import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HAWAII_DEMO_SYSTEM } from './hawaii-cqie-fixtures.mjs';

const CLINICAL_TYPES = ['Encounter', 'Condition', 'Observation', 'DocumentReference'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function verifyHawaiiBackend(config, credentials, fetchImpl = fetch) {
  const base = new URL(config.baseUrl);
  assert(!base.username && !base.password && !base.search && !base.hash && base.pathname === '/', 'Use an origin-only API URL');
  assert(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)),
    'Use HTTPS except for loopback test servers');
  assert(UUID.test(config.projectId) && UUID.test(config.allowedPatientId), 'Project and patient UUIDs are required');
  assert(Array.isArray(config.deniedPatientIds) && config.deniedPatientIds.length === 2 &&
    config.deniedPatientIds.every((id) => UUID.test(id)) &&
    new Set([config.allowedPatientId, ...config.deniedPatientIds]).size === 3, 'Use three distinct synthetic patient UUIDs');
  assert(credentials.clinicianToken && credentials.verifierToken && credentials.clinicianToken !== credentials.verifierToken,
    'Distinct clinician and fixture-verifier credentials are required');

  const get = async (role, relative) => {
    const response = await fetchImpl(new URL(relative, base), {
      method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${credentials[`${role}Token`]}`, Accept: 'application/fhir+json' },
    });
    const body = response.status === 200 ? await response.json() : undefined;
    return { status: response.status, body };
  };
  const entries = (body) => {
    assert(body?.resourceType === 'Bundle' && body.type === 'searchset', 'Expected a search Bundle');
    assert(!body.link?.some((link) => link.relation === 'next'), 'Fixture query must not be truncated');
    return (body.entry ?? []).filter((entry) => entry.search?.mode !== 'outcome').map((entry) => entry.resource);
  };
  const fixture = (resource, type) => {
    assert(resource?.resourceType === type && UUID.test(resource.id) &&
      resource.identifier?.some((identifier) => identifier.system === HAWAII_DEMO_SYSTEM), 'Expected an existing Hawaii synthetic fixture');
  };

  for (const role of ['clinician', 'verifier']) {
    const identity = await get(role, 'auth/me');
    assert(identity.status === 200 && identity.body?.project?.id === config.projectId, 'Credential project mismatch or unavailable identity');
  }
  const permitted = await get('clinician', `fhir/R4/Patient/${config.allowedPatientId}`);
  assert.equal(permitted.status, 200, 'Allowed patient must be readable with clinician credentials');
  fixture(permitted.body, 'Patient');

  let checked = 0;
  for (const patientId of [config.allowedPatientId, ...config.deniedPatientIds]) {
    const patient = await get('verifier', `fhir/R4/Patient/${patientId}`);
    assert.equal(patient.status, 200, 'Fixture verifier must prove the patient exists');
    fixture(patient.body, 'Patient');
    for (const type of CLINICAL_TYPES) {
      const patientParameter = type === 'DocumentReference' ? 'subject' : 'patient';
      const query = new URLSearchParams({ [patientParameter]: `Patient/${patientId}`, _count: '50' });
      const evidence = await get('verifier', `fhir/R4/${type}?${query}`);
      assert.equal(evidence.status, 200, 'Fixture verifier must prove the clinical data exists');
      const resources = entries(evidence.body);
      assert(resources.length > 0, 'Missing clinical fixtures cannot prove access enforcement');
      for (const resource of resources) {
        fixture(resource, type);
        assert.equal(resource.subject?.reference, `Patient/${patientId}`, 'Fixture subject mismatch');
      }
      const visible = await get('clinician', `fhir/R4/${type}?${query}`);
      const allowed = patientId === config.allowedPatientId;
      if (allowed) {
        assert.equal(visible.status, 200, 'Allowed clinical search must succeed');
        const ids = new Set(entries(visible.body).map((resource) => resource.id));
        assert(resources.every((resource) => ids.has(resource.id)), 'Allowed clinical fixtures must be visible');
      } else if (visible.status === 200) {
        assert.equal(entries(visible.body).length, 0, 'Denied clinical search leaked data');
      } else {
        assert([403, 404].includes(visible.status), 'Denied search must be filtered or forbidden, not unauthenticated');
      }
      for (const resource of resources) {
        const direct = await get('clinician', `fhir/R4/${type}/${resource.id}`);
        if (allowed) {
          assert.equal(direct.status, 200, 'Allowed direct clinical read must succeed');
          assert.equal(direct.body?.id, resource.id, 'Direct read returned the wrong resource');
        } else {
          assert([403, 404].includes(direct.status), 'Denied direct clinical read leaked data');
          const history = await get('clinician', `fhir/R4/${type}/${resource.id}/_history`);
          assert([403, 404].includes(history.status) ||
            (history.status === 200 && history.body?.resourceType === 'Bundle' && history.body.type === 'history' &&
              (history.body.entry ?? []).length === 0), 'Denied clinical history leaked data');
        }
        checked++;
      }
    }
  }
  return { clinicalResourcesChecked: checked, patientScenarios: 3 };
}

async function main() {
  assert(process.env.HAWAII_CQIE_PREFLIGHT_CONFIG, 'Set HAWAII_CQIE_PREFLIGHT_CONFIG to a private local configuration file');
  const configPath = path.resolve(process.env.HAWAII_CQIE_PREFLIGHT_CONFIG);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const readToken = async (file) => (await readFile(path.resolve(path.dirname(configPath), file), 'utf8')).trim();
  const result = await verifyHawaiiBackend(config, {
    clinicianToken: await readToken(config.clinicianTokenFile), verifierToken: await readToken(config.verifierTokenFile),
  });
  console.log(`PASS: ${result.patientScenarios} synthetic patient scenarios; ${result.clinicalResourcesChecked} clinical resources checked with GET-only requests.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('FAIL: Hawaii backend readiness was not established. Check private configuration, credentials, fixture existence, and access-policy enforcement. No credentials or resource bodies are logged.');
    process.exitCode = 1;
  });
}