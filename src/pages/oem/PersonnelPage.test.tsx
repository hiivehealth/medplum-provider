import { MantineProvider } from '@mantine/core';
import type { QuestionnaireResponse } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { OEM_PROJECT_ID } from './ih-review';
import type { PersonnelPending, PersonnelResult, PersonnelSaved } from './personnel';
import {
  loadPersonnelHistory,
  loadPersonnelPreview,
  pendingPersonnel,
  PERSONNEL_CANONICAL,
  PERSONNEL_PENDING_KEY,
  PERSONNEL_SOURCE,
  PERSONNEL_WORKER,
  personnelCanSave,
  previewPersonnel,
  savePersonnel,
} from './personnel';
import { PersonnelPage } from './PersonnelPage';

vi.mock('./personnel', async () => ({
  ...(await vi.importActual('./personnel')),
  loadPersonnelPreview: vi.fn(),
  previewPersonnel: vi.fn(),
  personnelCanSave: vi.fn(),
  pendingPersonnel: vi.fn(),
  savePersonnel: vi.fn(),
  loadPersonnelHistory: vi.fn(),
}));
vi.mock('@medplum/react', async () => ({
  ...(await vi.importActual('@medplum/react')),
  QuestionnaireForm: ({ onChange }: { onChange: (response: QuestionnaireResponse) => void }) => {
    useEffect(() => {
      onChange({ resourceType: 'QuestionnaireResponse', status: 'in-progress', item: [] });
    }, []);
    return (
      <button onClick={() => onChange({ resourceType: 'QuestionnaireResponse', status: 'completed', item: [] })}>
        Select test answers
      </button>
    );
  },
}));

const result: PersonnelResult = {
  mode: 'preview',
  persisted: false,
  activated: false,
  clinicalWrites: 0,
  fingerprint: 'a'.repeat(64),
  authority: 'synthetic-clinician-attestation',
  issues: [],
  collection: { resourceType: 'Bundle', type: 'collection', entry: [] },
};
let client: MockClient;
const pending: PersonnelPending = {
  version: 1,
  project: OEM_PROJECT_ID,
  actor: 'Practitioner/clinician',
  submissionId: '22222222-2222-4222-8222-222222222222',
  response: {
    resourceType: 'QuestionnaireResponse',
    status: 'completed',
    questionnaire: PERSONNEL_CANONICAL,
    subject: { reference: PERSONNEL_WORKER },
    item: [{ linkId: 'source-evidence', answer: [{ valueReference: { reference: PERSONNEL_SOURCE } }] }],
  },
  collection: {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [
      { resource: { resourceType: 'QuestionnaireResponse', status: 'completed' } },
      { resource: { resourceType: 'Observation', status: 'final', code: {} } },
      { resource: { resourceType: 'Provenance', target: [], recorded: '2026-10-22T00:00:00.000Z', agent: [] } },
    ],
  },
};
const saved: PersonnelSaved = {
  status: 'completed',
  activated: false,
  replayed: false,
  submissionId: pending.submissionId,
  fingerprint: 'b'.repeat(64),
  receipt: 'Task/receipt/_history/v5',
  resources: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  client = new MockClient();
  vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
  vi.spyOn(client, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
  vi.mocked(loadPersonnelPreview).mockResolvedValue({
    questionnaire: { resourceType: 'Questionnaire', status: 'draft', item: [] },
    patient: { resourceType: 'Patient', id: 'worker', name: [{ given: ['Synthetic'], family: 'Worker' }] },
    source: { resourceType: 'DocumentReference', id: 'source', status: 'current', content: [] },
  });
  vi.mocked(previewPersonnel).mockResolvedValue(result);
  vi.mocked(personnelCanSave).mockResolvedValue(false);
  vi.mocked(loadPersonnelHistory).mockResolvedValue({ entries: [], limited: false });
  vi.mocked(pendingPersonnel).mockReturnValue(structuredClone(pending));
  vi.mocked(savePersonnel).mockResolvedValue(saved);
});
function setup(): ReturnType<typeof render> {
  return render(
    <MedplumProvider medplum={client}>
      <MantineProvider env="test">
        <PersonnelPage />
      </MantineProvider>
    </MedplumProvider>
  );
}
async function select(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Select test answers' }));
}
test('offers only preview and cancel when Save capability is unavailable', async () => {
  setup();
  await select();
  expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  expect(await screen.findByText('Not Saved')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByText('Not Saved')).not.toBeInTheDocument();
});
test('blocks duplicate preview clicks while pending', async () => {
  let finish!: (value: PersonnelResult) => void;
  vi.mocked(previewPersonnel).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  setup();
  await select();
  const button = screen.getByRole('button', { name: 'Preview' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(previewPersonnel).toHaveBeenCalledTimes(1);
  await act(async () => finish(result));
  expect(await screen.findByText('Not Saved')).toBeInTheDocument();
});
test('fails closed when context cannot be verified', async () => {
  vi.mocked(loadPersonnelPreview).mockRejectedValue(new Error('Denied'));
  setup();
  expect(await screen.findByRole('alert', { name: 'Preview Unavailable' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
});
test('does not load another Project', async () => {
  vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: 'foreign' });
  setup();
  await waitFor(() => expect(screen.getByText('The Army OEM Synthetic Demo Project is required.')).toBeInTheDocument());
  expect(loadPersonnelPreview).not.toHaveBeenCalled();
});

async function confirmation(): Promise<HTMLElement> {
  await select();
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  await screen.findByText('Not Saved');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  return screen.findByRole('dialog', { name: 'Confirm Personnel Save' });
}

test('confirmation Cancel performs no Save and creates no pending marker', async () => {
  vi.mocked(personnelCanSave).mockResolvedValue(true);
  setup();
  const dialog = await confirmation();
  expect(within(dialog).getByText('No rule activation, enrollment decision or orders.')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(savePersonnel).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(PERSONNEL_PENDING_KEY)).toBeNull();
});

test('persists the pending marker before Save, blocks duplicate confirmation and clears only after verification', async () => {
  vi.mocked(personnelCanSave).mockResolvedValue(true);
  let finish!: (value: PersonnelSaved) => void;
  vi.mocked(savePersonnel).mockImplementation(async () => {
    expect(JSON.parse(sessionStorage.getItem(PERSONNEL_PENDING_KEY)!)).toEqual(pending);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  setup();
  const dialog = await confirmation();
  const button = within(dialog).getByRole('button', { name: 'Confirm Save' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(savePersonnel).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await act(async () => finish(saved));
  expect(await screen.findByText('Saved', { exact: true })).toBeInTheDocument();
  expect(sessionStorage.getItem(PERSONNEL_PENDING_KEY)).toBeNull();
});

test('retains uncertain Save across remount and retries the identical payload without a new preview or key', async () => {
  vi.mocked(personnelCanSave).mockResolvedValue(true);
  vi.mocked(savePersonnel).mockRejectedValueOnce(new Error('Response lost')).mockResolvedValue(saved);
  const view = setup();
  const dialog = await confirmation();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Save' }));
  await screen.findByText('Save is unconfirmed. The same submission is retained for retry or independent review.');
  const encoded = sessionStorage.getItem(PERSONNEL_PENDING_KEY);
  expect(encoded).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  view.unmount();
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry Same Save' }));
  expect(await screen.findByText('Saved', { exact: true })).toBeInTheDocument();
  expect(savePersonnel).toHaveBeenCalledTimes(2);
  expect(savePersonnel).toHaveBeenNthCalledWith(1, client, JSON.parse(encoded!));
  expect(savePersonnel).toHaveBeenNthCalledWith(2, client, JSON.parse(encoded!));
  expect(previewPersonnel).toHaveBeenCalledTimes(1);
});

test('does not send Save when pending storage is unavailable', async () => {
  vi.mocked(personnelCanSave).mockResolvedValue(true);
  setup();
  const dialog = await confirmation();
  const write = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Save' }));
  await screen.findByText('Save was not sent because its pending record could not be verified or retained.');
  expect(savePersonnel).not.toHaveBeenCalled();
  write.mockRestore();
});

test('preserves but refuses another clinician pending marker', async () => {
  vi.mocked(personnelCanSave).mockResolvedValue(true);
  const encoded = JSON.stringify({ ...pending, actor: 'Practitioner/other' });
  sessionStorage.setItem(PERSONNEL_PENDING_KEY, encoded);
  setup();
  await screen.findByRole('alert', { name: 'Preview Unavailable' });
  expect(screen.queryByRole('button', { name: /Retry Same Save|^Save$/ })).not.toBeInTheDocument();
  expect(sessionStorage.getItem(PERSONNEL_PENDING_KEY)).toBe(encoded);
  expect(savePersonnel).not.toHaveBeenCalled();
});

test('shows verified saved history on initial load without preview or Save', async () => {
  vi.mocked(personnelCanSave).mockResolvedValue(true);
  vi.mocked(loadPersonnelHistory).mockResolvedValue({
    entries: [
      { saved, recorded: '2026-10-22T13:00:00.000Z', actor: pending.actor, kind: 'population', value: 'military' },
    ],
    limited: false,
  });
  setup();
  expect(await screen.findByText('population: military')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Verified personnel history' })).toBeInTheDocument();
  expect(previewPersonnel).not.toHaveBeenCalled();
  expect(savePersonnel).not.toHaveBeenCalled();
});

test('does not portray unverified history as an empty or successfully saved list', async () => {
  vi.mocked(personnelCanSave).mockResolvedValue(true);
  vi.mocked(loadPersonnelHistory).mockRejectedValue(new Error('History tampered'));
  setup();
  expect(await screen.findByText('Saved personnel history could not be independently verified.')).toBeInTheDocument();
  expect(screen.queryByText('No saved personnel attestations recorded.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
});
