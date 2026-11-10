import { MantineProvider } from '@mantine/core';
import type { Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OEM_PROJECT_ID } from './ih-review';
import { loadRuleReviewDetail, loadRuleReviews, submitRuleReview, type RuleReviewDetail } from './rule-review';
import { RuleReviewPage } from './RuleReviewPage';

vi.mock('./rule-review', async () => ({
  ...(await vi.importActual('./rule-review')),
  loadRuleReviews: vi.fn(),
  loadRuleReviewDetail: vi.fn(),
  submitRuleReview: vi.fn(),
}));
const task: Task = {
  resourceType: 'Task',
  id: 'review',
  status: 'requested',
  intent: 'proposal',
  meta: { project: OEM_PROJECT_ID, versionId: 't1' },
  code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-rule-review', code: 'noise-503' }] },
  focus: { reference: 'PlanDefinition/rule/_history/r1' },
  input: [{ type: { text: 'Rule fingerprint' }, valueString: 'a'.repeat(64) }],
};
function detail(): RuleReviewDetail {
  return {
    task: 'Task/review/_history/t1',
    rule: {
      resourceType: 'PlanDefinition',
      id: 'rule',
      status: 'draft',
      title: 'Noise 503 / Matrix Edition 13',
      version: 'draft-1',
    },
    source: {
      resourceType: 'DocumentReference',
      id: 'source',
      status: 'current',
      meta: { versionId: 'd1' },
      content: [{ attachment: { title: 'Adopted Matrix' } }],
    },
    policyDocuments: [],
    blockers: [{ code: 'baseline-timing', description: 'Timing needs policy review' }],
    fingerprint: 'a'.repeat(64),
    stale: false,
    approvalBlocked: true,
  };
}

describe('admin rule-review page', () => {
  let client: MockClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = new MockClient();
    vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    vi.mocked(loadRuleReviews).mockResolvedValue([task]);
    vi.mocked(loadRuleReviewDetail).mockResolvedValue(detail());
    vi.mocked(submitRuleReview).mockResolvedValue('Task/review/_history/t2');
  });
  function setup() {
    render(
      <MemoryRouter>
        <MedplumProvider medplum={client}>
          <MantineProvider env="test">
            <RuleReviewPage />
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );
  }
  async function open() {
    await userEvent.click(await screen.findByRole('button', { name: 'Open rule review review' }));
    await screen.findByRole('heading', { name: 'Unresolved requirements' });
  }
  async function reason() {
    await userEvent.click(screen.getByPlaceholderText('Select reason'));
    await userEvent.click(await screen.findByRole('option', { name: 'Timing unresolved' }));
  }
  it('refuses another Project without loading', () => {
    vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: 'other' });
    setup();
    expect(screen.getByText('OEM Project required')).toBeInTheDocument();
    expect(loadRuleReviews).not.toHaveBeenCalled();
  });
  it('keeps permission/load failure distinct from an empty queue', async () => {
    vi.mocked(loadRuleReviews).mockRejectedValue(new Error('Forbidden'));
    setup();
    expect(await screen.findByText('Reviews unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No open rule reviews.')).not.toBeInTheDocument();
  });
  it('shows exact evidence and blockers without submitting; confirmation can be cancelled', async () => {
    setup();
    await open();
    expect(screen.getByText('Timing needs policy review')).toBeInTheDocument();
    expect(screen.getByText('Approval blocked')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'DocumentReference/source/_history/d1' })).toHaveAttribute(
      'href',
      '/DocumentReference/source/history'
    );
    expect(screen.getByRole('button', { name: 'Review decision' })).toBeDisabled();
    await reason();
    await userEvent.click(screen.getByRole('button', { name: 'Review decision' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('PlanDefinition/rule/_history/r1');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(submitRuleReview).not.toHaveBeenCalled();
  });
  it('records only after explicit confirmation and shows exact receipt', async () => {
    setup();
    await open();
    await reason();
    await userEvent.click(screen.getByRole('button', { name: 'Review decision' }));
    expect(submitRuleReview).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await screen.findByText('Decision recorded');
    expect(submitRuleReview).toHaveBeenCalledWith(client, task, 'request-changes', 'timing-unresolved');
  });
  it('shows stored annual cadence without inventing an unresolved baseline or anchor', async () => {
    const value = detail();
    value.rule.action = [
      { id: 'baseline', title: 'Baseline audiogram' },
      {
        id: 'periodic',
        title: 'Annual audiogram',
        timingTiming: { repeat: { frequency: 1, period: 1, periodUnit: 'a' } },
      },
      { id: 'termination', title: 'Termination audiogram' },
    ];
    vi.mocked(loadRuleReviewDetail).mockResolvedValue(value);
    setup();
    await open();
    const baseline = within(screen.getByRole('region', { name: 'Baseline audiogram' }));
    expect(baseline.getByText('Duration: Not recorded')).toBeInTheDocument();
    expect(baseline.getByText('Baseline anchor: Not recorded')).toBeInTheDocument();
    const periodic = within(screen.getByRole('region', { name: 'Annual audiogram' }));
    expect(periodic.getByText('Frequency: 1')).toBeInTheDocument();
    expect(periodic.getByText('Period: 1')).toBeInTheDocument();
    expect(periodic.getByText('Period unit: a')).toBeInTheDocument();
    expect(periodic.getByText('Periodic anchor: Not recorded')).toBeInTheDocument();
    expect(screen.getByText('Termination handling: Not recorded')).toBeInTheDocument();
    expect(screen.getByText('No policy resolutions recorded.')).toBeInTheDocument();
    expect(submitRuleReview).not.toHaveBeenCalled();
  });
  it('shows exact synthetic contract values and their cited resolution without a decision', async () => {
    const value = detail();
    value.rule.action = [
      {
        id: 'baseline',
        title: 'Synthetic baseline contract',
        timingDuration: { value: 0, system: 'http://unitsofmeasure.org', code: 'mo' },
        extension: [
          {
            url: 'https://hiivehealth.com/fhir/StructureDefinition/oem-baseline-anchor',
            valueCode: 'enrollment-start',
          },
        ],
      },
      {
        id: 'periodic',
        title: 'Synthetic periodic contract',
        extension: [
          {
            url: 'https://hiivehealth.com/fhir/StructureDefinition/oem-periodic-anchor',
            valueCode: 'qualifying-performed-date',
          },
        ],
      },
      {
        id: 'termination',
        title: 'Synthetic termination contract',
        extension: [
          {
            url: 'https://hiivehealth.com/fhir/StructureDefinition/oem-termination-policy',
            valueCode: 'requires-clinician-review',
          },
        ],
      },
    ];
    value.rule.extension = [
      {
        url: 'https://hiivehealth.com/fhir/StructureDefinition/oem-rule-resolution',
        extension: [
          { url: 'code', valueCode: 'baseline-timing' },
          { url: 'disposition', valueCode: 'policy-confirmed' },
          { url: 'evidence', valueReference: { reference: 'DocumentReference/policy/_history/p1' } },
        ],
      },
    ];
    vi.mocked(loadRuleReviewDetail).mockResolvedValue(value);
    setup();
    await open();
    const baseline = within(screen.getByRole('region', { name: 'Synthetic baseline contract' }));
    expect(baseline.getByText('Duration: 0')).toBeInTheDocument();
    expect(baseline.getByText('Duration unit: mo')).toBeInTheDocument();
    expect(baseline.getByText('Unit system: http://unitsofmeasure.org')).toBeInTheDocument();
    expect(baseline.getByText('Baseline anchor: enrollment-start')).toBeInTheDocument();
    expect(screen.getByText('Periodic anchor: qualifying-performed-date')).toBeInTheDocument();
    expect(screen.getByText('Termination handling: requires-clinician-review')).toBeInTheDocument();
    const resolution = within(screen.getByRole('region', { name: 'Policy resolution baseline-timing' }));
    expect(resolution.getByText('Disposition: policy-confirmed')).toBeInTheDocument();
    expect(resolution.getByRole('link', { name: 'DocumentReference/policy/_history/p1' })).toHaveAttribute(
      'href',
      '/DocumentReference/policy/history'
    );
    expect(submitRuleReview).not.toHaveBeenCalled();
  });
  it('blocks stale review decisions', async () => {
    vi.mocked(loadRuleReviewDetail).mockResolvedValue({ ...detail(), stale: true });
    setup();
    await open();
    expect(screen.getByText('Review changed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review decision' })).toBeDisabled();
  });
  it('shows completed decision attribution without editable controls', async () => {
    const completed: Task = {
      ...task,
      status: 'completed',
      meta: { ...task.meta, versionId: 't2' },
      output: [
        { type: { text: 'Decision' }, valueCode: 'request-changes' },
        { type: { text: 'Admin' }, valueReference: { reference: 'Practitioner/admin' } },
        { type: { text: 'Decision time' }, valueDateTime: '2026-10-21T12:00:00.000Z' },
      ],
    };
    vi.mocked(loadRuleReviews).mockImplementation(async (_, status) => (status === 'completed' ? [completed] : [task]));
    vi.mocked(loadRuleReviewDetail).mockResolvedValue({ ...detail(), task: 'Task/review/_history/t2' });
    setup();
    await userEvent.click(screen.getByRole('radio', { name: 'Reviewed' }));
    await open();
    expect(screen.getByRole('heading', { name: 'Recorded decision' })).toBeInTheDocument();
    expect(screen.getByText('Admin: Practitioner/admin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review decision' })).not.toBeInTheDocument();
  });
  it('requires a separate confirmation for source-contract approval', async () => {
    vi.mocked(loadRuleReviewDetail).mockResolvedValue({ ...detail(), blockers: [], approvalBlocked: false });
    setup();
    await open();
    await userEvent.click(screen.getByRole('textbox', { name: 'Decision' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Approve content' }));
    await userEvent.click(screen.getByPlaceholderText('Select reason'));
    await userEvent.click(await screen.findByRole('option', { name: 'Source and contract verified' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review decision' }));
    expect(submitRuleReview).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await waitFor(() =>
      expect(submitRuleReview).toHaveBeenCalledWith(client, task, 'approve', 'source-contract-verified')
    );
  });
  it('locks controls after an uncertain response until reload', async () => {
    vi.mocked(submitRuleReview).mockRejectedValue(new Error('Lost response'));
    setup();
    await open();
    await reason();
    await userEvent.click(screen.getByRole('button', { name: 'Review decision' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await screen.findByText('Decision completion was not confirmed. Reload the review before another decision.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review decision' })).toBeDisabled());
    expect(screen.getByRole('textbox', { name: 'Decision' })).toBeDisabled();
  });
  it('sends one decision on double-click and locks all context controls until completion', async () => {
    let finishDecision!: (receipt: string) => void;
    vi.mocked(submitRuleReview).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishDecision = resolve;
        })
    );
    setup();
    await open();
    await reason();
    await userEvent.click(screen.getByRole('button', { name: 'Review decision' }));
    await userEvent.dblClick(screen.getByRole('button', { name: 'Record decision' }));
    expect(submitRuleReview).toHaveBeenCalledTimes(1);
    for (const name of ['Cancel', 'Reload rule reviews', 'Open rule review review']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getByRole('radio', { name: 'Reviewed' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Decision' })).toBeDisabled();
    expect(screen.getByPlaceholderText('Select reason')).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => finishDecision('Task/review/_history/t2'));
    await screen.findByText('Decision recorded');
    expect(submitRuleReview).toHaveBeenCalledTimes(1);
  });
  it('reconciles a lost response through fresh reviewed history without resubmitting', async () => {
    const completed: Task = {
      ...task,
      status: 'completed',
      meta: { ...task.meta, versionId: 't2' },
      output: [
        { type: { text: 'Decision' }, valueCode: 'request-changes' },
        { type: { text: 'Admin' }, valueReference: { reference: 'Practitioner/admin' } },
      ],
    };
    let recorded = false;
    vi.mocked(loadRuleReviews).mockImplementation(async (_, status) =>
      status === 'completed' ? [completed] : recorded ? [] : [task]
    );
    vi.mocked(loadRuleReviewDetail).mockImplementation(async (_, selected) => ({
      ...detail(),
      task: `Task/review/_history/${selected.meta?.versionId}`,
    }));
    vi.mocked(submitRuleReview).mockImplementation(async () => {
      recorded = true;
      throw new Error('Response lost after recording');
    });
    setup();
    await open();
    await reason();
    await userEvent.click(screen.getByRole('button', { name: 'Review decision' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await screen.findByText('Decision completion was not confirmed. Reload the review before another decision.');
    await userEvent.click(screen.getByRole('button', { name: 'Reload rule reviews' }));
    await screen.findByText('No open rule reviews.');
    await userEvent.click(screen.getByRole('radio', { name: 'Reviewed' }));
    await open();
    expect(screen.getByRole('heading', { name: 'Recorded decision' })).toBeInTheDocument();
    expect(screen.getByText('Admin: Practitioner/admin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review decision' })).not.toBeInTheDocument();
    expect(submitRuleReview).toHaveBeenCalledTimes(1);
    expect(loadRuleReviews).toHaveBeenLastCalledWith(client, 'completed');
    expect(loadRuleReviewDetail).toHaveBeenLastCalledWith(client, completed);
  });
});
