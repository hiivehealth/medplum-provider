// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import type { WithId } from '@medplum/core';
import type { Project, Questionnaire, QuestionnaireResponse, ServiceRequest, Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as reactRouter from 'react-router';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TaskPanel } from './TaskPanel';
import { TaskQuestionnaireForm } from './TaskQuestionnaireForm';

const armyFeatures = ['army'] as unknown as Project['features'];

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof reactRouter>();
  return { ...actual, useNavigate: vi.fn() };
});

vi.mock('./TaskQuestionnaireForm', async (importOriginal) => {
  const actual = await importOriginal<{ TaskQuestionnaireForm: typeof TaskQuestionnaireForm }>();
  return { ...actual, TaskQuestionnaireForm: vi.fn(actual.TaskQuestionnaireForm) };
});

describe('TaskPanel', () => {
  let medplum: MockClient;
  let navigateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    medplum = new MockClient();
    vi.clearAllMocks();
    navigateSpy = vi.fn().mockReturnValue(Promise.resolve());
    vi.spyOn(reactRouter, 'useNavigate').mockReturnValue(navigateSpy as any);
  });

  const setup = async (
    task: WithId<Task>,
    onUpdateTask: (task: WithId<Task>) => void,
    enabled = true
  ): Promise<void> => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/Patient/123/Encounter/456']}>
          <MedplumProvider medplum={medplum}>
            <MantineProvider>
              <Notifications />
              <Routes>
                <Route
                  path="/Patient/:patientId/Encounter/:encounterId"
                  element={<TaskPanel task={task} onUpdateTask={onUpdateTask} enabled={enabled} />}
                />
                <Route
                  path="/Patient/:patientId/Encounter/:encounterId/Task/:taskId"
                  element={<div>Task Detail Page</div>}
                />
              </Routes>
            </MantineProvider>
          </MedplumProvider>
        </MemoryRouter>
      );
    });
  };

  const mockTask: WithId<Task> = {
    resourceType: 'Task',
    id: 'task-123',
    status: 'in-progress',
    intent: 'order',
    code: { text: 'Test Task Code' },
    description: 'Test Task Description',
  };

  const setupA01Submission = async (taskOverrides: Partial<Task> = {}, enabled = true): Promise<{
    task: WithId<Task>;
    response: QuestionnaireResponse;
    completedResponse: WithId<QuestionnaireResponse>;
    onUpdateTask: ReturnType<typeof vi.fn>;
    submit: (response: QuestionnaireResponse) => void;
  }> => {
    vi.spyOn(medplum, 'getProject').mockReturnValue({ resourceType: 'Project', id: 'army-project', features: armyFeatures });
    vi.spyOn(medplum, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'provider-1' });
    vi.spyOn(medplum, 'getProjectMembership').mockReturnValue({
      resourceType: 'ProjectMembership', id: 'membership-1',
      project: { reference: 'Project/army-project' }, user: { reference: 'User/user-1' },
      profile: { reference: 'Practitioner/provider-1' },
    });
    const task: WithId<Task> = {
      ...mockTask,
      meta: { project: 'army-project', versionId: '1' },
      code: { text: 'ADTMC A-01 Sore Throat/Hoarseness' },
      focus: { reference: 'Questionnaire/a01' },
      input: [{ type: { text: 'Questionnaire' }, valueReference: { reference: 'Questionnaire/a01' } }],
      ...taskOverrides,
    };
    vi.spyOn(medplum, 'readReference').mockResolvedValue({
      resourceType: 'Questionnaire', id: 'a01', status: 'active', meta: { project: 'army-project' },
    });
    const response: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse', status: 'completed',
      questionnaire: 'https://ehr.hiivehealth.net/fhir/Questionnaire/a01-sore-throat|1.0.0',
    };
    const completedResponse: WithId<QuestionnaireResponse> = {
      ...response, id: 'response-1', meta: { project: 'army-project' },
    };
    const onUpdateTask = vi.fn();
    await setup(task, onUpdateTask, enabled);
    const submit = vi.mocked(TaskQuestionnaireForm).mock.lastCall?.[0].onSubmitResponse;
    if (!submit) {
      throw new Error('Expected the A-01 submission callback');
    }
    return { task, response, completedResponse, onUpdateTask, submit };
  };

  test('retries A-01 Task completion using the same conditional response identity', async () => {
    const { task, response, completedResponse, onUpdateTask, submit } = await setupA01Submission();
    const conditionalCreate = vi.spyOn(medplum, 'createResourceIfNoneExist').mockResolvedValue(completedResponse);
    const create = vi.spyOn(medplum, 'createResource').mockResolvedValue(completedResponse);
    const update = vi.spyOn(medplum, 'updateResource')
      .mockRejectedValueOnce(new Error('Synthetic Task update failure'))
      .mockResolvedValueOnce({ ...task, status: 'completed' });

    await act(async () => { await submit(response); });
    expect(onUpdateTask).not.toHaveBeenCalled();
    await act(async () => { await submit(response); });

    const identifier = { system: 'urn:hiivehealth:adtmc-task-response', value: 'army-project/task-123' };
    expect(conditionalCreate).toHaveBeenCalledTimes(2);
    expect(conditionalCreate).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ identifier, status: 'completed' }),
      new URLSearchParams({ identifier: `${identifier.system}|${identifier.value}` }).toString()
    );
    expect(conditionalCreate.mock.calls[1]).toEqual(conditionalCreate.mock.calls[0]);
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'completed', output: [{ type: { text: 'QuestionnaireResponse' }, valueReference: { reference: 'QuestionnaireResponse/response-1' } }] }),
      { headers: { 'If-Match': 'W/"1"' } }
    );
    expect(onUpdateTask).toHaveBeenCalledTimes(1);
  });

  test('recovers an ambiguous A-01 response save without changing its conditional identity', async () => {
    const { task, response, completedResponse, onUpdateTask, submit } = await setupA01Submission();
    const conditionalCreate = vi.spyOn(medplum, 'createResourceIfNoneExist')
      .mockRejectedValueOnce(new Error('Synthetic timeout after response commit'))
      .mockResolvedValueOnce(completedResponse);
    const update = vi.spyOn(medplum, 'updateResource').mockResolvedValue({ ...task, status: 'completed' });

    await act(async () => { await submit(response); });
    expect(update).not.toHaveBeenCalled();
    await act(async () => { await submit(response); });

    expect(conditionalCreate).toHaveBeenCalledTimes(2);
    expect(conditionalCreate.mock.calls[1]).toEqual(conditionalCreate.mock.calls[0]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(onUpdateTask).toHaveBeenCalledTimes(1);
  });

  test('coalesces overlapping A-01 submissions', async () => {
    const { task, response, completedResponse, onUpdateTask, submit } = await setupA01Submission();
    let finishResponse: (saved: WithId<QuestionnaireResponse>) => void = () => undefined;
    const pendingResponse = new Promise<WithId<QuestionnaireResponse>>((resolve) => { finishResponse = resolve; });
    const conditionalCreate = vi.spyOn(medplum, 'createResourceIfNoneExist').mockReturnValue(pendingResponse);
    const update = vi.spyOn(medplum, 'updateResource').mockResolvedValue({ ...task, status: 'completed' });

    await act(async () => {
      const firstSubmission = submit(response);
      const secondSubmission = submit(response);
      expect(conditionalCreate).toHaveBeenCalledTimes(1);
      finishResponse(completedResponse);
      await Promise.all([firstSubmission, secondSubmission]);
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(onUpdateTask).toHaveBeenCalledTimes(1);
  });

  test.each([
    { name: 'foreign project', changed: { meta: { project: 'other-project' } } },
    { name: 'different answers', changed: { item: [{ linkId: 'screen', answer: [{ valueString: 'different' }] }] } },
    { name: 'incomplete response', changed: { status: 'in-progress' as const } },
    { name: 'different patient', changed: { subject: { reference: 'Patient/other-patient' } } },
  ])('does not complete an A-01 Task from a recovered response with $name', async ({ changed }) => {
    const { response, completedResponse, onUpdateTask, submit } = await setupA01Submission();
    vi.spyOn(medplum, 'createResourceIfNoneExist').mockResolvedValue({ ...completedResponse, ...changed });
    const update = vi.spyOn(medplum, 'updateResource');

    await act(async () => { await submit(response); });

    expect(update).not.toHaveBeenCalled();
    expect(onUpdateTask).not.toHaveBeenCalled();
  });

  test('does not overwrite a competing Task version after an A-01 response save', async () => {
    const { response, completedResponse, onUpdateTask, submit } = await setupA01Submission();
    vi.spyOn(medplum, 'createResourceIfNoneExist').mockResolvedValue(completedResponse);
    const update = vi.spyOn(medplum, 'updateResource').mockRejectedValue(new Error('Synthetic version conflict'));

    await act(async () => { await submit(response); });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1]).toEqual({ headers: { 'If-Match': 'W/"1"' } });
    expect(onUpdateTask).not.toHaveBeenCalled();
  });

  test.each(['missing version', 'locked'])('does not persist an A-01 submission when the Task is %s', async (kind) => {
    const overrides = kind === 'missing version' ? { meta: { project: 'army-project' } } : {};
    const { response, submit } = await setupA01Submission(overrides, kind !== 'locked');
    const conditionalCreate = vi.spyOn(medplum, 'createResourceIfNoneExist');
    const update = vi.spyOn(medplum, 'updateResource');

    await act(async () => { await submit(response); });

    expect(conditionalCreate).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test('does not complete an A-01 Task after its session switches projects', async () => {
    const { response, completedResponse, onUpdateTask, submit } = await setupA01Submission();
    vi.spyOn(medplum, 'createResourceIfNoneExist').mockImplementation(async () => {
      vi.mocked(medplum.getProject).mockReturnValue({ resourceType: 'Project', id: 'other-project' });
      return completedResponse;
    });
    const update = vi.spyOn(medplum, 'updateResource');

    await act(async () => { await submit(response); });

    expect(update).not.toHaveBeenCalled();
    expect(onUpdateTask).not.toHaveBeenCalled();
  });

  test.each(['launch', 'handoff', 'foreign-project'])('hides an ADTMC %s task without Army eligibility', async (kind) => {
    if (kind === 'foreign-project') {
      vi.spyOn(medplum, 'getProject').mockReturnValue({ resourceType: 'Project', id: 'army-project', features: armyFeatures });
      vi.spyOn(medplum, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'provider-1' });
      vi.spyOn(medplum, 'getProjectMembership').mockReturnValue({
        resourceType: 'ProjectMembership', id: 'membership-1', active: true,
        project: { reference: 'Project/army-project' }, user: { reference: 'User/user-1' },
        profile: { reference: 'Practitioner/provider-1' },
      });
    }
    const read = vi.spyOn(medplum, 'readReference');
    await setup({
      ...mockTask,
      meta: kind === 'foreign-project' ? { project: 'other-project' } : undefined,
      code: { text: kind !== 'handoff' ? 'ADTMC A-01 Sore Throat/Hoarseness' : 'Clinical handoff' },
      extension: kind === 'handoff' ? [{
        url: 'https://ehr.hiivehealth.net/fhir/StructureDefinition/adtmc-algorithm-id', valueString: 'A-01',
      }] : undefined,
      focus: { reference: 'Questionnaire/a01' },
      input: [{ type: { text: 'Questionnaire' }, valueReference: { reference: 'Questionnaire/a01' } }],
    }, vi.fn());

    expect(screen.queryByText('Task Status:')).not.toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
  });

  test('renders TaskQuestionnaireForm when focus is Questionnaire', async () => {
    const questionnaireId = `q-${Date.now()}`;
    const questionnaire: Questionnaire = {
      resourceType: 'Questionnaire',
      id: questionnaireId,
      status: 'active',
      item: [{ linkId: 'q1', type: 'string', text: 'Test Question' }],
    };
    await medplum.createResource(questionnaire);

    const task: WithId<Task> = {
      ...mockTask,
      focus: { reference: `Questionnaire/${questionnaireId}` },
      input: [{ type: { text: 'Questionnaire' }, valueReference: { reference: `Questionnaire/${questionnaireId}` } }],
    };
    const onUpdateTask = vi.fn();
    await setup(task, onUpdateTask);

    // Wait for the task status panel to render
    await waitFor(() => {
      expect(screen.getByText('Task Status:')).toBeInTheDocument();
    });
  });

  test('renders TaskServiceRequest when focus is ServiceRequest', async () => {
    const task: WithId<Task> = {
      ...mockTask,
      focus: { reference: 'ServiceRequest/1234' },
      for: { reference: 'Patient/123' },
      input: [{ type: { text: 'ServiceRequest' }, valueReference: { reference: 'ServiceRequest/123' } }],
    };
    const onUpdateTask = vi.fn();
    const serviceRequest: ServiceRequest = {
      resourceType: 'ServiceRequest',
      id: '1234',
      status: 'active',
      category: [
        { coding: [{ system: 'http://snomed.info/sct', code: '108252007', display: 'Laboratory procedure' }] },
      ],
      code: { text: 'Test Service Request' },
      intent: 'order',
      subject: { reference: 'Patient/123' },
      requisition: { value: 'REQ-123' },
    };
    await medplum.createResource(serviceRequest);
    medplum.readReference = vi.fn().mockResolvedValue(serviceRequest);
    await setup(task, onUpdateTask);

    await waitFor(() => {
      expect(screen.getByText('Test Task Code')).toBeInTheDocument();
      expect(screen.getByText(/✅ Order Sent/)).toBeInTheDocument();
    });
  });

  test('renders SimpleTask when focus is neither Questionnaire nor ServiceRequest', async () => {
    const onUpdateTask = vi.fn();
    await setup(mockTask, onUpdateTask);
    expect(screen.getByText('Test Task Code')).toBeInTheDocument();
    expect(screen.getByText('Test Task Description')).toBeInTheDocument();
  });

  test('renders TaskStatusPanel', async () => {
    const onUpdateTask = vi.fn();
    await setup(mockTask, onUpdateTask);
    expect(screen.getByText('Task Status:')).toBeInTheDocument();
  });

  test('updates task status when changed in TaskStatusPanel', async () => {
    const user = userEvent.setup();
    const onUpdateTask = vi.fn();
    medplum.updateResource = vi.fn().mockResolvedValue({ ...mockTask, status: 'completed' });
    await setup(mockTask, onUpdateTask);

    const statusBadge = screen.getByText('In Progress');
    await user.click(statusBadge);

    await waitFor(() => {
      const completedOption = screen.getByText('Completed');
      expect(completedOption).toBeInTheDocument();
    });

    await user.click(screen.getByText('Completed'));

    await waitFor(() => {
      expect(medplum.updateResource).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'task-123',
          status: 'completed',
        })
      );
      expect(onUpdateTask).toHaveBeenCalled();
    });
  });

  test('renders with edit action button', async () => {
    const onUpdateTask = vi.fn();
    await setup(mockTask, onUpdateTask);

    // Wait for the component to render
    await waitFor(() => {
      expect(screen.getByText('Test Task Code')).toBeInTheDocument();
    });

    // The panel should have action buttons
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  test('saves questionnaire response when response changes - update existing', async () => {
    const questionnaire: Questionnaire = {
      resourceType: 'Questionnaire',
      id: 'q-123',
      status: 'active',
      item: [{ linkId: 'q1', type: 'string', text: 'Test Question' }],
    };
    await medplum.createResource(questionnaire);

    const existingResponse: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      id: 'qr-456',
      status: 'in-progress',
      questionnaire: 'Questionnaire/q-123',
    };
    await medplum.createResource(existingResponse);

    const task: WithId<Task> = {
      ...mockTask,
      focus: { reference: 'Questionnaire/q-123' },
      output: [
        { type: { text: 'QuestionnaireResponse' }, valueReference: { reference: 'QuestionnaireResponse/qr-456' } },
      ],
    };

    const onUpdateTask = vi.fn();
    await setup(task, onUpdateTask);

    // Wait for the component to render with task status
    await waitFor(() => {
      expect(screen.getByText('Task Status:')).toBeInTheDocument();
    });
  });

  test('creates new questionnaire response when none exists', async () => {
    const questionnaire: Questionnaire = {
      resourceType: 'Questionnaire',
      id: 'q-new',
      status: 'active',
      item: [{ linkId: 'q1', type: 'string', text: 'Test Question' }],
    };
    await medplum.createResource(questionnaire);

    const task: WithId<Task> = {
      ...mockTask,
      id: 'task-new-qr',
      focus: { reference: 'Questionnaire/q-new' },
    };

    const onUpdateTask = vi.fn();
    await setup(task, onUpdateTask);

    // Wait for the component to render with task status
    await waitFor(() => {
      expect(screen.getByText('Task Status:')).toBeInTheDocument();
    });
  });

  test('shows error notification when status update fails', async () => {
    const user = userEvent.setup();
    const onUpdateTask = vi.fn();
    medplum.updateResource = vi.fn().mockRejectedValue(new Error('Update failed'));
    await setup(mockTask, onUpdateTask);

    const statusBadge = screen.getByText('In Progress');
    await user.click(statusBadge);

    await waitFor(() => {
      const completedOption = screen.getByText('Completed');
      expect(completedOption).toBeInTheDocument();
    });

    await user.click(screen.getByText('Completed'));

    await waitFor(() => {
      expect(medplum.updateResource).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(medplum.updateResource).toHaveBeenCalled();
    });
  });

  test('renders with enabled=false disables status changes', async () => {
    const onUpdateTask = vi.fn();
    await setup(mockTask, onUpdateTask, false);

    expect(screen.getByText('Test Task Code')).toBeInTheDocument();
    expect(screen.getByText('Task Status:')).toBeInTheDocument();
  });

  test('handles task without focus reference', async () => {
    const taskWithoutFocus: WithId<Task> = {
      resourceType: 'Task',
      id: 'task-no-focus',
      status: 'draft',
      intent: 'order',
      code: { text: 'Simple Task' },
    };

    const onUpdateTask = vi.fn();
    await setup(taskWithoutFocus, onUpdateTask);

    expect(screen.getByText('Simple Task')).toBeInTheDocument();
  });

  test('handles task with undefined focus reference', async () => {
    const taskWithUndefinedFocus: WithId<Task> = {
      resourceType: 'Task',
      id: 'task-undefined-focus',
      status: 'draft',
      intent: 'order',
      code: { text: 'Task with undefined focus' },
      focus: { display: 'Some Display' }, // focus without reference
    };

    const onUpdateTask = vi.fn();
    await setup(taskWithUndefinedFocus, onUpdateTask);

    expect(screen.getByText('Task with undefined focus')).toBeInTheDocument();
  });
});
