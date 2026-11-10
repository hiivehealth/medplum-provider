import { MantineProvider } from '@mantine/core';
import type { Observation, Patient } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExposureMeasurements } from './ExposureMeasurements';
import { sendExposureWorkflow, type ExposureWorkflowResult, type MeasurementAuditEntry } from './exposure-workflow';
import { OEM_PROJECT_ID } from './ih-review';
import { loadIntakeEvidence } from './intake';

vi.mock('./exposure-workflow', () => ({ sendExposureWorkflow: vi.fn() }));
vi.mock('./intake', async () => ({ ...await vi.importActual('./intake'), loadIntakeEvidence: vi.fn() }));
const worker: Patient = { resourceType: 'Patient', id: 'worker' };
const exposure: Observation = { resourceType: 'Observation', id: 'exposure', status: 'final', code: {},
  meta: { project: OEM_PROJECT_ID, versionId: 'one' }, subject: { reference: 'Patient/worker' }, effectivePeriod: { start: '2026-10-01' } };
const earlier: Observation = { ...exposure, id: 'earlier-measurement', focus: [{ reference: 'Observation/exposure' }],
  code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-noise-metric', code: 'eight-hour-twa' }] },
  effectiveDateTime: '2026-10-01', valueQuantity: { value: 80, unit: 'dBA' } };
const scope = { patient: 'Patient/worker', exposure: 'Observation/exposure/_history/one', asOf: '2026-10-26' };
const common = { ...scope, sources: [scope.exposure, 'DocumentReference/rules/_history/one'], persisted: false,
  fingerprint: 'a'.repeat(64), activated: false as const, externalDispatch: false as const, clinicalCompletionVerified: false as const };
const entry: MeasurementAuditEntry = {
  record: { ...exposure, id: 'later-measurement', focus: [{ reference: scope.exposure }], effectiveDateTime: '2026-10-25',
    code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-noise-metric', code: 'eight-hour-twa' }] }, valueQuantity: { value: 85, unit: 'dBA' }, derivedFrom: [{ reference: 'DocumentReference/evidence/_history/one' }] },
  lineage: { resourceType: 'Provenance', id: 'lineage', meta: { project: OEM_PROJECT_ID, versionId: 'one' },
    recorded: '2026-10-26T12:00:00.000Z', target: [], agent: [{ who: { reference: 'Practitioner/clinician' } }] },
  audit: { resourceType: 'AuditEvent', id: 'audit', meta: { project: OEM_PROJECT_ID, versionId: 'one' }, type: {},
    recorded: '2026-10-26T12:00:00.000Z', agent: [], source: { observer: {} } },
};

describe('later exposure measurements and audit trail', () => {
  let client: MockClient;
  let recorded: boolean;
  beforeEach(() => {
    vi.resetAllMocks(); sessionStorage.clear(); recorded = false;
    client = new MockClient();
    vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    vi.spyOn(client, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'clinician', name: [{ text: 'Synthetic clinician' }] });
    vi.mocked(loadIntakeEvidence).mockResolvedValue([{ resourceType: 'DocumentReference', id: 'evidence',
      meta: { project: OEM_PROJECT_ID, versionId: 'one' }, status: 'current', content: [], description: 'Synthetic IH assessment' }]);
    vi.mocked(sendExposureWorkflow).mockImplementation(async (_client, request) => {
      if (request.mode === 'measurement-history') return { ...common, phase: 'measurement-history',
        coverage: 'appended-measurements-only', entries: recorded ? [entry] : [] };
      if (request.mode === 'measurement-preview') return { ...common, phase: 'measurement', measurement: request.measurement };
      recorded = true;
      return { ...common, phase: 'measurement', persisted: true, measurement: request.measurement,
        measurementRecord: 'Observation/later-measurement/_history/one', lineage: 'Provenance/lineage/_history/one', audit: 'AuditEvent/audit/_history/one' };
    });
  });
  const content = (selected = exposure, onSaved = vi.fn()) => <MantineProvider env="test"><MedplumProvider medplum={client}>
    <ExposureMeasurements worker={worker} exposure={selected} measurements={[earlier]} asOf={scope.asOf} onSaved={onSaved} />
  </MedplumProvider></MantineProvider>;
  async function open(): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: 'Measurements and audit trail for exposure exposure' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add measurement' })).toBeEnabled());
  }
  async function review(waitForConfirmation = true): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: 'Add measurement' }));
    fireEvent.change(screen.getByLabelText('Noise measurement value'), { target: { value: '85' } });
    fireEvent.change(screen.getByLabelText('Measurement assessed on'), { target: { value: '2026-10-25' } });
    fireEvent.click(screen.getByRole('textbox', { name: 'Measurement method' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Synthetic personal dosimetry' }));
    fireEvent.click(screen.getByRole('textbox', { name: 'Measurement evidence' }));
    fireEvent.click(await screen.findByRole('option', { name: /Synthetic IH assessment/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Review measurement' }));
    if (waitForConfirmation) await screen.findByRole('region', { name: 'Confirm measurement' });
  }
  async function confirm(label = 'Save measurement'): Promise<void> {
    const confirmation = screen.getByRole('region', { name: 'Confirm measurement' });
    fireEvent.click(within(confirmation).getByRole('checkbox'));
    fireEvent.click(within(confirmation).getByRole('button', { name: label }));
  }
  it('reads persisted audit only when opened and cancels a preview without a save', async () => {
    render(content());
    expect(sendExposureWorkflow).not.toHaveBeenCalled();
    await open();
    expect(sendExposureWorkflow).toHaveBeenCalledExactlyOnceWith(client, { ...scope, mode: 'measurement-history' });
    expect(screen.getByText('Earlier measurement records')).toBeInTheDocument();
    await review();
    expect(screen.getByRole('button', { name: 'Save measurement' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel confirmation' }));
    expect(sendExposureWorkflow).toHaveBeenCalledTimes(2);
    expect(sessionStorage.length).toBe(0);
  });
  it('saves a separate measurement only after confirmation and reopens its server audit in a new session view', async () => {
    const onSaved = vi.fn();
    const view = render(content(exposure, onSaved)); await open(); await review(); await confirm();
    expect(await screen.findByText('Measurement saved')).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Measurement audit entries' });
    expect(within(table).getByText('2026-10-25')).toBeInTheDocument();
    expect(within(table).getByText('2026-10-26T12:00:00.000Z')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Audit event' })).toHaveAttribute('href', '/AuditEvent/audit/_history/one');
    expect(onSaved).toHaveBeenCalledExactlyOnceWith([entry.record]);
    const save = vi.mocked(sendExposureWorkflow).mock.calls.find(([, request]) => request.mode === 'measure')![1];
    expect(save).toMatchObject({ ...scope, confirmedSave: true, measurement: { value: 85, assessedOn: '2026-10-25' } });
    expect(sessionStorage.length).toBe(0);
    view.unmount(); render(content()); await open();
    expect(await screen.findByRole('table', { name: 'Measurement audit entries' })).toBeInTheDocument();
    expect(vi.mocked(sendExposureWorkflow).mock.calls.filter(([, request]) => request.mode === 'measure')).toHaveLength(1);
  });
  it('retains the exact original request after an uncertain save and requires reconfirmation', async () => {
    const run = vi.mocked(sendExposureWorkflow).getMockImplementation()!;
    let fail = true;
    vi.mocked(sendExposureWorkflow).mockImplementation(async (selected, request) => {
      if (request.mode === 'measure' && fail) { fail = false; throw new Error('Lost response'); }
      return run(selected, request);
    });
    render(content()); await open(); await review(); await confirm();
    fireEvent.click(await screen.findByRole('button', { name: 'Reconcile measurement' }));
    expect(screen.getByRole('button', { name: 'Reconcile same measurement' })).toBeDisabled();
    await confirm('Reconcile same measurement');
    await screen.findByText('Measurement saved');
    const requests = vi.mocked(sendExposureWorkflow).mock.calls.filter(([, request]) => request.mode === 'measure').map(([, request]) => request);
    expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  });
  it('blocks submission if safety storage is unavailable', async () => {
    render(content()); await open(); await review();
    const storage = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    await confirm();
    expect(await screen.findByText('Submission safety storage is unavailable. No save was requested.')).toBeInTheDocument();
    expect(vi.mocked(sendExposureWorkflow).mock.calls.some(([, request]) => request.mode === 'measure')).toBe(false);
    storage.mockRestore();
  });
  it('discards a late preview after the exposure scope changes', async () => {
    const run = vi.mocked(sendExposureWorkflow).getMockImplementation()!;
    let finish!: (result: ExposureWorkflowResult) => void;
    vi.mocked(sendExposureWorkflow).mockImplementation((selected, request) => request.mode === 'measurement-preview'
      ? new Promise(resolve => { finish = resolve; }) : run(selected, request));
    const view = render(content()); await open();
    await review(false);
    await waitFor(() => expect(finish).toBeDefined());
    view.rerender(content({ ...exposure, id: 'another-exposure' }));
    await act(async () => finish({ ...common, phase: 'measurement' }));
    expect(screen.queryByRole('region', { name: 'Confirm measurement' })).not.toBeInTheDocument();
    expect(sessionStorage.length).toBe(0);
  });
});