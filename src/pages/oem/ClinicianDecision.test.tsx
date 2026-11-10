import { MantineProvider } from '@mantine/core';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicianDecision } from './ClinicianDecision';
import { DECISION_TASK_ID, loadDecisionTask, sendDecision, type DecisionResult } from './clinician-decision';
import { OEM_PROJECT_ID } from './ih-review';
import { LIFECYCLE_WORKER_ID } from './intake';

vi.mock('./clinician-decision', async () => ({
  ...(await vi.importActual('./clinician-decision')),
  loadDecisionTask: vi.fn(),
  sendDecision: vi.fn(),
}));
const taskReference = `Task/${DECISION_TASK_ID}/_history/original`;
const fingerprint = 'a'.repeat(64);
const preview = {
  status: 'preview' as const,
  decision: 'accept' as const,
  task: taskReference,
  fingerprint,
  persisted: false,
};

describe('clinician-confirmed decisions', () => {
  let client: MockClient;
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
    client = new MockClient();
    vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    vi.spyOn(client, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
    vi.mocked(loadDecisionTask).mockResolvedValue({
      resourceType: 'Task',
      id: DECISION_TASK_ID,
      meta: { project: OEM_PROJECT_ID, versionId: 'original' },
      status: 'requested',
      intent: 'proposal',
      for: { reference: `Patient/${LIFECYCLE_WORKER_ID}` },
    });
    vi.mocked(sendDecision).mockResolvedValue(preview);
  });
  const content = () => (
    <MantineProvider>
      <MedplumProvider medplum={client}>
        <ClinicianDecision />
      </MedplumProvider>
    </MantineProvider>
  );
  const mount = () => render(content());
  const open = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Review decision' }));
    return screen.findByRole('dialog', { name: 'Confirm clinician decision' });
  };

  it.each(['actor', 'project'])('clears a reviewed confirmation when the %s scope changes', async (scope) => {
    const view = mount();
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('checkbox'));
    vi.mocked(loadDecisionTask).mockRejectedValueOnce(new Error('New scope has no decision access'));
    if (scope === 'actor')
      vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other-clinician' });
    else vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: 'other-project' });
    view.rerender(content());
    await screen.findByText('Clinician decisions are unavailable for this recommendation.');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'Review exact recommendation' })).not.toBeInTheDocument();
    expect(sendDecision).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0);
  });

  it('previews and cancels without submitting a clinician decision', async () => {
    mount();
    const dialog = await open();
    expect(screen.getByText('Requirement classification: Unclassified')).toBeInTheDocument();
    expect(screen.getByText('Recorded due date: Not recorded')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Record decision' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(sendDecision).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendDecision).mock.calls[0][2]).toBe('preview');
    expect(sessionStorage.length).toBe(0);
  });

  it('requires explicit confirmation and submits the reviewed version only once', async () => {
    vi.mocked(sendDecision)
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce({
        ...preview,
        status: 'recorded',
        persisted: true,
        task: `Task/${DECISION_TASK_ID}/_history/result`,
        receipt: 'Task/receipt/_history/saved',
        proposal: 'ServiceRequest/proposal/_history/saved',
      });
    mount();
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('checkbox'));
    const record = within(dialog).getByRole('button', { name: 'Record decision' });
    fireEvent.click(record);
    fireEvent.click(record);
    await screen.findByText('Decision recorded');
    expect(screen.getByText('Audiogram: accepted')).toBeInTheDocument();
    expect(sendDecision).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendDecision).mock.calls[1].slice(1)).toEqual([
      { task: taskReference, decision: 'accept', reason: 'local-proposal-requested' },
      'decide',
      fingerprint,
    ]);
    expect(sessionStorage.length).toBe(0);
    expect(screen.getByRole('link', { name: 'View local draft proposal' })).toHaveAttribute(
      'href',
      '/ServiceRequest/proposal/_history/saved'
    );
  });

  it('locks new decisions after a lost response and deliberately reconciles the identical stored request', async () => {
    vi.mocked(sendDecision)
      .mockResolvedValueOnce(preview)
      .mockRejectedValueOnce(new Error('Lost response'))
      .mockResolvedValueOnce({
        ...preview,
        status: 'replayed',
        persisted: true,
        task: `Task/${DECISION_TASK_ID}/_history/result`,
        receipt: 'Task/receipt/_history/saved',
        proposal: 'ServiceRequest/proposal/_history/saved',
      });
    const view = mount();
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record decision' }));
    await screen.findByText(/Decision outcome is unconfirmed/);
    expect(screen.getByRole('button', { name: 'Review decision' })).toBeDisabled();
    expect(sessionStorage.length).toBe(1);
    view.unmount();
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reconcile confirmed decision' })).toBeEnabled());
    expect(sendDecision).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Reconcile confirmed decision' }));
    const recovery = await screen.findByRole('dialog', { name: 'Reconcile original decision' });
    expect(within(recovery).getByRole('button', { name: 'Reconcile same decision' })).toBeDisabled();
    fireEvent.click(within(recovery).getByRole('checkbox'));
    fireEvent.click(within(recovery).getByRole('button', { name: 'Reconcile same decision' }));
    await screen.findByText('Decision recorded');
    expect(vi.mocked(sendDecision).mock.calls[2].slice(1)).toEqual(vi.mocked(sendDecision).mock.calls[1].slice(1));
    expect(sessionStorage.length).toBe(0);
  });

  it('ignores late preview responses after leaving the worker scope', async () => {
    let complete: (value: typeof preview) => void = () => {};
    vi.mocked(sendDecision).mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      })
    );
    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Review decision' }));
    view.unmount();
    await act(async () => complete(preview));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(sessionStorage.length).toBe(0);
  });

  it('refuses corrupted pending storage rather than silently enabling a new decision', async () => {
    sessionStorage.setItem(`oem-clinician-decision:${OEM_PROJECT_ID}:clinician`, '{"fingerprint":"invalid"}');
    mount();
    await screen.findByText('Decision recovery data is unavailable. Do not submit another decision.');
    expect(screen.getByRole('button', { name: 'Review decision' })).toBeDisabled();
    expect(sendDecision).not.toHaveBeenCalled();
  });

  it.each(['actor', 'project'])('retains recovery only in its original %s scope', async (scope) => {
    const key = `oem-clinician-decision:${OEM_PROJECT_ID}:clinician`;
    const stored = JSON.stringify({
      input: { task: taskReference, decision: 'accept', reason: 'local-proposal-requested' },
      fingerprint,
    });
    sessionStorage.setItem(key, stored);
    const view = mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reconcile confirmed decision' })).toBeEnabled());
    if (scope === 'actor')
      vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other-clinician' });
    else vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: 'other-project' });
    view.rerender(content());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review decision' })).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Reconcile confirmed decision' })).not.toBeInTheDocument();
    expect(sessionStorage.getItem(key)).toBe(stored);
    vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
    view.rerender(content());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reconcile confirmed decision' })).toBeEnabled());
    expect(sessionStorage.getItem(key)).toBe(stored);
    expect(sendDecision).not.toHaveBeenCalled();
  });

  it.each(['actor', 'project'])('does not carry recorded evidence into another %s scope', async (scope) => {
    vi.mocked(sendDecision)
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce({
        ...preview,
        status: 'recorded',
        persisted: true,
        receipt: 'Task/receipt/_history/saved',
        proposal: 'ServiceRequest/proposal/_history/saved',
      });
    const view = mount();
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record decision' }));
    await screen.findByText('Decision recorded');
    vi.mocked(loadDecisionTask).mockRejectedValueOnce(new Error('No access in changed scope'));
    if (scope === 'actor')
      vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other-clinician' });
    else vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: 'other-project' });
    view.rerender(content());
    await screen.findByText('Clinician decisions are unavailable for this recommendation.');
    expect(screen.queryByText('Decision recorded')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View local draft proposal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review exact recommendation' })).not.toBeInTheDocument();
    expect(sendDecision).toHaveBeenCalledTimes(2);
  });

  it('does not let a late old preview unlock or replace the current in-flight preview', async () => {
    let oldReply: (value: DecisionResult) => void = () => {};
    let currentReply: (value: DecisionResult) => void = () => {};
    vi.mocked(sendDecision)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          oldReply = resolve;
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          currentReply = resolve;
        })
      );
    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Review decision' }));
    vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other-clinician' });
    view.rerender(content());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review decision' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Review decision' }));
    await act(async () => oldReply(preview));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const review = screen.getByRole('button', { name: 'Review decision' });
    expect(review).toBeDisabled();
    fireEvent.click(review);
    fireEvent.click(review);
    expect(sendDecision).toHaveBeenCalledTimes(2);
    await act(async () => currentReply({ ...preview, fingerprint: 'b'.repeat(64) }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm clinician decision' });
    expect(within(dialog).getByRole('button', { name: 'Record decision' })).toBeDisabled();
    expect(sessionStorage.length).toBe(0);
  });

  it('preserves the original recovery entry when an old save finishes after a scope change', async () => {
    let saveReply: (value: DecisionResult) => void = () => {};
    vi.mocked(sendDecision)
      .mockResolvedValueOnce(preview)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          saveReply = resolve;
        })
      );
    const view = mount();
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record decision' }));
    const key = `oem-clinician-decision:${OEM_PROJECT_ID}:clinician`;
    const stored = sessionStorage.getItem(key);
    expect(stored).not.toBeNull();
    vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other-clinician' });
    view.rerender(content());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review decision' })).toBeEnabled());
    await act(async () =>
      saveReply({ ...preview, status: 'recorded', persisted: true, receipt: 'Task/receipt/_history/saved' })
    );
    expect(screen.queryByText('Decision recorded')).not.toBeInTheDocument();
    expect(sessionStorage.getItem(key)).toBe(stored);
    expect(sessionStorage.getItem(`oem-clinician-decision:${OEM_PROJECT_ID}:other-clinician`)).toBeNull();
    expect(sendDecision).toHaveBeenCalledTimes(2);
    vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
    view.rerender(content());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reconcile confirmed decision' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Review decision' })).toBeDisabled();
  });

  it('keeps a corrupt recovery warning in its own scope without blocking a different session', async () => {
    const key = `oem-clinician-decision:${OEM_PROJECT_ID}:clinician`;
    sessionStorage.setItem(key, 'invalid-json');
    const view = mount();
    await screen.findByText('Decision recovery data is unavailable. Do not submit another decision.');
    vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other-clinician' });
    view.rerender(content());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review decision' })).toBeEnabled());
    expect(
      screen.queryByText('Decision recovery data is unavailable. Do not submit another decision.')
    ).not.toBeInTheDocument();
    expect(sessionStorage.getItem(key)).toBe('invalid-json');
    expect(sendDecision).not.toHaveBeenCalled();
  });
});
