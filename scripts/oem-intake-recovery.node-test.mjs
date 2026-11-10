import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRecoveryResult, permitsRecoverySave } from './oem-intake-recovery.mjs';

const url = 'https://api.ehr.hiivehealth.net/fhir/R4/Bot/4dba434f-1549-4a02-93b6-e15bdcefdd90/$execute';
const patient = 'Patient/f8be7ab5-b799-4345-baba-2ba675122b13';
const request = { mode: 'save', patient, submissionId: '12345678-1234-4234-8234-123456789abc',
  at: '2026-10-24T00:00:00.000Z', response: { resourceType: 'QuestionnaireResponse', status: 'completed',
    subject: { reference: patient }, questionnaire: 'https://hiivehealth.com/fhir/Questionnaire/synthetic-noise-intake|demo-1' } };

test('recovery permits only the configured new intake episode and exact recorded request', () => {
  assert(permitsRecoverySave('POST', url, request, { patient }));
  assert(permitsRecoverySave('POST', url, structuredClone(request), { patient, request }));
  for (const body of [{ ...request, submissionId: '87654321-1234-4234-8234-123456789abc' },
    { ...request, exposure: 'Observation/existing', amendmentReason: 'correct-worksite' },
    { ...request, actor: 'Practitioner/forged' }, { ...request, at: '2026-10-25T00:00:00.000Z' }]) {
    assert(!permitsRecoverySave('POST', url, body, { patient, request }));
  }
});

test('recovery denies another worker, endpoint, method and arbitrary clinical writes', () => {
  for (const target of [url + '?override=1', url.replace('api.ehr.hiivehealth.net', 'other.example'),
    'https://api.ehr.hiivehealth.net/fhir/R4/Observation']) assert(!permitsRecoverySave('POST', target, request, { patient }));
  for (const method of ['PUT', 'PATCH', 'DELETE', 'GET']) assert(!permitsRecoverySave(method, url, request, { patient }));
  assert(!permitsRecoverySave('POST', url, request, { patient: 'Patient/another-worker' }));
});

test('recovery requires a completed unique exact-history graph and an explicit replay indicator', () => {
  const result = { status: 'completed', replayed: false, receipt: 'Task/receipt/_history/version', resources: [
    { step: 'submission', reference: 'QuestionnaireResponse/submission/_history/version' },
    { step: 'exposure', reference: 'Observation/exposure/_history/version' },
    { step: 'measurement', reference: 'Observation/measurement/_history/version' },
    { step: 'lineage', reference: 'Provenance/lineage/_history/version' },
  ] };
  assert.doesNotThrow(() => checkRecoveryResult(result, false));
  assert.doesNotThrow(() => checkRecoveryResult({ ...result, replayed: true }, true));
  for (const bad of [{ ...result, status: 'in-progress' }, { ...result, replayed: true },
    { ...result, resources: result.resources.slice(1) },
    { ...result, resources: result.resources.map(value => value.step === 'measurement' ? { ...value, reference: 'Observation/exposure/_history/other' } : value) }]) {
    assert.throws(() => checkRecoveryResult(bad, false));
  }
});