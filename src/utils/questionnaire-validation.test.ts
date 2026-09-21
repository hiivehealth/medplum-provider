import type { Questionnaire, QuestionnaireResponse } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import { removeEmptyAnswers, validateQuestionnaireResponse } from './questionnaire-validation';

const questionnaire: Questionnaire = {
  resourceType: 'Questionnaire',
  status: 'active',
  item: [
    {
      linkId: 'identifier',
      text: 'Identifier',
      type: 'string',
      required: true,
      maxLength: 10,
      extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/regex', valueString: '^[0-9]{10}$' }],
    },
    {
      linkId: 'group',
      type: 'group',
      item: [{ linkId: 'nested', text: 'Nested', type: 'string', required: true }],
    },
  ],
};

const armyDemographicsQuestionnaire: Questionnaire = {
  resourceType: 'Questionnaire',
  status: 'active',
  item: [
    {
      linkId: 'dod-id',
      text: 'DoD ID',
      type: 'string',
      required: true,
      maxLength: 10,
      extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/regex', valueString: '^[0-9]{10}$' }],
    },
    { linkId: 'blood-type', text: 'Blood Type', type: 'choice', required: true },
    { linkId: 'affiliation', text: 'Affiliation', type: 'choice', required: true },
    { linkId: 'branch', text: 'Branch', type: 'choice', required: true },
    { linkId: 'grade', text: 'Grade', type: 'choice', required: true },
    { linkId: 'vip-status', text: 'VIP', type: 'boolean' },
  ],
};

function response(item: QuestionnaireResponse['item']): QuestionnaireResponse {
  return { resourceType: 'QuestionnaireResponse', status: 'in-progress', item };
}

describe('validateQuestionnaireResponse', () => {
  test('reports required, length, format, and nested errors', () => {
    expect(
      validateQuestionnaireResponse(
        questionnaire,
        response([{ linkId: 'identifier', answer: [{ valueString: '123' }] }])
      )
    ).toEqual(['Identifier has an invalid format.', 'Nested is required.']);
  });

  test('reports maximum length independently from format', () => {
    expect(
      validateQuestionnaireResponse(
        questionnaire,
        response([{ linkId: 'identifier', answer: [{ valueString: '12345678901' }] }, { linkId: 'nested', answer: [{ valueString: 'ok' }] }])
      )
    ).toEqual(['Identifier must be at most 10 characters.', 'Identifier has an invalid format.']);
  });

  test('returns no errors for a valid response', () => {
    expect(
      validateQuestionnaireResponse(
        questionnaire,
        response([{ linkId: 'identifier', answer: [{ valueString: '1234567890' }] }, { linkId: 'nested', answer: [{ valueString: 'ok' }] }])
      )
    ).toEqual([]);
  });

  test('treats empty answer objects as unanswered', () => {
    expect(
      validateQuestionnaireResponse(
        questionnaire,
        response([{ linkId: 'identifier', answer: [{}] }, { linkId: 'nested', answer: [{}] }])
      )
    ).toEqual(['Identifier is required.', 'Nested is required.']);
  });

  test('removes empty answer objects before extraction', () => {
    const cleanedResponse = removeEmptyAnswers(
      response([{ linkId: 'identifier', answer: [{}] }, { linkId: 'nested', answer: [{ valueString: 'ok' }] }])
    );

    expect(cleanedResponse.item?.[0].answer).toBeUndefined();
    expect(cleanedResponse.item?.[1].answer).toEqual([{ valueString: 'ok' }]);
  });

  test('accepts a complete Army demographics response with a valid DoD ID', () => {
    expect(
      validateQuestionnaireResponse(
        armyDemographicsQuestionnaire,
        response([
          { linkId: 'dod-id', answer: [{ valueString: '1234567890' }] },
          { linkId: 'blood-type', answer: [{ valueCoding: { code: 'A-positive' } }] },
          { linkId: 'affiliation', answer: [{ valueCoding: { code: 'active-duty' } }] },
          { linkId: 'branch', answer: [{ valueCoding: { code: 'army' } }] },
          { linkId: 'grade', answer: [{ valueCoding: { code: 'E-5' } }] },
          { linkId: 'vip-status', answer: [{ valueBoolean: false }] },
        ])
      )
    ).toEqual([]);
  });

  test.each(['123456789', '12345678901', '123456789A'])('rejects an invalid DoD ID: %s', (dodId) => {
    expect(
      validateQuestionnaireResponse(
        armyDemographicsQuestionnaire,
        response([
          { linkId: 'dod-id', answer: [{ valueString: dodId }] },
          { linkId: 'blood-type', answer: [{ valueCoding: { code: 'A-positive' } }] },
          { linkId: 'affiliation', answer: [{ valueCoding: { code: 'active-duty' } }] },
          { linkId: 'branch', answer: [{ valueCoding: { code: 'army' } }] },
          { linkId: 'grade', answer: [{ valueCoding: { code: 'E-5' } }] },
        ])
      )
    ).toContain('DoD ID has an invalid format.');
  });

  test('requires the Army demographics fields owned by questionnaire validation', () => {
    expect(validateQuestionnaireResponse(armyDemographicsQuestionnaire, response([]))).toEqual([
      'DoD ID is required.',
      'Blood Type is required.',
      'Affiliation is required.',
      'Branch is required.',
      'Grade is required.',
    ]);
  });
});
