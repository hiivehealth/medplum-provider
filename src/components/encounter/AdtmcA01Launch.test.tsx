// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import type { WithId } from '@medplum/core';
import type { Encounter, Patient, Questionnaire, Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { AdtmcA01Launch } from './AdtmcA01Launch';

const patient: WithId<Patient> = { resourceType: 'Patient', id: 'patient-1' };
const encounter: WithId<Encounter> = {
  resourceType: 'Encounter',
  id: 'encounter-1',
  status: 'in-progress',
  class: { code: 'AMB' },
};

test('creates an encounter task that renders the A-01 questionnaire', async () => {
  const medplum = new MockClient();
  const createdTask: WithId<Task> = { resourceType: 'Task', id: 'task-1', status: 'ready', intent: 'order' };
  const questionnaire: Questionnaire & { id: string } = {
    resourceType: 'Questionnaire',
    id: 'published-a01-questionnaire',
    status: 'draft',
    url: 'https://ehr.hiivehealth.net/fhir/Questionnaire/a01-sore-throat',
    version: '1.0.0',
  };
  vi.spyOn(medplum, 'searchOne').mockResolvedValue(questionnaire);
  const createResourceSpy = vi.spyOn(medplum, 'createResource').mockResolvedValue(createdTask);
  const onTaskCreated = vi.fn();

  render(
    <MedplumProvider medplum={medplum}>
      <MantineProvider>
        <AdtmcA01Launch patient={patient} encounter={encounter} onTaskCreated={onTaskCreated} />
      </MantineProvider>
    </MedplumProvider>
  );

  await userEvent.setup().click(screen.getByRole('button', { name: 'Start A-01 Sore Throat' }));

  await waitFor(() => {
    expect(createResourceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'Task',
        encounter: { reference: 'Encounter/encounter-1' },
        focus: { reference: 'Questionnaire/published-a01-questionnaire' },
        input: [
          { type: { text: 'Questionnaire' }, valueReference: { reference: 'Questionnaire/published-a01-questionnaire' } },
        ],
      })
    );
  });
  expect(onTaskCreated).toHaveBeenCalledWith(createdTask);
});