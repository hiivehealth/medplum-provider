import { MantineProvider } from '@mantine/core';
import type { Questionnaire, QuestionnaireResponse } from '@medplum/fhirtypes';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { A01CompactQuestionnaire, shouldOpenAemNowModal, shouldOpenProviderNowModal } from './A01CompactQuestionnaire';

const RED_FLAG_IDS = ['shortness-of-breath', 'stridor', 'deviated-uvula', 'drooling-trouble-swallowing', 'stiff-neck'];
const DP1_IDS = ['symptoms-more-than-10-days', 'immunosuppression', 'inhaled-steroid', 'fever'];

const questionnaire: Questionnaire = {
  resourceType: 'Questionnaire',
  id: 'a01-sore-throat',
  url: 'https://ehr.hiivehealth.net/fhir/Questionnaire/a01-sore-throat',
  version: '1.0.0',
  title: 'Sore Throat/Hoarseness, A-1',
  description: 'A sore throat is often due to a viral infection. Bacterial infections and other causes need to also be considered.',
  status: 'draft',
  item: [
    {
      linkId: 'initial-escalation-screen',
      text: 'Does the patient have any of the following Red Flags?',
      type: 'group',
      item: [
        { linkId: 'shortness-of-breath', text: 'Shortness of Breath', type: 'choice', required: true },
        { linkId: 'stridor', text: 'Stridor', type: 'choice', required: true },
        { linkId: 'deviated-uvula', text: 'Deviated Uvula', type: 'choice', required: true },
        { linkId: 'drooling-trouble-swallowing', text: 'Drooling', type: 'choice', required: true },
        { linkId: 'stiff-neck', text: 'Stiff Neck', type: 'choice', required: true },
      ],
    },
    {
      linkId: 'dp1-screen',
      text: 'Screening DP1:',
      type: 'group',
      item: [
        {
          linkId: 'dp1-question-prompt',
          text: 'Does patient have any of the following?',
          type: 'display',
        },
        { linkId: 'symptoms-more-than-10-days', text: 'Symptoms >10 days', type: 'choice', required: true },
        {
          linkId: 'dp1-guidance',
          text: 'Symptoms greater than 10 days, immunosuppression, inhaled steroid medications are related to diseases that are unlikely to go away without treatment. Hoarseness longer than 2 weeks requires a full laryngeal exam.',
          type: 'display',
        },
      ],
    },
    {
      linkId: 'dp2-screen',
      text: 'Screening DP2:',
      type: 'group',
      item: [
        {
          linkId: 'dp2-question-prompt',
          text: 'Does patient have any of the following?',
          type: 'display',
        },
        { linkId: 'dp2-fever', text: 'Fever', type: 'choice', required: true },
        { linkId: 'no-cough', text: 'No cough', type: 'choice', required: true },
        { linkId: 'tonsillar-exudate', text: 'Tonsillar exudate', type: 'choice', required: true },
        { linkId: 'swollen-anterior-cervical-nodes', text: 'Swollen anterior cervical nodes', type: 'choice', required: true },
      ],
    },
    {
      linkId: 'strep-test',
      text: 'Perform Rapid Strep +/- Culture Test',
      type: 'group',
      item: [
        { linkId: 'rapid-strep-culture-result', text: 'Rapid strep/culture test result', type: 'choice', required: true },
      ],
    },
    {
      linkId: 'additional-screen',
      text: 'Screen Cold Symptoms, Ear Pain if present',
      type: 'group',
      item: [
        { linkId: 'cold-present', text: 'Cold present', type: 'choice', required: true },
        { linkId: 'ear-pain-present', text: 'Ear pain present', type: 'choice', required: true },
      ],
    },
  ],
};

describe('A01CompactQuestionnaire', () => {
  test('submits coded A-01 answers in the canonical QuestionnaireResponse shape', async () => {
    const onSubmit = vi.fn();
    const questionnaireResponse: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      status: 'in-progress',
      item: [
        { linkId: 'initial-escalation-screen', item: RED_FLAG_IDS.map((linkId) => ({ linkId, answer: [{ valueCoding: { code: 'false' } }] })) },
        { linkId: 'dp1-screen', item: DP1_IDS.map((linkId) => ({ linkId, answer: [{ valueCoding: { code: 'false' } }] })) },
        {
          linkId: 'dp2-screen',
          item: [
            { linkId: 'dp2-fever', answer: [{ valueCoding: { code: 'true' } }] },
            { linkId: 'no-cough', answer: [{ valueCoding: { code: 'true' } }] },
            { linkId: 'tonsillar-exudate', answer: [{ valueCoding: { code: 'true' } }] },
            { linkId: 'swollen-anterior-cervical-nodes', answer: [{ valueCoding: { code: 'true' } }] },
          ],
        },
        {
          linkId: 'strep-test',
          item: [
            { linkId: 'rapid-strep-culture-result', answer: [{ valueCoding: { code: 'positive' } }] },
          ],
        },
      ],
    };
    render(
      <MantineProvider>
        <A01CompactQuestionnaire questionnaire={questionnaire} questionnaireResponse={questionnaireResponse} onSubmit={onSubmit} />
      </MantineProvider>
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Complete A-01' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'QuestionnaireResponse',
        questionnaire: 'https://ehr.hiivehealth.net/fhir/Questionnaire/a01-sore-throat|1.0.0',
        status: 'completed',
        item: expect.arrayContaining([
          expect.objectContaining({
            linkId: 'initial-escalation-screen',
            item: expect.arrayContaining([
              expect.objectContaining({
                linkId: 'shortness-of-breath',
                answer: [{ valueCoding: { system: 'urn:hiivehealth:adtmc-boolean', code: 'false', display: 'No' } }],
              }),
            ]),
          }),
        ]),
      })
    );
  });

  test('disables completion until the red-flag questions are answered', async () => {
    const onSubmit = vi.fn();
    render(
      <MantineProvider>
        <A01CompactQuestionnaire questionnaire={questionnaire} onSubmit={onSubmit} />
      </MantineProvider>
    );

    expect(screen.getByRole('button', { name: 'Complete A-01' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('offers optional Scope of Practice PDFs without adding questionnaire requirements', async () => {
    render(
      <MantineProvider>
        <A01CompactQuestionnaire questionnaire={questionnaire} onSubmit={vi.fn()} />
      </MantineProvider>
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Scope of Practice' }));

    const algorithmLink = await screen.findByRole('link', { name: 'A-1 Sore Throat/Hoarseness' });
    expect(algorithmLink).toHaveAttribute(
      'href',
      '/documents/adtmc/a01/scope-of-practice.html?document=a01-sore-throat-hoarseness'
    );
    expect(screen.getAllByRole('link')).toHaveLength(5);
    screen.getAllByRole('link').forEach((link) => expect(link).toHaveAttribute('target', '_blank'));
    expect(screen.getByRole('button', { name: 'Complete A-01' })).toBeDisabled();
  });

  test('shows the source-faithful DP1 guidance below its questions after every red flag is answered No', async () => {
    const questionnaireResponse: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      status: 'in-progress',
      item: [
        {
          linkId: 'initial-escalation-screen',
          item: [
            'shortness-of-breath',
            'stridor',
            'deviated-uvula',
            'drooling-trouble-swallowing',
            'stiff-neck',
          ].map((linkId) => ({ linkId, answer: [{ valueCoding: { code: 'false' } }] })),
        },
      ],
    };
    render(
      <MantineProvider>
        <A01CompactQuestionnaire
          questionnaire={questionnaire}
          questionnaireResponse={questionnaireResponse}
          onSubmit={vi.fn()}
        />
      </MantineProvider>
    );

    expect(screen.getByText('Screening DP1:')).toBeInTheDocument();
    const dp1Question = screen.getByText('Symptoms >10 days *');
    const dp1Guidance = screen.getByText('Symptoms greater than 10 days, immunosuppression, inhaled steroid medications are related to diseases that are unlikely to go away without treatment. Hoarseness longer than 2 weeks requires a full laryngeal exam.');
    expect(dp1Question.compareDocumentPosition(dp1Guidance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const dp1Prompt = screen.getByText('Does patient have any of the following?');
    expect(dp1Prompt.parentElement).toContainElement(screen.getByText('Screening DP1:'));
    expect(screen.queryByText('Screening DP2:')).not.toBeInTheDocument();
    expect(screen.queryByText('Screen Cold Symptoms, Ear Pain if present')).not.toBeInTheDocument();
  });

  test('shows the additional screen only for the Minor Care path', () => {
    const questionnaireResponse: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      status: 'in-progress',
      item: [
        {
          linkId: 'initial-escalation-screen',
          item: RED_FLAG_IDS.map((linkId) => ({ linkId, answer: [{ valueCoding: { code: 'false' } }] })),
        },
        {
          linkId: 'dp1-screen',
          item: DP1_IDS.map((linkId) => ({ linkId, answer: [{ valueCoding: { code: 'false' } }] })),
        },
        {
          linkId: 'dp2-screen',
          item: [
            { linkId: 'dp2-fever', answer: [{ valueCoding: { code: 'true' } }] },
            { linkId: 'no-cough', answer: [{ valueCoding: { code: 'true' } }] },
            { linkId: 'tonsillar-exudate', answer: [{ valueCoding: { code: 'true' } }] },
            { linkId: 'swollen-anterior-cervical-nodes', answer: [{ valueCoding: { code: 'true' } }] },
            { linkId: 'rapid-strep-culture-result', answer: [{ valueCoding: { code: 'negative' } }] },
          ],
        },
      ],
    };
    render(
      <MantineProvider>
        <A01CompactQuestionnaire questionnaire={questionnaire} questionnaireResponse={questionnaireResponse} onSubmit={vi.fn()} />
      </MantineProvider>
    );

    expect(screen.getByText('Screen Cold Symptoms, Ear Pain if present')).toBeInTheDocument();
  });

  test('opens Provider Now only after the complete DP1 contains a Yes answer', () => {
    const partialDp1 = Object.fromEntries(DP1_IDS.slice(0, 3).map((linkId) => [linkId, 'false']));
    expect(shouldOpenProviderNowModal('inhaled-steroid', partialDp1)).toBe(false);
    expect(shouldOpenProviderNowModal('fever', { ...partialDp1, fever: 'true' })).toBe(true);
  });

  test('opens AEM Now only for a positive test with three or more strep criteria', () => {
    const threeCriteria = {
      'dp2-fever': 'true',
      'no-cough': 'true',
      'tonsillar-exudate': 'true',
      'swollen-anterior-cervical-nodes': 'false',
      'rapid-strep-culture-result': 'positive',
    };

    expect(shouldOpenAemNowModal('rapid-strep-culture-result', threeCriteria)).toBe(true);
    expect(shouldOpenAemNowModal('rapid-strep-culture-result', { ...threeCriteria, 'tonsillar-exudate': 'false' })).toBe(false);
    expect(shouldOpenAemNowModal('rapid-strep-culture-result', { ...threeCriteria, 'rapid-strep-culture-result': 'negative' })).toBe(false);
  });

  test('blocks screening and routes AEM Now after a positive test with three criteria', async () => {
    const onSubmit = vi.fn();
    const questionnaireResponse: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      status: 'in-progress',
      item: [
        { linkId: 'initial-escalation-screen', item: RED_FLAG_IDS.map((linkId) => ({ linkId, answer: [{ valueCoding: { code: 'false' } }] })) },
        { linkId: 'dp1-screen', item: DP1_IDS.map((linkId) => ({ linkId, answer: [{ valueCoding: { code: 'false' } }] })) },
        {
          linkId: 'dp2-screen',
          item: [
            { linkId: 'dp2-fever', answer: [{ valueCoding: { code: 'true' } }] },
            { linkId: 'no-cough', answer: [{ valueCoding: { code: 'true' } }] },
            { linkId: 'tonsillar-exudate', answer: [{ valueCoding: { code: 'true' } }] },
            { linkId: 'swollen-anterior-cervical-nodes', answer: [{ valueCoding: { code: 'false' } }] },
          ],
        },
      ],
    };

    render(
      <MantineProvider>
        <A01CompactQuestionnaire questionnaire={questionnaire} questionnaireResponse={questionnaireResponse} onSubmit={onSubmit} />
      </MantineProvider>
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Positive' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Route to AEM Now' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Route to AEM Now' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });

  test('blocks screening and routes Provider Now after all red flags are answered with at least one positive', async () => {
    const onSubmit = vi.fn();
    render(
      <MantineProvider>
        <A01CompactQuestionnaire questionnaire={questionnaire} onSubmit={onSubmit} />
      </MantineProvider>
    );

    const user = userEvent.setup();
    await user.click(screen.getAllByRole('radio', { name: 'Yes' })[0]);

    expect(screen.queryByRole('button', { name: 'Route to Provider Now' })).not.toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio', { name: 'No' }).slice(1)) {
      await user.click(radio);
    }

    await waitFor(() => expect(screen.getByRole('button', { name: 'Route to Provider Now' })).toBeInTheDocument());
    expect(screen.queryByText('Screening DP2:')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Route to Provider Now' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });
});
