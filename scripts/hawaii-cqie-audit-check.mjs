import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ClientStorage, MedplumClient, MemoryStorage } from '@medplum/core';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loginHawaiiProject } from './hawaii-cqie-provision.mjs';

const BASE_URL = 'https://api.ehr.hiivehealth.net/';
const PROJECT_ID = 'a901f66f-ace9-4895-a492-80364684194d';
const CLUSTER = 'MedplumBuild-BackEndCluster6B6DC4A8-RJc8IRf3ENQc';
const SERVICE = 'MedplumBuild-BackEndFargateServiceD3B260C0-VHHbzrR6nDGn';

export async function verifyHawaiiAuditEvidence(config, credentials, fetchImpl = fetch) {
  const base = new URL(config.baseUrl);
  assert(base.protocol === 'https:' && base.origin === BASE_URL.slice(0, -1) && base.pathname === '/' &&
    !base.username && !base.password && !base.search && !base.hash, 'Only the approved Hiive API origin may be queried');
  assert.equal(config.projectId, PROJECT_ID, 'Only the isolated Hawaii project may be checked');
  assert(Array.isArray(config.deniedPatientIds) && config.deniedPatientIds.length === 2 &&
    [config.allowedPatientId, ...config.deniedPatientIds].every((id) => /^[0-9a-f-]{36}$/i.test(id)) &&
    new Set([config.allowedPatientId, ...config.deniedPatientIds]).size === 3, 'Three distinct synthetic patient UUIDs are required');
  assert(['clinicianToken', 'reviewerToken', 'verifierToken'].every((key) => credentials[key]) &&
    new Set(Object.values(credentials)).size === 3, 'Three distinct scoped credentials are required');
  const requests = [];
  const get = async (role, relative) => {
    const response = await fetchImpl(new URL(relative, base), { method: 'GET', redirect: 'error',
      cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${credentials[`${role}Token`]}`, Accept: 'application/fhir+json' },
    });
    const body = response.status === 200 ? await response.json() : undefined;
    requests.push({ role, path: relative, status: response.status });
    return { status: response.status, body };
  };
  const entries = (response) => {
    assert.equal(response.status, 200, 'Expected authenticated search access');
    assert.equal(response.body?.resourceType, 'Bundle', 'Expected a search Bundle');
    assert.equal(response.body.type, 'searchset', 'Expected search results');
    return (response.body.entry ?? []).filter((entry) => entry.search?.mode !== 'outcome').map((entry) => entry.resource);
  };
  const identities = {};
  for (const role of ['clinician', 'reviewer', 'verifier']) {
    const identity = await get(role, 'auth/me');
    assert(identity.status === 200 && identity.body?.project?.id === config.projectId, 'Credential project mismatch or unavailable identity');
    assert(identity.body.profile?.resourceType && identity.body.profile.id, 'Authenticated profile required');
    identities[role] = `${identity.body.profile.resourceType}/${identity.body.profile.id}`;
  }
  const clinicianAudit = await get('clinician', 'fhir/R4/AuditEvent?_count=1');
  assert([403, 404].includes(clinicianAudit.status) ||
    (clinicianAudit.status === 200 && entries(clinicianAudit).length === 0), 'Clinician must not discover audit records');
  const reviewerAudit = await get('reviewer', 'fhir/R4/AuditEvent?_sort=-date&_count=20');
  const recentAuditEvents = entries(reviewerAudit);
  assert(recentAuditEvents.length > 0, 'Real audit records are required to prove reviewer access');
  const sampleAuditId = recentAuditEvents[0].id;
  assert(sampleAuditId, 'A persisted audit ID is required');
  const directAudit = await get('clinician', `fhir/R4/AuditEvent/${sampleAuditId}`);
  assert([403, 404].includes(directAudit.status), 'Clinician direct audit read must be denied');
  const reviewerPatient = await get('reviewer', `fhir/R4/Patient/${config.allowedPatientId}`);
  assert([403, 404].includes(reviewerPatient.status), 'Audit reviewer must not read the clinical patient record');
  const reviewerObservations = await get('reviewer', `fhir/R4/Observation?${new URLSearchParams({
    patient: `Patient/${config.allowedPatientId}`, _count: '1',
  })}`);
  assert([403, 404].includes(reviewerObservations.status) ||
    (reviewerObservations.status === 200 && entries(reviewerObservations).length === 0), 'Reviewer clinical search must be filtered or denied');

  const probes = [];
  const searchProbes = [];
  for (const patientId of [config.allowedPatientId, ...config.deniedPatientIds]) {
    const fixtures = entries(await get('verifier', `fhir/R4/Observation?${new URLSearchParams({
      patient: `Patient/${patientId}`, _count: '1',
    })}`));
    assert(fixtures[0]?.resourceType === 'Observation' && fixtures[0].id &&
      fixtures[0].subject?.reference === `Patient/${patientId}`, 'A real patient-bound clinical fixture is required');
    const reference = `Observation/${fixtures[0].id}`;
    const auditPath = `fhir/R4/AuditEvent?${new URLSearchParams({ entity: reference, _sort: '-date', _count: '100' })}`;
    const baseline = await get('reviewer', auditPath);
    const baselineIds = new Set(entries(baseline).map((event) => event.id));
    const requestedAt = new Date().toISOString();
    const response = await get('clinician', `fhir/R4/${reference}`);
    const allowed = patientId === config.allowedPatientId;
    assert(allowed ? response.status === 200 && response.body?.id === fixtures[0].id : [403, 404].includes(response.status),
      'Clinical probe must prove a real allowed or denied request, not an authentication failure');
    const after = await get('reviewer', auditPath);
    const newEvents = entries(after).filter((event) => !baselineIds.has(event.id));
    const matching = newEvents.filter((event) => event.resourceType === 'AuditEvent' && event.action === 'R' &&
      Date.parse(event.recorded) >= Date.parse(requestedAt) &&
      event.entity?.some((entity) => entity.what?.reference === reference) &&
      event.agent?.some((agent) => agent.requestor && agent.who?.reference === identities.clinician) &&
      (allowed ? event.outcome === '0' : ['4', '8', '12'].includes(event.outcome)));
    const truncated = [baseline, after].some((result) => result.body.link?.some((link) => link.relation === 'next'));
    probes.push({ scenario: allowed ? 'allowed' : patientId === config.deniedPatientIds[0] ? 'opted-out' : 'not-declared',
      reference, requestedAt, checkedAt: new Date().toISOString(), httpStatus: response.status,
      coverage: matching.length ? 'observed' : truncated ? 'inconclusive-window' : 'not-observed-in-window',
      matchingAuditIds: matching.map((event) => event.id), newUncorrelatedRecords: newEvents.length - matching.length });
    const reviewerClinical = await get('reviewer', `fhir/R4/${reference}`);
    assert([403, 404].includes(reviewerClinical.status), 'Reviewer direct clinical read must be denied');
    const searchStartedAt = new Date().toISOString();
    const searchResult = await get('clinician', `fhir/R4/Observation?${new URLSearchParams({
      patient: `Patient/${patientId}`, _count: '1',
    })}`);
    const searchEntries = entries(searchResult);
    assert(allowed ? searchEntries.length === 1 && searchEntries[0].subject?.reference === `Patient/${patientId}` :
      searchEntries.length === 0, 'Clinical search must return only permitted patient data');
    searchProbes.push({ scenario: probes.at(-1).scenario, patientReference: `Patient/${patientId}`,
      requestedAt: searchStartedAt, checkedAt: new Date().toISOString(), httpStatus: searchResult.status,
      resultCount: searchEntries.length });
  }
  return { projectId: config.projectId, checkedAt: new Date().toISOString(),
    clinicianReference: identities.clinician,
    roleSeparation: { clinicianAuditSearchDenied: true, clinicianAuditReadDenied: true,
      reviewerAuditVisible: true, reviewerClinicalSearchDenied: true, reviewerPatientReadDenied: true, reviewerClinicalReadsDenied: true },
    probes, searchProbes, recentAuditEvents, requests,
    limitations: ['GET-only probes do not change clinical data, consent, roles, or follow-up state.',
      'Not observed means no newly correlated event in this immediate bounded query window, not proof that no audit exists elsewhere or arrives later.',
      'Candidate matches require a new ID, current timestamp, actor, resource, read action, and compatible outcome; they do not provide a unique request trace correlation.',
      'Subscription execution records do not establish clinical-access audit coverage.',
      'This does not certify comprehensive auditing, dynamic consent, Part 2, exception access, or alternate/export paths.'],
  };
}

export function verifyHawaiiCloudWatchEvidence(evidence, logEvents) {
  assert.equal(evidence.projectId, PROJECT_ID, 'Only isolated Hawaii evidence may be matched');
  assert(evidence.clinicianReference && evidence.probes?.length === 3 && evidence.searchProbes?.length === 3,
    'Fresh direct-read and search evidence is required');
  const records = logEvents.flatMap((entry) => {
    try { return [{ event: JSON.parse(entry.message), eventId: entry.eventId, stream: entry.logStreamName }]; }
    catch { return []; }
  });
  const verify = (probe, interaction) => {
    const matches = records.filter(({ event }) => {
      if (event.resourceType !== 'AuditEvent' || event.meta?.project !== PROJECT_ID || event.action !== 'R' ||
        !event.subtype?.some((subtype) => subtype.code === interaction) ||
        !event.agent?.some((agent) => agent.requestor && agent.who?.reference === evidence.clinicianReference) ||
        !(Date.parse(event.recorded) >= Date.parse(probe.requestedAt) &&
          Date.parse(event.recorded) <= Date.parse(probe.checkedAt) + 1000) ||
        event.outcome !== (interaction === 'read' && probe.scenario !== 'allowed' ? '4' : '0')) { return false; }
      return event.entity?.some((entity) => {
        if (interaction === 'read') { return entity.what?.reference === probe.reference; }
        if (!entity.query) { return false; }
        try {
          const query = new URL(entity.query, `${BASE_URL}fhir/R4/`);
          return query.origin === new URL(BASE_URL).origin && query.pathname === '/fhir/R4/Observation' &&
            query.searchParams.get('patient') === probe.patientReference && query.searchParams.get('_count') === '1';
        } catch { return false; }
      });
    });
    assert(matches.length > 0, `No correlated CloudWatch ${interaction} evidence for ${probe.scenario}`);
    for (const { event } of matches) {
      assert(!event.source?.observer?.display && !event.agent?.some((agent) => agent.who?.display) &&
        !event.entity?.some((entity) => entity.what?.display), 'Reference display-name redaction must be active');
    }
    return { scenario: probe.scenario, interaction, httpStatus: probe.httpStatus,
      resultCount: probe.resultCount, target: probe.reference ?? probe.patientReference,
      matchedEvents: matches.map(({ event, eventId, stream }) => ({ eventId, stream, recorded: event.recorded,
        action: event.action, outcome: event.outcome })), referenceDisplaysRedacted: true };
  };
  return { projectId: PROJECT_ID, destination: '/ecs/medplum/build', checkedAt: new Date().toISOString(),
    checks: [...evidence.probes.map((probe) => verify(probe, 'read')),
      ...evidence.searchProbes.map((probe) => verify(probe, 'search'))],
    limitations: ['Actor/target/action/outcome and bounded timestamps are correlated, not a unique request trace.',
      'A filtered-out search is a successful query with zero results, not a server error.',
      'Redaction removes reference display names, not identifiers, network addresses, or search query values.',
      'This does not persist clinical-access AuditEvents in FHIR or certify complete audit coverage.'] };
}

export function verifyHawaiiTargetHealth(targets, containers) {
  assert(containers.length === 1 && containers[0].addresses?.length > 0, 'Running task address required');
  const active = targets.filter((target) => target.state !== 'draining');
  assert(active.length === 1 && active[0].state === 'healthy' && containers[0].addresses.includes(active[0].id),
    'The running task must own the healthy active target; only old targets may drain');
  return { activeHealthyTargets: active.length, drainingTargets: targets.length - active.length };
}

async function verifyCloudWatch() {
  const directory = path.resolve('hawaii-cqie.local');
  const evidence = JSON.parse(await readFile(path.join(directory, 'audit-check.json'), 'utf8'));
  assert.equal(evidence.projectId, PROJECT_ID);
  const started = Math.min(...evidence.probes.map((probe) => Date.parse(probe.requestedAt)));
  assert(Number.isFinite(started) && Date.now() - started < 30 * 60 * 1000 && started <= Date.now(),
    'Only fresh bounded evidence may be queried');
  const aws = (args) => JSON.parse(execFileSync('aws', [...args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'], {
    env: { ...process.env, AWS_PROFILE: 'hiive-build', AWS_SDK_LOAD_CONFIG: '1', AWS_PAGER: '' },
    encoding: 'utf8', maxBuffer: 5 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
  }));
  assert.equal(aws(['sts', 'get-caller-identity']).Account, '476905305808', 'Wrong AWS account');
  const parameters = aws(['ssm', 'get-parameters', '--names', '/medplum/build/logAuditEvents',
    '/medplum/build/redactAuditEvents', '/medplum/build/saveAuditEvents', '--query',
    '{Parameters:Parameters[].{Name:Name,Value:Value,Version:Version},InvalidParameters:InvalidParameters}']);
  for (const name of ['logAuditEvents', 'redactAuditEvents']) {
    assert(parameters.Parameters.some((parameter) => parameter.Name === `/medplum/build/${name}` && parameter.Value === 'true'),
      'Expected shared audit logging/redaction parameters');
  }
  assert(parameters.InvalidParameters.includes('/medplum/build/saveAuditEvents'), 'FHIR persistence must remain unchanged');
  const service = aws(['ecs', 'describe-services', '--cluster', CLUSTER, '--services', SERVICE, '--query',
    'services[0].{running:runningCount,pending:pendingCount,taskDefinition:taskDefinition,deployments:deployments[].{id:id,rolloutState:rolloutState}}']);
  assert(service.running === 1 && service.pending === 0 && service.deployments.length === 1 &&
    service.deployments[0].rolloutState === 'COMPLETED' &&
    service.taskDefinition.endsWith('/MedplumBuildBackEndTaskDefinition25DAB390:6'), 'Stable approved capacity task definition required');
  const capacity = aws(['ecs', 'describe-task-definition', '--task-definition', service.taskDefinition, '--query',
    'taskDefinition.{memory:memory,cpu:cpu}']);
  assert(capacity.memory === '1024' && capacity.cpu === '256', 'Only approved memory/CPU capacity is allowed');
  const targets = aws(['elbv2', 'describe-target-health', '--target-group-arn',
    'arn:aws:elasticloadbalancing:us-east-1:476905305808:targetgroup/Medplu-BackE-USDVZ8TUROL5/19eacf89e7c148a5',
    '--query', 'TargetHealthDescriptions[].{id:Target.Id,state:TargetHealth.State}']);
  const tasks = aws(['ecs', 'list-tasks', '--cluster', CLUSTER, '--service-name', SERVICE, '--desired-status', 'RUNNING']);
  assert.equal(tasks.taskArns.length, 1, 'Exactly one settled backend task required');
  const containers = aws(['ecs', 'describe-tasks', '--cluster', CLUSTER, '--tasks', tasks.taskArns[0], '--query',
    'tasks[0].containers[].{name:name,image:image,imageDigest:imageDigest,addresses:networkInterfaces[].privateIpv4Address}']);
  assert(containers.length === 1 && containers[0].imageDigest ===
    'sha256:5dcb8b0a4c0ce4423be8c6edfc8137c5891456e524084abd1050e7671a8b3004', 'Backend image must remain unchanged');
  const targetHealth = verifyHawaiiTargetHealth(targets, containers);
  const logs = aws(['logs', 'filter-log-events', '--log-group-name', '/ecs/medplum/build',
    '--start-time', String(started), '--end-time', String(Date.now()), '--filter-pattern',
    `{ $.resourceType = "AuditEvent" && $.meta.project = "${PROJECT_ID}" }`]);
  const result = verifyHawaiiCloudWatchEvidence(evidence, logs.events ?? []);
  result.runtime = { parameters, service, capacity, targets, targetHealth, taskArn: tasks.taskArns[0], containers };
  await writeFile(path.join(directory, 'audit-cloudwatch-check.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result));
}

async function main() {
  if (process.argv.includes('--verify-cloudwatch')) { return verifyCloudWatch(); }
  const directory = path.resolve('hawaii-cqie.local');
  const manifest = JSON.parse(await readFile(path.join(directory, 'provisioning.json'), 'utf8'));
  assert(manifest.baseUrl === BASE_URL && manifest.projectId === PROJECT_ID && manifest.stage === 'preflight-passed', 'A verified isolated Hawaii project is required');
  const clinician = await loginHawaiiProject(BASE_URL, manifest.accounts.clinician, PROJECT_ID);
  const reviewer = await loginHawaiiProject(BASE_URL, manifest.accounts.reviewer, PROJECT_ID);
  const verifier = new MedplumClient({ baseUrl: BASE_URL, storage: new ClientStorage(new MemoryStorage()) });
  await verifier.startClientLogin(manifest.verifier.clientId, manifest.verifier.clientSecret);
  const result = await verifyHawaiiAuditEvidence(manifest, {
    clinicianToken: clinician.getAccessToken(), reviewerToken: reviewer.getAccessToken(), verifierToken: verifier.getAccessToken(),
  });
  await writeFile(path.join(directory, 'audit-check.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ projectId: result.projectId, roleSeparation: result.roleSeparation,
    probes: result.probes, searchProbes: result.searchProbes, evidenceFile: path.join(directory, 'audit-check.json'),
    auditCompletenessEstablished: false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('AUDIT_CHECK_FAILED: role separation or live evidence was not established. No credentials or response bodies are printed.');
    process.exitCode = 1;
  });
}