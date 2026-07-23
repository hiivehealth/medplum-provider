// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import type { AuditEvent, Bundle } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AuditDashboardPage } from './AuditDashboardPage';

describe('AuditDashboardPage', () => {
  let medplum: MockClient;

  beforeEach(() => {
    medplum = new MockClient();
  });

  const setup = (): ReturnType<typeof render> =>
    render(
      <MemoryRouter>
        <MedplumProvider medplum={medplum}>
          <MantineProvider>
            <AuditDashboardPage />
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );

  function makeBundle(entries: AuditEvent[]): Bundle {
    return {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: entries.map((resource) => ({ resource })),
    };
  }

  test('shows access denied for non-admin', async () => {
    vi.spyOn(medplum, 'getProjectMembership').mockReturnValue({
      resourceType: 'ProjectMembership',
      id: 'mem-1',
      project: { reference: 'Project/project-1' },
      profile: { reference: 'Practitioner/practitioner-1' },
      user: { reference: 'User/user-1' },
      admin: false,
    } as never);

    setup();
    await waitFor(() => expect(screen.getByText('Access denied')).toBeInTheDocument());
  });

  test('renders audit events for admin', async () => {
    vi.spyOn(medplum, 'getProjectMembership').mockReturnValue({
      resourceType: 'ProjectMembership',
      id: 'mem-1',
      project: { reference: 'Project/project-1' },
      profile: { reference: 'Practitioner/practitioner-1' },
      user: { reference: 'User/user-1' },
      admin: true,
    } as never);

    const searchSpy = vi.spyOn(medplum, 'search').mockResolvedValueOnce(
      makeBundle([
        {
          resourceType: 'AuditEvent',
          id: 'audit-1',
          recorded: '2026-07-23T12:00:00Z',
          action: 'R',
          agent: [{ who: { display: 'Dr. Alex' } }],
          entity: [{ what: { reference: 'Patient/patient-1' } }],
          type: { display: 'Query' },
          outcome: '0',
        } as AuditEvent,
      ])
    );

    setup();
    await waitFor(() => expect(screen.getByText('Dr. Alex')).toBeInTheDocument());
    expect(searchSpy).toHaveBeenCalledWith('AuditEvent', expect.objectContaining({ _count: '100' }));
  });

  test('applies filters', async () => {
    const user = userEvent.setup();
    vi.spyOn(medplum, 'getProjectMembership').mockReturnValue({
      resourceType: 'ProjectMembership',
      id: 'mem-1',
      project: { reference: 'Project/project-1' },
      profile: { reference: 'Practitioner/practitioner-1' },
      user: { reference: 'User/user-1' },
      admin: true,
    } as never);

    const searchSpy = vi.spyOn(medplum, 'search').mockResolvedValue(makeBundle([]));

    setup();
    await waitFor(() => expect(screen.getByText('Apply filters')).toBeInTheDocument());

    await user.type(screen.getByLabelText('User'), 'Practitioner/123');
    await user.click(screen.getByText('Apply filters'));

    await waitFor(() => {
      expect(searchSpy).toHaveBeenCalledWith(
        'AuditEvent',
        expect.objectContaining({ agent: 'Practitioner/123' })
      );
    });
  });
});
