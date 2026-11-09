import type { QuestionnaireResponse } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import { appendA01PartialDifferentials, appendSoapText, appendSoapTexts } from './AdtmcA01DecisionSupport';
import { SOAP_PLAN_URL } from '../../data/soap-questionnaires';
import { extractSoapResponse } from '../../utils/soap-extraction';
import { buildSoapComposition } from '../../utils/soap-composition';

describe('appendSoapText', () => {
  test('keeps A-01 draft content protected through generic SOAP extraction and composition', () => {
    const patient = { resourceType: 'Patient' as const, id: 'patient' };
    const encounter = { resourceType: 'Encounter' as const, id: 'encounter', status: 'in-progress' as const, class: { code: 'AMB' } };
    const response = appendSoapText(undefined, 'plan-free-text', 'A-01 guidance');
    const security = [{ system: 'https://ehr.hiivehealth.net/fhir/CodeSystem/workflow-access', code: 'army' }];
    expect(response.meta?.security).toEqual(security);
    const extracted = extractSoapResponse(SOAP_PLAN_URL, response, { patient, encounter });
    expect(extracted.carePlans).toHaveLength(1);
    expect(extracted.carePlans[0].meta?.security).toEqual(security);
    const composition = buildSoapComposition({
      patient, encounter, practitioner: { reference: 'Practitioner/provider' },
      ...extracted, questionnaireResponses: new Map([[SOAP_PLAN_URL, response]]),
    });
    expect(composition.meta?.security).toEqual(security);
  });

  test('generic SOAP content remains unclassified and Army labels are not duplicated', () => {
    const patient = { resourceType: 'Patient' as const, id: 'patient' };
    const encounter = { resourceType: 'Encounter' as const, id: 'encounter', status: 'in-progress' as const, class: { code: 'AMB' } };
    const response: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse', status: 'completed',
      item: [{ linkId: 'plan-free-text', answer: [{ valueString: 'Generic follow-up' }] }],
    };
    const extracted = extractSoapResponse(SOAP_PLAN_URL, response, { patient, encounter });
    expect(extracted.carePlans[0].meta?.security).toBeUndefined();
    expect(buildSoapComposition({
      patient, encounter, practitioner: { reference: 'Practitioner/provider' },
      ...extracted, questionnaireResponses: new Map([[SOAP_PLAN_URL, response]]),
    }).meta?.security).toBeUndefined();
    const draft = appendSoapText(response, 'plan-free-text', 'A-01 guidance');
    expect(appendSoapText(draft, 'plan-free-text', 'More A-01 guidance').meta?.security).toHaveLength(1);
  });

  test('adds a clinician-confirmed A-01 differential consideration without creating a diagnosis resource', () => {
    const response = appendSoapText(undefined, 'differential-diagnoses', 'A-01 Provider Now consideration');

    expect(response.resourceType).toBe('QuestionnaireResponse');
    expect(response.status).toBe('in-progress');
    expect(response.item).toEqual([
      { linkId: 'differential-diagnoses', answer: [{ valueString: 'A-01 Provider Now consideration' }] },
    ]);
  });

  test('preserves existing editable plan text when adding A-01 guidance', () => {
    const existing: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      status: 'in-progress',
      item: [{ linkId: 'plan-free-text', answer: [{ valueString: 'Existing plan.' }] }],
    };

    const response = appendSoapText(existing, 'plan-free-text', 'A-01 Minor Care guidance');

    expect(response.item?.[0].answer).toEqual([
      { valueString: 'Existing plan.' },
      { valueString: 'A-01 Minor Care guidance' },
    ]);
  });

  test('adds each A-01 partial differential as a separate editable Assessment item', () => {
    const response = appendSoapTexts(undefined, 'differential-diagnoses', [
      'Viral infections',
      'Bacterial infections',
      'Meningitis',
    ]);

    expect(response.item?.[0].answer).toEqual([
      { valueString: 'Viral infections' },
      { valueString: 'Bacterial infections' },
      { valueString: 'Meningitis' },
    ]);
  });

  test('replaces the legacy single-line A-01 differential draft with separate items', () => {
    const response = appendA01PartialDifferentials({
      resourceType: 'QuestionnaireResponse',
      status: 'in-progress',
      item: [
        {
          linkId: 'differential-diagnoses',
          answer: [
            { valueString: 'Manual differential.' },
            { valueString: 'A-01 partial differential for clinician review: Viral infections; Bacterial infections.' },
          ],
        },
      ],
    });

    expect(response.item?.[0].answer).toEqual([
      { valueString: 'Manual differential.' },
      { valueString: 'Viral infections' },
      { valueString: 'Bacterial infections' },
      { valueString: 'Meningitis' },
      { valueString: 'Neck deep tissue infection' },
      { valueString: 'Candida infection' },
      { valueString: 'Strep throat' },
    ]);
  });
});