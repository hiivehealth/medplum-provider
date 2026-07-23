// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ConsentBanner } from './ConsentBanner';

describe('ConsentBanner', () => {
  let medplum: MockClient;

  beforeEach(() => {
    medplum = new MockClient();
    vi.clearAllMocks();
  });

  const setup = (patientId = 'patient-123'): ReturnType<typeof render> =>
    render(
      <MemoryRouter>
        <MedplumProvider medplum={medplum}>
          <MantineProvider>
            <Notifications />
            <ConsentBanner patientId={patientId} />
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );

  test('shows loading state initially', () => {
    setup();
    expect(screen.getByText('Loading consent status...')).toBeInTheDocument();
  });

  test('shows opt-in banner when consent is permit', async () => {
    await medplum.createResource({
      resourceType: 'Consent',
      status: 'active',
      patient: { reference: 'Patient/patient-123' },
      category: [{ text: 'opt-in' }],
      provision: { type: 'permit' },
    });

    setup();
    await waitFor(() => expect(screen.getByText('Consent on file')).toBeInTheDocument());
    expect(screen.getByText('This patient has opted in to data sharing.')).toBeInTheDocument();
  });

  test('shows opt-out banner when consent is deny', async () => {
    await medplum.createResource({
      resourceType: 'Consent',
      status: 'active',
      patient: { reference: 'Patient/patient-123' },
      category: [{ text: 'opt-out' }],
      provision: { type: 'deny' },
    });

    setup();
    await waitFor(() => expect(screen.getByText('Opted out')).toBeInTheDocument());
  });

  test('shows break-the-glass banner when no consent exists', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Consent not declared')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /break the glass/i })).toBeInTheDocument();
  });

  test('records break-the-glass audit event', async () => {
    const user = userEvent.setup();
    const createSpy = vi.spyOn(medplum, 'createResource').mockResolvedValue({ resourceType: 'AuditEvent', id: 'audit-1' } as never);

    setup();
    await waitFor(() => expect(screen.getByRole('button', { name: /break the glass/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /break the glass/i }));

    await waitFor(() => {
      expect(screen.getByTestId('break-glass-reason')).toBeInTheDocument();
    });

    const reasonInput = screen.getByTestId('break-glass-reason');
    await user.type(reasonInput, 'Emergency evaluation');
    await user.click(screen.getByRole('button', { name: /record access/i }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: 'AuditEvent',
          action: 'R',
          outcomeDesc: 'Emergency evaluation',
        })
      );
    });
  });
});
