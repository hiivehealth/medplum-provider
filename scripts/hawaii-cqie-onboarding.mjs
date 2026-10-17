import assert from 'node:assert/strict';
import { ClientStorage, MedplumClient, MemoryStorage } from '@medplum/core';
import { randomBytes } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildHawaiiOnboardingBundle } from './hawaii-cqie-fixtures.mjs';
import { loginHawaiiProject } from './hawaii-cqie-provision.mjs';

export const HAWAII_OPERATIONS_PROJECT = 'a901f66f-ace9-4895-a492-80364684194d';
export const HAWAII_OPERATIONS_BASE_URL = 'https://api.ehr.hiivehealth.net/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let phase = 'preflight';

export function buildHawaiiOperationsPolicy(snapshotId) {
  assert(UUID.test(snapshotId), 'An exact snapshot UUID is required');
  return { resourceType: 'AccessPolicy', name: 'Hawaii CQIE Read-Only Participant Operations', resource: [
    { resourceType: 'Basic', criteria: `Basic?${new URLSearchParams({ _id: snapshotId })}`, interaction: ['read', 'search'], readonly: true },
  ] };
}

export async function verifyHawaiiOperations(manifest, tokens, fetchImpl = fetch) {
  assert.equal(manifest.baseUrl, HAWAII_OPERATIONS_BASE_URL);
  assert.equal(manifest.projectId, HAWAII_OPERATIONS_PROJECT);
  assert(UUID.test(manifest.onboarding?.snapshotId) && UUID.test(manifest.allowedPatientId));
  const roles = ['operations', 'clinician', 'reviewer', 'other'];
  assert(roles.every((role) => typeof tokens[role] === 'string' && tokens[role].length > 0) &&
    new Set(roles.map((role) => tokens[role])).size === roles.length, 'Distinct scoped credentials are required');
  const request = async (role, endpoint) => {
    phase = endpoint === 'auth/me' ? `${role}-identity` : `${role}-${endpoint.split('/')[2]}-${endpoint.includes('?') ? 'search' : 'read'}`;
    const response = await fetchImpl(new URL(endpoint, HAWAII_OPERATIONS_BASE_URL), {
      method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${tokens[role]}`, Accept: 'application/fhir+json', 'Cache-Control': 'no-cache' },
    });
    return { status: response.status, body: await response.json() };
  };
  const identity = {};
  for (const role of roles) {
    const current = await request(role, 'auth/me');
    assert.equal(current.status, 200, 'Role authentication failed');
    assert.equal(current.body.project?.id, HAWAII_OPERATIONS_PROJECT, 'Role project mismatch');
    if (role === 'other' && current.body.membership?.admin === undefined) {
      assert.equal(current.body.profile?.resourceType, 'ClientApplication', 'An omitted admin flag is accepted only for the expected existing client');
      assert.equal(current.body.profile.id, manifest.followUp?.otherClient?.clientId, 'Existing client identity mismatch');
      assert(UUID.test(current.body.profile.id), 'Existing client UUID required');
    } else { assert.equal(current.body.membership?.admin, false, 'Roles must not be project administrators'); }
    identity[role] = current.body.profile;
  }
  const entries = (result) => {
    assert.equal(result.status, 200, 'Expected successful FHIR search');
    assert.equal(result.body.resourceType, 'Bundle');
    assert.equal(result.body.type, 'searchset');
    return (result.body.entry ?? []).map((entry) => entry.resource);
  };
  const deniedRead = async (role, reference) => {
    const response = await request(role, `fhir/R4/${reference}`);
    assert([403, 404].includes(response.status), 'Direct-read access leaked or authentication failed');
  };
  const deniedSearch = async (role, type) => {
    const result = await request(role, `fhir/R4/${type}?_count=2`);
    assert(result.status === 403 || (result.status === 200 && entries(result).length === 0), 'Search access leaked or authentication failed');
  };
  const snapshot = await request('operations', `fhir/R4/Basic/${manifest.onboarding.snapshotId}`);
  assert.equal(snapshot.status, 200, 'Operations must read the persisted snapshot');
  assert.equal(snapshot.body.id, manifest.onboarding.snapshotId);
  if (snapshot.body.meta?.project !== undefined) { assert.equal(snapshot.body.meta.project, HAWAII_OPERATIONS_PROJECT); }
  const expected = buildHawaiiOnboardingBundle().entry[0].resource;
  assert.deepEqual(snapshot.body.identifier, expected.identifier, 'Unexpected operational identifier');
  assert.deepEqual(snapshot.body.extension, expected.extension, 'Persisted snapshot differs from reviewed fixture');
  assert(snapshot.body.meta.versionId, 'Persisted snapshot version required');
  const all = entries(await request('operations', 'fhir/R4/Basic?_count=2'));
  assert.equal(all.length, 1);
  assert.equal(all[0].id, snapshot.body.id);
  for (const role of ['clinician', 'reviewer', 'other']) {
    await deniedSearch(role, 'Basic');
    await deniedRead(role, `Basic/${snapshot.body.id}`);
  }
  const references = [`Patient/${manifest.allowedPatientId}`];
  for (const type of ['Consent', 'Encounter', 'Condition', 'Observation', 'DocumentReference', 'Task']) {
    const resources = entries(await request('clinician', `fhir/R4/${type}?_count=2`));
    assert(resources.length > 0 && resources.every((resource) => UUID.test(resource.id)), 'A real clinician-visible fixture is required');
    references.push(`${type}/${resources[0].id}`);
  }
  const audits = entries(await request('reviewer', 'fhir/R4/AuditEvent?_count=1'));
  assert(audits.length === 1 && UUID.test(audits[0].id), 'A real reviewer-visible AuditEvent is required');
  references.push(`AuditEvent/${audits[0].id}`);
  for (const reference of references) {
    await deniedSearch('operations', reference.split('/')[0]);
    await deniedRead('operations', reference);
  }
  const again = await request('operations', `fhir/R4/Basic/${snapshot.body.id}`);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, snapshot.body, 'Read-only verification must preserve the persisted snapshot');
  return { projectId: HAWAII_OPERATIONS_PROJECT, snapshotId: snapshot.body.id, versionId: snapshot.body.meta.versionId,
    verifiedAt: new Date().toISOString(), operationsReadSearch: true, otherRolesDenied: ['clinician', 'reviewer', 'other'],
    operationsDeniedResources: references.map((reference) => reference.split('/')[0]),
    snapshotUnchanged: true, fhirWrites: 0, profileReference: `${identity.operations.resourceType}/${identity.operations.id}` };
}

async function administrator() {
  assert(process.env.HAWAII_CQIE_ADMIN_LOGIN_REFERENCE, 'A documented administrator login reference is required');
  const reference = await readFile(process.env.HAWAII_CQIE_ADMIN_LOGIN_REFERENCE, 'utf8');
  const rows = reference.split('\n').filter((line) => line.startsWith('| Initial '))
    .map((line) => line.split('|').map((cell) => cell.trim().replaceAll('`', '')));
  const account = { email: rows.find((row) => row[1] === 'Initial email')?.[2], password: rows.find((row) => row[1] === 'Initial password')?.[2] };
  assert(account.email && account.password, 'Administrator login reference is incomplete');
  const admin = await loginHawaiiProject(HAWAII_OPERATIONS_BASE_URL, account, undefined, true);
  assert.equal((await admin.readResource('Project', HAWAII_OPERATIONS_PROJECT)).name, 'Hawaii CQIE Synthetic Demo');
  return admin;
}

async function setup(manifest, save) {
  phase = 'administrator-project-preflight';
  const admin = await administrator();
  const protectedReferences = [
    ...Object.values(manifest.policies).map((id) => `AccessPolicy/${id}`),
    ...Object.values(manifest.followUp.policies).map((id) => `AccessPolicy/${id}`),
    ...['clinician', 'reviewer'].map((role) => `ProjectMembership/${manifest.accounts[role].membershipId}`),
  ];
  const read = (reference) => admin.readResource(...reference.split('/'), { cache: 'no-cache' });
  const before = await Promise.all(protectedReferences.map(read));
  assert(before.every((resource) => resource.meta?.project === HAWAII_OPERATIONS_PROJECT ||
    resource.project?.reference === `Project/${HAWAII_OPERATIONS_PROJECT}`));
  const state = manifest.onboarding ??= { stage: 'starting', startedAt: new Date().toISOString() };
  await save();
  phase = 'conditional-operational-snapshot';
  const seed = buildHawaiiOnboardingBundle().entry[0];
  const snapshot = state.snapshotId ? await admin.readResource('Basic', state.snapshotId) :
    await admin.createResourceIfNoneExist({ ...seed.resource, meta: { project: HAWAII_OPERATIONS_PROJECT } }, seed.request.ifNoneExist);
  assert.equal(snapshot.meta?.project, HAWAII_OPERATIONS_PROJECT, 'Snapshot must belong to the approved project');
  assert.deepEqual(snapshot.extension, seed.resource.extension, 'Existing operational evidence differs; do not overwrite');
  state.snapshotId = snapshot.id;
  state.snapshotVersion = snapshot.meta.versionId;
  state.stage = 'snapshot-created';
  await save();
  phase = 'snapshot-scoped-policy';
  const expectedPolicy = buildHawaiiOperationsPolicy(snapshot.id);
  const policy = state.policyId ? await admin.readResource('AccessPolicy', state.policyId) :
    await admin.createResourceIfNoneExist({ ...expectedPolicy, meta: { project: HAWAII_OPERATIONS_PROJECT } },
      new URLSearchParams({ name: expectedPolicy.name }).toString());
  assert.equal(policy.meta?.project, HAWAII_OPERATIONS_PROJECT);
  assert.deepEqual(policy.resource, expectedPolicy.resource);
  state.policyId = policy.id;
  await save();
  phase = 'separate-operations-membership';
  if (!state.account?.membershipId) {
    assert(!state.invitationAttempted, 'Inspect the previous invite before retrying; do not create duplicate memberships');
    state.account = { email: `hawaii.cqie.operations.${HAWAII_OPERATIONS_PROJECT.slice(0, 8)}@example.com`,
      password: `Hiive-${randomBytes(24).toString('base64url')}!7a` };
    state.invitationAttempted = true;
    await save();
    const membership = await admin.post(`admin/projects/${HAWAII_OPERATIONS_PROJECT}/invite`, {
      resourceType: 'Practitioner', firstName: 'Hawaii Demo', lastName: 'Operations', ...state.account,
      scope: 'project', sendEmail: false, membership: { admin: false, accessPolicy: { reference: `AccessPolicy/${policy.id}` } },
    });
    state.account.membershipId = membership.id;
    await save();
  }
  const membership = await admin.readResource('ProjectMembership', state.account.membershipId);
  assert.equal(membership.project?.reference, `Project/${HAWAII_OPERATIONS_PROJECT}`);
  assert.equal(membership.admin, false);
  assert.equal(membership.accessPolicy?.reference, `AccessPolicy/${policy.id}`);
  assert.deepEqual(await Promise.all(protectedReferences.map(read)), before, 'Existing memberships and policies must remain unchanged');
  state.stage = 'scoped-role-created';
  state.existingPoliciesUnchanged = true;
  await save();
  console.log(JSON.stringify({ projectId: HAWAII_OPERATIONS_PROJECT, snapshotId: snapshot.id,
    policyId: policy.id, membershipId: membership.id, existingPoliciesUnchanged: true, serverChanged: false }));
}

async function verify(manifest, directory) {
  phase = 'role-logins';
  assert.equal(manifest.onboarding?.stage, 'scoped-role-created');
  const clients = {};
  for (const role of ['operations', 'clinician', 'reviewer']) {
    phase = `${role}-login`;
    clients[role] = await loginHawaiiProject(HAWAII_OPERATIONS_BASE_URL,
      role === 'operations' ? manifest.onboarding.account : manifest.accounts[role], HAWAII_OPERATIONS_PROJECT);
  }
  phase = 'other-login';
  clients.other = new MedplumClient({ baseUrl: HAWAII_OPERATIONS_BASE_URL, storage: new ClientStorage(new MemoryStorage()) });
  await clients.other.startClientLogin(manifest.followUp.otherClient.clientId, manifest.followUp.otherClient.clientSecret);
  phase = 'read-only-access-boundaries';
  const report = await verifyHawaiiOperations(manifest, Object.fromEntries(Object.entries(clients).map(([role, client]) => [role, client.getAccessToken()])));
  phase = 'rejected-snapshot-update';
  const snapshot = await clients.operations.readResource('Basic', manifest.onboarding.snapshotId, { cache: 'no-cache' });
  const response = await fetch(new URL(`fhir/R4/Basic/${snapshot.id}`, HAWAII_OPERATIONS_BASE_URL), {
    method: 'PUT', redirect: 'error', headers: { Authorization: `Bearer ${clients.operations.getAccessToken()}`,
      'Content-Type': 'application/fhir+json', 'If-Match': `W/"${snapshot.meta.versionId}"` }, body: JSON.stringify(snapshot),
  });
  assert([403, 404].includes(response.status), 'The read-only operations user must not update the snapshot');
  const after = await clients.operations.readResource('Basic', snapshot.id, { cache: 'no-cache' });
  assert.deepEqual(after, snapshot, 'Rejected update must not change the snapshot');
  report.rejectedIdenticalUpdate = { status: response.status, persistedVersionUnchanged: true };
  await writeFile(path.join(directory, 'onboarding-check.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ passed: true, ...report }));
}

async function main() {
  assert(process.argv.length === 3 && ['--apply', '--verify', '--check'].includes(process.argv[2]), 'Choose --apply, --verify, or --check');
  if (process.argv[2] === '--check') {
    buildHawaiiOperationsPolicy(HAWAII_OPERATIONS_PROJECT);
    assert.equal(buildHawaiiOnboardingBundle().entry.length, 1);
    console.log('PASS: one separate operational snapshot and an exact-ID read-only policy; no network calls.');
    return;
  }
  const directory = path.resolve('hawaii-cqie.local');
  const filename = path.join(directory, 'provisioning.json');
  assert.equal((await stat(directory)).mode & 0o777, 0o700, 'Private directory must be owner-only');
  assert.equal((await stat(filename)).mode & 0o777, 0o600, 'Private manifest must be owner-only');
  const manifest = JSON.parse(await readFile(filename, 'utf8'));
  assert.equal(manifest.baseUrl, HAWAII_OPERATIONS_BASE_URL);
  assert.equal(manifest.projectId, HAWAII_OPERATIONS_PROJECT);
  assert.equal(manifest.stage, 'preflight-passed');
  const save = () => writeFile(filename, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  if (process.argv[2] === '--apply') { await setup(manifest, save); }
  else { await verify(manifest, directory); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    if (error?.code === 'ERR_ASSERTION') { console.error(`PRECONDITION_FAILED: ${error.message.split('\n')[0]}`); }
    console.error(`ONBOARDING_STOPPED at ${phase}. Inspect the private manifest before retrying; no credentials or resource bodies are printed.`);
    process.exitCode = 1;
  });
}