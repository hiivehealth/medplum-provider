import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { QuestionnaireResponse } from '@medplum/fhirtypes';
import { createElement } from 'react';
import { describe, expect, test } from 'vitest';
import { buildSubjectiveResponse, getSubjectiveValues, hasExactlyOneChiefComplaint, hasNonEmptyComplaint, SoapSubjectiveCard } from './SoapSubjectiveCard';

describe('SoapSubjectiveCard', () => {
  test('builds one response group per complaint with its own onset and severity', () => {
    const response = buildSubjectiveResponse(
      {
        complaints: [
          { text: 'Sore throat', onset: '2026-09-20T08:30', severity: 'moderate', isChiefComplaint: true },
          { text: 'Ear pain', onset: '2026-09-21T13:00', severity: 'mild', isChiefComplaint: false },
        ],
        hpi: '',
        comments: '',
      },
      undefined
    );

    expect(response.item?.slice(0, 2)).toEqual([
      {
        linkId: 'complaint',
        item: [
          { linkId: 'complaint-text', answer: [{ valueString: 'Sore throat' }] },
          { linkId: 'complaint-onset', answer: [{ valueDateTime: new Date('2026-09-20T08:30').toISOString() }] },
          { linkId: 'complaint-severity', answer: [{ valueCoding: { system: 'https://hiivehealth.com/fhir/soap/symptom-severity', code: 'moderate', display: 'moderate' } }] },
          { linkId: 'complaint-is-chief', answer: [{ valueBoolean: true }] },
        ],
      },
      {
        linkId: 'complaint',
        item: [
          { linkId: 'complaint-text', answer: [{ valueString: 'Ear pain' }] },
          { linkId: 'complaint-onset', answer: [{ valueDateTime: new Date('2026-09-21T13:00').toISOString() }] },
          { linkId: 'complaint-severity', answer: [{ valueCoding: { system: 'https://hiivehealth.com/fhir/soap/symptom-severity', code: 'mild', display: 'mild' } }] },
          { linkId: 'complaint-is-chief', answer: [{ valueBoolean: false }] },
        ],
      },
    ]);
  });

  test('reads legacy repeated chief complaints without assigning the shared onset', () => {
    const legacyResponse: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      item: [
        {
          linkId: 'chief-complaint',
          answer: [{ valueString: 'Sore throat' }, { valueString: 'Ear pain' }],
        },
        { linkId: 'symptom-onset', answer: [{ valueDateTime: '2026-09-20T08:30:00Z' }] },
        {
          linkId: 'symptom-severity',
          answer: [{ valueCoding: { system: 'https://hiivehealth.com/fhir/soap/symptom-severity', code: 'severe' } }],
        },
      ],
    };

    expect(getSubjectiveValues(legacyResponse).complaints).toEqual([
      { text: 'Sore throat', onset: '', severity: '', isChiefComplaint: false },
      { text: 'Ear pain', onset: '', severity: '', isChiefComplaint: false },
    ]);
  });

  test('renders a stored UTC onset in the local date-time input format', () => {
    const onset = new Date('2026-09-20T08:30').toISOString();
    const response: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      item: [
        {
          linkId: 'complaint',
          item: [
            { linkId: 'complaint-text', answer: [{ valueString: 'Sore throat' }] },
            { linkId: 'complaint-onset', answer: [{ valueDateTime: onset }] },
          ],
        },
      ],
    };

    expect(getSubjectiveValues(response).complaints[0]?.onset).toBe('2026-09-20T08:30');
  });

  test('requires at least one non-empty complaint before signing', () => {
    expect(hasNonEmptyComplaint(undefined)).toBe(false);
    expect(
      hasNonEmptyComplaint({
        resourceType: 'QuestionnaireResponse',
        status: 'in-progress',
        item: [{ linkId: 'complaint', item: [{ linkId: 'complaint-text', answer: [{ valueString: 'Sore throat' }] }] }],
      })
    ).toBe(true);
  });

  test('requires exactly one chief complaint before signing', () => {
    const baseValues = {
      hpi: '',
      comments: '',
    };
    expect(
      hasExactlyOneChiefComplaint(
        buildSubjectiveResponse(
          { ...baseValues, complaints: [{ text: 'Sore throat', onset: '', severity: '', isChiefComplaint: true }] },
          undefined
        )
      )
    ).toBe(true);
    expect(
      hasExactlyOneChiefComplaint(
        buildSubjectiveResponse(
          { ...baseValues, complaints: [{ text: 'Sore throat', onset: '', severity: '', isChiefComplaint: false }] },
          undefined
        )
      )
    ).toBe(false);
  });

  test('retains multi-character typing in the second complaint', async () => {
    const user = userEvent.setup();
    render(
      createElement(
        MantineProvider,
        undefined,
        createElement(SoapSubjectiveCard, {
          questionnaireResponse: buildSubjectiveResponse(
            {
              complaints: [
                { text: 'Sore throat', onset: '', severity: '', isChiefComplaint: true },
                { text: '', onset: '', severity: '', isChiefComplaint: false },
              ],
              hpi: '',
              comments: '',
            },
            undefined
          ),
          onChange: vi.fn(),
        })
      )
    );

    const complaints = screen.getAllByLabelText('Complaint');
    await user.type(complaints[1] as HTMLInputElement, 'Ear pain');

    expect(complaints[1]).toHaveValue('Ear pain');
  });
});