import { MantineProvider } from '@mantine/core';
import { ReadablePromise } from '@medplum/core';
import type { WithId } from '@medplum/core';
import type { Basic, Consent, DocumentReference, Resource, Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../App';
import { describeHawaiiRecord, readHawaiiTextAttachment, sortHawaiiRecords } from './clinical';
import { HawaiiDocumentViewer } from './HawaiiDocumentViewer';
import { HawaiiFollowUpPage } from './HawaiiFollowUpPage';
import { HAWAII_FOLLOW_UP_SYSTEM } from './followUp';
import { HawaiiAuditPage, HawaiiDiscoveryPage, HawaiiPatientPage } from './HawaiiWorkspace';
import { HawaiiOnboardingPage } from './HawaiiOnboardingPage';
import { HAWAII_ONBOARDING_EXTENSION, HAWAII_ONBOARDING_SITE, HAWAII_ONBOARDING_SYSTEM } from './onboarding';
import onboardingFixture from '../../../fhir/hawaii/onboarding-snapshot.json';

vi.mock('../cui/CuiPolicyProvider', () => ({
  CuiPolicyProvider: ({ children }: { children: React.ReactNode }) => children,
  useCuiPolicy: () => ({ state: { status: 'ready', policy: { enabled: false, canManage: false } } }),
}));

describe('Hawaii participant operations', () => {
  let medplum: MockClient;
  const basic: WithId<Basic> = { resourceType: 'Basic', id: 'operational-snapshot', meta: { versionId: '1' },
    identifier: [{ system: HAWAII_ONBOARDING_SYSTEM, value: HAWAII_ONBOARDING_SITE }],
    code: { coding: [{ system: HAWAII_ONBOARDING_SYSTEM, code: 'site-readiness' }] },
    extension: [{ url: HAWAII_ONBOARDING_EXTENSION, valueString: JSON.stringify(onboardingFixture) }] };
  beforeEach(() => { medplum = new MockClient(); });

  function result(resources: WithId<Basic>[]): ReturnType<MockClient['searchResources']> {
    return new ReadablePromise(Promise.resolve(Object.assign(resources, {
      bundle: { resourceType: 'Bundle' as const, type: 'searchset' as const },
    })));
  }

  function setup(): ReturnType<typeof render> {
    return render(<MedplumProvider medplum={medplum}><MantineProvider><HawaiiOnboardingPage /></MantineProvider></MedplumProvider>);
  }

  test('loads only persisted operational evidence, with reconciled metrics and traceable findings', async () => {
    const search = vi.spyOn(medplum, 'searchResources').mockReturnValue(result([basic]));
    const create = vi.spyOn(medplum, 'createResource');
    const update = vi.spyOn(medplum, 'updateResource');
    setup();
    await screen.findByRole('heading', { name: 'Demo Hawaii Rural Hospital' });
    expect(screen.getByText('50.0%')).toBeInTheDocument();
    expect(screen.getByText('1 accepted / 2 submitted records')).toBeInTheDocument();
    expect(screen.getByText('1 unresolved validation findings · 3/6 stages completed')).toBeInTheDocument();
    expect(screen.getByText('VAL-001')).toBeInTheDocument();
    expect(screen.getByText(/SYNTH-ADT-002 · Encounter.class/)).toBeInTheDocument();
    expect(screen.getByText('TA-001 · mapping review')).toBeInTheDocument();
    expect(screen.getByText('Source: Basic/operational-snapshot · Version 1')).toBeInTheDocument();
    expect(screen.queryByText('Ready for cutover')).not.toBeInTheDocument();
    expect(search).toHaveBeenCalledExactlyOnceWith('Basic', {
      identifier: `${HAWAII_ONBOARDING_SYSTEM}|${HAWAII_ONBOARDING_SITE}`, _count: '2',
    }, { cache: 'no-cache' });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test('does not substitute a bundled fixture when no persisted snapshot is visible', async () => {
    vi.spyOn(medplum, 'searchResources').mockReturnValue(result([]));
    setup();
    await screen.findByText('No operational evidence available');
    expect(screen.queryByText('50.0%')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Demo Hawaii Rural Hospital' })).not.toBeInTheDocument();
  });

  test('does not show readiness or metrics after an access failure', async () => {
    vi.spyOn(medplum, 'searchResources').mockReturnValue(new ReadablePromise(Promise.reject(new Error('Forbidden'))));
    setup();
    await screen.findByText('Operational evidence unavailable');
    expect(screen.queryByText('50.0%')).not.toBeInTheDocument();
    expect(screen.queryByText('Ready for cutover')).not.toBeInTheDocument();
  });

  const invalidCases: [string, WithId<Basic>[]][] = [
    ['duplicate snapshots', [basic, { ...basic, id: 'another-snapshot' }]],
    ['invalid persisted JSON', [{ ...basic, extension: [{ url: HAWAII_ONBOARDING_EXTENSION, valueString: '{invalid' }] }]],
  ];
  for (const [name, resources] of invalidCases) {
    test(`fails closed on ${name}`, async () => {
      vi.spyOn(medplum, 'searchResources').mockReturnValue(result([...resources]));
      setup();
      await screen.findByText('Operational evidence unavailable');
      expect(screen.queryByText('50.0%')).not.toBeInTheDocument();
    });
  }

  test('refresh clears old evidence while waiting and does not restore it after failure', async () => {
    let rejectRefresh: (reason: Error) => void = () => {};
    const pending = new ReadablePromise(new Promise<never>((_resolve, reject) => { rejectRefresh = reject; }));
    const search = vi.spyOn(medplum, 'searchResources').mockReturnValueOnce(result([basic])).mockReturnValueOnce(pending);
    setup();
    await screen.findByText('50.0%');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh operational evidence' }));
    expect(screen.queryByText('50.0%')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Loading operational evidence')).toBeInTheDocument();
    rejectRefresh(new Error('Forbidden'));
    await screen.findByText('Operational evidence unavailable');
    expect(search).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('50.0%')).not.toBeInTheDocument();
  });

  test('refresh and remount both reread the server rather than treating local state as persistence', async () => {
    const updated = structuredClone(onboardingFixture);
    updated.issues[0].status = 'resolved';
    updated.stages.slice(0, 4).forEach((stage) => { stage.status = 'completed'; });
    const next: WithId<Basic> = { ...basic, meta: { versionId: '2' },
      extension: [{ url: HAWAII_ONBOARDING_EXTENSION, valueString: JSON.stringify(updated) }] };
    const search = vi.spyOn(medplum, 'searchResources').mockReturnValueOnce(result([basic])).mockReturnValue(result([next]));
    const first = setup();
    await screen.findByText('50.0%');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh operational evidence' }));
    await screen.findByText('Ready for cutover');
    expect(screen.getByText('Source: Basic/operational-snapshot · Version 2')).toBeInTheDocument();
    first.unmount();
    setup();
    await screen.findByText('Ready for cutover');
    expect(search).toHaveBeenCalledTimes(3);
    expect(search.mock.calls.every((call) => call[0] === 'Basic' && call[2]?.cache === 'no-cache')).toBe(true);
  });
});

describe('Hawaii provider workspace', () => {
  let medplum: MockClient;
  const permit: WithId<Consent> = {
    resourceType: 'Consent', id: 'consent-1', status: 'active', scope: { text: 'Patient privacy' }, category: [{ text: 'Sharing' }],
    patient: { reference: 'Patient/demo-patient' }, provision: { type: 'permit' },
  };
  beforeEach(() => { medplum = new MockClient(); });

  test('orders clinical entries newest first and leaves unknown dates last without changing input', () => {
    const records: Resource[] = [
      { resourceType: 'Condition', id: 'old', subject: { reference: 'Patient/demo-patient' }, onsetDateTime: '2020-03-01' },
      { resourceType: 'Observation', id: 'unknown', status: 'final', code: { text: 'Unknown' }, effectiveDateTime: 'invalid' },
      { resourceType: 'Encounter', id: 'new', status: 'finished', class: { code: 'IMP' },
        period: { start: '2026-10-12T14:00:00Z', end: '2026-10-14T16:00:00Z' } },
    ];
    expect(sortHawaiiRecords(records).map((entry) => entry.resource.id)).toEqual(['new', 'old', 'unknown']);
    expect(records[0].id).toBe('old');
    expect(sortHawaiiRecords(records)[2].date).toBe('Date not recorded');
  });

  test('formats Hawaii timestamps, preserves date-only values, and displays zero-valued results', () => {
    const result = describeHawaiiRecord({ resourceType: 'Observation', status: 'final', code: { text: 'Glucose' },
      effectiveDateTime: '2026-10-13T09:00:00Z', valueQuantity: { value: 0, unit: 'mg/dL' } });
    expect(result.value).toBe('0 mg/dL');
    expect(result.date).toContain('Oct 12, 2026');
    expect(result.date).toContain('HST');
    expect(describeHawaiiRecord({ resourceType: 'Condition', subject: { reference: 'Patient/demo-patient' },
      onsetDateTime: '2020-03-01' }).date).toBe('Mar 1, 2020');
  });

  test('decodes plain text but never treats HTML, remote URLs, malformed base64, or oversized content as a preview', () => {
    expect(readHawaiiTextAttachment({ contentType: 'text/plain', data: btoa('<b>Synthetic text</b>') })).toBe('<b>Synthetic text</b>');
    for (const attachment of [
      { contentType: 'text/html', data: btoa('<script>alert(1)</script>') },
      { contentType: 'text/plain', url: 'https://untrusted.example/summary.txt' },
      { contentType: 'text/plain', data: '%%invalid' },
      { contentType: 'text/plain', data: 'A'.repeat(1400001) },
    ]) {
      expect(() => readHawaiiTextAttachment(attachment)).toThrow();
    }
  });

  function setupDocument(): void {
    render(<MedplumProvider medplum={medplum}><MantineProvider>
      <HawaiiDocumentViewer patientId="demo-patient" documentId="document-1" onClose={() => {}} />
    </MantineProvider></MedplumProvider>);
  }

  const document: WithId<DocumentReference> = {
    resourceType: 'DocumentReference', id: 'document-1', status: 'current', subject: { reference: 'Patient/demo-patient' },
    description: 'Synthetic summary', content: [{ attachment: { contentType: 'text/plain', data: btoa('SYNTHETIC DEMO ONLY') } }],
  };

  test('rechecks consent and reads the current document before displaying plain text', async () => {
    const search = vi.spyOn(medplum, 'searchResources').mockReturnValue(result([permit]));
    const read = vi.spyOn(medplum, 'readResource').mockResolvedValue(document);
    setupDocument();
    await screen.findByText('SYNTHETIC DEMO ONLY');
    expect(search).toHaveBeenCalledWith('Consent', expect.objectContaining({ patient: 'Patient/demo-patient' }), { cache: 'no-cache' });
    expect(read).toHaveBeenCalledWith('DocumentReference', 'document-1', { cache: 'no-cache' });
  });

  test('does not fetch a document after consent has been revoked', async () => {
    vi.spyOn(medplum, 'searchResources').mockReturnValue(result([{ ...permit, provision: { type: 'deny' } }]));
    const read = vi.spyOn(medplum, 'readResource');
    setupDocument();
    await screen.findByText('Document unavailable');
    expect(read).not.toHaveBeenCalled();
  });

  test('rejects documents belonging to a different patient', async () => {
    vi.spyOn(medplum, 'searchResources').mockReturnValue(result([permit]));
    vi.spyOn(medplum, 'readResource').mockResolvedValue({ ...document, subject: { reference: 'Patient/another-patient' } });
    setupDocument();
    await screen.findByText('Document unavailable');
    expect(screen.queryByText('SYNTHETIC DEMO ONLY')).not.toBeInTheDocument();
  });

  function result(resources: WithId<Resource>[]): ReturnType<MockClient['searchResources']> {
    return new ReadablePromise(Promise.resolve(Object.assign(resources, {
      bundle: { resourceType: 'Bundle' as const, type: 'searchset' as const },
    })));
  }

  function setup(path = '/hie/patients/demo-patient'): void {
    render(<MemoryRouter initialEntries={[path]}><MedplumProvider medplum={medplum}><MantineProvider>
      <Routes><Route path="/hie" element={<HawaiiDiscoveryPage />} />
        <Route path="/hie/patients/:patientId" element={<HawaiiPatientPage />} />
        <Route path="/hie/audit" element={<HawaiiAuditPage />} /></Routes>
    </MantineProvider></MedplumProvider></MemoryRouter>);
  }

  function setupFollowUp(): void {
    vi.spyOn(medplum, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'demo-clinician' });
    render(<MemoryRouter><MedplumProvider medplum={medplum}><MantineProvider>
      <HawaiiFollowUpPage />
    </MantineProvider></MedplumProvider></MemoryRouter>);
  }

  const followUp: WithId<Task> = {
    resourceType: 'Task', id: 'follow-up-1', meta: { versionId: 'version-1' }, status: 'requested', intent: 'order',
    identifier: [{ system: HAWAII_FOLLOW_UP_SYSTEM, value: 'Encounter/discharge-1' }],
    for: { reference: 'Patient/demo-patient' }, focus: { reference: 'Encounter/discharge-1' },
    owner: { reference: 'Practitioner/demo-clinician' }, code: { text: 'Post-discharge follow-up' },
    authoredOn: '2026-10-16T12:00:04Z',
    input: [{ type: { text: 'Discharge event time' }, valueDateTime: '2026-10-16T12:00:00Z' }],
  };

  test('shows assigned persisted work with event/receipt times and linked clinical record', async () => {
    const search = vi.spyOn(medplum, 'searchResources').mockImplementation((type) => result(type === 'Task' ? [followUp] : [permit]));
    await medplum.createResource({ resourceType: 'Patient', id: 'demo-patient', name: [{ text: 'Avery Synthetic' }] });
    setupFollowUp();
    await screen.findByText('Post-discharge follow-up');
    await screen.findByText('Avery Synthetic');
    expect(screen.getByText(/Discharged:/)).toHaveTextContent('HST');
    expect(screen.getByText(/Received:/)).toHaveTextContent('HST');
    expect(screen.getByRole('link', { name: 'Source discharge' })).toHaveAttribute('href', '/hie/patients/demo-patient#Encounter-discharge-1');
    expect(search).toHaveBeenCalledWith('Task', expect.objectContaining({ owner: 'Practitioner/demo-clinician' }), { cache: 'no-cache' });
  });

  test('does not show work assigned to another clinician', async () => {
    vi.spyOn(medplum, 'searchResources').mockReturnValue(result([{ ...followUp, owner: { reference: 'Practitioner/other' } }]));
    setupFollowUp();
    await screen.findByText('No assigned follow-up work.');
    expect(screen.queryByText('Post-discharge follow-up')).not.toBeInTheDocument();
  });

  test('rechecks consent and uses a version-guarded update to start assigned work', async () => {
    vi.spyOn(medplum, 'searchResources').mockImplementation((type) => result(type === 'Task' ? [followUp] : [permit]));
    vi.spyOn(medplum, 'readResource').mockResolvedValue(followUp);
    const update = vi.spyOn(medplum, 'updateResource').mockResolvedValue({ ...followUp, status: 'in-progress' });
    setupFollowUp();
    await userEvent.click(await screen.findByRole('button', { name: 'Start follow-up' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'in-progress' }), {
      headers: { 'If-Match': 'W/"version-1"' },
    }));
  });

  test.each(['reassigned', 'already-completed'])('does not update %s follow-up work', async (scenario) => {
    vi.spyOn(medplum, 'searchResources').mockImplementation((type) => result(type === 'Task' ? [followUp] : [permit]));
    vi.spyOn(medplum, 'readResource').mockResolvedValue(scenario === 'reassigned' ?
      { ...followUp, owner: { reference: 'Practitioner/other' } } : { ...followUp, status: 'completed' });
    const update = vi.spyOn(medplum, 'updateResource');
    setupFollowUp();
    await userEvent.click(await screen.findByRole('button', { name: 'Start follow-up' }));
    await screen.findByText('Follow-up unavailable');
    expect(update).not.toHaveBeenCalled();
  });

  test('does not update after consent is revoked while the worklist is open', async () => {
    let consentReads = 0;
    vi.spyOn(medplum, 'searchResources').mockImplementation((type) => {
      if (type === 'Task') { return result([followUp]); }
      consentReads++;
      return result([consentReads === 1 ? permit : { ...permit, provision: { type: 'deny' } }]);
    });
    vi.spyOn(medplum, 'readResource').mockResolvedValue(followUp);
    const update = vi.spyOn(medplum, 'updateResource');
    setupFollowUp();
    await userEvent.click(await screen.findByRole('button', { name: 'Start follow-up' }));
    await screen.findByText('Follow-up unavailable');
    expect(update).not.toHaveBeenCalled();
  });

  test('does not report completion when a version-guarded write fails', async () => {
    vi.spyOn(medplum, 'searchResources').mockImplementation((type) => result(type === 'Task' ? [followUp] : [permit]));
    vi.spyOn(medplum, 'readResource').mockResolvedValue(followUp);
    vi.spyOn(medplum, 'updateResource').mockRejectedValue(new Error('Precondition failed'));
    setupFollowUp();
    await userEvent.click(await screen.findByRole('button', { name: 'Start follow-up' }));
    await screen.findByText('Follow-up unavailable');
    expect(screen.queryByText('completed')).not.toBeInTheDocument();
    expect(screen.queryByText('Post-discharge follow-up')).not.toBeInTheDocument();
  });

  test('fails closed when follow-up consent is denied', async () => {
    vi.spyOn(medplum, 'searchResources').mockImplementation((type) => result(type === 'Task' ? [followUp] : [{ ...permit, provision: { type: 'deny' } }]));
    setupFollowUp();
    await screen.findByText('Follow-up unavailable');
    expect(screen.queryByText('Post-discharge follow-up')).not.toBeInTheDocument();
  });

  test.each(['deny', 'missing', 'unavailable', 'ambiguous'])('blocks clinical fetches when consent is %s', async (scenario) => {
    const search = vi.spyOn(medplum, 'searchResources').mockImplementation(() => {
      if (scenario === 'unavailable') { throw new Error('Forbidden'); }
      if (scenario === 'missing') { return result([]); }
      if (scenario === 'ambiguous') { return result([permit, permit]); }
      return result([{ ...permit, provision: { type: 'deny' } }]);
    });
    const read = vi.spyOn(medplum, 'readResource');
    setup();
    await screen.findByText('Record unavailable');
    expect(read).not.toHaveBeenCalled();
    expect(search.mock.calls.every(([resourceType]) => resourceType === 'Consent')).toBe(true);
    expect(screen.queryByText('Shared clinical record')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /glass/i })).not.toBeInTheDocument();
  });

  test('shows permitted records with three independent source organizations', async () => {
    vi.spyOn(medplum, 'searchResources').mockImplementation((type) => {
      if (type === 'Consent') { return result([permit]); }
      if (type === 'Encounter') { return result([{ resourceType: 'Encounter', id: 'hospital-visit', status: 'finished',
        class: { code: 'IMP' }, type: [{ text: 'Hospital discharge' }], serviceProvider: { display: 'Demo Rural Hospital' } }]); }
      if (type === 'Observation') { return result([{ resourceType: 'Observation', id: 'lab', status: 'final',
        code: { text: 'Hemoglobin A1c' }, performer: [{ display: 'Demo Laboratory' }] }]); }
      if (type === 'Condition') { return result([{ resourceType: 'Condition', id: 'condition', code: { text: 'Diabetes' },
        subject: { reference: 'Patient/demo-patient' }, recorder: { display: 'Demo Community Practice' } }]); }
      return result([]);
    });
    vi.spyOn(medplum, 'readResource').mockResolvedValue({ resourceType: 'Patient', id: 'demo-patient', name: [{ text: 'Synthetic Patient' }] });
    setup();
    await screen.findByText('Shared clinical record');
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent))
      .toEqual(['Date', 'Clinical entry', 'Source']);
    for (const source of ['Demo Rural Hospital', 'Demo Laboratory', 'Demo Community Practice']) {
      expect(screen.getByText(source)).toBeInTheDocument();
    }
  });

  test('displays no partial clinical data when a resource query fails', async () => {
    vi.spyOn(medplum, 'searchResources').mockImplementation((type) => {
      if (type === 'Consent') { return result([permit]); }
      throw new Error('Forbidden');
    });
    setup();
    await screen.findByText('Record unavailable');
    expect(screen.queryByText('Shared clinical record')).not.toBeInTheDocument();
  });

  test('uses caller-authenticated minimal discovery and explicit identifier search', async () => {
    const search = vi.spyOn(medplum, 'searchResources').mockReturnValue(result([]));
    const user = userEvent.setup();
    setup('/hie');
    await user.type(screen.getByLabelText('Patient'), 'HAWAII-DEMO-001');
    await user.click(screen.getByLabelText('Search by', { selector: 'input' }));
    await user.click(await screen.findByRole('option', { name: 'Patient identifier', hidden: true }));
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('No matching patients.');
    expect(search).toHaveBeenCalledWith('Patient', {
      identifier: 'HAWAII-DEMO-001', active: 'true', _count: '20', _elements: 'id,name,birthDate',
    }, { cache: 'no-cache' });
  });

  test('handles audit access denial without displaying synthetic evidence as live events', async () => {
    vi.spyOn(medplum, 'searchResources').mockRejectedValue(new Error('Forbidden'));
    setup('/hie/audit');
    await screen.findByText('Activity unavailable');
    await waitFor(() => expect(screen.queryByRole('table')).not.toBeInTheDocument());
  });

  test('shows only actual audit evidence with actor/resource references and readable outcomes', async () => {
    vi.spyOn(medplum, 'searchResources').mockReturnValue(result([{
      resourceType: 'AuditEvent', id: 'native-audit', recorded: '2026-10-16T12:00:00Z', type: { code: 'rest' }, action: 'R', outcome: '0',
      agent: [{ requestor: true, who: { reference: 'Practitioner/actor' } }],
      source: { observer: { reference: 'Device/server' } }, entity: [{ what: { reference: 'Observation/lab' } }],
    }]));
    setup('/hie/audit');
    await screen.findByText('Actor: Practitioner/actor (requestor)');
    expect(screen.getByText('Observation/lab')).toBeInTheDocument();
    expect(screen.getByText('Observer: Device/server')).toBeInTheDocument();
    expect(screen.getByText('Action: Read')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Audit ID: native-audit')).toBeInTheDocument();
  });

  test('shows an honest empty audit state and refreshes with no cache', async () => {
    const search = vi.spyOn(medplum, 'searchResources').mockReturnValue(result([]));
    setup('/hie/audit');
    await screen.findByText('No visible audit events.');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh audit activity' }));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(search).toHaveBeenLastCalledWith('AuditEvent', { _sort: '-date', _count: '20' }, { cache: 'no-cache' });
  });

  function renderApp(path: string, enabled: boolean): void {
    vi.spyOn(medplum, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'demo-clinician' });
    vi.spyOn(medplum, 'getProject').mockReturnValue({
      resourceType: 'Project', id: 'demo-project', setting: [{ name: 'hawaiiCqieDemo', valueBoolean: enabled }],
    });
    render(<MemoryRouter initialEntries={[path]}><MedplumProvider medplum={medplum}><MantineProvider>
      <App />
    </MantineProvider></MedplumProvider></MemoryRouter>);
  }

  test('Hawaii mode redirects unrelated direct routes to discovery', async () => {
    renderApp('/Patient/demo-patient/edit', true);
    await screen.findByText('Hawaii CQIE Provider Portal');
    expect(screen.queryByRole('link', { name: 'Schedule' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New Patient' })).not.toBeInTheDocument();
  });

  test('the normal provider mode keeps its usual navigation', async () => {
    renderApp('/Patient', false);
    expect(await screen.findByRole('link', { name: 'Schedule' })).toBeInTheDocument();
    expect(screen.queryByText('Hawaii CQIE Provider Portal')).not.toBeInTheDocument();
  });
});