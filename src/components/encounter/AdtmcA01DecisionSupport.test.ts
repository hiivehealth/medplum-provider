import type { QuestionnaireResponse } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import { appendA01PartialDifferentials, appendSoapText, appendSoapTexts } from './AdtmcA01DecisionSupport';

describe('appendSoapText', () => {
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