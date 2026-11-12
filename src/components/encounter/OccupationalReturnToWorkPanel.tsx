// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import type { WithId } from '@medplum/core';
import { createReference, getReferenceString } from '@medplum/core';
import type { CodeableConcept, Encounter, Observation, Patient, Task } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconCircleCheck, IconDeviceFloppy } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { showErrorNotification } from '../../utils/notifications';

interface OccupationalReturnToWorkPanelProps {
  patient: WithId<Patient>;
  encounter: WithId<Encounter>;
  tasks: WithId<Task>[];
  enabled?: boolean;
  onUpdateTask: (task: WithId<Task>) => void;
}

interface RtwObservationValues {
  status: string;
  restrictionSummary: string;
  reevaluationDate: string;
  followUpPlan: string;
}

const DEMO_CODE_SYSTEM = 'https://hiivecare.example/fhir/CodeSystem/medplum-ubix-demo';
const RETURN_TO_WORK_STATUS_CODE = 'return-to-work-status';
const RTW_FOLLOW_UP_TASK_CODE = 'rtw-follow-up';
const RESTRICTION_SUMMARY_CODE = 'restriction-summary';
const RESTRICTION_REEVALUATION_DATE_CODE = 'restriction-reevaluation-date';
const OPEN_TASK_STATUS_SEARCH = 'requested,ready,received,accepted,in-progress,on-hold,draft';

const CLOSED_TASK_STATUSES = new Set<Task['status']>([
  'completed',
  'cancelled',
  'failed',
  'rejected',
  'entered-in-error',
]);

const RTW_STATUS_OPTIONS = [
  { value: 'full-duty', label: 'Full duty' },
  { value: 'restricted-duty', label: 'Restricted duty' },
  { value: 'not-fit', label: 'Not fit' },
  { value: 'pending-reevaluation', label: 'Pending reevaluation' },
];

export function OccupationalReturnToWorkPanel(props: OccupationalReturnToWorkPanelProps): JSX.Element | null {
  const { patient, encounter, tasks, enabled = true, onUpdateTask } = props;
  const medplum = useMedplum();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [observation, setObservation] = useState<WithId<Observation> | undefined>();
  const [openRtwTasks, setOpenRtwTasks] = useState<WithId<Task>[]>([]);
  const [rtwStatus, setRtwStatus] = useState<string | null>('pending-reevaluation');
  const [restrictionSummary, setRestrictionSummary] = useState('');
  const [reevaluationDate, setReevaluationDate] = useState('');
  const [followUpPlan, setFollowUpPlan] = useState('');

  const patientReference = getReferenceString(patient);
  const currentVisitTasks = useMemo(() => tasks.filter(isOccupationalVisitTask), [tasks]);
  const currentVisitTaskIds = useMemo(() => new Set(currentVisitTasks.map((task) => task.id)), [currentVisitTasks]);
  const incompleteRelatedTaskCount = useMemo(
    () =>
      uniqueTasks([...currentVisitTasks, ...openRtwTasks]).filter((task) => !CLOSED_TASK_STATUSES.has(task.status))
        .length,
    [currentVisitTasks, openRtwTasks]
  );

  useEffect(() => {
    let active = true;

    async function loadRtwResources(): Promise<void> {
      if (!patientReference) {
        return;
      }

      setLoading(true);
      try {
        const [observations, rtwTasks] = await Promise.all([
          medplum.searchResources(
            'Observation',
            new URLSearchParams({
              subject: patientReference,
              code: `${DEMO_CODE_SYSTEM}|${RETURN_TO_WORK_STATUS_CODE}`,
              _count: '1',
              _sort: '-_lastUpdated',
            }),
            { cache: 'no-cache' }
          ),
          medplum.searchResources(
            'Task',
            new URLSearchParams({
              for: patientReference,
              code: `${DEMO_CODE_SYSTEM}|${RTW_FOLLOW_UP_TASK_CODE}`,
              status: OPEN_TASK_STATUS_SEARCH,
              _count: '25',
              _sort: '-_lastUpdated',
            }),
            { cache: 'no-cache' }
          ),
        ]);

        if (!active) {
          return;
        }

        const latestObservation = observations[0];
        setObservation(latestObservation);
        setOpenRtwTasks(rtwTasks);

        if (latestObservation) {
          setRtwStatus(latestObservation.valueString ?? 'pending-reevaluation');
          setRestrictionSummary(getStringComponentValue(latestObservation, RESTRICTION_SUMMARY_CODE));
          setReevaluationDate(getDateComponentValue(latestObservation, RESTRICTION_REEVALUATION_DATE_CODE));
          setFollowUpPlan(latestObservation.note?.[0]?.text ?? '');
        }
      } catch (err) {
        showErrorNotification(err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadRtwResources().catch(showErrorNotification);

    return () => {
      active = false;
    };
  }, [medplum, patientReference]);

  const handleSave = useCallback(
    async (completeFollowUp: boolean): Promise<void> => {
      if (!rtwStatus) {
        showNotification({
          color: 'yellow',
          title: 'Return-to-work status required',
          message: 'Select a status before saving.',
        });
        return;
      }

      setSaving(true);
      try {
        const values: RtwObservationValues = {
          status: rtwStatus,
          restrictionSummary,
          reevaluationDate,
          followUpPlan,
        };
        const updatedObservation = buildRtwObservation(observation, patient, encounter, values);
        const savedObservation = updatedObservation.id
          ? await medplum.updateResource(updatedObservation)
          : await medplum.createResource(updatedObservation);
        setObservation(savedObservation);

        if (completeFollowUp) {
          const now = new Date().toISOString();
          const relatedTasks = uniqueTasks([...currentVisitTasks, ...openRtwTasks]).filter(
            (task) => !CLOSED_TASK_STATUSES.has(task.status)
          );
          const updatedTasks = await Promise.all(
            relatedTasks.map((task) =>
              medplum.updateResource<Task>({
                ...task,
                status: 'completed',
                executionPeriod: {
                  ...task.executionPeriod,
                  end: now,
                },
              })
            )
          );

          for (const task of updatedTasks) {
            if (task.id && currentVisitTaskIds.has(task.id)) {
              onUpdateTask(task);
            }
          }
          setOpenRtwTasks((previousTasks) =>
            previousTasks.map((task) => updatedTasks.find((updatedTask) => updatedTask.id === task.id) ?? task)
          );
        }

        showNotification({
          icon: <IconCircleCheck />,
          title: 'Saved',
          message: 'Return-to-work documentation updated',
        });
      } catch (err) {
        showErrorNotification(err);
      } finally {
        setSaving(false);
      }
    },
    [
      currentVisitTaskIds,
      currentVisitTasks,
      encounter,
      followUpPlan,
      medplum,
      observation,
      onUpdateTask,
      openRtwTasks,
      patient,
      reevaluationDate,
      restrictionSummary,
      rtwStatus,
    ]
  );

  const shouldRender = currentVisitTasks.length > 0 || openRtwTasks.length > 0 || observation;
  if (!shouldRender) {
    return null;
  }

  return (
    <Card withBorder shadow="sm" mt="md">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Title order={2}>Return-to-Work Documentation</Title>
          <Group gap="xs">
            {loading && <Loader size="sm" />}
            <Badge color={rtwBadgeColor(rtwStatus ?? undefined)} variant="light">
              {formatRtwStatus(rtwStatus ?? undefined)}
            </Badge>
          </Group>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Select
            label="Return-to-work status"
            data={RTW_STATUS_OPTIONS}
            value={rtwStatus}
            onChange={setRtwStatus}
            disabled={!enabled || saving}
            required={true}
          />
          <TextInput
            label="Restriction reevaluation date"
            type="date"
            value={reevaluationDate}
            onChange={(event) => setReevaluationDate(event.currentTarget.value)}
            disabled={!enabled || saving}
          />
        </SimpleGrid>

        <Textarea
          label="Restriction summary"
          minRows={2}
          value={restrictionSummary}
          onChange={(event) => setRestrictionSummary(event.currentTarget.value)}
          disabled={!enabled || saving}
        />

        <Textarea
          label="Follow-up plan"
          minRows={2}
          value={followUpPlan}
          onChange={(event) => setFollowUpPlan(event.currentTarget.value)}
          disabled={!enabled || saving}
        />

        <Group justify="space-between" align="center">
          <Text size="sm" c="dimmed">
            {incompleteRelatedTaskCount} related follow-up {incompleteRelatedTaskCount === 1 ? 'task' : 'tasks'} open
          </Text>
          <Group gap="sm">
            <Button
              variant="light"
              leftSection={<IconDeviceFloppy size={16} />}
              loading={saving}
              disabled={!enabled}
              onClick={() => handleSave(false)}
            >
              Save RTW update
            </Button>
            <Button
              leftSection={<IconCircleCheck size={16} />}
              loading={saving}
              disabled={!enabled}
              onClick={() => handleSave(true)}
            >
              Save and complete follow-up
            </Button>
          </Group>
        </Group>
      </Stack>
    </Card>
  );
}

function buildRtwObservation(
  observation: WithId<Observation> | undefined,
  patient: WithId<Patient>,
  encounter: WithId<Encounter>,
  values: RtwObservationValues
): Observation {
  const restrictionSummary = values.restrictionSummary.trim();
  const followUpPlan = values.followUpPlan.trim();
  const components = [
    restrictionSummary && stringComponent(RESTRICTION_SUMMARY_CODE, 'Restriction summary', restrictionSummary),
    values.reevaluationDate &&
      dateComponent(RESTRICTION_REEVALUATION_DATE_CODE, 'Restriction reevaluation date', values.reevaluationDate),
  ].filter(isDefined);

  return {
    ...observation,
    resourceType: 'Observation',
    status: 'final',
    code: demoCodeableConcept(RETURN_TO_WORK_STATUS_CODE, 'Return-to-work status'),
    subject: createReference(patient),
    encounter: createReference(encounter),
    effectiveDateTime: new Date().toISOString(),
    issued: new Date().toISOString(),
    valueString: values.status,
    component: components.length > 0 ? components : undefined,
    note: followUpPlan ? [{ text: followUpPlan }] : undefined,
  };
}

function stringComponent(
  code: string,
  display: string,
  valueString: string
): NonNullable<Observation['component']>[number] {
  return {
    code: demoCodeableConcept(code, display),
    valueString,
  };
}

function dateComponent(
  code: string,
  display: string,
  valueDateTime: string
): NonNullable<Observation['component']>[number] {
  return {
    code: demoCodeableConcept(code, display),
    valueDateTime,
  };
}

function demoCodeableConcept(code: string, display: string): CodeableConcept {
  return {
    coding: [{ system: DEMO_CODE_SYSTEM, code, display }],
    text: display,
  };
}

function getStringComponentValue(observation: Observation, code: string): string {
  return (
    observation.component?.find((component) => component.code?.coding?.some((coding) => coding.code === code))
      ?.valueString ?? ''
  );
}

function getDateComponentValue(observation: Observation, code: string): string {
  return (
    observation.component
      ?.find((component) => component.code?.coding?.some((coding) => coding.code === code))
      ?.valueDateTime?.split('T')[0] ?? ''
  );
}

function isOccupationalVisitTask(task: Task): boolean {
  const taskText = [task.code?.text, task.description].filter(Boolean).join(' ').toLowerCase();
  return (
    taskText.includes('return-to-work') ||
    taskText.includes('return to work') ||
    taskText.includes('follow-up plan') ||
    taskText.includes('exposure incident history')
  );
}

function uniqueTasks(tasks: WithId<Task>[]): WithId<Task>[] {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    if (!task.id || seen.has(task.id)) {
      return false;
    }
    seen.add(task.id);
    return true;
  });
}

function formatRtwStatus(status: string | undefined): string {
  return RTW_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? 'Not documented';
}

function rtwBadgeColor(status: string | undefined): string {
  if (status === 'full-duty') {
    return 'green';
  }
  if (status === 'restricted-duty') {
    return 'yellow';
  }
  if (status === 'not-fit') {
    return 'red';
  }
  if (status === 'pending-reevaluation') {
    return 'blue';
  }
  return 'gray';
}

function isDefined<T>(value: T | undefined | '' | null): value is T {
  return value !== undefined && value !== null && value !== '';
}
