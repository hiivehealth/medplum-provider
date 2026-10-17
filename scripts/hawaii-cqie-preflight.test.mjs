import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHawaiiOnboardingBundle, HAWAII_DEMO_SYSTEM } from './hawaii-cqie-fixtures.mjs';
import { buildOperationsPreviewResponse } from './hawaii-cqie-browser-check.mjs';
import { buildHawaiiOperationsPolicy, HAWAII_OPERATIONS_BASE_URL, HAWAII_OPERATIONS_PROJECT, verifyHawaiiOperations } from './hawaii-cqie-onboarding.mjs';
import { verifyHawaiiBackend } from './hawaii-cqie-preflight.mjs';
import { buildHawaiiPolicies } from './hawaii-cqie-provision.mjs';
import { verifyHawaiiAuditEvidence, verifyHawaiiCloudWatchEvidence, verifyHawaiiTargetHealth } from './hawaii-cqie-audit-check.mjs';
import { buildHawaiiFollowUpPolicies, DISCHARGE_SYSTEM, FOLLOW_UP_SYSTEM } from './hawaii-cqie-follow-up.mjs';

const ids = [1, 2, 3].map((value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`);
const config = { baseUrl: 'http://127.0.0.1:8103/', projectId: ids[0], allowedPatientId: ids[0], deniedPatientIds: ids.slice(1) };
const credentials = { clinicianToken: 'test-clinician-only', verifierToken: 'test-verifier-only' };

test('operations policy permits only read/search of the exact snapshot, with no clinical, audit, Task or write grants', () => {
  const policy = buildHawaiiOperationsPolicy(ids[0]);
  assert.deepEqual(policy.resource, [{ resourceType: 'Basic', criteria: `Basic?_id=${ids[0]}`,
    interaction: ['read', 'search'], readonly: true }]);
  for (const invalid of ['', undefined, 'Basic/123', `${ids[0]},${ids[1]}`, `${ids[0]}&_count=100`]) {
    assert.throws(() => buildHawaiiOperationsPolicy(invalid));
  }
});

function operationsBackend({ wrongProject = false, clinicalLeak = false, operationalLeak = false, admin = false, missingFixture = false,
  omittedOtherAdmin = false, wrongClient = false, omittedSnapshotProject = false, wrongSnapshotProject = false } = {}) {
  const calls = [];
  const snapshot = { ...buildHawaiiOnboardingBundle().entry[0].resource, id: ids[0], meta: { project: HAWAII_OPERATIONS_PROJECT, versionId: '1' } };
  if (omittedSnapshotProject) { delete snapshot.meta.project; }
  if (wrongSnapshotProject) { snapshot.meta.project = ids[2]; }
  const fakeFetch = async (url, options) => {
    calls.push({ method: options.method, path: url.pathname });
    const role = options.headers.Authorization.replace('Bearer test-', '');
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
    const bundle = (resources) => reply({ resourceType: 'Bundle', type: 'searchset', entry: resources.map((resource) => ({ resource })) });
    if (url.pathname === '/auth/me') {
      return reply({ project: { id: wrongProject ? ids[2] : HAWAII_OPERATIONS_PROJECT },
        membership: role === 'other' && omittedOtherAdmin ? {} : { admin },
        profile: role === 'other' && omittedOtherAdmin ? { resourceType: 'ClientApplication', id: wrongClient ? ids[1] : ids[2] } :
          { resourceType: 'Practitioner', id: role } });
    }
    const type = url.pathname.split('/')[3];
    if (type === 'Basic') {
      if (role !== 'operations' && !operationalLeak) { return reply({}, 403); }
      return url.pathname.endsWith(ids[0]) ? reply(snapshot) : bundle([snapshot]);
    }
    if (role === 'operations' && !clinicalLeak) { return reply({}, 403); }
    return bundle(missingFixture ? [] : [{ resourceType: type, id: ids[1] }]);
  };
  return { fakeFetch, calls };
}

const operationsManifest = { baseUrl: HAWAII_OPERATIONS_BASE_URL, projectId: HAWAII_OPERATIONS_PROJECT,
  allowedPatientId: ids[0], onboarding: { snapshotId: ids[0] }, followUp: { otherClient: { clientId: ids[2] } } };
const operationsTokens = Object.fromEntries(['operations', 'clinician', 'reviewer', 'other'].map((role) => [role, `test-${role}`]));

test('operations verifier proves actual snapshot reads and role denials using GET only', async () => {
  const { fakeFetch, calls } = operationsBackend();
  const report = await verifyHawaiiOperations(operationsManifest, operationsTokens, fakeFetch);
  assert(report.snapshotUnchanged && report.operationsReadSearch);
  assert.equal(report.fhirWrites, 0);
  assert.equal(report.operationsDeniedResources.length, 8);
  assert.deepEqual(report.otherRolesDenied, ['clinician', 'reviewer', 'other']);
  assert(calls.every((call) => call.method === 'GET'));
});

test('operations verifier handles the native omitted admin flag only for the exact existing other-practice client', async () => {
  await verifyHawaiiOperations(operationsManifest, operationsTokens, operationsBackend({ omittedOtherAdmin: true }).fakeFetch);
  await assert.rejects(verifyHawaiiOperations(operationsManifest, operationsTokens,
    operationsBackend({ omittedOtherAdmin: true, wrongClient: true }).fakeFetch));
});

test('operations verifier accepts scoped metadata omission but rejects a supplied foreign snapshot project', async () => {
  await verifyHawaiiOperations(operationsManifest, operationsTokens, operationsBackend({ omittedSnapshotProject: true }).fakeFetch);
  await assert.rejects(verifyHawaiiOperations(operationsManifest, operationsTokens, operationsBackend({ wrongSnapshotProject: true }).fakeFetch));
});

for (const [name, config] of [
  ['wrong project', { wrongProject: true }], ['admin role', { admin: true }],
  ['clinical access leak', { clinicalLeak: true }], ['operational access leak', { operationalLeak: true }],
  ['missing real fixture', { missingFixture: true }],
]) {
  test(`operations verifier rejects ${name}`, async () => {
    await assert.rejects(verifyHawaiiOperations(operationsManifest, operationsTokens, operationsBackend(config).fakeFetch));
  });
}

test('operations verifier rejects unsafe environment or duplicate credentials before network access', async () => {
  const fetchImpl = () => { throw new Error('Unexpected network access'); };
  await assert.rejects(verifyHawaiiOperations({ ...operationsManifest, baseUrl: 'http://foreign.invalid/' }, operationsTokens, fetchImpl));
  await assert.rejects(verifyHawaiiOperations(operationsManifest, { ...operationsTokens, other: operationsTokens.operations }, fetchImpl));
});

test('operations preview substitutes duplicate reads and preserves ordered native responses for other reads', async () => {
  const resource = buildHawaiiOnboardingBundle().entry[0].resource;
  const search = { request: { method: 'GET', url: `Basic?identifier=${encodeURIComponent(`${resource.identifier[0].system}|${resource.identifier[0].value}`)}` } };
  const other = { request: { method: 'GET', url: 'Organization?_count=1' } };
  const native = { response: { status: '403 Forbidden' }, resource: { resourceType: 'OperationOutcome' } };
  let forwarded = 0;
  const rootRelative = { request: { ...search.request, url: `/${search.request.url}` } };
  const bundle = { resourceType: 'Bundle', type: 'batch', entry: [rootRelative, other, search] };
  const result = await buildOperationsPreviewResponse(bundle, resource, false, async (request) => {
    forwarded++;
    assert.deepEqual(request.entry, [other]);
    return { resourceType: 'Bundle', type: 'batch-response', entry: [native] };
  });
  assert.equal(result.interceptedReads, 2);
  assert.equal(result.body.entry[0].resource.entry[0].resource, resource);
  assert.equal(result.body.entry[1], native);
  assert.equal(result.body.entry[2].response.status, '200 OK');
  const denied = await buildOperationsPreviewResponse({ ...bundle, entry: [search] }, resource, true, () => { throw new Error('Unexpected forwarding'); });
  assert.equal(denied.body.entry[0].response.status, '403 Forbidden');
  assert.equal(forwarded, 1);
  for (const entry of [{ request: { method: 'PUT', url: 'Basic/id' } }, { request: { method: 'GET', url: 'https://foreign.invalid/Basic' } }]) {
    await assert.rejects(buildOperationsPreviewResponse({ ...bundle, entry: [search, entry] }, resource, false, () => {}));
  }
  assert.equal(await buildOperationsPreviewResponse({ ...bundle, entry: [other] }, resource, false, () => { throw new Error('Unexpected forwarding'); }), undefined);
});

test('onboarding bundle is separate, conditionally created operational evidence without clinical references', () => {
  const bundle = buildHawaiiOnboardingBundle();
  assert.equal(bundle.type, 'transaction');
  assert.equal(bundle.entry.length, 1);
  const { resource, request } = bundle.entry[0];
  assert.equal(resource.resourceType, 'Basic');
  assert.equal(resource.subject, undefined);
  assert.equal(request.method, 'POST');
  assert.equal(request.url, 'Basic');
  assert.equal(request.ifNoneExist, `identifier=${encodeURIComponent(`${resource.identifier[0].system}|${resource.identifier[0].value}`)}`);
  const snapshot = JSON.parse(resource.extension[0].valueString);
  assert.equal(snapshot.stages.length, 6);
  assert.equal(snapshot.records.length, 2);
  assert.equal(snapshot.records.filter((record) => record.result === 'accepted').length, 1);
  assert.equal(snapshot.issues[0].recordId, snapshot.records.find((record) => record.result === 'rejected').id);
  assert.equal(snapshot.issues[0].status, 'open');
  assert.equal(snapshot.assistance.length, 1);
  assert.notEqual(buildHawaiiOnboardingBundle().entry[0].fullUrl, bundle.entry[0].fullUrl);
});

function auditBackend({ leakAudit = false, leakClinical = false, wrongProject = false, recordReads = false,
  actor = 'clinician', action = 'R', oldTimestamp = false } = {}) {
  const calls = [];
  const auditQueries = new Map();
  const fakeFetch = async (url, options) => {
    calls.push({ method: options.method, url });
    const role = options.headers.Authorization.replace('Bearer test-', '');
    const reply = (body, code = 200) => new Response(JSON.stringify(body), { status: code });
    const bundle = (resources) => reply({ resourceType: 'Bundle', type: 'searchset', entry: resources.map((resource) => ({ resource })) });
    if (url.pathname === '/auth/me') {
      return reply({ project: { id: wrongProject ? ids[1] : 'a901f66f-ace9-4895-a492-80364684194d' },
        profile: { resourceType: 'Practitioner', id: role } });
    }
    if (url.pathname.includes('/AuditEvent')) {
      if (role === 'clinician' && !leakAudit) { return reply({}, 403); }
      const entity = url.searchParams.get('entity');
      if (entity) {
        const count = auditQueries.get(entity) ?? 0;
        auditQueries.set(entity, count + 1);
        return bundle(recordReads && count > 0 ? [{ resourceType: 'AuditEvent', id: `read-${entity}`, action,
          recorded: oldTimestamp ? '2020-01-01T00:00:00Z' : new Date().toISOString(),
          outcome: entity.endsWith('allowed') ? '0' : '4', entity: [{ what: { reference: entity } }],
          agent: [{ requestor: true, who: { reference: `Practitioner/${actor}` } }] }] : []);
      }
      return bundle([{ resourceType: 'AuditEvent', id: 'existing-native-event' }]);
    }
    if (role === 'reviewer' && !leakClinical) { return reply({}, 403); }
    if (url.searchParams.has('patient')) {
      const patient = url.searchParams.get('patient');
      if (role === 'clinician' && !patient.endsWith(ids[0])) { return bundle([]); }
      return bundle([{ resourceType: 'Observation', id: patient.endsWith(ids[0]) ? 'allowed' : patient.split('/')[1], subject: { reference: patient } }]);
    }
    const id = url.pathname.split('/').at(-1);
    if (role === 'clinician' && id !== 'allowed') { return reply({}, 403); }
    return reply({ resourceType: 'Observation', id });
  };
  return { fakeFetch, calls };
}

const auditConfig = { ...config, baseUrl: 'https://api.ehr.hiivehealth.net/', projectId: 'a901f66f-ace9-4895-a492-80364684194d' };
const auditCredentials = { clinicianToken: 'test-clinician', reviewerToken: 'test-reviewer', verifierToken: 'test-verifier' };

test('audit evidence check uses GET-only probes, proves role separation, and reports missing coverage honestly', async () => {
  const { fakeFetch, calls } = auditBackend();
  const result = await verifyHawaiiAuditEvidence(auditConfig, auditCredentials, fakeFetch);
  assert.equal(result.probes.length, 3);
  assert(result.probes.every((probe) => probe.coverage === 'not-observed-in-window'));
  assert(calls.every((call) => call.method === 'GET'));
});

test('audit evidence check only reports coverage for new resource/actor/action/outcome matches', async () => {
  const result = await verifyHawaiiAuditEvidence(auditConfig, auditCredentials, auditBackend({ recordReads: true }).fakeFetch);
  assert(result.probes.every((probe) => probe.coverage === 'observed' && probe.matchingAuditIds.length === 1));
});

test('runtime health requires the running task target healthy while allowing old targets to drain', () => {
  const containers = [{ addresses: ['10.0.0.1'] }];
  const healthy = { id: '10.0.0.1', state: 'healthy' };
  assert.deepEqual(verifyHawaiiTargetHealth([healthy, { id: '10.0.0.2', state: 'draining' }], containers),
    { activeHealthyTargets: 1, drainingTargets: 1 });
  for (const targets of [[], [{ ...healthy, state: 'draining' }], [{ ...healthy, state: 'unhealthy' }],
    [{ id: '10.0.0.2', state: 'healthy' }], [healthy, { id: '10.0.0.2', state: 'healthy' }]]) {
    assert.throws(() => verifyHawaiiTargetHealth(targets, containers));
  }
  assert.throws(() => verifyHawaiiTargetHealth([healthy], [{ addresses: [] }]));
});

test('CloudWatch evidence proves reads, masked denials, and successful filtered searches with redacted references', async () => {
  const evidence = await verifyHawaiiAuditEvidence(auditConfig, auditCredentials, auditBackend().fakeFetch);
  const logs = [...evidence.probes.map((probe) => ({ probe, interaction: 'read' })),
    ...evidence.searchProbes.map((probe) => ({ probe, interaction: 'search' }))].map(({ probe, interaction }, index) => ({
    eventId: String(index), logStreamName: 'test-stream', message: JSON.stringify({ resourceType: 'AuditEvent',
      meta: { project: auditConfig.projectId }, action: 'R', subtype: [{ code: interaction }], recorded: probe.requestedAt,
      agent: [{ requestor: true, who: { reference: evidence.clinicianReference } }],
      entity: [interaction === 'read' ? { what: { reference: probe.reference } } :
        { query: `Observation?${new URLSearchParams({ patient: probe.patientReference, _count: '1' })}` }],
      outcome: interaction === 'read' && probe.scenario !== 'allowed' ? '4' : '0',
    }),
  }));
  const result = verifyHawaiiCloudWatchEvidence(evidence, logs);
  assert.equal(result.checks.length, 6);
  assert(result.checks.every((check) => check.referenceDisplaysRedacted && check.matchedEvents.length === 1));
  assert.throws(() => verifyHawaiiCloudWatchEvidence(evidence, logs.slice(1)), /No correlated/);
  for (const mutation of [
    (event) => { event.agent[0].who.reference = 'Practitioner/other'; },
    (event) => { event.action = 'U'; },
    (event) => { event.outcome = '8'; },
    (event) => { event.meta.project = ids[0]; },
    (event) => { event.recorded = '2020-01-01T00:00:00Z'; },
    (event) => { event.entity[0].what.reference = 'Observation/other'; },
    (event) => { event.agent[0].who.display = 'Name must be redacted'; },
  ]) {
    const changed = JSON.parse(logs[0].message);
    mutation(changed);
    assert.throws(() => verifyHawaiiCloudWatchEvidence(evidence, [{ ...logs[0], message: JSON.stringify(changed) }, ...logs.slice(1)]));
  }
  for (const query of ['Observation?_count=1', 'Observation?patient=Patient/other&_count=1',
    `Observation?patient=${evidence.searchProbes[0].patientReference}&_count=100`,
    `https://other.example/fhir/R4/Observation?patient=${evidence.searchProbes[0].patientReference}&_count=1`]) {
    const changed = JSON.parse(logs[3].message);
    changed.entity[0].query = query;
    assert.throws(() => verifyHawaiiCloudWatchEvidence(evidence,
      [...logs.slice(0, 3), { ...logs[3], message: JSON.stringify(changed) }, ...logs.slice(4)]), /No correlated/);
  }
});

for (const [name, options] of [['another actor', { actor: 'other' }], ['an update instead of a read', { action: 'U' }], ['an old timestamp', { oldTimestamp: true }]]) {
  test(`audit evidence check does not count ${name} as read coverage`, async () => {
    const result = await verifyHawaiiAuditEvidence(auditConfig, auditCredentials, auditBackend({ recordReads: true, ...options }).fakeFetch);
    assert(result.probes.every((probe) => probe.coverage === 'not-observed-in-window'));
  });
}

for (const [name, options] of [['clinician audit leak', { leakAudit: true }], ['reviewer clinical leak', { leakClinical: true }], ['wrong project', { wrongProject: true }]]) {
  test(`audit evidence check rejects ${name}`, async () => {
    await assert.rejects(verifyHawaiiAuditEvidence(auditConfig, auditCredentials, auditBackend(options).fakeFetch));
  });
}

test('follow-up policies bind all work to one patient and assigned clinician without clinical write expansion', () => {
  const policies = buildHawaiiFollowUpPolicies(ids[0], 'Practitioner/primary', 'Practitioner/other');
  for (const rule of [policies.clinicianTask, policies.bot.resource.find((rule) => rule.resourceType === 'Task')]) {
    const query = new URLSearchParams(rule.criteria.split('?')[1]);
    assert.equal(query.get('patient'), `Patient/${ids[0]}`);
    assert.equal(query.get('owner'), 'Practitioner/primary');
    assert.equal(query.get('identifier'), `${FOLLOW_UP_SYSTEM}|`);
  }
  assert.deepEqual(policies.clinicianTask.interaction, ['read', 'search', 'update']);
  for (const field of ['owner', 'for', 'focus', 'identifier', 'authoredOn', 'input']) {
    assert(policies.clinicianTask.readonlyFields.includes(field));
  }
  assert(policies.clinicianTask.writeConstraint[0].expression.includes('%before.status'));
  assert(!policies.bot.resource.some((rule) => rule.interaction.includes('update')));
  assert.equal(policies.event.resource.length, 1);
  assert.equal(new URLSearchParams(policies.event.resource[0].criteria.split('?')[1]).get('identifier'), `${DISCHARGE_SYSTEM}|`);
  assert.equal(new URLSearchParams(policies.other.resource[0].criteria.split('?')[1]).get('owner'), 'Practitioner/other');
});

test('follow-up policy generation rejects missing or identical assignees', () => {
  assert.throws(() => buildHawaiiFollowUpPolicies(ids[0], 'Practitioner/primary', 'Practitioner/primary'));
  assert.throws(() => buildHawaiiFollowUpPolicies(ids[0], 'Organization/practice', 'Practitioner/other'));
});

function backend({ leak = false, missing = false, wrongProject = false, unauthenticated = false } = {}) {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ method: options.method, url });
    const verifier = options.headers.Authorization === `Bearer ${credentials.verifierToken}`;
    const respond = (body, status = 200) => new Response(JSON.stringify(body), { status });
    if (unauthenticated) { return respond({}, 401); }
    if (url.pathname === '/auth/me') { return respond({ project: { id: wrongProject ? ids[2] : config.projectId } }); }
    const [, , , type, id, history] = url.pathname.split('/');
    const fixture = (resourceId, patientId) => ({ resourceType: type, id: resourceId,
      identifier: [{ system: HAWAII_DEMO_SYSTEM, value: 'fixture' }], subject: { reference: `Patient/${patientId}` } });
    if (type === 'Patient') { return respond(fixture(id, id)); }
    const patientId = id ?? (url.searchParams.get('patient') ?? url.searchParams.get('subject')).split('/')[1];
    const allowed = patientId === config.allowedPatientId;
    if (id) {
      if (verifier || allowed || leak) { return respond(history ? { resourceType: 'Bundle', type: 'history', entry: [{ resource: fixture(id, id) }] } : fixture(id, id)); }
      return respond({}, 403);
    }
    return respond({ resourceType: 'Bundle', type: 'searchset',
      entry: missing || (!verifier && !allowed && !leak) ? [] : [{ resource: fixture(patientId, patientId) }] });
  };
  return { fakeFetch, calls };
}

test('checks real fixture existence and allowed/denied paths using GET only', async () => {
  const { fakeFetch, calls } = backend();
  assert.deepEqual(await verifyHawaiiBackend(config, credentials, fakeFetch), { clinicalResourcesChecked: 12, patientScenarios: 3 });
  assert(calls.length > 30 && calls.every((call) => call.method === 'GET'));
});

for (const [name, options] of [
  ['clinical leakage', { leak: true }], ['missing fixtures', { missing: true }],
  ['wrong project', { wrongProject: true }], ['expired credentials', { unauthenticated: true }],
]) {
  test(`does not report readiness for ${name}`, async () => {
    await assert.rejects(verifyHawaiiBackend(config, credentials, backend(options).fakeFetch));
  });
}

test('rejects insecure remote origins and identical credentials before making requests', async () => {
  const { fakeFetch, calls } = backend();
  await assert.rejects(verifyHawaiiBackend({ ...config, baseUrl: 'http://example.com/' }, credentials, fakeFetch));
  await assert.rejects(verifyHawaiiBackend(config, { clinicianToken: 'same', verifierToken: 'same' }, fakeFetch));
  assert.equal(calls.length, 0);
});

test('demo roles are read-only, separated, and clinically restricted to the permitted patient', () => {
  const policies = buildHawaiiPolicies(ids[0]);
  for (const policy of [policies.clinician, policies.reviewer, policies.verifier]) {
    assert(policy.resource.every((rule) => rule.readonly === true && rule.resourceType !== '*'));
  }
  for (const type of ['Encounter', 'Condition', 'Observation', 'DocumentReference']) {
    assert(policies.clinician.resource.find((rule) => rule.resourceType === type).criteria.endsWith(`Patient/${ids[0]}`));
    assert(!policies.reviewer.resource.some((rule) => rule.resourceType === type));
  }
  assert.deepEqual(policies.disabled.resource, []);
});