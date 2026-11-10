import assert from 'node:assert/strict';
import { test } from 'node:test';
import { permitsReadOnlyFhir, retainedWorkExpectations, retainedDraftExpectations, readOnlyRehearsalMode } from './oem-browser-check.mjs';
import { permitsPersonnelBrowserSave, permitsReadOnlyGraphql } from './oem-personnel-browser-save.mjs';

const api = 'https://api.ehr.hiivehealth.net/fhir/R4';
test('presenter rehearsal retains completion reports but explicitly excludes optional technical drill-downs', () => {
  assert.deepEqual(readOnlyRehearsalMode(['--presenter-read-only']), { presenterOnly: true, examplesOnly: true, technicalDrilldowns: false });
  assert.deepEqual(readOnlyRehearsalMode(['--completion-report-read-only']), { presenterOnly: false, examplesOnly: true, technicalDrilldowns: true });
  for (const mode of ['--read-only', '--accepted-read-only', '--completion-read-only', '--saved-completion-read-only',
    '--report-read-only', '--cohort-report-read-only', '--rule-review-read-only', '--personnel-read-only']) {
    assert.deepEqual(readOnlyRehearsalMode([mode]), { presenterOnly: false, examplesOnly: false, technicalDrilldowns: true });
  }
  for (const args of [[], ['--publish'], ['--presenter-read-only', '--publish'], ['--presenter-read-only', 'override'], null]) {
    assert.throws(() => readOnlyRehearsalMode(args), /explicit read-only/);
  }
  assert(!permitsReadOnlyFhir('POST', `${api}/Bot/ca2e981d-6b7a-4580-affc-02d9218e1703/$execute`, { mode: 'publish' }));
});
test('Matrix PDF verification permits only its exact confirmed readonly service envelope', () => {
  const url = `${api}/Bot/ca2e981d-6b7a-4580-affc-02d9218e1703/$execute`;
  const body = { mode: 'verify-pdf', confirmedSynthetic: true };
  assert(permitsReadOnlyFhir('POST', url, body));
  for (const change of [{ mode: 'publish' }, { mode: 'save' }, { mode: 'approve' }, { mode: 'history' }, { confirmedSynthetic: false },
    { actor: 'Practitioner/foreign' }, { document: 'DocumentReference/foreign' }, { binary: 'Binary/foreign' },
    { url: 'https://foreign.invalid/file.pdf' }, { sha256: '0'.repeat(64) }, { sources: [] }, { asOf: '2026-10-25' }]) {
    assert(!permitsReadOnlyFhir('POST', url, { ...body, ...change }));
  }
  for (const method of ['PUT', 'PATCH', 'DELETE']) assert(!permitsReadOnlyFhir(method, url, body));
  assert(!permitsReadOnlyFhir('POST', `${url}?override=true`, body));
  assert(!permitsReadOnlyFhir('POST', url.replace('api.ehr.hiivehealth.net', 'foreign.invalid'), body));
});
test('Matrix history permits only confirmed canonical metadata inspection without attachment or source overrides', () => {
  const url = `${api}/Bot/416a2192-7e77-4c24-92be-425ec077432e/$execute`;
  const body = { mode: 'as-of', confirmedSynthetic: true, asOf: '2026-10-21T16:19:06.120Z' };
  assert(permitsReadOnlyFhir('POST', url, body));
  for (const change of [{ mode: 'save' }, { mode: 'approve' }, { mode: 'history' }, { confirmedSynthetic: false },
    { asOf: '2026-10-21' }, { asOf: '2026-02-30T00:00:00.000Z' }, { matrixDocument: 'DocumentReference/other' },
    { attachmentFetch: true }, { sources: [] }, { actor: 'Practitioner/other' }]) {
    assert(!permitsReadOnlyFhir('POST', url, { ...body, ...change }));
  }
  assert(!permitsReadOnlyFhir('POST', `${url}?override=1`, body)); assert(!permitsReadOnlyFhir('PUT', url, body));
});
test('rule history permits only its separate canonical confirmed as-of request, never approval or source overrides', () => {
  const url = `${api}/Bot/b22601ef-7972-4d1e-a1a5-1d7f591584b7/$execute`;
  const body = { mode: 'as-of', confirmedSynthetic: true, asOf: '2026-10-23T20:06:37.676Z' };
  assert(permitsReadOnlyFhir('POST', url, body));
  for (const change of [{ mode: 'approve' }, { mode: 'history' }, { mode: 'save' }, { confirmedSynthetic: false },
    { asOf: '2026-10-23' }, { asOf: '2026-02-30T00:00:00.000Z' }, { ruleDefinition: 'PlanDefinition/foreign' },
    { ruleReview: 'Task/foreign' }, { sources: [] }, { actor: 'Practitioner/foreign' }]) assert(!permitsReadOnlyFhir('POST', url, { ...body, ...change }));
  assert(!permitsReadOnlyFhir('POST', `${url}?override=true`, body)); assert(!permitsReadOnlyFhir('PUT', url, body));
});
test('recorded-time inspection permits only exact canonical confirmed readonly selection over its published Bot', () => {
  const url = `${api}/Bot/bdbdcf1c-8c70-453d-ad9e-c18721cd33ba/$execute`;
  const body = { mode: 'as-of', confirmedSynthetic: true, asOf: '2026-10-21T01:39:00.858Z' };
  assert(permitsReadOnlyFhir('POST', url, body));
  for (const change of [{ mode: 'history' }, { mode: 'save' }, { confirmedSynthetic: false }, { asOf: '2026-10-21' },
    { asOf: '2026-02-30T00:00:00.000Z' }, { sources: [] }, { worker: 'Patient/foreign' }, { actor: 'Practitioner/foreign' }]) {
    assert(!permitsReadOnlyFhir('POST', url, { ...body, ...change }));
  }
  assert(!permitsReadOnlyFhir('POST', `${url}?override=true`, body)); assert(!permitsReadOnlyFhir('PUT', url, body));
  assert(!permitsReadOnlyFhir('POST', `${api}/Bot/d62fce54-6582-4cd3-8feb-d6889f717d70/$execute`, body));
});
test('native history permits only the exact confirmed published read without caller selection or write overrides', () => {
  for (const id of ['071345cf-dbcb-44f5-b152-cb403326f397', 'e4623052-26bd-49d1-83de-5e00afa70cff', 'd62fce54-6582-4cd3-8feb-d6889f717d70']) {
  const url = `${api}/Bot/${id}/$execute`;
  const body = { mode: 'history', confirmedSynthetic: true };
  assert(permitsReadOnlyFhir('POST', url, body));
  for (const change of [{ mode: 'save' }, { mode: 'publish' }, { mode: 'export' }, { confirmedSynthetic: false },
    { worker: 'Patient/other' }, { asOf: '2026-01-01' }, { checkpoints: [] }, { sources: [] }, { actor: 'Practitioner/other' }]) {
    assert(!permitsReadOnlyFhir('POST', url, { ...body, ...change }));
  }
  assert(!permitsReadOnlyFhir('POST', `${url}?override=true`, body));
  assert(!permitsReadOnlyFhir('PUT', url, body));
  assert(!permitsReadOnlyFhir('POST', `${api}/Bot/other/$execute`, body));
  }
});
test('retained-work expectation includes only independently verified exact alternative outcomes', () => {
  const accepted = { result: { task: 'Task/original/_history/accepted', proposal: 'ServiceRequest/original-draft/_history/draft' } };
  const alternatives = { stage: 'published', verifiedAt: '2026-10-24T04:34:42.679Z', plan: { fixtures: { modify: { id: 'modified' }, dismiss: { id: 'dismissed' } } },
    decisions: Object.fromEntries(['modify', 'dismiss'].map(decision => [decision, { stage: 'verified', replay: 'verified-no-extra-versions', records: [{
      resourceType: 'Task', id: decision === 'modify' ? 'modified' : 'dismissed', meta: { project: '33e151fc-3e91-4df9-8093-106107f7e2f1', versionId: 'saved' },
      status: decision === 'modify' ? 'requested' : 'rejected', restriction: { period: { end: '2027-02-01' } },
    }] }])) };
  assert.equal(retainedWorkExpectations(accepted).length, 1);
  assert.deepEqual(retainedWorkExpectations(accepted, alternatives).map(value => value.reference),
    ['Task/original/_history/accepted', 'Task/modified/_history/saved', 'Task/dismissed/_history/saved']);
  const uncertain = structuredClone(alternatives); uncertain.decisions.modify.replay = 'sent-outcome-unknown';
  assert.throws(() => retainedWorkExpectations(accepted, uncertain));
  const changed = structuredClone(alternatives); changed.decisions.modify.records[0].restriction.period.end = '2027-03-01';
  assert.throws(() => retainedWorkExpectations(accepted, changed));
  const conflict = { stage: 'published', verifiedAt: alternatives.verifiedAt, plan: { fixture: { id: 'conflicting' } }, race: {
    stage: 'verified-one-winner', winner: 'dismiss', loser: 'modify', outcomes: [{ status: 'fulfilled', decision: 'dismiss' }, { status: 'rejected', decision: 'modify' }],
    records: [{ resourceType: 'Task', id: 'conflicting', meta: { project: '33e151fc-3e91-4df9-8093-106107f7e2f1', versionId: 'won' }, status: 'rejected' }],
  } };
  assert.equal(retainedWorkExpectations(accepted, alternatives, conflict).length, 4);
  const pending = structuredClone(conflict); pending.race.stage = 'sent-outcomes-unknown';
  assert.throws(() => retainedWorkExpectations(accepted, alternatives, pending));
  const twoWinners = structuredClone(conflict); twoWinners.race.outcomes[1].status = 'fulfilled';
  assert.throws(() => retainedWorkExpectations(accepted, alternatives, twoWinners));
  const duplicate = structuredClone(conflict); duplicate.plan.fixture.id = 'original'; duplicate.race.records[0].id = 'original';
  assert.throws(() => retainedWorkExpectations(accepted, alternatives, duplicate));
  const result = { status: 'recorded', decision: 'accept', persisted: true, activated: false, externalDispatch: false, completionRecorded: false,
    task: 'Task/concurrent/_history/accepted', proposal: 'ServiceRequest/concurrent-draft/_history/draft' };
  const concurrent = { stage: 'published', verifiedAt: alternatives.verifiedAt, plan: { fixture: { id: 'concurrent' } }, race: {
    stage: 'verified-single-graph', outcomes: [{ status: 'fulfilled', value: result }, { status: 'rejected' }], records: [
      { resourceType: 'Task', id: 'concurrent', status: 'accepted', meta: { project: '33e151fc-3e91-4df9-8093-106107f7e2f1', versionId: 'accepted' } },
      { resourceType: 'ServiceRequest', id: 'concurrent-draft', status: 'draft', intent: 'proposal', meta: { project: '33e151fc-3e91-4df9-8093-106107f7e2f1', versionId: 'draft' } },
    ],
  } };
  assert.equal(retainedWorkExpectations(accepted, alternatives, conflict, concurrent).length, 5);
  assert.equal(retainedDraftExpectations(accepted, concurrent).length, 2);
  const unknownAccept = structuredClone(concurrent); unknownAccept.race.stage = 'sent-outcomes-unknown';
  assert.throws(() => retainedWorkExpectations(accepted, alternatives, conflict, unknownAccept));
  const repeatedAccept = structuredClone(concurrent); repeatedAccept.race.outcomes[1] = repeatedAccept.race.outcomes[0];
  assert.throws(() => retainedWorkExpectations(accepted, alternatives, conflict, repeatedAccept));
  const uncertainRecovery = structuredClone(concurrent); uncertainRecovery.recovery = { stage: 'sent-outcome-unknown' };
  assert.throws(() => retainedWorkExpectations(accepted, alternatives, conflict, uncertainRecovery));
  const duplicateDraft = structuredClone(concurrent); duplicateDraft.race.records[1].id = 'original-draft';
  assert.throws(() => retainedDraftExpectations(accepted, duplicateDraft));
  const recovered = structuredClone(concurrent);
  recovered.race.stage = 'verified-recovered-single-graph'; recovered.race.concurrencyProven = false;
  recovered.race.outcomes = [{ status: 'rejected', reason: { resourceType: 'OperationOutcome', issue: [{ code: 'invalid', diagnostics: 'Concurrent receipt exists; retry the same decision to reconcile' }] } },
    { status: 'rejected', reason: { resourceType: 'OperationOutcome', issue: [{ code: 'forbidden' }] } }];
  recovered.policyCorrection = { stage: 'verified-pending-recovery' };
  recovered.recovery = { stage: 'verified-completed-pending-graph', result };
  assert.equal(retainedWorkExpectations(accepted, alternatives, conflict, recovered).length, 5);
  assert.equal(retainedDraftExpectations(accepted, recovered).length, 2);
  const falseProof = structuredClone(recovered); falseProof.race.concurrencyProven = true;
  assert.throws(() => retainedWorkExpectations(accepted, alternatives, conflict, falseProof));
  const repeat = structuredClone(concurrent); repeat.run = 'corrected-repeat';
  repeat.plan = { fixture: { id: 'repeat' }, draftPolicyFormat: 'receipt-tag-v1' };
  repeat.race.records[0].id = 'repeat'; repeat.race.records[1].id = 'repeat-draft';
  repeat.race.outcomes[0].value.task = 'Task/repeat/_history/accepted';
  repeat.race.outcomes[0].value.proposal = 'ServiceRequest/repeat-draft/_history/draft';
  assert.equal(retainedWorkExpectations(accepted, alternatives, conflict, recovered, repeat).length, 6);
  assert.equal(retainedDraftExpectations(accepted, recovered, repeat).length, 3);
  const pendingRepeat = structuredClone(repeat); pendingRepeat.race.stage = 'sent-outcomes-unknown';
  assert.throws(() => retainedWorkExpectations(accepted, alternatives, conflict, recovered, pendingRepeat));
  const correctedAgain = structuredClone(repeat); correctedAgain.policyCorrection = { stage: 'started' };
  assert.throws(() => retainedWorkExpectations(accepted, alternatives, conflict, recovered, correctedAgain));
  const duplicateRepeat = structuredClone(repeat); duplicateRepeat.race.records[1].id = 'original-draft';
  assert.throws(() => retainedDraftExpectations(accepted, recovered, duplicateRepeat));
  for (const mode of ['decide', 'preview']) assert(!permitsReadOnlyFhir('POST', `${api}/Bot/66b0d679-59df-4c82-8793-0a7471c9ea1f/$execute`, { mode }));
});
test('native report allows only confirmed read-only export without worker/date/filter or write overrides', () => {
  for (const id of ['debacf60-927e-4d92-9603-5bd2b45b0e5c', 'c6b0f60a-0e14-4cfe-8488-c62ff905a537', '7ce499ba-7b76-4ba2-92c1-6b115c507a87']) {
  const url = `${api}/Bot/${id}/$execute`;
  const body = { mode: 'export', confirmedSynthetic: true };
  assert(permitsReadOnlyFhir('POST', url, body));
  for (const change of [{ mode: 'save' }, { confirmedSynthetic: false }, { patient: 'Patient/other' },
    { asOf: '2000-01-01' }, { actor: 'Practitioner/other' }, { filter: 'all-workers' }, { sources: [] }, { workers: [] }, { completionExamples: [] }, { completion: 'Observation/other' }]) {
    assert(!permitsReadOnlyFhir('POST', url, { ...body, ...change }));
  }
  assert(!permitsReadOnlyFhir('POST', `${url}?override=true`, body));
  assert(!permitsReadOnlyFhir('PUT', url, body));
  }
});
test('saved synthetic attestation readback permits preview only and never a confirmed save or overrides', () => {
  const url = `${api}/Bot/d9af955e-eeba-489f-a4cc-13b8e088e1dc/$execute`;
  const body = { mode: 'preview', confirmedSimulation: true };
  assert(permitsReadOnlyFhir('POST', url, body));
  for (const change of [{ mode: 'save', confirmedSave: true, fingerprint: 'a'.repeat(64) }, { confirmedSimulation: false },
    { actor: 'Practitioner/foreign' }, { at: '2020-01-01' }, { report: 'DocumentReference/other/_history/one' }]) {
    assert(!permitsReadOnlyFhir('POST', url, { ...body, ...change }));
  }
  assert(!permitsReadOnlyFhir('POST', `${url}?override=true`, body));
  assert(!permitsReadOnlyFhir('PUT', url, body));
});
test('completion preview permits only explicit synthetic confirmation and blocks all save/attribution/resource overrides', () => {
  const url = `${api}/Bot/c0ce6818-1d5e-4e38-a086-80a1a218b6aa/$execute`;
  const body = { mode: 'preview', confirmedSimulation: true };
  assert(permitsReadOnlyFhir('POST', url, body));
  for (const change of [{ mode: 'save' }, { mode: 'decide' }, { confirmedSimulation: false }, { actor: 'Practitioner/spoof' },
    { at: '2020-01-01' }, { patient: 'Patient/other' }, { report: 'DocumentReference/other/_history/one' }, { performedOn: '2026-07-01' }]) {
    assert(!permitsReadOnlyFhir('POST', url, { ...body, ...change }));
  }
  assert(!permitsReadOnlyFhir('POST', `${url}?override=true`, body));
  assert(!permitsReadOnlyFhir('PUT', url, body));
});
test('clinician decisions permit exact preview/cancel envelopes and never submissions or caller attribution', () => {
  const url = `${api}/Bot/e198aa1a-31c8-4316-b8f4-e14f0214bc33/$execute`;
  const base = { mode: 'preview', task: 'Task/790e5844-e7f4-446e-ae9a-f6ead2b1a37b/_history/42fdbec8-c94b-49f4-b1da-8a6ff345c8b9', decision: 'accept', reason: 'local-proposal-requested' };
  assert(permitsReadOnlyFhir('POST', url, base));
  assert(permitsReadOnlyFhir('POST', url, { ...base, decision: 'modify', reason: 'timing-adjusted', due: '2026-12-01' }));
  assert(permitsReadOnlyFhir('POST', url, { ...base, decision: 'dismiss', reason: 'evidence-pending' }));
  for (const change of [{ mode: 'decide' }, { mode: 'save' }, { actor: 'Practitioner/foreign' }, { at: '2020-01-01' },
    { task: 'Task/other/_history/one' }, { reason: 'unsupported' }, { decision: 'modify', reason: 'timing-adjusted', due: '2026-02-30' }]) {
    assert(!permitsReadOnlyFhir('POST', url, { ...base, ...change }));
  }
  assert(!permitsReadOnlyFhir('POST', `${url}?override=true`, base));
  assert(!permitsReadOnlyFhir('PUT', url, base));
});
test('lifecycle collection permits only the authorized worker/exposure and no supplied records, actor or time', () => {
  const url = `${api}/Bot/15f69821-6267-4911-b255-e7460b395ec3/$execute`;
  const body = { mode: 'collect', patient: 'Patient/f8be7ab5-b799-4345-baba-2ba675122b13',
    exposure: 'Observation/baa7efea-26cc-44ee-9d9b-b4351aff9112/_history/305afa94-491a-4838-a4d7-e4abf3bc367f' };
  assert(permitsReadOnlyFhir('POST', url, body));
  for (const change of [{ actor: 'Practitioner/spoof' }, { at: '2020-01-01' }, { recommendations: [] }, { proposals: [] },
    { mode: 'save' }, { patient: 'Patient/other' }, { exposure: 'Observation/other/_history/one' }]) {
    assert(!permitsReadOnlyFhir('POST', url, { ...body, ...change }));
  }
  assert(!permitsReadOnlyFhir('POST', `${url}?override=true`, body));
  assert(!permitsReadOnlyFhir('PUT', url, body));
});
test('lifecycle inspection permits only the published exact two-record envelope without action or attribution fields', () => {
  const url = `${api}/Bot/15f69821-6267-4911-b255-e7460b395ec3/$execute`;
  const body = { mode: 'inspect', patient: 'Patient/f8be7ab5-b799-4345-baba-2ba675122b13',
    exposure: 'Observation/baa7efea-26cc-44ee-9d9b-b4351aff9112/_history/305afa94-491a-4838-a4d7-e4abf3bc367f',
    recommendations: ['Task/790e5844-e7f4-446e-ae9a-f6ead2b1a37b/_history/42fdbec8-c94b-49f4-b1da-8a6ff345c8b9'], proposals: [] };
  assert(permitsReadOnlyFhir('POST', url, body));
  for (const change of [{ mode: 'save' }, { actor: 'Practitioner/spoof' }, { asOf: '2020-01-01' },
    { patient: 'Patient/other' }, { exposure: 'Observation/other/_history/one' }, { recommendations: [] },
    { proposals: ['ServiceRequest/other/_history/one'] }]) {
    assert(!permitsReadOnlyFhir('POST', url, { ...body, ...change }));
  }
  assert(!permitsReadOnlyFhir('POST', `${url}?override=true`, body));
  assert(!permitsReadOnlyFhir('PUT', url, body));
});
test('historical-view reconciliation permits parsed GraphQL queries but no mutations or subscriptions', () => {
  const url = `${api}/$graphql`;
  assert(permitsReadOnlyGraphql('POST', url, { query: '{ Patient(id: "worker") { id } }' }));
  assert(
    permitsReadOnlyGraphql('POST', url, {
      query: 'query Read { Patient(id: "worker") { ...Identity } } fragment Identity on Patient { id }',
      operationName: 'Read',
    })
  );
  for (const query of [
    'mutation { PatientCreate(resource: {}) { id } }',
    'subscription { Patient { id } }',
    'query Read { Patient { id } } mutation Write { PatientCreate { id } }',
    'query First { Patient { id } } query Second { Patient { id } }',
    'fragment Identity on Patient { id }',
    'not valid graphql',
  ])
    assert(!permitsReadOnlyGraphql('POST', url, { query }));
  assert(!permitsReadOnlyGraphql('POST', url, { query: '{ Patient { id } }', action: 'save' }));
  assert(!permitsReadOnlyGraphql('POST', url, { query: 'query Read { Patient { id } }', operationName: 'Write' }));
  assert(!permitsReadOnlyGraphql('POST', 'https://foreign.invalid/fhir/R4/$graphql', { query: '{ Patient { id } }' }));
  assert(!permitsReadOnlyGraphql('PUT', url, { query: '{ Patient { id } }' }));
});
test('one-shot personnel browser Save permits only the exact reviewed key and payload', () => {
  const expected = {
    submissionId: '00000000-0000-4000-8000-000000000001',
    response: { resourceType: 'QuestionnaireResponse', status: 'completed' },
  };
  const body = { ...expected, mode: 'save', patient: 'Patient/f8be7ab5-b799-4345-baba-2ba675122b13' };
  const url = `${api}/Bot/910708cd-76af-4be7-9b5f-ea686f1a1e87/$execute`;
  assert(permitsPersonnelBrowserSave('POST', url, body, expected));
  for (const change of [
    { submissionId: 'other' },
    { patient: 'Patient/other' },
    { actor: 'Practitioner/spoof' },
    { response: {} },
    { mode: 'preview' },
  ]) {
    assert(!permitsPersonnelBrowserSave('POST', url, { ...body, ...change }, expected));
  }
  assert(!permitsPersonnelBrowserSave('PUT', url, body, expected));
  assert(!permitsPersonnelBrowserSave('POST', `${url}?override=true`, body, expected));
  assert(!permitsReadOnlyFhir('POST', url, body));
});
test('allows native reads and read-only batches only on the recorded API', () => {
  assert(permitsReadOnlyFhir('GET', `${api}/Patient/worker`));
  assert(!permitsReadOnlyFhir('GET', 'https://foreign.invalid/fhir/R4/Patient/worker'));
  assert(
    permitsReadOnlyFhir('POST', api, {
      resourceType: 'Bundle',
      type: 'batch',
      entry: [{ request: { method: 'GET', url: 'Patient/worker' } }],
    })
  );
  for (const url of [
    '/Patient/worker',
    '/fhir/R4/Patient/worker',
    '/Questionnaire/form/_history/v1',
    '/Task?status=requested',
  ]) {
    assert(
      permitsReadOnlyFhir('POST', api, {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [{ request: { method: 'GET', url } }],
      })
    );
  }
  for (const url of ['https://foreign.invalid/fhir/R4/Patient/worker', '/auth/me']) {
    assert(
      !permitsReadOnlyFhir('POST', api, {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [{ request: { method: 'GET', url } }],
      })
    );
  }
});
test('blocks direct writes, transactions, save and review execution', () => {
  for (const method of ['PUT', 'PATCH', 'DELETE', 'POST'])
    assert(!permitsReadOnlyFhir(method, `${api}/Observation/episode`, {}));
  assert(
    !permitsReadOnlyFhir('POST', api, {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [{ request: { method: 'GET', url: 'Patient/worker' } }],
    })
  );
  assert(!permitsReadOnlyFhir('POST', `${api}/Bot/4dba434f-1549-4a02-93b6-e15bdcefdd90/$execute`, { mode: 'save' }));
  assert(!permitsReadOnlyFhir('POST', `${api}/Bot/910708cd-76af-4be7-9b5f-ea686f1a1e87/$execute`, { mode: 'save' }));
  assert(
    !permitsReadOnlyFhir('POST', `${api}/Bot/d45729ec-20c4-4c3c-84a4-db0579c749c1/$execute`, {
      mode: 'resolve-ih-review',
    })
  );
  for (const decision of ['approve', 'request-changes']) {
    assert(
      !permitsReadOnlyFhir('POST', `${api}/Bot/af6d0db8-4e2e-4400-aa8b-6a14f95fb825/$execute`, {
        mode: 'review-noise-rule',
        task: 'Task/review/_history/v1',
        decision,
        reason: 'timing-unresolved',
      })
    );
  }
});
test('allows only the specific read-only intake preview envelope', () => {
  const url = `${api}/Bot/d92817e9-c540-410a-b92e-73cd92a78876/$execute`;
  assert(permitsReadOnlyFhir('POST', url, { mode: 'preview', patient: 'Patient/worker' }));
  assert(!permitsReadOnlyFhir('POST', url, { mode: 'save', patient: 'Patient/worker' }));
  assert(
    !permitsReadOnlyFhir('POST', url, { mode: 'preview', patient: 'Patient/worker', actor: 'Practitioner/spoof' })
  );
});
test('allows only the pinned personnel preview envelope and refuses save or attribution fields', () => {
  const url = `${api}/Bot/f164d473-0d95-486e-9743-140ced50ae57/$execute`;
  const patient = 'Patient/f8be7ab5-b799-4345-baba-2ba675122b13';
  const request = {
    mode: 'preview',
    patient,
    submissionId: '00000000-0000-4000-8000-000000000001',
    response: {
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      subject: { reference: patient },
      questionnaire: 'https://hiivehealth.com/fhir/Questionnaire/synthetic-dod-personnel-attestation|draft-1',
    },
  };
  assert(permitsReadOnlyFhir('POST', url, request));
  for (const change of [
    { mode: 'save' },
    { actor: 'Practitioner/spoof' },
    { at: '2026-01-01' },
    { patient: 'Patient/other' },
  ]) {
    assert(!permitsReadOnlyFhir('POST', url, { ...request, ...change }));
  }
});
test('allows only the bound noise scenario envelope without acceptance or actor fields', () => {
  const url = `${api}/Bot/58eb84c1-5d92-4e0f-b476-b300c240abca/$execute`;
  const request = {
    mode: 'preview',
    patient: 'Patient/worker',
    exposure: 'Observation/exposure/_history/v1',
    asOf: '2026-10-21',
  };
  assert(permitsReadOnlyFhir('POST', url, request));
  assert(permitsReadOnlyFhir('POST', url, { ...request, enrollment: 'Observation/enrollment/_history/v2' }));
  const enrolled = { ...request, enrollment: 'Observation/enrollment/_history/v2' };
  assert(permitsReadOnlyFhir('POST', url, { ...enrolled, completion: 'Observation/completion/_history/v1' }));
  for (const completion of ['Observation/completion', 'Task/task/_history/v1', '', null])
    assert(!permitsReadOnlyFhir('POST', url, { ...enrolled, completion }));
  for (const extra of [
    { actor: 'Practitioner/spoof' },
    { task: 'Task/task/_history/v1' },
    { actionAt: '2026-10-21T12:00:00Z' },
    { completion: 'Observation/completion/_history/v1' },
    { mode: 'save' },
  ])
    assert(!permitsReadOnlyFhir('POST', url, { ...request, ...extra }));
  assert(!permitsReadOnlyFhir('POST', url, { ...request, exposure: 'Observation/exposure' }));
});
