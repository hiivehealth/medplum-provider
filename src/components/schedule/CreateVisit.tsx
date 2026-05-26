// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Flex, Stack, Text, Title } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { getDisplayString, getReferenceString } from '@medplum/core';
import type { Coding, Patient, PlanDefinition, Practitioner, Reference, Schedule } from '@medplum/fhirtypes';
import type { AsyncAutocompleteOption } from '@medplum/react';
import {
  AsyncAutocomplete,
  CodingInput,
  DateTimeInput,
  Form,
  ResourceAvatar,
  ResourceInput,
  useMedplum,
} from '@medplum/react';
import { IconAlertSquareRounded, IconCircleCheck, IconCirclePlus } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Range } from '../../types/scheduling';
import { createAppointment, createEncounter } from '../../utils/encounter';
import { showErrorNotification } from '../../utils/notifications';
import { PlanDefinitionSummary } from '../plandefinition/PlanDefinitionSummary';

interface CreateVisitProps {
  appointmentSlot: Range | undefined;
  practitioner: Reference<Practitioner>;
  schedule?: Schedule;
}

const PATIENT_SEARCH_RESULT_COUNT = '50';
const BIRTH_YEAR_PATTERN = /\b(?:19|20)\d{2}\b/;
const EMPLOYEE_ID_PATTERN = /\bEMP-[A-Z0-9-]+\b/i;

export function CreateVisit(props: CreateVisitProps): JSX.Element {
  const { appointmentSlot, schedule } = props;
  const [patient, setPatient] = useState<Patient | undefined>();
  const [planDefinitionData, setPlanDefinitionData] = useState<PlanDefinition | undefined>();
  const [encounterClass, setEncounterClass] = useState<Coding | undefined>();
  const [start, setStart] = useState(appointmentSlot?.start);
  const [end, setEnd] = useState(appointmentSlot?.end);
  const [isLoading, setIsLoading] = useState(false);
  const medplum = useMedplum();
  const navigate = useNavigate();

  const loadPatients = useCallback(
    async (input: string, signal: AbortSignal): Promise<Patient[]> => {
      const search = parsePatientSearch(input);
      const searchParams = new URLSearchParams({ _count: PATIENT_SEARCH_RESULT_COUNT });

      if (search.employeeId) {
        searchParams.set('identifier', search.employeeId);
      } else if (search.birthYear && !search.nameQuery) {
        searchParams.set('birthdate', search.birthYear);
      } else {
        searchParams.set('name', search.nameQuery);
      }

      const patients = await medplum.searchResources('Patient', searchParams, { signal });
      return rankPatients(patients, search);
    },
    [medplum]
  );

  const [formattedDate, formattedSlotTime] = useMemo(() => {
    if (!appointmentSlot) {
      return ['', ''];
    }

    const startDate = new Date(appointmentSlot?.start);
    const endDate = new Date(appointmentSlot?.end);

    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    };
    const dateStr = startDate.toLocaleDateString('en-US', options);

    const timeOptions: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: 'numeric', hour12: true };
    const startTimeStr = startDate.toLocaleTimeString('en-US', timeOptions);
    const endTimeStr = endDate.toLocaleTimeString('en-US', timeOptions);

    const formattedTime = `${startTimeStr} – ${endTimeStr}`;
    return [dateStr, formattedTime];
  }, [appointmentSlot]);

  async function handleSubmit(): Promise<void> {
    if (!patient || !planDefinitionData || !encounterClass || !start || !end) {
      showNotification({
        color: 'yellow',
        icon: <IconAlertSquareRounded />,
        title: 'Error',
        message: 'Please fill out required fields.',
      });
      return;
    }
    setIsLoading(true);
    try {
      const appointment = await createAppointment(medplum, start, end, patient, props.practitioner, schedule);
      const encounter = await createEncounter(
        medplum,
        encounterClass,
        patient,
        planDefinitionData,
        appointment,
        props.practitioner
      );
      showNotification({ icon: <IconCircleCheck />, title: 'Success', message: 'Visit created' });
      navigate(`/Patient/${patient.id}/Encounter/${encounter.id}`)?.catch(console.error);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form onSubmit={handleSubmit}>
      <Flex direction="column" gap="md" h="100%" justify="space-between">
        <Stack gap="md" h="100%">
          <Stack gap={0}>
            <Title order={1} fw={500}>
              {formattedDate}
            </Title>
            <Text size="lg">{formattedSlotTime}</Text>
          </Stack>

          <ResourceInput
            label="Practitioner"
            resourceType="Practitioner"
            name="Practitioner-id"
            required={true}
            defaultValue={props.practitioner}
            disabled={true}
          />

          <AsyncAutocomplete<Patient>
            label="Patient"
            name="Patient-id"
            placeholder="Search patients by name, birth year, or employee ID"
            required={true}
            maxValues={1}
            clearable={true}
            loadOptions={loadPatients}
            toOption={patientToOption}
            itemComponent={PatientSearchOption}
            onChange={(values) => setPatient(values[0])}
          />

          <DateTimeInput
            name="start"
            label="Start Time"
            defaultValue={appointmentSlot?.start?.toISOString()}
            required={true}
            onChange={(value) => {
              setStart(new Date(value));
            }}
          />

          <DateTimeInput
            name="end"
            label="End Time"
            defaultValue={appointmentSlot?.end?.toISOString()}
            required={true}
            onChange={(value) => {
              setEnd(new Date(value));
            }}
          />

          <CodingInput
            name="class"
            label="Class"
            binding="http://terminology.hl7.org/ValueSet/v3-ActEncounterCode"
            required={true}
            onChange={setEncounterClass}
            path="Encounter.type"
          />

          <ResourceInput
            name="plandefinition"
            resourceType="PlanDefinition"
            label="Care template"
            placeholder="Search care templates"
            onChange={(value) => {
              setPlanDefinitionData(value as PlanDefinition);
            }}
            required={true}
          />
        </Stack>

        <PlanDefinitionSummary planDefinition={planDefinitionData} />

        <Button fullWidth mt="xl" type="submit" loading={isLoading} disabled={isLoading}>
          <IconCirclePlus /> <Text ml="xs">Create Visit</Text>
        </Button>
      </Flex>
    </Form>
  );
}

interface PatientSearchCriteria {
  nameQuery: string;
  birthYear?: string;
  employeeId?: string;
}

function parsePatientSearch(input: string): PatientSearchCriteria {
  const trimmedInput = input.trim();
  const birthYear = trimmedInput.match(BIRTH_YEAR_PATTERN)?.[0];
  const employeeId = trimmedInput.match(EMPLOYEE_ID_PATTERN)?.[0];
  const nameQuery = employeeId ? '' : trimmedInput.replace(BIRTH_YEAR_PATTERN, '').trim();
  return { nameQuery, birthYear, employeeId };
}

function rankPatients(patients: Patient[], search: PatientSearchCriteria): Patient[] {
  if (!search.birthYear) {
    return patients;
  }

  const birthYear = search.birthYear;
  return [...patients].sort((left, right) => getBirthYearRank(left, birthYear) - getBirthYearRank(right, birthYear));
}

function getBirthYearRank(patient: Patient, birthYear: string): number {
  if (patient.birthDate?.startsWith(birthYear)) {
    return 0;
  }
  return 1;
}

function patientToOption(patient: Patient): AsyncAutocompleteOption<Patient> {
  const label = getDisplayString(patient);
  return {
    value: getReferenceString(patient) ?? label,
    label,
    resource: patient,
  };
}

function PatientSearchOption(props: AsyncAutocompleteOption<Patient>): JSX.Element {
  const patient = props.resource;
  const employeeId = getEmployeeIdentifier(patient);
  const details = [patient.birthDate, employeeId].filter(Boolean).join(' | ');

  return (
    <Flex align="center" gap="sm" wrap="nowrap">
      <ResourceAvatar value={patient} />
      <Stack gap={0}>
        <Text>{props.label}</Text>
        {details && (
          <Text size="xs" c="dimmed">
            {details}
          </Text>
        )}
      </Stack>
    </Flex>
  );
}

function getEmployeeIdentifier(patient: Patient): string | undefined {
  return patient.identifier?.find((identifier) => identifier.value?.toUpperCase().startsWith('EMP-'))?.value;
}
