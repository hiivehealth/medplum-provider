import { MantineProvider } from '@mantine/core';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompletionPreview } from './CompletionPreview';
import { COMPLETION_PREVIEW_BOT_ID, COMPLETION_PROPOSAL, COMPLETION_REPORT, COMPLETION_TASK, previewSimulatedCompletion } from './completion-preview';
import { OEM_PROJECT_ID } from './ih-review';
import { LIFECYCLE_WORKER_ID } from './intake';
import { COMPLETION_SAVE_BOT_ID, inspectSyntheticCompletion, saveSyntheticCompletion } from './completion-save';
import type { Task } from '@medplum/fhirtypes';

const worker = `Patient/${LIFECYCLE_WORKER_ID}`;
const actor = 'Practitioner/clinician';
const at = '2026-10-23T12:00:00.000Z';
function response() {
  const flags = { persisted: false, activated: false, externalDispatch: false, clinicalCompletionVerified: false };
  const attestation = { resourceType: 'Observation', id: `oem-simulated-${'a'.repeat(40)}`, status: 'final',
    meta: { tag: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/demo-data', code: 'synthetic-only' }] },
    code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-simulated-completion', code: 'audiogram-attestation' }] },
    subject: { reference: worker }, issued: at, effectiveDateTime: '2026-06-15', performer: [{ reference: actor }],
    basedOn: [{ reference: COMPLETION_PROPOSAL }], focus: [{ reference: COMPLETION_TASK }], derivedFrom: [{ reference: COMPLETION_REPORT }] };
  return { ...flags, fingerprint: 'f'.repeat(64), saved: false, mode: 'preview', coverage: 'exact-configured-manifest-only', requester: actor, inspectedAt: at,
    headState: 'unchanged-at-read-checks', task: COMPLETION_TASK, proposal: COMPLETION_PROPOSAL, report: COMPLETION_REPORT,
    plan: { ...flags, mode: 'offline-simulated-completion', coverage: 'supplied-records-only',
      completion: { patient: { reference: worker }, action: 'audiogram', ruleVersion: 'demo-1', kind: 'manual-attestation', performedOn: '2026-06-15', evidence: { reference: COMPLETION_REPORT } },
      evaluation: { due: '2027-06-15', stage: 'periodic' }, attestation,
      lineage: { resourceType: 'Provenance', recorded: at, target: [{ reference: `Observation/${attestation.id}` }], agent: [{ who: { reference: actor } }],
        entity: [COMPLETION_TASK, COMPLETION_PROPOSAL, COMPLETION_REPORT].map(reference => ({ role: 'source', what: { reference } })) } } };
}

function savedFixture() {
  const preview = response();
  const marker = 'https://hiivehealth.com/fhir/CodeSystem/oem-synthetic-completion-save';
  const meta = { project: OEM_PROJECT_ID, versionId: 'saved', tag: [
    { system: 'https://hiivehealth.com/fhir/CodeSystem/demo-data', code: 'synthetic-only' }, { system: marker, code: 'a'.repeat(40) }] };
  const references = ['Task/receipt/_history/saved', 'Observation/attestation/_history/saved', 'AuditEvent/audit/_history/saved', 'Provenance/lineage/_history/saved'];
  const result = { mode: 'save', status: 'recorded', fingerprint: preview.fingerprint, persisted: true, syntheticAttestationRecorded: true,
    clinicalCompletionVerified: false, activated: false, externalDispatch: false, task: COMPLETION_TASK, proposal: COMPLETION_PROPOSAL,
    report: COMPLETION_REPORT, requester: actor, recordedAt: at, performedOn: '2026-06-15', nextPeriodicOn: '2027-06-15',
    receipt: references[0], attestation: references[1], audit: references[2], lineage: references[3] };
  const records = [
    { resourceType: 'Task', id: 'receipt', meta, status: 'completed', intent: 'order', for: { reference: worker }, requester: { reference: actor },
      focus: { reference: COMPLETION_TASK }, authoredOn: at, code: { coding: [{ system: marker, code: 'technical-receipt' }] },
      identifier: [{ system: marker, value: 'a'.repeat(40) }], input: [{ valueString: preview.fingerprint }],
      output: references.slice(1).map((reference, index) => ({ type: { text: ['attestation', 'audit', 'lineage'][index] }, valueReference: { reference } })) },
    { ...preview.plan.attestation, id: 'attestation', meta },
    { resourceType: 'AuditEvent', id: 'audit', meta, action: 'C', recorded: at, agent: [{ who: { reference: actor }, requestor: true }],
      entity: [COMPLETION_TASK, COMPLETION_PROPOSAL, COMPLETION_REPORT, 'Task/receipt', references[1]].map(reference => ({ what: { reference } })) },
    { ...preview.plan.lineage, id: 'lineage', meta, target: [{ reference: references[1] }],
      entity: [...preview.plan.lineage.entity, { role: 'source', what: { reference: 'Task/receipt' } }] },
    ...[COMPLETION_TASK, COMPLETION_PROPOSAL].map(reference => { const [resourceType, id, , versionId] = reference.split('/'); return { resourceType, id, meta: { project: OEM_PROJECT_ID, versionId } }; }),
  ];
  return { preview: { ...preview, saved: true, recorded: result }, result, records };
}

describe('read-only simulated completion preview', () => {
  let client: MockClient;
  beforeEach(() => {
    client = new MockClient();
    sessionStorage.clear();
    vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    vi.spyOn(client, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
  });
  const content = () => <MantineProvider><MedplumProvider medplum={client}><CompletionPreview /></MedplumProvider></MantineProvider>;
  const mount = () => render(content());

  it.each(['denied', 'corrupt'])('fails closed without crashing or deleting %s recovery storage', async scenario => {
    const key = `oem-synthetic-completion:${OEM_PROJECT_ID}:clinician`;
    const stored = scenario === 'denied' ? 'f'.repeat(64) : 'not-a-fingerprint';
    sessionStorage.setItem(key, stored);
    const post = vi.spyOn(client, 'post').mockResolvedValue(response());
    const originalGet = sessionStorage.getItem.bind(sessionStorage);
    const storage = vi.spyOn(sessionStorage, 'getItem').mockImplementation((name: string) => {
      if (scenario === 'denied' && name === key) throw new Error('private storage details');
      return originalGet(name);
    });
    try {
      expect(() => mount()).not.toThrow();
      await screen.findByText('Recovery unavailable');
      expect(screen.getByRole('checkbox', { name: 'I confirm this is a synthetic example' })).toBeDisabled();
      const preview = screen.getByRole('button', { name: 'Preview simulated completion' });
      expect(preview).toBeDisabled();
      fireEvent.click(preview);
      expect(post).not.toHaveBeenCalled();
      expect(screen.queryByText('private storage details')).not.toBeInTheDocument();
    } finally {
      storage.mockRestore();
    }
    expect(sessionStorage.getItem(key)).toBe(stored);
  });

  it('sends only explicit simulation confirmation with no retry, actor/date or record selections', async () => {
    const post = vi.spyOn(client, 'post').mockResolvedValue(response());
    expect((await previewSimulatedCompletion(client, true)).nextPeriodicOn).toBe('2027-06-15');
    expect(post).toHaveBeenCalledWith(`fhir/R4/Bot/${COMPLETION_PREVIEW_BOT_ID}/$execute`, { mode: 'preview', confirmedSimulation: true }, 'application/json', { maxRetries: 0 });
    await expect(previewSimulatedCompletion(client, false)).rejects.toThrow('confirmation');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each(['saved', 'activated', 'dispatch', 'clinical', 'actor', 'task', 'report', 'date', 'lineage', 'attestation-worker'])(
    'rejects an unsafe or mismatched native result: %s', async scenario => {
      const raw = response();
      if (scenario === 'saved') raw.persisted = true;
      if (scenario === 'activated') raw.plan.activated = true;
      if (scenario === 'dispatch') raw.externalDispatch = true;
      if (scenario === 'clinical') raw.clinicalCompletionVerified = true;
      if (scenario === 'actor') raw.requester = 'Practitioner/foreign';
      if (scenario === 'task') raw.task = 'Task/foreign/_history/one';
      if (scenario === 'report') raw.plan.attestation.derivedFrom[0].reference = 'DocumentReference/foreign/_history/one';
      if (scenario === 'date') raw.plan.evaluation.due = '2027-10-23';
      if (scenario === 'lineage') raw.plan.lineage.entity = [];
      if (scenario === 'attestation-worker') raw.plan.attestation.subject.reference = 'Patient/foreign';
      vi.spyOn(client, 'post').mockResolvedValue(raw);
      await expect(previewSimulatedCompletion(client, true)).rejects.toThrow('could not be verified');
    });

  it('requires confirmation and presents only an unsaved simulation with exact report link', async () => {
    const post = vi.spyOn(client, 'post').mockResolvedValue(response());
    mount();
    const button = screen.getByRole('button', { name: 'Preview simulated completion' });
    expect(button).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText('Preview not saved');
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Illustrative next periodic date: 2027-06-15')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View synthetic audiogram report' })).toHaveAttribute('href', `/${COMPLETION_REPORT}`);
    expect(screen.getByRole('button', { name: 'Save synthetic attestation' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'I confirm saving this synthetic attestation only' })).not.toBeChecked();
    expect(post.mock.calls[0][0]).toBe(`fhir/R4/Bot/${COMPLETION_SAVE_BOT_ID}/$execute`);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss preview' }));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('does not retry errors or expose private transport details', async () => {
    const post = vi.spyOn(client, 'post').mockRejectedValue(new Error('private transport details'));
    mount(); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Preview simulated completion' }));
    await screen.findByText('Preview unavailable');
    expect(screen.queryByText('private transport details')).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('ignores a late preview after leaving the worker scope', async () => {
    let complete: (value: ReturnType<typeof response>) => void = () => {};
    vi.spyOn(client, 'post').mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const view = mount(); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Preview simulated completion' }));
    view.unmount(); await act(async () => complete(response()));
    await waitFor(() => expect(screen.queryByText('Preview not saved')).not.toBeInTheDocument());
  });

  it('requires separate save confirmation, blocks rapid clicks and retains only exact-request reconciliation after a lost response', async () => {
    const post = vi.spyOn(client, 'post').mockResolvedValueOnce(response()).mockRejectedValue(new Error('private save transport'));
    mount(); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Preview simulated completion' }));
    await screen.findByText('Preview not saved');
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm saving this synthetic attestation only' }));
    const save = screen.getByRole('button', { name: 'Save synthetic attestation' });
    fireEvent.click(save); fireEvent.click(save);
    await screen.findByText('Save outcome uncertain');
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]).toEqual([`fhir/R4/Bot/${COMPLETION_SAVE_BOT_ID}/$execute`,
      { mode: 'save', confirmedSimulation: true, confirmedSave: true, fingerprint: 'f'.repeat(64) }, 'application/json', { maxRetries: 0 }]);
    expect(screen.getByRole('button', { name: 'Reconcile synthetic save' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Dismiss preview' })).not.toBeInTheDocument();
    expect(screen.queryByText('private save transport')).not.toBeInTheDocument();
  });

  it.each([false, true])('verifies saved readback without another Save control, with pending recovery: %s', async pending => {
    const fixture = savedFixture();
    const key = `oem-synthetic-completion:${OEM_PROJECT_ID}:clinician`;
    if (pending) sessionStorage.setItem(key, fixture.result.fingerprint);
    const lookup = (type: string, id: string) => fixture.records.find(resource => resource.resourceType === type && resource.id === id);
    vi.spyOn(client, 'readVersion').mockImplementation((type, id) => Promise.resolve(structuredClone(lookup(type, id))) as never);
    vi.spyOn(client, 'readResource').mockImplementation((type, id) => Promise.resolve(structuredClone(lookup(type, id))) as never);
    const post = vi.spyOn(client, 'post').mockResolvedValueOnce(fixture.preview).mockResolvedValue(fixture.result);
    mount(); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Preview simulated completion' }));
    await screen.findByText('Synthetic attestation saved');
    expect(screen.getByRole('link', { name: 'View synthetic attestation' })).toHaveAttribute('href', `/${fixture.result.attestation}`);
    expect(screen.queryByRole('button', { name: 'Save synthetic attestation' })).not.toBeInTheDocument();
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
    await expect(saveSyntheticCompletion(client, fixture.result.fingerprint, false)).rejects.toThrow('confirmation');
    expect(post).toHaveBeenCalledTimes(1);
    expect(await saveSyntheticCompletion(client, fixture.result.fingerprint, true)).toEqual(fixture.result);
  });

  it.each(['actor', 'project'])('isolates a corrupt recovery warning to its original %s scope', async scope => {
    const key = `oem-synthetic-completion:${OEM_PROJECT_ID}:clinician`;
    sessionStorage.setItem(key, 'invalid-fingerprint');
    const post = vi.spyOn(client, 'post').mockResolvedValue(response());
    const view = mount();
    await screen.findByText('Recovery unavailable');
    if (scope === 'actor') vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other-clinician' });
    else vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: 'other-project' });
    view.rerender(content());
    await waitFor(() => expect(screen.queryByText('Recovery unavailable')).not.toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: 'I confirm this is a synthetic example' })).not.toBeChecked();
    expect(sessionStorage.getItem(key)).toBe('invalid-fingerprint');
    expect(post).not.toHaveBeenCalled();
    vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
    view.rerender(content());
    await screen.findByText('Recovery unavailable');
    expect(screen.getByRole('checkbox', { name: 'I confirm this is a synthetic example' })).toBeDisabled();
  });

  it('does not submit a save if its recovery journal cannot be written', async () => {
    const post = vi.spyOn(client, 'post').mockResolvedValue(response());
    mount();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this is a synthetic example' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview simulated completion' }));
    await screen.findByText('Preview not saved');
    const storage = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('private quota details'); });
    try {
      fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm saving this synthetic attestation only' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save synthetic attestation' }));
      await screen.findByText('Recovery unavailable');
      expect(screen.getByRole('button', { name: 'Save synthetic attestation' })).toBeDisabled();
      expect(screen.queryByText('private quota details')).not.toBeInTheDocument();
      expect(post).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem(`oem-synthetic-completion:${OEM_PROJECT_ID}:clinician`)).toBeNull();
    } finally {
      storage.mockRestore();
    }
  });

  it('does not let an old preview release a new scope request lock', async () => {
    let oldReply: (value: ReturnType<typeof response>) => void = () => {};
    let currentReply: (value: ReturnType<typeof response>) => void = () => {};
    const post = vi.spyOn(client, 'post').mockReturnValueOnce(new Promise(resolve => { oldReply = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { currentReply = resolve; }));
    const view = mount();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this is a synthetic example' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview simulated completion' }));
    vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other-clinician' });
    view.rerender(content());
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this is a synthetic example' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview simulated completion' }));
    expect(post).toHaveBeenCalledTimes(2);
    await act(async () => oldReply(response()));
    const button = screen.getByRole('button', { name: 'Preview simulated completion' });
    expect(button).toBeDisabled();
    expect(screen.queryByText('Preview not saved')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(post).toHaveBeenCalledTimes(2);
    await act(async () => currentReply(response()));
  });

  it('preserves the original recovery journal when an old save resolves after an actor change', async () => {
    const fixture = savedFixture();
    const lookup = (type: string, id: string) => fixture.records.find(resource => resource.resourceType === type && resource.id === id);
    vi.spyOn(client, 'readVersion').mockImplementation((type, id) => Promise.resolve(structuredClone(lookup(type, id))) as never);
    vi.spyOn(client, 'readResource').mockImplementation((type, id) => Promise.resolve(structuredClone(lookup(type, id))) as never);
    let saveReply: (value: typeof fixture.result) => void = () => {};
    const post = vi.spyOn(client, 'post').mockResolvedValueOnce(response())
      .mockReturnValueOnce(new Promise(resolve => { saveReply = resolve; }));
    const view = mount();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this is a synthetic example' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview simulated completion' }));
    await screen.findByText('Preview not saved');
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm saving this synthetic attestation only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save synthetic attestation' }));
    const key = `oem-synthetic-completion:${OEM_PROJECT_ID}:clinician`;
    expect(sessionStorage.getItem(key)).toBe(fixture.result.fingerprint);
    vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other-clinician' });
    view.rerender(content());
    await act(async () => saveReply(fixture.result));
    expect(sessionStorage.getItem(key)).toBe(fixture.result.fingerprint);
    expect(screen.queryByText('Synthetic attestation saved')).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(2);
    vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
    view.rerender(content());
    await screen.findByText('Save outcome uncertain');
  });

  it.each(['foreign-project', 'wrong-report', 'wrong-receipt-output', 'missing-tag', 'wrong-actor'])('rejects saved graph mismatch %s without resubmitting', async scenario => {
    const fixture = savedFixture();
    if (scenario === 'foreign-project') fixture.records[1].meta!.project = 'foreign';
    if (scenario === 'wrong-report') Object.assign(fixture.records[1], { derivedFrom: [{ reference: 'DocumentReference/foreign/_history/one' }] });
    if (scenario === 'wrong-receipt-output') (fixture.records[0] as Task).output![0].valueReference!.reference = 'Observation/foreign/_history/one';
    if (scenario === 'missing-tag') Object.assign(fixture.records[1].meta!, { tag: [] });
    if (scenario === 'wrong-actor') fixture.preview.recorded.requester = 'Practitioner/foreign';
    const lookup = (type: string, id: string) => fixture.records.find(resource => resource.resourceType === type && resource.id === id);
    vi.spyOn(client, 'readVersion').mockImplementation((type, id) => Promise.resolve(structuredClone(lookup(type, id))) as never);
    vi.spyOn(client, 'readResource').mockImplementation((type, id) => Promise.resolve(structuredClone(lookup(type, id))) as never);
    const post = vi.spyOn(client, 'post').mockResolvedValue(fixture.preview);
    await expect(inspectSyntheticCompletion(client, true)).rejects.toThrow('could not be verified');
    expect(post).toHaveBeenCalledTimes(1);
  });
});