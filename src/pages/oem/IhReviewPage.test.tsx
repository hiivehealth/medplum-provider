import { MantineProvider } from '@mantine/core';
import type { Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IhReviewPage } from './IhReviewPage';
import {
  keepCurrent,
  loadReviewDetail,
  loadReviews,
  OEM_PROJECT_ID,
  OEM_REVIEW_BOT_ID,
  type ReviewDetail,
} from './ih-review';

vi.mock('./ih-review', async () => ({
  ...(await vi.importActual('./ih-review')),
  keepCurrent: vi.fn(),
  loadReviewDetail: vi.fn(),
  loadReviews: vi.fn(),
}));

const task: Task = {
  resourceType: 'Task',
  id: 'review',
  meta: { project: OEM_PROJECT_ID, versionId: 'v1' },
  status: 'requested',
  intent: 'proposal',
  identifier: [{ system: 'https://hiivehealth.com/fhir/identifier/mock-ih-conflict', value: 'fingerprint' }],
  code: {
    coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-ih-review', code: 'source-content-changed' }],
  },
  for: { reference: 'Patient/worker' },
  focus: { reference: 'Observation/exposure/_history/v1' },
  input: [{ type: { text: 'Source version' }, valueString: 'v2' }],
};

function detail(): ReviewDetail {
  return {
    task: 'Task/review/_history/v1',
    patient: { resourceType: 'Patient', id: 'worker', name: [{ given: ['Synthetic'], family: 'Worker' }] },
    exposure: {
      resourceType: 'Observation',
      status: 'final',
      code: { text: 'Noise exposure' },
      effectivePeriod: { start: '2026-01-01', end: '2026-09-01' },
    },
    latest: { resourceType: 'Observation', status: 'final', code: { text: 'Noise exposure' } },
    incomingExposure: {
      resourceType: 'Observation',
      status: 'final',
      code: { text: 'Noise exposure' },
      effectivePeriod: { start: '2026-01-01' },
    },
    incoming: {
      resourceType: 'Observation',
      status: 'final',
      code: { text: 'Noise measurement' },
      valueQuantity: { value: 89, unit: 'dBA' },
    },
    evidence: {
      resourceType: 'DocumentReference',
      id: 'evidence',
      status: 'current',
      meta: { versionId: 'exact-v1' },
      content: [{ attachment: { title: 'Synthetic IH evidence' } }],
    },
    sourceVersion: 'v2',
    stale: false,
  };
}

describe('OEM source review page', () => {
  let client: MockClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = new MockClient();
    vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    vi.spyOn(client, 'readResource').mockResolvedValue({
      resourceType: 'Bot',
      id: OEM_REVIEW_BOT_ID,
      meta: { project: OEM_PROJECT_ID },
    });
    vi.mocked(loadReviews).mockResolvedValue([task]);
    vi.mocked(loadReviewDetail).mockResolvedValue(detail());
    vi.mocked(keepCurrent).mockResolvedValue(undefined);
  });
  function setup(): void {
    render(
      <MemoryRouter>
        <MedplumProvider medplum={client}>
          <MantineProvider env="test">
            <IhReviewPage />
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );
  }
  async function openReview(): Promise<void> {
    await userEvent.click(await screen.findByRole('button', { name: 'Open review review' }));
    await screen.findByRole('heading', { name: 'Synthetic Worker' });
  }
  it('refuses another Project without loading reviews or Bot permissions', async () => {
    vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: 'other' });
    setup();
    expect(screen.getByText('OEM Project required')).toBeInTheDocument();
    expect(loadReviews).not.toHaveBeenCalled();
    expect(client.readResource).not.toHaveBeenCalled();
  });
  it('shows exact exposure/evidence and requires reason plus confirmation before saving', async () => {
    setup();
    await openReview();
    expect(screen.getByText('Measurement: 89 dBA')).toBeInTheDocument();
    expect(screen.getByText('Observation/exposure/_history/v1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Synthetic IH evidence' })).toHaveAttribute(
      'href',
      '/DocumentReference/evidence/history'
    );
    expect(screen.getByRole('button', { name: 'Keep current record' })).toBeDisabled();
    await waitFor(() => expect(screen.getByPlaceholderText('Select a reason')).toBeEnabled());
    await userEvent.click(screen.getByPlaceholderText('Select a reason'));
    await userEvent.click(await screen.findByRole('option', { name: 'Clinician record preferred' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep current record' }));
    expect(keepCurrent).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm keep current' }));
    await waitFor(() => expect(keepCurrent).toHaveBeenCalledWith(client, task, 'clinician-record-preferred'));
    expect(await screen.findByText('Current record retained')).toBeInTheDocument();
  });
  it('keeps unknown measurements unknown rather than zero', async () => {
    const result = detail();
    delete result.incoming.valueQuantity;
    result.incoming.dataAbsentReason = { coding: [{ code: 'unknown' }] };
    vi.mocked(loadReviewDetail).mockResolvedValue(result);
    setup();
    await openReview();
    expect(screen.getByText('Measurement: Unknown')).toBeInTheDocument();
  });
  it('disables decisions when the exposure changed', async () => {
    vi.mocked(loadReviewDetail).mockResolvedValue({ ...detail(), stale: true });
    setup();
    await openReview();
    expect(screen.getByText('Exposure version changed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep current record' })).toBeDisabled();
    expect(screen.getByPlaceholderText('Select a reason')).toBeDisabled();
  });
  it('shows a read-only comparison when Bot access is denied', async () => {
    vi.mocked(client.readResource).mockRejectedValue(new Error('Denied'));
    setup();
    await openReview();
    expect(screen.getByText('Review action unavailable for this account.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep current record' })).toBeDisabled();
  });
  it('does not enable a decision when exact evidence fails validation', async () => {
    vi.mocked(loadReviewDetail).mockRejectedValue(new Error('Wrong worker'));
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Open review review' }));
    expect(await screen.findByText('The worker or exact source evidence could not be verified.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep current record' })).not.toBeInTheDocument();
  });
  it('shows load failure without presenting an empty queue as success', async () => {
    vi.mocked(loadReviews).mockRejectedValue(new Error('Unavailable'));
    setup();
    expect(await screen.findByText('Source reviews are unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('No open source reviews.')).not.toBeInTheDocument();
  });
  it('shows completed decisions without offering another write', async () => {
    vi.mocked(loadReviews).mockResolvedValue([
      {
        ...task,
        status: 'completed',
        output: [
          { type: { text: 'Decision' }, valueCoding: { code: 'keep-current' } },
          { type: { text: 'Reason' }, valueCoding: { code: 'clinician-record-preferred' } },
          { type: { text: 'Clinician' }, valueReference: { reference: 'Practitioner/clinician' } },
        ],
      },
    ]);
    setup();
    await openReview();
    expect(screen.getByRole('heading', { name: 'Recorded decision' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep current record' })).not.toBeInTheDocument();
    expect(keepCurrent).not.toHaveBeenCalled();
  });
});
