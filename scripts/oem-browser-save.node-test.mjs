import assert from 'node:assert/strict';
import { test } from 'node:test';
import { permitsSave } from './oem-browser-save.mjs';
import { permitsDemoIntake } from './oem-demo-intake.mjs';
const url = 'https://api.ehr.hiivehealth.net/fhir/R4/Bot/4dba434f-1549-4a02-93b6-e15bdcefdd90/$execute';
const request = {
  mode: 'save',
  patient: 'Patient/worker',
  submissionId: '11111111-1111-4111-8111-111111111111',
  response: {
    subject: { reference: 'Patient/worker' },
    questionnaire: 'https://hiivehealth.com/fhir/Questionnaire/synthetic-noise-intake|demo-1',
  },
};
test('permits only recorded patient and configured save endpoint', () => {
  assert(permitsSave('POST', url, request, { patient: 'Patient/worker' }));
  assert(!permitsSave('POST', url, request, { patient: 'Patient/other' }));
  assert(
    !permitsSave('POST', url.replace('api.ehr.hiivehealth.net', 'foreign.invalid'), request, {
      patient: 'Patient/worker',
    })
  );
  assert(!permitsSave('POST', url, { ...request, actor: 'Practitioner/spoof' }, { patient: 'Patient/worker' }));
});
test('requires exact newly saved exposure and structured reason for amendment', () => {
  const amended = { ...request, exposure: 'Observation/new/_history/v1', amendmentReason: 'correct-worksite' };
  assert(permitsSave('POST', url, amended, { patient: 'Patient/worker', exposure: amended.exposure }));
  assert(!permitsSave('POST', url, amended, { patient: 'Patient/worker' }));
  assert(!permitsSave('POST', url, amended, { patient: 'Patient/worker', exposure: 'Observation/old/_history/v1' }));
});

test('single demo intake permits only the exact new unknown-measurement exposure and no enrollment', () => {
  const evidence = 'DocumentReference/synthetic-source/_history/version';
  const values = { worksite: { valueCoding: { code: 'synthetic-maintenance-bay' } },
    start: { valueDate: '2026-10-26' }, availability: { valueCoding: { code: 'unknown' } },
    metric: { valueCoding: { code: 'eight-hour-twa' } }, unit: { valueCoding: { code: 'dBA' } },
    basis: { valueCoding: { code: '8h' } }, method: { valueCoding: { code: 'synthetic-personal-dosimetry' } },
    assessed: { valueDate: '2026-10-26' }, 'measurement-evidence': { valueReference: { reference: evidence } },
    determination: { valueCoding: { code: 'not-provided' } } };
  const body = { ...request, patient: 'Patient/f8be7ab5-b799-4345-baba-2ba675122b13', at: '2026-10-26T14:00:00.000Z',
    response: { ...request.response, subject: { reference: 'Patient/f8be7ab5-b799-4345-baba-2ba675122b13' },
      item: [{ linkId: 'group', item: Object.entries(values).map(([linkId, answer]) => ({ linkId, answer: [answer] })) }] } };
  assert(permitsDemoIntake('POST', url, body, evidence));
  for (const change of [{ patient: 'Patient/other' }, { exposure: 'Observation/old/_history/v1' },
    { amendmentReason: 'correct-worksite' }, { actor: 'Practitioner/spoof' }, { mode: 'decide' },
    { at: '2026-10-27T14:00:00.000Z' }]) assert(!permitsDemoIntake('POST', url, { ...body, ...change }, evidence));
  for (const [linkId, value] of [['availability', 'measured'], ['determination', 'enrolled'], ['worksite', 'synthetic-training-range']]) {
    const changed = structuredClone(body);
    changed.response.item[0].item.find(item => item.linkId === linkId).answer = [{ valueCoding: { code: value } }];
    assert(!permitsDemoIntake('POST', url, changed, evidence));
  }
  const duplicate = structuredClone(body);
  duplicate.response.item[0].item.push(duplicate.response.item[0].item[0]);
  assert(!permitsDemoIntake('POST', url, duplicate, evidence));
  assert(!permitsDemoIntake('POST', url, body, 'DocumentReference/foreign/_history/version'));
  assert(!permitsDemoIntake('POST', url + '?override=true', body, evidence));
  assert(!permitsDemoIntake('PUT', url, body, evidence));
});
