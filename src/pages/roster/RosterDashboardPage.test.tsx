// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Bundle, Encounter, Group, ProjectMembership } from '@medplum/fhirtypes';
import { RosterDashboardPage } from './RosterDashboardPage';

describe('RosterDashboardPage', () => {
  let medplum: MockClient;

  beforeEach(() => {
    medplum = new MockClient();
  });

  const setup = (): ReturnType<typeof render> =>
    render(
      <MemoryRouter>
        <MedplumProvider medplum={medplum}>
          <MantineProvider>
            <RosterDashboardPage />
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );

  function makeBundle(entries: Encounter[]): Bundle {
    return {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: entries.map((resource) => ({ resource })),
    };
  }

  function membershipWithRoster(group: Group): ProjectMembership {
    return {
      resourceType: 'ProjectMembership',
      id: 'mem-1',
      project: { reference: 'Project/project-1' },
      profile: { reference: 'Practitioner/payer-user' },
      access: [
        {
          policy: { reference: 'AccessPolicy/payer-roster' },
          parameter: [
            {
              name: 'roster_group',
              valueReference: { reference: `Group/${group.id}`, display: group.name },
            },
          ],
        },
      ],
    } as ProjectMembership;
  }

  function assignRoster(group: Group): void {
    vi.spyOn(medplum, 'getProjectMembership').mockReturnValue(membershipWithRoster(group));
  }

  test('shows access denied when user has no roster', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Access denied')).toBeInTheDocument());
  });

  test('renders roster encounters for payer user', async () => {
    const group = await medplum.createResource<Group>({
      resourceType: 'Group',
      type: 'person',
      actual: true,
      name: 'Silver State Plan Roster',
    });

    const encounter: Encounter = {
      resourceType: 'Encounter',
      id: 'enc-1',
      status: 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
      subject: { reference: 'Patient/patient-1', display: 'Test RosterPatient' },
      period: { start: new Date().toISOString() },
    };

    vi.spyOn(medplum, 'search').mockResolvedValueOnce(makeBundle([encounter]));
    assignRoster(group);
    setup();

    await waitFor(() => expect(screen.getByText('Test RosterPatient')).toBeInTheDocument());
    expect(screen.getByText('AMB')).toBeInTheDocument();
  });

  test('filters by patient name', async () => {
    const user = userEvent.setup();
    const group = await medplum.createResource<Group>({
      resourceType: 'Group',
      type: 'person',
      actual: true,
      name: 'Silver State Plan Roster',
    });

    const encounters: Encounter[] = [
      {
        resourceType: 'Encounter',
        id: 'enc-1',
        status: 'finished',
        class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
        subject: { reference: 'Patient/patient-a', display: 'A Alpha' },
        period: { start: new Date().toISOString() },
      },
      {
        resourceType: 'Encounter',
        id: 'enc-2',
        status: 'finished',
        class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'EMER' },
        subject: { reference: 'Patient/patient-b', display: 'B Beta' },
        period: { start: new Date().toISOString() },
      },
    ];

    vi.spyOn(medplum, 'search').mockResolvedValueOnce(makeBundle(encounters));
    assignRoster(group);
    setup();
    await waitFor(() => expect(screen.getByText('A Alpha')).toBeInTheDocument());

    const nameInput = screen.getByPlaceholderText('Filter by name');
    await user.type(nameInput, 'Beta');

    await waitFor(() => {
      expect(screen.queryByText('A Alpha')).not.toBeInTheDocument();
      expect(screen.getByText('B Beta')).toBeInTheDocument();
    });
  });
});
