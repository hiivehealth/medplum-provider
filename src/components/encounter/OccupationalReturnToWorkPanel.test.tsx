// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import type { WithId } from '@medplum/core';
import { createReference } from '@medplum/core';
import type { Encounter, Observation, Patient, Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { OccupationalReturnToWorkPanel } from './OccupationalReturnToWorkPanel';

const DEMO_CODE_SYSTEM = 'https://hiivecare.example/fhir/CodeSystem/medplum-ubix-demo';

const patient: WithId<Patient> = {
  resourceType: 'Patient',
  id: 'patient-rtw',
  name: [{ given: ['Avery'], family: 'Rivera' }],
};

const encounter: WithId<Encounter> = {
  resourceType: 'Encounter',
  id: 'encounter-rtw',
  status: 'in-progress',
  class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
  subject: createReference(patient),
};

const visitTask: WithId<Task> = {
  resourceType: 'Task',
  id: 'visit-task',
  status: 'in-progress',
  intent: 'order',
  code: { text: 'Assess return-to-work status' },
  encounter: createReference(encounter),
  for: createReference(patient),
};

const rtwTask: WithId<Task> = {
  resourceType: 'Task',
  id: 'rtw-task',
  status: 'ready',
  intent: 'order',
  code: {
    coding: [{ system: DEMO_CODE_SYSTEM, code: 'rtw-follow-up', display: 'RTW case follow-up' }],
    text: 'RTW case follow-up',
  },
  for: createReference(patient),
};

const rtwObservation: WithId<Observation> = {
  resourceType: 'Observation',
  id: 'rtw-observation',
  status: 'final',
  code: {
    coding: [{ system: DEMO_CODE_SYSTEM, code: 'return-to-work-status', display: 'Return-to-work status' }],
  },
  subject: createReference(patient),
  valueString: 'pending-reevaluation',
  component: [
    {
      code: { coding: [{ system: DEMO_CODE_SYSTEM, code: 'restriction-summary', display: 'Restriction summary' }] },
      valueString: 'Administrative duty only.',
    },
    {
      code: {
        coding: [
          { system: DEMO_CODE_SYSTEM, code: 'restriction-reevaluation-date', display: 'Restriction reevaluation date' },
        ],
      },
      valueDateTime: '2026-05-26',
    },
  ],
};

describe('OccupationalReturnToWorkPanel', () => {
  let medplum: MockClient;

  beforeEach(() => {
    medplum = new MockClient();
    vi.clearAllMocks();
  });

  function setup(onUpdateTask = vi.fn()): void {
    vi.spyOn(medplum, 'searchResources').mockImplementation((resourceType: string) => {
      if (resourceType === 'Observation') {
        return Promise.resolve([rtwObservation]) as any;
      }
      if (resourceType === 'Task') {
        return Promise.resolve([rtwTask]) as any;
      }
      return Promise.resolve([]) as any;
    });

    vi.spyOn(medplum, 'updateResource').mockImplementation((resource: any) => Promise.resolve(resource));

    render(
      <MedplumProvider medplum={medplum}>
        <MantineProvider>
          <Notifications />
          <OccupationalReturnToWorkPanel
            patient={patient}
            encounter={encounter}
            tasks={[visitTask]}
            onUpdateTask={onUpdateTask}
          />
        </MantineProvider>
      </MedplumProvider>
    );
  }

  test('saves RTW documentation and completes related follow-up tasks', async () => {
    const user = userEvent.setup();
    const onUpdateTask = vi.fn();
    setup(onUpdateTask);

    await waitFor(() => {
      expect(screen.getByText('Return-to-Work Documentation')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Administrative duty only.')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Save and complete follow-up/i }));

    await waitFor(() => {
      expect(medplum.updateResource).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: 'Observation',
          id: 'rtw-observation',
          valueString: 'pending-reevaluation',
          encounter: { reference: 'Encounter/encounter-rtw' },
        })
      );
      expect(medplum.updateResource).toHaveBeenCalledWith(
        expect.objectContaining({ resourceType: 'Task', id: 'visit-task', status: 'completed' })
      );
      expect(medplum.updateResource).toHaveBeenCalledWith(
        expect.objectContaining({ resourceType: 'Task', id: 'rtw-task', status: 'completed' })
      );
      expect(onUpdateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'visit-task', status: 'completed' }));
    });
  });
});
