import type { Encounter, Patient, QuestionnaireResponse } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import { extractObjective, extractSubjective } from './soap-extraction';
import { createVitalObservation } from './vitals';

const patient: Patient = { resourceType: 'Patient', id: 'patient-1' };
const encounter: Encounter = { resourceType: 'Encounter', id: 'encounter-1', status: 'in-progress', class: { code: 'AMB' } };

describe('extractObjective', () => {
  test('extracts nested vital values using their selected UCUM units', () => {
    const response: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      item: [
        {
          linkId: 'vitals',
          item: [
            { linkId: 'temperature-unit', answer: [{ valueCoding: { code: 'Cel' } }] },
            { linkId: 'temperature-c', answer: [{ valueDecimal: 37.2 }] },
            { linkId: 'weight-unit', answer: [{ valueCoding: { code: 'kg' } }] },
            { linkId: 'weight-kg', answer: [{ valueDecimal: 72.5 }] },
            { linkId: 'height-unit', answer: [{ valueCoding: { code: 'cm' } }] },
            { linkId: 'height-cm', answer: [{ valueDecimal: 180 }] },
          ],
        },
      ],
    };

    const observations = extractObjective(response, { patient, encounter }).observations;

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: { coding: [expect.objectContaining({ code: '8310-5' })] }, valueQuantity: { value: 37.2, unit: 'Cel', system: 'http://unitsofmeasure.org', code: 'Cel' } }),
        expect.objectContaining({ code: { coding: [expect.objectContaining({ code: '29463-7' })] }, valueQuantity: { value: 72.5, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' } }),
        expect.objectContaining({ code: { coding: [expect.objectContaining({ code: '8302-2' })] }, valueQuantity: { value: 180, unit: 'cm', system: 'http://unitsofmeasure.org', code: 'cm' } }),
      ])
    );
  });

  test('rejects conflicting temperature-unit answers', () => {
    const response: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      item: [
        {
          linkId: 'vitals',
          item: [
            { linkId: 'temperature-f', answer: [{ valueDecimal: 98.6 }] },
            { linkId: 'temperature-c', answer: [{ valueDecimal: 37 }] },
          ],
        },
      ],
    };

    expect(() => extractObjective(response, { patient, encounter })).toThrow('Conflicting answers for Body temperature');
  });
});

describe('createVitalObservation', () => {
  test('creates an encounter-scoped final vital with the supplied time and performer', () => {
    const observation = createVitalObservation({
      patient,
      encounter,
      coding: { system: 'http://loinc.org', code: '8310-5', display: 'Body temperature' },
      value: 101,
      unit: '[degF]',
      performer: { reference: 'Practitioner/practitioner-1' },
      effectiveDateTime: '2026-09-22T13:18:00Z',
    });

    expect(observation).toMatchObject({
      status: 'final',
      subject: { reference: 'Patient/patient-1' },
      encounter: { reference: 'Encounter/encounter-1' },
      performer: [{ reference: 'Practitioner/practitioner-1' }],
      effectiveDateTime: '2026-09-22T13:18:00Z',
      code: { coding: [{ code: '8310-5' }] },
      valueQuantity: { value: 101, unit: '[degF]', system: 'http://unitsofmeasure.org', code: '[degF]' },
    });
  });
});

describe('extractSubjective', () => {
  test('extracts each repeating complaint with its own onset date and time', () => {
    const response: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      item: [
        {
          linkId: 'complaint',
          item: [
            { linkId: 'complaint-text', answer: [{ valueString: 'Sore throat' }] },
            { linkId: 'complaint-onset', answer: [{ valueDateTime: '2026-09-20T08:30:00Z' }] },
          ],
        },
        {
          linkId: 'complaint',
          item: [
            { linkId: 'complaint-text', answer: [{ valueString: 'Ear pain' }] },
            { linkId: 'complaint-onset', answer: [{ valueDateTime: '2026-09-21T13:00:00Z' }] },
          ],
        },
      ],
    };

    expect(extractSubjective(response, { patient, encounter }).conditions).toEqual([
      expect.objectContaining({ code: { text: 'Sore throat' }, onsetDateTime: '2026-09-20T08:30:00Z' }),
      expect.objectContaining({ code: { text: 'Ear pain' }, onsetDateTime: '2026-09-21T13:00:00Z' }),
    ]);
  });
});