// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Card, Stack } from '@mantine/core';
import { useDebouncedCallback } from '@mantine/hooks';
import { showNotification } from '@mantine/notifications';
import type { MedplumClient, WithId } from '@medplum/core';
import { createReference, deepEquals, normalizeErrorString } from '@medplum/core';
import type { DiagnosticReport, QuestionnaireResponse, Task } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconCircleOff } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { SAVE_TIMEOUT_MS } from '../../../config/constants';
import { A01_QUESTIONNAIRE_URL, hasArmyAccess, isAdtmcTask } from '../../../utils/adtmc';
import { SimpleTask } from './SimpleTask';
import { TaskQuestionnaireForm } from './TaskQuestionnaireForm';
import { TaskServiceRequest } from './TaskServiceRequest';
import { TaskStatusPanel } from './TaskStatusPanel';

const A01_TASK_CODE = 'ADTMC A-01 Sore Throat/Hoarseness';

interface TaskPanelProps {
  task: WithId<Task>;
  enabled?: boolean;
  onUpdateTask: (task: WithId<Task>) => void;
}

export const TaskPanel = (props: TaskPanelProps): JSX.Element | null => {
  const { task, enabled = true, onUpdateTask } = props;
  const navigate = useNavigate();
  const location = useLocation();
  const medplum = useMedplum();
  const projectId = task.meta?.project ?? medplum.getProject()?.id;
  const submitting = useRef(false);

  const onActionButtonClicked = async (): Promise<void> => {
    // Keep the search query (relative navigation drops it by default).
    navigate(`Task/${task.id}${location.search}`)?.catch(console.error);
  };

  const onChangeResponse = (response: QuestionnaireResponse): void => {
    saveQuestionnaireResponse(task, response);
  };

  const onSubmitA01Response = async (response: QuestionnaireResponse): Promise<void> => {
    const adtmc = isAdtmcTask(task) || response.questionnaire?.startsWith(A01_QUESTIONNAIRE_URL);
    if (submitting.current || (adtmc && (!enabled || !hasArmyAccess(medplum, projectId)))) {
      return;
    }
    submitting.current = true;
    try {
      if (adtmc && !task.meta?.versionId) {
        throw new Error('Reload the A-01 task before completing the assessment.');
      }
      const identifier = { system: 'urn:hiivehealth:adtmc-task-response', value: `${projectId}/${task.id}` };
      const completedResponse = adtmc
        ? await medplum.createResourceIfNoneExist(
          { ...response, identifier },
          new URLSearchParams({ identifier: `${identifier.system}|${identifier.value}` }).toString()
        )
        : await medplum.createResource(response);
      if (adtmc && !hasArmyAccess(medplum, projectId)) {
        return;
      }
      if (adtmc && (
        completedResponse.meta?.project !== projectId || completedResponse.status !== 'completed' ||
        completedResponse.questionnaire !== response.questionnaire ||
        completedResponse.subject?.reference !== response.subject?.reference ||
        completedResponse.encounter?.reference !== response.encounter?.reference ||
        !deepEquals(completedResponse.item, response.item)
      )) {
        throw new Error('A different completed A-01 response exists. Reload the task before continuing.');
      }
      const completedTask = await medplum.updateResource<Task>({
        ...task,
        status: 'completed',
        output: [{ type: { text: 'QuestionnaireResponse' }, valueReference: createReference(completedResponse) }],
      }, adtmc ? { headers: { 'If-Match': `W/"${task.meta?.versionId}"` } } : undefined);
      onUpdateTask(completedTask);
    } catch (err) {
      showNotification({
        color: 'red', icon: <IconCircleOff />, title: 'Error', message: normalizeErrorString(err),
      });
    } finally {
      submitting.current = false;
    }
  };

  const onSaveDiagnosticReport = (diagnosticReport: DiagnosticReport): void => {
    saveDiagnosticReport(task, diagnosticReport);
  };

  const saveQuestionnaireResponse = useDebouncedCallback(
    async (task: Task, response: QuestionnaireResponse): Promise<void> => {
      if (isAdtmcTask(task) && !hasArmyAccess(medplum, projectId)) {
        return;
      }
      try {
        if (response.id) {
          await medplum.updateResource(response);
        } else {
          const updatedResponse = await medplum.createResource(response);
          if (isAdtmcTask(task) && !hasArmyAccess(medplum, projectId)) {
            return;
          }
          const updatedTask = await medplum.updateResource<Task>({
            ...task,
            output: [
              {
                type: { text: 'QuestionnaireResponse' },
                valueReference: createReference(updatedResponse),
              },
            ],
          });
          onUpdateTask(updatedTask);
        }
      } catch (err) {
        console.error(err);
      }
    },
    SAVE_TIMEOUT_MS
  );

  const saveDiagnosticReport = useDebouncedCallback(
    async (task: Task, diagnosticReport: DiagnosticReport): Promise<void> => {
      const updatedTask = await medplum.updateResource<Task>({
        ...task,
        output: [
          {
            type: { text: 'DiagnosticReport' },
            valueReference: createReference(diagnosticReport),
          },
        ],
      });
      onUpdateTask(updatedTask);
    },
    SAVE_TIMEOUT_MS
  );

  const onChangeStatus = async (status: Task[`status`]): Promise<void> => {
    if (isAdtmcTask(task) && !hasArmyAccess(medplum, projectId)) {
      return;
    }
    const updatedTask: WithId<Task> = { ...task, status: status };
    await updateTaskStatus(updatedTask, medplum, onUpdateTask);
  };

  if (isAdtmcTask(task) && !hasArmyAccess(medplum, projectId)) {
    return null;
  }

  return (
    <Card withBorder shadow="sm" p={0}>
      <Stack gap="xs">
        <Stack p="md">
          {task.focus?.reference?.startsWith('Questionnaire/') && (
            <TaskQuestionnaireForm
              key={task.id}
              task={task}
              autoSave={task.code?.text !== A01_TASK_CODE}
              onChangeResponse={onChangeResponse}
              onSubmitResponse={onSubmitA01Response}
            />
          )}
          {task.focus?.reference?.startsWith('ServiceRequest/') && (
            <TaskServiceRequest key={task.id} task={task} saveDiagnosticReport={onSaveDiagnosticReport} />
          )}

          {!task.focus?.reference?.startsWith('ServiceRequest/') &&
            !task.focus?.reference?.startsWith('Questionnaire/') && <SimpleTask key={task.id} task={task} />}
        </Stack>
        <TaskStatusPanel
          task={task}
          enabled={enabled}
          onActionButtonClicked={onActionButtonClicked}
          onChangeStatus={onChangeStatus}
        />
      </Stack>
    </Card>
  );
};

const updateTaskStatus = async (
  task: WithId<Task>,
  medplum: MedplumClient,
  onUpdateTask: (task: WithId<Task>) => void
): Promise<void> => {
  try {
    const response = await medplum.updateResource(task);
    onUpdateTask(response);
  } catch (err) {
    showNotification({
      color: 'red',
      icon: <IconCircleOff />,
      title: 'Error',
      message: normalizeErrorString(err),
    });
  }
};
