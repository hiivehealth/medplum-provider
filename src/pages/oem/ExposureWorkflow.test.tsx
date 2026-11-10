import { MantineProvider } from '@mantine/core';
import type { Observation, Patient } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExposureWorkflow } from './ExposureWorkflow';
import { sendExposureWorkflow, verifyExposureWorkflowResult, type ExposureWorkflowResult } from './exposure-workflow';
import { OEM_PROJECT_ID } from './ih-review';
import { loadIntakeEvidence } from './intake';

vi.mock('./exposure-workflow', () => ({ exposureSummary: vi.fn(), sendExposureWorkflow: vi.fn(), verifyExposureWorkflowResult: vi.fn() }));
vi.mock('./intake', async () => ({ ...await vi.importActual('./intake'), loadIntakeEvidence: vi.fn() }));
const patient: Patient = { resourceType: 'Patient', id: 'new-worker' };
const exposure: Observation = { resourceType: 'Observation', id: 'new-exposure', meta: { project: OEM_PROJECT_ID, versionId: 'new-version' },
  status: 'final', code: { text: 'Noise' } };
const enrollment: Observation = { ...exposure, id: 'new-enrollment' };
const scope = { patient: 'Patient/new-worker', exposure: 'Observation/new-exposure/_history/new-version',
  enrollment: 'Observation/new-enrollment/_history/new-version', asOf: '2026-10-26' };
const fingerprint = 'a'.repeat(64);
const advisory: ExposureWorkflowResult = { ...scope, phase: 'advisory', persisted: false, fingerprint, sources: [],
  activated: false, externalDispatch: false, clinicalCompletionVerified: false, status: 'due', canRecommend: true, rationale: 'New episode baseline due.' };

describe('same-exposure provider workflow', () => {
  let client: MockClient;
  beforeEach(() => {
    vi.resetAllMocks(); sessionStorage.clear();
    client = new MockClient();
    vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    vi.spyOn(client, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
    vi.mocked(verifyExposureWorkflowResult).mockImplementation(async (_client, _request, result) => result);
    vi.mocked(sendExposureWorkflow).mockResolvedValue(advisory);
    vi.mocked(loadIntakeEvidence).mockResolvedValue([{ resourceType: 'DocumentReference', id: 'worker-evidence',
      meta: { project: OEM_PROJECT_ID, versionId: 'one' }, status: 'current', subject: { reference: 'Patient/new-worker' },
      description: 'Synthetic worker enrollment evidence', content: [] }]);
  });
  const content = (selected = exposure) => <MantineProvider env="test"><MedplumProvider medplum={client}>
    <ExposureWorkflow worker={patient} exposure={selected} enrollment={enrollment} asOf={scope.asOf} />
  </MedplumProvider></MantineProvider>;
  const review = async () => {
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review recommendation' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Review recommendation' }));
    return screen.findByRole('dialog', { name: 'Confirm exposure workflow' });
  };
  const confirm = async (label: string) => {
    const dialog = await screen.findByRole('dialog', { name: 'Confirm exposure workflow' });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: label }));
  };

  it('does not submit on mount and can cancel a preview without saving', async () => {
    render(content());
    expect(sendExposureWorkflow).not.toHaveBeenCalled();
    const dialog = await review();
    expect(sendExposureWorkflow).toHaveBeenCalledExactlyOnceWith(client, { ...scope, mode: 'preview' });
    expect(within(dialog).getByRole('button', { name: 'Save recommendation' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(sendExposureWorkflow).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0);
  });

  it('keeps the same episode from recommendation through decision, draft and follow-up', async () => {
    const requested = { ...advisory, phase: 'recommendation' as const, persisted: true, task: 'Task/new-task/_history/requested', status: 'requested' };
    const decisionPreview = { ...advisory, phase: 'decision' as const, task: requested.task, decision: 'accept' as const };
    const accepted = { ...decisionPreview, persisted: true, task: 'Task/new-task/_history/accepted', proposal: 'ServiceRequest/new-draft/_history/one' };
    const completionPreview = { ...advisory, phase: 'completion' as const, task: accepted.task, proposal: accepted.proposal,
      performedOn: '2026-10-26', nextPeriodicOn: '2027-10-26' };
    const completed = { ...completionPreview, persisted: true, report: 'DocumentReference/new-report/_history/one', attestation: 'Observation/new-attestation/_history/one' };
    vi.mocked(sendExposureWorkflow).mockResolvedValueOnce(advisory).mockResolvedValueOnce(requested)
      .mockResolvedValueOnce(decisionPreview).mockResolvedValueOnce(accepted).mockResolvedValueOnce(completionPreview).mockResolvedValueOnce(completed);
    render(content()); await review(); await confirm('Save recommendation');
    expect(await screen.findByRole('link', { name: "View this exposure's recommendation" })).toHaveAttribute('href', `/${requested.task}`);
    fireEvent.click(screen.getByRole('button', { name: 'Review decision' }));
    await confirm('Record decision');
    expect(await screen.findByText('Audiogram: accepted')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "View this exposure's draft order" })).toHaveAttribute('href', `/${accepted.proposal}`);
    fireEvent.click(screen.getByRole('button', { name: 'Preview synthetic follow-up' }));
    await confirm('Save synthetic attestation');
    expect(await screen.findByText('Synthetic attestation saved')).toBeInTheDocument();
    expect(screen.getByText('Illustrative next periodic date: 2027-10-26')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "View this exposure's attestation" })).toHaveAttribute('href', `/${completed.attestation}`);
    expect(sendExposureWorkflow).toHaveBeenCalledTimes(6);
    for (const [, request] of vi.mocked(sendExposureWorkflow).mock.calls) {
      expect(request).toMatchObject(scope);
      expect(JSON.stringify(request)).not.toContain('baa7efea');
      if (['recommend', 'decide', 'complete'].includes(request.mode)) expect(request).toMatchObject({ confirmedSave: true, fingerprint });
    }
  });

  it('does not offer a save when enrollment evidence needs review', async () => {
    vi.mocked(sendExposureWorkflow).mockResolvedValue({ ...advisory, status: 'needs-review', canRecommend: false });
    render(content());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review recommendation' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Review recommendation' }));
    expect(await screen.findByText('Source review required')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(sendExposureWorkflow).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit enrollment decision and evidence, then selects only its confirmed saved result', async () => {
    const onSaved = vi.fn(async () => undefined);
    const enrollmentPreview = { ...advisory, enrollment: undefined, phase: 'enrollment' as const, determination: 'enrolled' as const,
      enrollmentStart: scope.asOf, enrollmentEvidence: 'DocumentReference/worker-evidence/_history/one' };
    vi.mocked(sendExposureWorkflow).mockResolvedValueOnce(enrollmentPreview).mockResolvedValueOnce({ ...enrollmentPreview,
      persisted: true, enrollmentRecord: 'Observation/saved-enrollment/_history/one' });
    render(<MantineProvider env="test"><MedplumProvider medplum={client}><ExposureWorkflow worker={patient} exposure={exposure}
      asOf={scope.asOf} onEnrollmentSaved={onSaved} /></MedplumProvider></MantineProvider>);
    const button = await screen.findByRole('button', { name: 'Review enrollment determination' });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('textbox', { name: 'New enrollment determination' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Enrolled' }));
    fireEvent.click(screen.getByRole('textbox', { name: 'Enrollment evidence for this exposure' }));
    fireEvent.click(await screen.findByRole('option', { name: /Synthetic worker enrollment evidence/ }));
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Confirm exposure workflow' });
    expect(onSaved).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Record enrollment determination' })).toBeDisabled();
    await confirm('Record enrollment determination');
    await waitFor(() => expect(onSaved).toHaveBeenCalledExactlyOnceWith('Observation/saved-enrollment/_history/one'));
    expect(vi.mocked(sendExposureWorkflow).mock.calls[1][1]).toMatchObject({ patient: scope.patient, exposure: scope.exposure,
      mode: 'enroll', determination: 'enrolled', enrollmentEvidence: enrollmentPreview.enrollmentEvidence, confirmedSave: true });
  });

  it('reconciles only the original confirmed request after an uncertain save', async () => {
    vi.mocked(sendExposureWorkflow).mockResolvedValueOnce(advisory).mockRejectedValueOnce(new Error('Lost response'))
      .mockResolvedValueOnce({ ...advisory, phase: 'recommendation', persisted: true, task: 'Task/new-task/_history/one' });
    render(content()); await review(); await confirm('Save recommendation');
    const reconcile = await screen.findByRole('button', { name: 'Reconcile confirmed action' });
    expect(screen.getByRole('button', { name: 'Review recommendation' })).toBeDisabled();
    const original = structuredClone(vi.mocked(sendExposureWorkflow).mock.calls[1][1]);
    fireEvent.click(reconcile); await confirm('Reconcile same action');
    await screen.findByRole('link', { name: "View this exposure's recommendation" });
    expect(vi.mocked(sendExposureWorkflow).mock.calls[2][1]).toEqual(original);
  });

  it('discards a late preview after the selected exposure changes', async () => {
    let finish!: (value: ExposureWorkflowResult) => void;
    vi.mocked(sendExposureWorkflow).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(content());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review recommendation' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Review recommendation' }));
    view.rerender(content({ ...exposure, id: 'another-exposure' }));
    await act(async () => finish(advisory));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('New episode baseline due.')).not.toBeInTheDocument();
  });

  it('blocks new saves if recovery storage is unavailable', async () => {
    vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    render(content());
    expect(await screen.findByText(/Saved workflow recovery could not be verified/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review recommendation' })).toBeDisabled();
    expect(sendExposureWorkflow).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});