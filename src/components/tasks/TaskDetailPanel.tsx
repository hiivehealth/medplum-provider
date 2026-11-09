// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Box, Flex, Paper, ScrollArea, SegmentedControl, Text } from '@mantine/core';
import type { MedplumClient } from '@medplum/core';
import type { Patient, Reference, ResourceType, Task } from '@medplum/fhirtypes';
import {
  createPharmaciesSection,
  getDefaultSections,
  PatientSummary,
  ResourceTimeline,
  useMedplum,
  useResource,
} from '@medplum/react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { showErrorNotification } from '../../utils/notifications';
import { hasArmyAccess, isAdtmcTask } from '../../utils/adtmc';
import { usePharmacyDialog } from '../pharmacy/usePharmacyDialog';
import { ScriptSureMessageTaskActions } from './ScriptSureMessageTaskActions';
import { isScriptSureMessageTask } from './ScriptSureMessageTaskActions.utils';
import classes from './TaskBoard.module.css';
import { TaskInputNote } from './TaskInputNote';
import { TaskProperties } from './TaskProperties';

interface TaskDetailPanelProps {
  task: Task | Reference<Task>;
  onTaskChange?: (task: Task) => void;
  onDeleteTask?: (task: Task) => void;
}

export function TaskDetailPanel(props: TaskDetailPanelProps): JSX.Element | null {
  const { task: taskProp, onTaskChange, onDeleteTask } = props;
  const medplum = useMedplum();
  const PharmacyDialogComponent = usePharmacyDialog();
  const resolvedTask = useResource(taskProp);
  const [task, setTask] = useState<Task | undefined>(resolvedTask);
  const [activeTab, setActiveTab] = useState('properties');

  useEffect(() => {
    if (resolvedTask) {
      setTask(resolvedTask);
    }
  }, [resolvedTask]);

  const patientRef = task?.for as Reference<Patient>;
  const projectId = task?.meta?.project ?? medplum.getProject()?.id;
  const denied = !!task && isAdtmcTask(task) && !hasArmyAccess(medplum, projectId);
  const selectedPatient = useResource<Patient>(denied ? undefined : patientRef);

  if (denied) {
    return null;
  }

  if (!task) {
    return (
      <Box h="100%" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Text c="dimmed">No task selected</Text>
      </Box>
    );
  }

  const handleTaskChange = async (updatedTask: Task): Promise<void> => {
    if ((isAdtmcTask(task) || isAdtmcTask(updatedTask)) && !hasArmyAccess(medplum, projectId)) {
      return;
    }
    await medplum.updateResource(updatedTask);
    if (isAdtmcTask(task) && !hasArmyAccess(medplum, projectId)) {
      return;
    }
    setTask(updatedTask);
    onTaskChange?.(updatedTask);
  };

  const handleServerTaskChange = (updatedTask: Task): void => {
    setTask(updatedTask);
    onTaskChange?.(updatedTask);
  };

  const handleDeleteTask = async (deletedTask: Task): Promise<void> => {
    if ((isAdtmcTask(task) || isAdtmcTask(deletedTask)) && !hasArmyAccess(medplum, projectId)) {
      return;
    }
    try {
      await medplum.deleteResource('Task', deletedTask.id as string);
      onDeleteTask?.(deletedTask);
    } catch (error) {
      showErrorNotification(error);
    }
  };

  const handleTabChange = (value: string): void => {
    setActiveTab(value);
  };

  const getTabData = (): { label: string; value: string }[] => {
    const tabs = [
      { label: 'Properties', value: 'properties' },
      { label: 'Activity Log', value: 'activity-log' },
    ];

    if (selectedPatient) {
      tabs.push({ label: 'Patient Summary', value: 'patient-summary' });
    }

    return tabs;
  };

  return (
    <>
      <Box
        h="100%"
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
        }}
        className={classes.borderRight}
      >
        {isScriptSureMessageTask(task) ? (
          <Flex direction="column" h="100%">
            <ScriptSureMessageTaskActions task={task} onTaskChange={handleServerTaskChange} />
            <Box flex={1} mih={0}>
              <TaskInputNote
                task={task}
                onTaskChange={handleTaskChange}
                onDeleteTask={onDeleteTask ? handleDeleteTask : undefined}
              />
            </Box>
          </Flex>
        ) : (
          <TaskInputNote
            task={task}
            onTaskChange={handleTaskChange}
            onDeleteTask={onDeleteTask ? handleDeleteTask : undefined}
          />
        )}
      </Box>

      <Box h="100%" w="400px">
        <Paper h="100%" style={{ overflow: 'hidden' }}>
          <Box px="md" pb="md" pt="md">
            <SegmentedControl
              value={activeTab}
              onChange={handleTabChange}
              data={getTabData()}
              fullWidth
              radius="md"
              color="gray"
              size="sm"
              className={classes.segmentedControl}
            />
          </Box>

          <Box>
            {activeTab === 'properties' && (
              <ScrollArea h="calc(100vh - 120px)">
                <TaskProperties key={task.id} p="md" task={task} onTaskChange={handleTaskChange} />
              </ScrollArea>
            )}
            {activeTab === 'activity-log' && (
              <ScrollArea h="calc(100vh - 120px)">
                <ResourceTimeline
                  value={task}
                  loadTimelineResources={async (medplum: MedplumClient, _resourceType: ResourceType, id: string) => {
                    if (isAdtmcTask(task) && !hasArmyAccess(medplum, projectId)) {
                      return [];
                    }
                    return Promise.allSettled([medplum.readHistory('Task', id)]);
                  }}
                />
              </ScrollArea>
            )}
            {activeTab === 'patient-summary' && selectedPatient?.resourceType === 'Patient' && (
              <ScrollArea h="calc(100vh - 120px)">
                <PatientSummary
                  patient={selectedPatient}
                  sections={getDefaultSections().map((s) =>
                    s.key === 'pharmacies' ? createPharmaciesSection(PharmacyDialogComponent) : s
                  )}
                />
              </ScrollArea>
            )}
          </Box>
        </Paper>
      </Box>
    </>
  );
}
