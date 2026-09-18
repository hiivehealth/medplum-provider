import type { Patient, QuestionnaireResponse } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import {
  applyArmyDemographicsResponse,
  validateArmyDemographicsResponse,
} from './army-demographics';

function response(item: QuestionnaireResponse['item']): QuestionnaireResponse {
  return { resourceType: 'QuestionnaireResponse', status: 'completed', item };
}

describe('Army demographics Questionnaire mapping', () => {
  test('maps Army answers into native Patient fields and extensions', () => {
    const patient = applyArmyDemographicsResponse(
      { resourceType: 'Patient' },
      response([
        { linkId: 'dod-id', answer: [{ valueString: '1234567890' }] },
        { linkId: 'gender', answer: [{ valueCoding: { code: 'male' } }] },
        { linkId: 'date-of-birth', answer: [{ valueDate: '1990-01-01' }] },
        { linkId: 'affiliation', answer: [{ valueCoding: { system: 'urn:army', code: 'active-duty' } }] },
        { linkId: 'branch', answer: [{ valueCoding: { system: 'urn:army', code: 'army' } }] },
        { linkId: 'grade', answer: [{ valueCoding: { system: 'urn:army', code: 'E-9' } }] },
        { linkId: 'vip-status', answer: [{ valueBoolean: true }] },
        { linkId: 'blood-type', answer: [{ valueCoding: { system: 'urn:blood', code: 'O+' } }] },
      ])
    );

    expect(patient.meta?.profile).toContain(
      'https://ehr.hiivehealth.net/fhir/StructureDefinition/hiive-army-demographics-patient'
    );
    expect(patient.identifier).toEqual([{ system: 'https://ehr.hiivehealth.net/fhir/identifier/dod-id', value: '1234567890' }]);
    expect(patient.gender).toBe('male');
    expect(patient.birthDate).toBe('1990-01-01');
    expect(patient.extension).toHaveLength(3);
  });

  test('rejects invalid DoD IDs and incomplete military service answers', () => {
    const errors = validateArmyDemographicsResponse(
      response([
        { linkId: 'dod-id', answer: [{ valueString: '123' }] },
        { linkId: 'grade', answer: [{ valueCoding: { code: 'E-9' } }] },
      ])
    );

    expect(errors).toEqual([
      'DoD ID must contain exactly 10 digits.',
      'Affiliation is required when Branch or Grade is provided.',
      'Branch and Grade must be provided together.',
    ]);
  });

  test('preserves unrelated Patient data while replacing managed extensions', () => {
    const patient: Patient = {
      resourceType: 'Patient',
      active: true,
      extension: [{ url: 'https://example.com/other-extension', valueString: 'keep' }],
    };
    const result = applyArmyDemographicsResponse(
      patient,
      response([{ linkId: 'vip-status', answer: [{ valueBoolean: false }] }])
    );

    expect(result.active).toBe(true);
    expect(result.extension).toEqual([
      { url: 'https://example.com/other-extension', valueString: 'keep' },
      { url: 'https://ehr.hiivehealth.net/fhir/StructureDefinition/vip-status', valueBoolean: false },
    ]);
  });
});
