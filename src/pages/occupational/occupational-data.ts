// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import { getReferenceString } from '@medplum/core';
import type {
  CodeableConcept,
  Encounter,
  EpisodeOfCare,
  Location as FhirLocation,
  Observation,
  Patient,
  Reference,
  Task,
} from '@medplum/fhirtypes';

export const DEMO_CODE_SYSTEM = 'https://hiivecare.example/fhir/CodeSystem/medplum-ubix-demo';
export const EXPOSURE_INCIDENT_CODE = 'exposure-incident';
export const RETURN_TO_WORK_STATUS_CODE = 'return-to-work-status';
export const RTW_FOLLOW_UP_TASK_CODE = 'rtw-follow-up';
export const UNKNOWN = 'Not documented';

const CLOSED_TASK_STATUSES = new Set(['completed', 'cancelled', 'failed', 'rejected', 'entered-in-error']);

export type OccupationalData = {
  locations: FhirLocation[];
  encounters: Encounter[];
  episodes: EpisodeOfCare[];
  observations: Observation[];
  tasks: Task[];
  patientsByReference: Record<string, Patient>;
};

export type EmployeeExposureRow = {
  patientReference: string;
  patientId?: string;
  patientName: string;
  component: string;
  dutyLocation: string;
  rtwStatus: string;
  rtwStatusCode?: string;
  restrictionSummary: string;
  reevaluationDate: string;
  notificationStatus: string;
  openTaskCount: number;
  caseStatus: string;
  episodeId?: string;
  encounterId?: string;
  taskId?: string;
};

export type LocationExposureSummary = {
  key: string;
  locationName: string;
  locationReference?: string;
  component: string;
  affectedEmployeeCount: number;
  activeCaseCount: number;
  openTaskCount: number;
  latestIncidentDate: string;
  statusCounts: Record<string, number>;
  employeeRows: EmployeeExposureRow[];
};

export async function fetchOccupationalData(medplum: MedplumClient): Promise<OccupationalData> {
  const [locations, encounters, episodes, observations, tasks] = await Promise.all([
    medplum.searchResources('Location', new URLSearchParams({ _count: '100', _sort: 'name' }), { cache: 'no-cache' }),
    medplum.searchResources(
      'Encounter',
      new URLSearchParams({
        type: `${DEMO_CODE_SYSTEM}|${EXPOSURE_INCIDENT_CODE}`,
        _count: '200',
        _sort: '-_lastUpdated',
      }),
      { cache: 'no-cache' }
    ),
    medplum.searchResources(
      'EpisodeOfCare',
      new URLSearchParams({
        type: `${DEMO_CODE_SYSTEM}|${EXPOSURE_INCIDENT_CODE}`,
        _count: '200',
        _sort: '-_lastUpdated',
      }),
      { cache: 'no-cache' }
    ),
    medplum.searchResources(
      'Observation',
      new URLSearchParams({
        code: `${DEMO_CODE_SYSTEM}|${RETURN_TO_WORK_STATUS_CODE}`,
        _count: '200',
        _sort: '-_lastUpdated',
      }),
      { cache: 'no-cache' }
    ),
    medplum.searchResources(
      'Task',
      new URLSearchParams({
        code: `${DEMO_CODE_SYSTEM}|${RTW_FOLLOW_UP_TASK_CODE}`,
        _count: '200',
        _sort: '-_lastUpdated',
      }),
      { cache: 'no-cache' }
    ),
  ]);

  const patientReferences = unique(
    [
      ...encounters.map((encounter) => encounter.subject?.reference),
      ...episodes.map((episode) => episode.patient?.reference),
      ...observations.map((observation) => observation.subject?.reference),
      ...tasks.map((task) => task.for?.reference),
    ].filter(isDefined)
  );

  const patientsByReference: Record<string, Patient> = {};
  await Promise.all(
    patientReferences.map(async (patientReference) => {
      const [, patientId] = patientReference.split('/');
      if (!patientId) {
        return;
      }
      try {
        patientsByReference[patientReference] = await medplum.readResource('Patient', patientId);
      } catch {
        patientsByReference[patientReference] = { resourceType: 'Patient', id: patientId };
      }
    })
  );

  return { locations, encounters, episodes, observations, tasks, patientsByReference };
}

export function buildLocationExposureSummaries(data: OccupationalData): LocationExposureSummary[] {
  const exposureEncounters = data.encounters.filter(isExposureEncounter);
  const locationsByReference = new Map(data.locations.map((location) => [`Location/${location.id}`, location]));
  const encountersByLocation = new Map<string, Encounter[]>();

  for (const encounter of exposureEncounters) {
    const locationReference = encounter.location?.[0]?.location;
    const key = locationReference?.reference || locationReference?.display || 'unknown-location';
    const existing = encountersByLocation.get(key) || [];
    existing.push(encounter);
    encountersByLocation.set(key, existing);
  }

  return Array.from(encountersByLocation.entries())
    .map(([key, encounters]) => {
      const locationReference = encounters[0]?.location?.[0]?.location;
      const location = locationReference?.reference ? locationsByReference.get(locationReference.reference) : undefined;
      const employeeRows = unique(encounters.map((encounter) => encounter.subject?.reference).filter(isDefined)).map(
        (patientReference) => buildEmployeeExposureRow(patientReference, data, encounters, location, locationReference)
      );
      const statusCounts = countBy(employeeRows.map((row) => row.rtwStatus));

      return {
        key,
        locationName: getReferenceDisplay(locationReference) || location?.name || UNKNOWN,
        locationReference: locationReference?.reference,
        component: getReferenceDisplay(location?.managingOrganization) || employeeRows[0]?.component || UNKNOWN,
        affectedEmployeeCount: employeeRows.length,
        activeCaseCount: employeeRows.filter((row) => row.caseStatus === 'active').length,
        openTaskCount: employeeRows.reduce((sum, row) => sum + row.openTaskCount, 0),
        latestIncidentDate: latestDate(
          encounters.map((encounter) => encounter.period?.start || encounter.meta?.lastUpdated)
        ),
        statusCounts,
        employeeRows,
      } satisfies LocationExposureSummary;
    })
    .sort(
      (left, right) =>
        right.affectedEmployeeCount - left.affectedEmployeeCount || left.locationName.localeCompare(right.locationName)
    );
}

export function buildSupervisorRows(data: OccupationalData): EmployeeExposureRow[] {
  return buildLocationExposureSummaries(data)
    .flatMap((summary) => summary.employeeRows)
    .sort((left, right) => left.patientName.localeCompare(right.patientName));
}

function buildEmployeeExposureRow(
  patientReference: string,
  data: OccupationalData,
  locationEncounters: Encounter[],
  location: FhirLocation | undefined,
  locationReference: Reference | undefined
): EmployeeExposureRow {
  const patient = data.patientsByReference[patientReference];
  const patientEncounter = locationEncounters.find((encounter) => encounter.subject?.reference === patientReference);
  const episode = data.episodes.find(
    (candidate) => candidate.patient?.reference === patientReference && isExposureEpisode(candidate)
  );
  const observation = data.observations.find(
    (candidate) => candidate.subject?.reference === patientReference && isRtwObservation(candidate)
  );
  const openTasks = data.tasks.filter(
    (candidate) => candidate.for?.reference === patientReference && isOpenRtwTask(candidate)
  );
  const patientId = patientReference.split('/')[1];

  return {
    patientReference,
    patientId,
    patientName: formatPatientName(patient) || patientReference,
    component:
      getReferenceDisplay(location?.managingOrganization) ||
      getReferenceDisplay(episode?.managingOrganization) ||
      UNKNOWN,
    dutyLocation: getReferenceDisplay(locationReference) || location?.name || UNKNOWN,
    rtwStatus: formatRtwStatus(observation?.valueString),
    rtwStatusCode: observation?.valueString,
    restrictionSummary: getComponentValue(observation, 'restriction-summary'),
    reevaluationDate: formatDate(getComponentValue(observation, 'restriction-reevaluation-date')),
    notificationStatus: openTasks.length > 0 ? `${openTasks.length} follow-up open` : 'No open follow-up',
    openTaskCount: openTasks.length,
    caseStatus: episode?.status || UNKNOWN,
    episodeId: episode?.id,
    encounterId: patientEncounter?.id,
    taskId: openTasks[0]?.id,
  };
}

export function isExposureEncounter(encounter: Encounter): boolean {
  return Boolean(encounter.type?.some((type) => hasDemoCode(type, EXPOSURE_INCIDENT_CODE)));
}

export function isExposureEpisode(episode: EpisodeOfCare): boolean {
  return Boolean(episode.type?.some((type) => hasDemoCode(type, EXPOSURE_INCIDENT_CODE)));
}

export function isRtwObservation(observation: Observation): boolean {
  return hasDemoCode(observation.code, RETURN_TO_WORK_STATUS_CODE);
}

export function isOpenRtwTask(task: Task): boolean {
  return hasDemoCode(task.code, RTW_FOLLOW_UP_TASK_CODE) && !CLOSED_TASK_STATUSES.has(task.status);
}

export function formatRtwStatus(status: string | undefined): string {
  if (!status) {
    return UNKNOWN;
  }
  return status
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatPatientName(patient: Patient | undefined): string | undefined {
  const name = patient?.name?.[0];
  if (!name) {
    return undefined;
  }
  return [name.given?.join(' '), name.family].filter(Boolean).join(' ');
}

export function getComponentValue(observation: Observation | undefined, code: string): string {
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

export function getCodeableConceptText(codeableConcept: CodeableConcept | undefined): string {
  return codeableConcept?.text || codeableConcept?.coding?.find((coding) => coding.display)?.display || UNKNOWN;
}

export function getReferenceDisplay(reference: Reference | undefined): string | undefined {
  return reference?.display || reference?.reference;
}

export function rtwBadgeColor(statusCode: string | undefined): string {
  if (statusCode === 'full-duty') {
    return 'green';
  }
  if (statusCode === 'restricted-duty') {
    return 'yellow';
  }
  if (statusCode === 'not-fit') {
    return 'red';
  }
  if (statusCode === 'pending-reevaluation') {
    return 'blue';
  }
  return 'gray';
}

function hasDemoCode(codeableConcept: CodeableConcept | undefined, code: string): boolean {
  return Boolean(codeableConcept?.coding?.some((coding) => coding.system === DEMO_CODE_SYSTEM && coding.code === code));
}

function firstCodingCode(codeableConcept: CodeableConcept | undefined): string | undefined {
  return codeableConcept?.coding?.[0]?.code;
}

function formatDate(value: string): string {
  if (!value || value === UNKNOWN) {
    return UNKNOWN;
  }
  return value.split('T')[0];
}

function latestDate(values: (string | undefined)[]): string {
  const dates = values.filter(isDefined).sort().reverse();
  return dates[0]?.split('T')[0] || UNKNOWN;
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

export function resourcePath(resourceType: string, id: string | undefined): string | undefined {
  if (!id) {
    return undefined;
  }
  return `/${resourceType}/${id}`;
}

export function patientPath(patientId: string | undefined, suffix = ''): string | undefined {
  if (!patientId) {
    return undefined;
  }
  return `/Patient/${patientId}${suffix}`;
}

export function referenceForResource(resource: { resourceType: string; id?: string }): string | undefined {
  return resource.id ? getReferenceString(resource) : undefined;
}
