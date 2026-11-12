// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Anchor, Badge, Button, Group, Loader, Stack, Text } from '@mantine/core';
import { getReferenceString } from '@medplum/core';
import type {
  CodeableConcept,
  Encounter,
  EpisodeOfCare,
  Observation,
  Reference,
  Resource,
  Task,
} from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconClipboardPlus } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { usePatient } from '../../hooks/usePatient';
import classes from './OccupationalSummaryTab.module.css';

const DEMO_CODE_SYSTEM = 'https://hiivecare.example/fhir/CodeSystem/medplum-ubix-demo';
const RTW_STATUS_CODE = 'return-to-work-status';
const RTW_TASK_CODE = 'rtw-follow-up';
const UNKNOWN = 'Not documented';
const CLOSED_TASK_STATUSES = new Set(['completed', 'cancelled', 'failed', 'rejected', 'entered-in-error']);

type OccupationalSummaryState = {
  rtwObservation?: Observation;
  rtwTasks: Task[];
  episodes: EpisodeOfCare[];
  encounters: Encounter[];
};

type RestrictionSummary = {
  type: string;
  summary: string;
  limit: string;
  effectiveDate: string;
  expirationDate: string;
  reevaluationDate: string;
};

export function OccupationalSummaryTab(): JSX.Element {
  const medplum = useMedplum();
  const patient = usePatient();
  const patientReference = useMemo(() => (patient ? getReferenceString(patient) : undefined), [patient]);
  const [summary, setSummary] = useState<OccupationalSummaryState>({ rtwTasks: [], episodes: [], encounters: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const loadSummary = useCallback(async (): Promise<void> => {
    if (!patientReference) {
      return;
    }

    const abortController = new AbortController();
    setLoading(true);
    setError(undefined);

    try {
      const [observations, tasks, episodes, encounters] = await Promise.all([
        medplum.searchResources(
          'Observation',
          new URLSearchParams([
            ['subject', patientReference],
            ['code', `${DEMO_CODE_SYSTEM}|${RTW_STATUS_CODE}`],
            ['_count', '10'],
            ['_sort', '-_lastUpdated'],
          ]),
          { cache: 'no-cache', signal: abortController.signal }
        ),
        medplum.searchResources(
          'Task',
          new URLSearchParams([
            ['patient', patientReference],
            ['_count', '100'],
            ['_sort', '-_lastUpdated'],
          ]),
          { cache: 'no-cache', signal: abortController.signal }
        ),
        medplum.searchResources(
          'EpisodeOfCare',
          new URLSearchParams([
            ['patient', patientReference],
            ['_count', '25'],
            ['_sort', '-_lastUpdated'],
          ]),
          { cache: 'no-cache', signal: abortController.signal }
        ),
        medplum.searchResources(
          'Encounter',
          new URLSearchParams([
            ['subject', patientReference],
            ['_count', '25'],
            ['_sort', '-_lastUpdated'],
          ]),
          { cache: 'no-cache', signal: abortController.signal }
        ),
      ]);

      setSummary({
        rtwObservation: observations.find(isReturnToWorkObservation),
        rtwTasks: tasks.filter(isOpenReturnToWorkTask),
        episodes: episodes.filter(isOccupationalEpisode),
        encounters: encounters.filter(isOccupationalEncounter),
      });
    } catch (err) {
      if (!abortController.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!abortController.signal.aborted) {
        setLoading(false);
      }
    }
  }, [medplum, patientReference]);

  useEffect(() => {
    loadSummary().catch(console.error);
  }, [loadSummary]);

  if (!patient || loading) {
    return <Loader />;
  }

  if (error) {
    return (
      <div className={classes.container}>
        <Alert color="red" title="Occupational summary unavailable">
          {error}
        </Alert>
      </div>
    );
  }

  const restriction = getRestrictionSummary(summary.rtwObservation);
  const rtwStatus = formatReturnToWorkStatus(summary.rtwObservation?.valueString);
  const primaryEpisode = getPrimaryEpisode(summary.episodes, summary.rtwObservation, summary.rtwTasks);
  const primaryEncounter = getPrimaryEncounter(summary.encounters, primaryEpisode);
  const component =
    getReferenceDisplay(primaryEpisode?.managingOrganization) || getReferenceDisplay(primaryEncounter?.serviceProvider);
  const dutyLocation = getReferenceDisplay(primaryEncounter?.location?.[0]?.location);
  const exposureContext = getCodeableConceptText(primaryEpisode?.type?.[0] || primaryEncounter?.type?.[0]);
  const openRtwTaskCount = summary.rtwTasks.length;

  return (
    <div className={classes.container}>
      <div className={classes.actionBar}>
        <div>
          <div className={classes.actionTitle}>Occupational Summary</div>
          <Text c="dimmed" size="sm">
            Exposure case, restrictions, and return-to-work follow-up
          </Text>
        </div>
        <Button
          component={Link}
          leftSection={<IconClipboardPlus size={16} />}
          to={`/Patient/${patient.id}/occupational/incident/new`}
        >
          Report Incident
        </Button>
      </div>
      <div className={classes.summaryGrid}>
        <Metric label="RTW status" value={<ReturnToWorkBadge status={summary.rtwObservation?.valueString} />} />
        <Metric label="Restrictions" value={restriction.summary} detail={restriction.limit} />
        <Metric label="Reevaluation" value={restriction.reevaluationDate} detail={restriction.expirationDate} />
        <Metric label="Open RTW tasks" value={String(openRtwTaskCount)} detail={summary.rtwTasks[0]?.description} />
      </div>

      <div className={classes.panelGrid}>
        <section className={classes.panel}>
          <div className={classes.panelHeader}>
            <div className={classes.panelTitle}>Occupational State</div>
          </div>
          <div className={classes.panelBody}>
            <div className={classes.detailGrid}>
              <Detail label="RTW status" value={rtwStatus} />
              <Detail label="Case" value={exposureContext || UNKNOWN} />
              <Detail label="Work unit" value={component || UNKNOWN} />
              <Detail label="Duty location" value={dutyLocation || UNKNOWN} />
              <Detail label="Restriction type" value={restriction.type} />
              <Detail label="Effective" value={restriction.effectiveDate} />
              <Detail label="Expires" value={restriction.expirationDate} />
              <Detail label="Reevaluation" value={restriction.reevaluationDate} />
            </div>
          </div>
        </section>

        <section className={classes.panel}>
          <div className={classes.panelHeader}>
            <div className={classes.panelTitle}>Source Resources</div>
          </div>
          <div className={classes.panelBody}>
            <div className={classes.sourceList}>
              <ResourceLink
                patientId={patient.id as string}
                resource={summary.rtwObservation}
                label="RTW observation"
              />
              <ResourceLink patientId={patient.id as string} resource={primaryEpisode} label="Case" />
              <ResourceLink patientId={patient.id as string} resource={primaryEncounter} label="Encounter" />
              {summary.rtwTasks[0] && (
                <ResourceLink patientId={patient.id as string} resource={summary.rtwTasks[0]} label="Task" />
              )}
            </div>
          </div>
        </section>
      </div>

      <section className={classes.panel}>
        <div className={classes.panelHeader}>
          <div className={classes.panelTitle}>Work Restrictions</div>
        </div>
        <div className={classes.panelBody}>
          <div className={classes.detailGrid}>
            <Detail label="Summary" value={restriction.summary} />
            <Detail label="Limit" value={restriction.limit} />
          </div>
        </div>
      </section>

      <section className={classes.panel}>
        <div className={classes.panelHeader}>
          <div className={classes.panelTitle}>Open Occupational Tasks</div>
          <Badge variant="light" color={openRtwTaskCount > 0 ? 'blue' : 'gray'}>
            {openRtwTaskCount}
          </Badge>
        </div>
        <div className={classes.panelBody}>
          {summary.rtwTasks.length === 0 ? (
            <div className={classes.emptyState}>No open RTW tasks</div>
          ) : (
            <div className={classes.taskList}>
              {summary.rtwTasks.map((task) => (
                <div className={classes.taskItem} key={task.id}>
                  <Stack gap={2}>
                    <Anchor component={Link} to={`/Patient/${patient.id}/Task/${task.id}`} fw={700}>
                      {getCodeableConceptText(task.code) || task.description || task.id}
                    </Anchor>
                    <Text size="sm" c="dimmed">
                      {task.description || UNKNOWN}
                    </Text>
                  </Stack>
                  <Group gap="xs" justify="flex-end">
                    <Badge variant="light" color={task.priority === 'urgent' ? 'red' : 'gray'}>
                      {formatCode(task.priority)}
                    </Badge>
                    <Badge variant="outline" color="gray">
                      {formatCode(task.status)}
                    </Badge>
                  </Group>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Metric(props: { label: string; value: JSX.Element | string; detail?: string }): JSX.Element {
  return (
    <div className={classes.metric}>
      <div className={classes.metricLabel}>{props.label}</div>
      <div className={classes.metricValue}>{props.value || UNKNOWN}</div>
      {props.detail && <div className={classes.metricDetail}>{props.detail}</div>}
    </div>
  );
}

function Detail(props: { label: string; value?: string }): JSX.Element {
  return (
    <div className={classes.detailItem}>
      <div className={classes.detailLabel}>{props.label}</div>
      <div className={classes.detailValue}>{props.value || UNKNOWN}</div>
    </div>
  );
}

function ResourceLink(props: { patientId: string; resource?: Resource; label: string }): JSX.Element | null {
  const { patientId, resource, label } = props;
  if (!resource?.id) {
    return null;
  }

  return (
    <Badge
      component={Link}
      to={`/Patient/${patientId}/${resource.resourceType}/${resource.id}`}
      variant="light"
      color="gray"
    >
      {label}
    </Badge>
  );
}

function ReturnToWorkBadge(props: { status?: string }): JSX.Element {
  const colorByStatus: Record<string, string> = {
    'full-duty': 'green',
    'restricted-duty': 'yellow',
    'not-fit': 'red',
    'pending-reevaluation': 'blue',
  };
  const color = props.status ? colorByStatus[props.status] || 'gray' : 'gray';
  return (
    <Badge color={color} variant="light">
      {formatReturnToWorkStatus(props.status)}
    </Badge>
  );
}

function getRestrictionSummary(observation: Observation | undefined): RestrictionSummary {
  return {
    type: getComponentValue(observation, 'restriction-type'),
    summary: getComponentValue(observation, 'restriction-summary'),
    limit: getComponentValue(observation, 'restriction-limit'),
    effectiveDate: formatDate(getComponentValue(observation, 'restriction-effective-date')),
    expirationDate: formatDate(getComponentValue(observation, 'restriction-expiration-date')),
    reevaluationDate: formatDate(getComponentValue(observation, 'restriction-reevaluation-date')),
  };
}

function getComponentValue(observation: Observation | undefined, code: string): string {
  const component = observation?.component?.find((candidate) => firstCodingCode(candidate.code) === code);
  if (!component) {
    return UNKNOWN;
  }
  if (component.valueString) {
    return component.valueString;
  }
  if (component.valueDateTime) {
    return component.valueDateTime;
  }
  if (component.valueCodeableConcept) {
    return getCodeableConceptText(component.valueCodeableConcept);
  }
  return UNKNOWN;
}

function isReturnToWorkObservation(observation: Observation): boolean {
  return firstCodingCode(observation.code) === RTW_STATUS_CODE;
}

function isOpenReturnToWorkTask(task: Task): boolean {
  return firstCodingCode(task.code) === RTW_TASK_CODE && !CLOSED_TASK_STATUSES.has(task.status);
}

function isOccupationalEpisode(episode: EpisodeOfCare): boolean {
  return Boolean(episode.type?.some((type) => type.coding?.some((coding) => coding.system === DEMO_CODE_SYSTEM)));
}

function isOccupationalEncounter(encounter: Encounter): boolean {
  return Boolean(encounter.type?.some((type) => type.coding?.some((coding) => coding.system === DEMO_CODE_SYSTEM)));
}

function getPrimaryEpisode(
  episodes: EpisodeOfCare[],
  observation: Observation | undefined,
  tasks: Task[]
): EpisodeOfCare | undefined {
  const focusedEpisodeReference = observation?.focus?.find((reference) =>
    reference.reference?.startsWith('EpisodeOfCare/')
  );
  const taskEpisodeReference = tasks.find((task) => task.focus?.reference?.startsWith('EpisodeOfCare/'))?.focus;
  const preferredReference = focusedEpisodeReference?.reference || taskEpisodeReference?.reference;
  return episodes.find((episode) => getReferenceString(episode) === preferredReference) || episodes[0];
}

function getPrimaryEncounter(encounters: Encounter[], episode: EpisodeOfCare | undefined): Encounter | undefined {
  if (!episode) {
    return encounters[0];
  }
  const episodeTypeCode = firstCodingCode(episode.type?.[0]);
  return encounters.find((encounter) => firstCodingCode(encounter.type?.[0]) === episodeTypeCode) || encounters[0];
}

function firstCodingCode(codeableConcept: CodeableConcept | undefined): string | undefined {
  return codeableConcept?.coding?.[0]?.code;
}

function getCodeableConceptText(codeableConcept: CodeableConcept | undefined): string {
  return codeableConcept?.text || codeableConcept?.coding?.find((coding) => coding.display)?.display || UNKNOWN;
}

function getReferenceDisplay(reference: Reference | undefined): string | undefined {
  return reference?.display || reference?.reference;
}

function formatReturnToWorkStatus(status: string | undefined): string {
  if (!status) {
    return UNKNOWN;
  }
  return status
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatCode(value: string | undefined): string {
  return value ? value.replaceAll('-', ' ') : UNKNOWN;
}

function formatDate(value: string | undefined): string {
  if (!value || value === UNKNOWN) {
    return UNKNOWN;
  }
  return value.split('T')[0];
}
