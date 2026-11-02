// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import type { WithId } from '@medplum/core';
import type { Encounter, Patient, Project, ProjectMembership, Questionnaire, Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import '@testing-library/jest-dom/vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { AdtmcA01Launch } from './AdtmcA01Launch';

const armyFeatures = ['army'] as unknown as Project['features'];

function enableArmy(medplum: MockClient): WithId<ProjectMembership> {
  vi.spyOn(medplum, 'getProject').mockReturnValue({ resourceType: 'Project', id: 'army-project', features: armyFeatures });
  vi.spyOn(medplum, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'provider-1' });
  const membership: WithId<ProjectMembership> = {
    resourceType: 'ProjectMembership',
    id: 'membership-1',
    active: true,
    admin: false,
    project: { reference: 'Project/army-project' },
    user: { reference: 'User/user-1' },
    profile: { reference: 'Practitioner/provider-1' },
  };
  vi.spyOn(medplum, 'getProjectMembership').mockReturnValue(membership);
  return membership;
}

const patient: WithId<Patient> = { resourceType: 'Patient', id: 'patient-1', meta: { project: 'army-project' } };
const encounter: WithId<Encounter> = {
  resourceType: 'Encounter',
  id: 'encounter-1',
  meta: { project: 'army-project' },
  status: 'in-progress',
  class: { code: 'AMB' },
};

test('allows an otherwise verified Army member with the platform default active state', () => {
  const medplum = new MockClient();
  const membership = enableArmy(medplum);
  vi.mocked(medplum.getProjectMembership).mockReturnValue({
    ...membership, active: undefined,
  });

  render(
    <MedplumProvider medplum={medplum}>
      <MantineProvider>
        <AdtmcA01Launch patient={patient} encounter={encounter} onTaskCreated={vi.fn()} />
      </MantineProvider>
    </MedplumProvider>
  );

  expect(screen.getByRole('button', { name: 'Start A-01 Sore Throat' })).toBeInTheDocument();
});

test('creates an encounter task that renders the A-01 questionnaire', async () => {
  const medplum = new MockClient();
  enableArmy(medplum);
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

test.each(['foreign-patient', 'foreign-encounter', 'unverified-patient', 'unverified-encounter'])(
  'does not launch against a resource outside the verified Army project: %s', (scenario) => {
    const medplum = new MockClient();
    enableArmy(medplum);
    const search = vi.spyOn(medplum, 'searchOne');
    const create = vi.spyOn(medplum, 'createResource');
    const resourceMeta = scenario.startsWith('foreign') ? { project: 'other-project' } : undefined;

    render(
      <MedplumProvider medplum={medplum}>
        <MantineProvider>
          <AdtmcA01Launch
            patient={scenario.endsWith('patient') ? { ...patient, meta: resourceMeta } : patient}
            encounter={scenario.endsWith('encounter') ? { ...encounter, meta: resourceMeta } : encounter}
            onTaskCreated={vi.fn()}
          />
        </MantineProvider>
      </MedplumProvider>
    );

    expect(screen.queryByRole('button', { name: 'Start A-01 Sore Throat' })).not.toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  }
);

test('does not expose or load A-01 in a non-Army project', () => {
  const medplum = new MockClient();
  vi.spyOn(medplum, 'getProject').mockReturnValue({ resourceType: 'Project', id: 'general-project', features: [] });
  const search = vi.spyOn(medplum, 'searchOne');
  const create = vi.spyOn(medplum, 'createResource');

  render(
    <MedplumProvider medplum={medplum}>
      <MantineProvider>
        <AdtmcA01Launch patient={patient} encounter={encounter} onTaskCreated={vi.fn()} />
      </MantineProvider>
    </MedplumProvider>
  );

  expect(screen.queryByRole('button', { name: 'Start A-01 Sore Throat' })).not.toBeInTheDocument();
  expect(search).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

test.each(['missing-project', 'missing-membership', 'inactive-member', 'invalid-active', 'foreign-membership', 'missing-profile', 'invalid-features'])(
  'denies an unverifiable Army session: %s',
  (scenario) => {
    const medplum = new MockClient();
    const membership = enableArmy(medplum);
    if (scenario === 'missing-project') {
      vi.mocked(medplum.getProject).mockReturnValue(undefined);
    } else if (scenario === 'missing-membership') {
      vi.mocked(medplum.getProjectMembership).mockReturnValue(undefined);
    } else if (scenario === 'missing-profile') {
      vi.mocked(medplum.getProfile).mockReturnValue(undefined);
    } else if (scenario === 'invalid-features') {
      vi.mocked(medplum.getProject).mockReturnValue({ resourceType: 'Project', id: 'army-project', features: 'army' as never });
    } else if (scenario === 'invalid-active') {
      vi.mocked(medplum.getProjectMembership).mockReturnValue({
        ...membership, active: 'true' as never,
      });
    } else {
      vi.mocked(medplum.getProjectMembership).mockReturnValue({
        ...membership,
        active: scenario !== 'inactive-member',
        project: { reference: scenario === 'foreign-membership' ? 'Project/other-project' : 'Project/army-project' },
      });
    }

    render(
      <MedplumProvider medplum={medplum}>
        <MantineProvider>
          <AdtmcA01Launch patient={patient} encounter={encounter} onTaskCreated={vi.fn()} />
        </MantineProvider>
      </MedplumProvider>
    );

    expect(screen.queryByRole('button', { name: 'Start A-01 Sore Throat' })).not.toBeInTheDocument();
  }
);

test('does not launch if the project changes while the questionnaire is loading', async () => {
  const medplum = new MockClient();
  enableArmy(medplum);
  let resolveQuestionnaire: (value: Questionnaire) => void = () => undefined;
  vi.spyOn(medplum, 'searchOne').mockReturnValue(new Promise<Questionnaire>((resolve) => {
    resolveQuestionnaire = resolve;
  }) as never);
  const create = vi.spyOn(medplum, 'createResource');

  render(
    <MedplumProvider medplum={medplum}>
      <MantineProvider>
        <AdtmcA01Launch patient={patient} encounter={encounter} onTaskCreated={vi.fn()} />
      </MantineProvider>
    </MedplumProvider>
  );

  await userEvent.setup().click(screen.getByRole('button', { name: 'Start A-01 Sore Throat' }));
  vi.mocked(medplum.getProject).mockReturnValue({ resourceType: 'Project', id: 'other-project', features: [] });
  resolveQuestionnaire({ resourceType: 'Questionnaire', id: 'a01', status: 'active' });

  await waitFor(() => expect(screen.queryByRole('button', { name: 'Start A-01 Sore Throat' })).not.toBeInTheDocument());
  expect(create).not.toHaveBeenCalled();
});

test('does not publish a created task into the UI after the project changes', async () => {
  const medplum = new MockClient();
  enableArmy(medplum);
  vi.spyOn(medplum, 'searchOne').mockResolvedValue({ resourceType: 'Questionnaire', id: 'a01', status: 'active' });
  let resolveTask: (value: WithId<Task>) => void = () => undefined;
  const create = vi.spyOn(medplum, 'createResource').mockReturnValue(new Promise<WithId<Task>>((resolve) => {
    resolveTask = resolve;
  }));
  const onTaskCreated = vi.fn();

  render(
    <MedplumProvider medplum={medplum}>
      <MantineProvider>
        <AdtmcA01Launch patient={patient} encounter={encounter} onTaskCreated={onTaskCreated} />
      </MantineProvider>
    </MedplumProvider>
  );

  await userEvent.setup().click(screen.getByRole('button', { name: 'Start A-01 Sore Throat' }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  vi.mocked(medplum.getProject).mockReturnValue({ resourceType: 'Project', id: 'other-project', features: armyFeatures });
  await act(async () => {
    resolveTask({ resourceType: 'Task', id: 'army-task', status: 'ready', intent: 'order' });
  });

  expect(onTaskCreated).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Start A-01 Sore Throat' })).not.toBeInTheDocument();
});