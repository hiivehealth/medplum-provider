import { ActionIcon, Alert, Anchor, Badge, Button, Group, Loader, Select, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { getDisplayString } from '@medplum/core';
import type { AuditEvent, Consent, Patient, Resource } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconFileText, IconRefresh, IconSearch } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { getHawaiiConsentStatus } from './consent';
import type { HawaiiConsentStatus } from './consent';
import { sortHawaiiRecords } from './clinical';
import { HawaiiDocumentViewer } from './HawaiiDocumentViewer';
import { describeHawaiiAuditEvent } from './audit';
import classes from './HawaiiWorkspace.module.css';

export function HawaiiDiscoveryPage(): JSX.Element {
  const medplum = useMedplum();
  const [query, setQuery] = useState('');
  const [searchBy, setSearchBy] = useState<string | null>('name');
  const [results, setResults] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = async (): Promise<void> => {
    if (loading || query.trim().length < 2) {
      return;
    }
    setLoading(true);
    setError(false);
    setResults([]);
    try {
      setResults(await medplum.searchResources('Patient', {
        [searchBy === 'identifier' ? 'identifier' : 'name']: query.trim(),
        active: 'true', _count: '20', _elements: 'id,name,birthDate',
      }, { cache: 'no-cache' }));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  };

  return (
    <Stack p="md">
      <Title order={2}>Hawaii CQIE Provider Portal</Title>
      <Text c="dimmed" size="sm">Synthetic demonstration</Text>
      <form onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <Group align="end" wrap="wrap">
          <Select label="Search by" data={[{ value: 'name', label: 'Name' }, { value: 'identifier', label: 'Patient identifier' }]}
            value={searchBy} onChange={setSearchBy} allowDeselect={false} disabled={loading} />
          <TextInput label="Patient" value={query} disabled={loading} onChange={(event) => setQuery(event.currentTarget.value)}
            style={{ flex: '1 1 220px' }} />
          <Button type="submit" leftSection={<IconSearch size={16} />} loading={loading} disabled={query.trim().length < 2}>Search</Button>
        </Group>
      </form>
      {error && <Alert color="red" title="Patient search unavailable">The directory could not be queried with your current access.</Alert>}
      {!error && searched && !loading && results.length === 0 && <Text>No matching patients.</Text>}
      {results.length > 0 && <Table.ScrollContainer minWidth={420}><Table>
        <Table.Thead><Table.Tr><Table.Th>Patient</Table.Th><Table.Th>Date of birth</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>{results.map((patient) => <Table.Tr key={patient.id}>
          <Table.Td>{getDisplayString(patient)}</Table.Td><Table.Td>{patient.birthDate ?? 'Not recorded'}</Table.Td>
          <Table.Td><Anchor component={Link} to={`/hie/patients/${patient.id}`}>Review record</Anchor></Table.Td>
        </Table.Tr>)}</Table.Tbody>
      </Table></Table.ScrollContainer>}
    </Stack>
  );
}

export function HawaiiPatientPage(): JSX.Element {
  const { patientId } = useParams();
  if (!patientId) {
    return <Alert color="red">Patient unavailable.</Alert>;
  }
  return <HawaiiPatientRecord key={patientId} patientId={patientId} />;
}

function HawaiiPatientRecord({ patientId }: { patientId: string }): JSX.Element {
  const medplum = useMedplum();
  const [status, setStatus] = useState<HawaiiConsentStatus | 'loading' | 'error'>('loading');
  const [patient, setPatient] = useState<Patient>();
  const [records, setRecords] = useState<Resource[]>([]);
  const [documentId, setDocumentId] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const consents: Consent[] = await medplum.searchResources('Consent', {
          patient: `Patient/${patientId}`, status: 'active', _count: '2',
        }, { cache: 'no-cache' });
        const nextStatus = getHawaiiConsentStatus(consents, patientId);
        if (cancelled) {
          return;
        }
        if (nextStatus !== 'opt-in') {
          setStatus(nextStatus);
          return;
        }
        const [nextPatient, encounters, observations, conditions, documents] = await Promise.all([
          Promise.resolve().then(() => medplum.readResource('Patient', patientId, { cache: 'no-cache' })),
          Promise.resolve().then(() => medplum.searchResources('Encounter', { patient: `Patient/${patientId}`, _count: '50' }, { cache: 'no-cache' })),
          Promise.resolve().then(() => medplum.searchResources('Observation', { patient: `Patient/${patientId}`, _count: '50' }, { cache: 'no-cache' })),
          Promise.resolve().then(() => medplum.searchResources('Condition', { patient: `Patient/${patientId}`, _count: '50' }, { cache: 'no-cache' })),
          Promise.resolve().then(() => medplum.searchResources('DocumentReference', { subject: `Patient/${patientId}`, _count: '50' }, { cache: 'no-cache' })),
        ]);
        if (!cancelled) {
          setPatient(nextPatient);
          setRecords([...encounters, ...observations, ...conditions, ...documents]);
          setStatus('opt-in');
        }
      } catch {
        if (!cancelled) {
          setPatient(undefined);
          setRecords([]);
          setStatus('error');
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [medplum, patientId]);

  if (status === 'loading') {
    return <Loader m="md" aria-label="Checking record access" />;
  }
  if (status !== 'opt-in') {
    const message = {
      'opt-out': 'This patient has opted out of sharing.',
      'not-declared': 'No current sharing permission is available.',
      unsupported: 'This consent policy requires a supported server-side decision.',
      error: 'Record access could not be verified. No clinical record has been displayed.',
    }[status];
    return <Stack p="md"><Anchor component={Link} to="/hie">Patient discovery</Anchor>
      <Alert color="red" title="Record unavailable">{message}</Alert>
    </Stack>;
  }
  return <Stack p="md">
    <Group justify="space-between"><Title order={2}>{patient && getDisplayString(patient)}</Title><Badge color="green">Consent on file</Badge></Group>
    <Text c="dimmed" size="sm">Synthetic demonstration</Text>
    <Anchor component={Link} to="/hie">Patient discovery</Anchor>
    <Title order={3}>Shared clinical record</Title>
    {records.length === 0 ? <Text>No shared clinical entries.</Text> : <Table className={classes.clinicalRecords} style={{ tableLayout: 'fixed', overflowWrap: 'anywhere' }} verticalSpacing="md">
      <Table.Thead>
        <Table.Tr>
          <Table.Th w="25%">Date</Table.Th>
          <Table.Th>Clinical entry</Table.Th>
          <Table.Th w="30%">Source</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>{sortHawaiiRecords(records).map((entry) => {
        const resource = entry.resource;
        return <Table.Tr id={`${resource.resourceType}-${resource.id}`} data-record-time={entry.dateTime} key={`${resource.resourceType}/${resource.id}`}><Table.Td>
          <Text size="sm">{entry.date}</Text>
        </Table.Td><Table.Td>
          <Text c="dimmed" size="xs">{entry.kind}</Text>
          <Text fw={600} size="sm">{entry.label}</Text>
          <Text size="sm">{entry.value}</Text>
          {resource.resourceType === 'DocumentReference' && resource.id && <Tooltip label="View document">
            <ActionIcon variant="subtle" size={32} aria-label={`View ${entry.label}`} onClick={() => setDocumentId(resource.id)}>
              <IconFileText size={18} />
            </ActionIcon>
          </Tooltip>}
        </Table.Td><Table.Td><Text size="sm">{entry.source}</Text></Table.Td></Table.Tr>;
      })}</Table.Tbody>
    </Table>}
    {documentId && <HawaiiDocumentViewer key={documentId} documentId={documentId} patientId={patientId} onClose={() => setDocumentId(undefined)} />}
  </Stack>;
}

export function HawaiiAuditPage(): JSX.Element {
  const medplum = useMedplum();
  const [events, setEvents] = useState<AuditEvent[]>();
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setEvents(undefined);
    setFailed(false);
    medplum.searchResources('AuditEvent', { _sort: '-date', _count: '20' }, { cache: 'no-cache' })
      .then((result) => { if (!cancelled) { setEvents(result); } })
      .catch(() => { if (!cancelled) { setFailed(true); } });
    return () => { cancelled = true; };
  }, [medplum, revision]);
  return <Stack p="md">
    <Group justify="space-between"><Title order={2}>Access activity</Title>
      <Tooltip label="Refresh audit activity"><ActionIcon variant="subtle" aria-label="Refresh audit activity"
        disabled={!events && !failed} onClick={() => setRevision((value) => value + 1)}><IconRefresh size={18} /></ActionIcon></Tooltip>
    </Group>
    {failed ? <Alert color="red" title="Activity unavailable">Your current access could not retrieve audit events.</Alert> :
      !events ? <Loader aria-label="Loading activity" /> : events.length === 0 ? <Text>No visible audit events.</Text> :
        <Stack component="ol" gap={0} m={0} p={0} style={{ listStyle: 'none' }}>{events.map((event) => {
          const entry = describeHawaiiAuditEvent(event);
          return <Stack component="li" key={event.id} gap="xs" py="md" style={{
            borderBottom: '1px solid var(--mantine-color-default-border)', overflowWrap: 'anywhere',
          }}>
            <Group justify="space-between"><Text size="sm">{entry.recorded}</Text>
              <Badge color={entry.outcomeColor}>{entry.outcome}</Badge></Group>
            <Text size="sm" fw={600}>{entry.activity}</Text>
            <Group align="start">
              <Stack gap={4} style={{ flex: '1 1 260px', minWidth: 0 }}>
                <Text size="sm">Action: {entry.action}</Text>
                <Text size="sm">Actor: {entry.actors.length ? entry.actors.join('; ') : 'Not recorded'}</Text>
                <Text size="sm">Observer: {entry.observer}</Text>
              </Stack>
              <Stack gap={4} style={{ flex: '1 1 260px', minWidth: 0 }}>
                <Text size="sm" fw={500}>Recorded resources</Text>
                {entry.resources.length ? entry.resources.map((resource, index) =>
                  <Text key={`${index}-${resource}`} size="sm">{resource}</Text>) : <Text size="sm">Not recorded</Text>}
              </Stack>
            </Group>
            <Text size="xs" c="dimmed">Audit ID: {event.id ?? 'Not recorded'}</Text>
          </Stack>;
        })}</Stack>}
  </Stack>;
}