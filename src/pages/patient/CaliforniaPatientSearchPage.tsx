import { Anchor, Badge, Card, Group, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import type { Patient } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useState } from 'react';
import { Link } from 'react-router';

const CALIFORNIA_IDENTIFIER_PREFIX = 'https://hiivehealth.com/fhir/identifier/california-demo-org-';
const RECENT_PATIENTS_KEY = 'california-hie-recent-patients';

const SOURCE_OPTIONS = [
  { label: 'All contributing sources', value: 'all' },
  { label: 'Bay Care Network', value: `${CALIFORNIA_IDENTIFIER_PREFIX}bay-care` },
  { label: 'Central Valley Community Health', value: `${CALIFORNIA_IDENTIFIER_PREFIX}central-valley` },
  { label: 'Sierra Wellness Medical Group', value: `${CALIFORNIA_IDENTIFIER_PREFIX}sierra-wellness` },
];

type RecentPatient = { id: string; name: string; sourceNames: string[] };

const CALIFORNIA_DEMO_PATIENTS: Patient[] = [
  {
    resourceType: 'Patient',
    id: 'fa57edfe-a1a2-42bd-9295-0b310154e4c9',
    name: [{ given: ['Maya'], family: 'Chen' }],
    birthDate: '1982-04-18',
    identifier: [
      { system: `${CALIFORNIA_IDENTIFIER_PREFIX}bay-care`, value: 'MAYA-1982-0418', assigner: { display: 'Bay Care Network' } },
      { system: `${CALIFORNIA_IDENTIFIER_PREFIX}central-valley`, value: 'MAYA-1982-0418', assigner: { display: 'Central Valley Community Health' } },
      { system: `${CALIFORNIA_IDENTIFIER_PREFIX}sierra-wellness`, value: 'MAYA-1982-0418', assigner: { display: 'Sierra Wellness Medical Group' } },
    ],
  },
  {
    resourceType: 'Patient',
    id: '3c9b6e55-38a0-4cdf-9c5d-d18aad408f64',
    name: [{ given: ['Elena'], family: 'Ramirez' }],
    birthDate: '1971-09-22',
    identifier: [
      { system: `${CALIFORNIA_IDENTIFIER_PREFIX}bay-care`, value: 'ELENA-1971-0922', assigner: { display: 'Bay Care Network' } },
    ],
  },
];

export function CaliforniaPatientSearchPage(): JSX.Element {
  const [given, setGiven] = useState('');
  const [family, setFamily] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [source, setSource] = useState('all');
  const [recentPatients, setRecentPatients] = useState(getRecentPatients);
  const hasCriteria = Boolean(given || family || birthDate || identifier);
  const patients = CALIFORNIA_DEMO_PATIENTS.filter(
    (patient) =>
      includesIgnoreCase(patient.name?.[0]?.given?.join(' '), given) &&
      includesIgnoreCase(patient.name?.[0]?.family, family) &&
      (!birthDate || patient.birthDate === birthDate) &&
      patient.identifier?.some(
        (patientIdentifier) =>
          (source === 'all' || patientIdentifier.system === source) &&
          includesIgnoreCase(patientIdentifier.value, identifier)
      )
  );

  const handlePatientOpen = (patient: Patient): void => {
    const recentPatient = {
      id: patient.id ?? '',
      name: getPatientName(patient),
      sourceNames: getSourceNames(patient),
    };
    const updatedPatients = [recentPatient, ...recentPatients.filter((item) => item.id !== patient.id)].slice(0, 5);
    setRecentPatients(updatedPatients);
    localStorage.setItem(RECENT_PATIENTS_KEY, JSON.stringify(updatedPatients));
  };

  return (
    <Stack p="md" gap="md">
      <div>
        <Title order={2}>California HIE Patient Search</Title>
        <Text size="sm" c="dimmed">
          Synthetic demonstration records
        </Text>
      </div>

      <Card withBorder padding="md">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          <TextInput label="Given name" value={given} onChange={(event) => setGiven(event.currentTarget.value)} />
          <TextInput label="Family name" value={family} onChange={(event) => setFamily(event.currentTarget.value)} />
          <TextInput
            label="Birth date"
            type="date"
            value={birthDate}
            onChange={(event) => setBirthDate(event.currentTarget.value)}
          />
          <TextInput
            label="Patient identifier"
            value={identifier}
            onChange={(event) => setIdentifier(event.currentTarget.value)}
          />
          <Select
            label="Identifier source"
            data={SOURCE_OPTIONS}
            value={source}
            onChange={(value) => setSource(value ?? 'all')}
          />
        </SimpleGrid>
      </Card>

      {hasCriteria && (
        <Stack gap="xs">
          <Title order={3}>Search results</Title>
          {patients.length === 0 ? (
            <Text c="dimmed">No matching synthetic demonstration records.</Text>
          ) : (
            patients.map((patient) => <PatientResult key={patient.id} patient={patient} onOpen={handlePatientOpen} />)
          )}
        </Stack>
      )}

      {!hasCriteria && recentPatients.length > 0 && (
        <Stack gap="xs">
          <Title order={3}>Recently viewed</Title>
          {recentPatients.map((patient) => (
            <Group key={patient.id} justify="space-between">
              <Anchor component={Link} to={`/Patient/${patient.id}/california-viewer`}>
                {patient.name}
              </Anchor>
              <SourceBadges sourceNames={patient.sourceNames} />
            </Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function PatientResult({ patient, onOpen }: { patient: Patient; onOpen: (patient: Patient) => void }): JSX.Element {
  const sourceNames = getSourceNames(patient);
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" align="center">
        <div>
          <Anchor component={Link} to={`/Patient/${patient.id}/california-viewer`} onClick={() => onOpen(patient)}>
            {getPatientName(patient)}
          </Anchor>
          <Text size="sm" c="dimmed">
            {patient.birthDate ?? 'Birth date unavailable'}
          </Text>
        </div>
        <SourceBadges sourceNames={sourceNames} />
      </Group>
    </Card>
  );
}

function SourceBadges({ sourceNames }: { sourceNames: string[] }): JSX.Element {
  return (
    <Group gap="xs">
      {sourceNames.map((sourceName) => (
        <Badge key={sourceName} variant="light">
          {sourceName}
        </Badge>
      ))}
    </Group>
  );
}

function getPatientName(patient: Patient): string {
  const name = patient.name?.[0];
  return [name?.given?.join(' '), name?.family].filter(Boolean).join(' ') || 'Unnamed patient';
}

function includesIgnoreCase(value: string | undefined, searchValue: string): boolean {
  return !searchValue || value?.toLocaleLowerCase().includes(searchValue.toLocaleLowerCase()) === true;
}

function getSourceNames(patient: Patient): string[] {
  return (patient.identifier ?? [])
      .filter((identifier) => identifier.system?.startsWith(CALIFORNIA_IDENTIFIER_PREFIX))
      .map((identifier) => identifier.assigner?.display ?? identifier.assigner?.reference ?? 'Unknown source') ?? []
}

function getRecentPatients(): RecentPatient[] {
  try {
    const storedPatients = localStorage.getItem(RECENT_PATIENTS_KEY);
    return storedPatients ? (JSON.parse(storedPatients) as RecentPatient[]) : [];
  } catch {
    return [];
  }
}
