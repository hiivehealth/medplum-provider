import { ActionIcon, Card, Group, Loader, Select, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import type { AuditEvent } from '@medplum/fhirtypes';
import { useSearchResources } from '@medplum/react';
import { IconDownload } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useState } from 'react';

const CALIFORNIA_DEMO_TAG_SYSTEM = 'https://hiivehealth.com/fhir/identifier/california-hie-demo';
const ACTION_OPTIONS = [
  { label: 'All actions', value: 'all' },
  { label: 'Chart viewed', value: 'record-view' },
  { label: 'Source filtered', value: 'source-filter' },
  { label: 'Document viewed', value: 'document-view' },
  { label: 'Printed', value: 'print' },
  { label: 'Exported', value: 'export' },
];

export function CaliforniaViewerAuditPage(): JSX.Element {
  const [action, setAction] = useState('all');
  const [actor, setActor] = useState('');
  const [patient, setPatient] = useState('');
  const [source, setSource] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [events = [], loading] = useSearchResources(
    'AuditEvent',
    { _count: '100' },
    { cacheTime: 0 }
  );
  const filteredEvents = events
    .filter((event) => isCaliforniaViewerEvent(event))
    .filter((event) => {
      const eventAction = getEventDetail(event, 'viewer-action');
      const eventSource = getEventDetail(event, 'source-selection');
      const eventActor = event.agent?.[0]?.who?.display ?? event.agent?.[0]?.who?.reference ?? '';
      const eventPatient = event.entity?.[0]?.what?.reference ?? '';
      const recordedDate = event.recorded?.slice(0, 10) ?? '';
      return (
        (action === 'all' || eventAction === action) &&
        includesText(eventActor, actor) &&
        includesText(eventPatient, patient) &&
        includesText(eventSource, source) &&
        (!fromDate || recordedDate >= fromDate) &&
        (!toDate || recordedDate <= toDate)
      );
    });

  return (
    <Stack p="md" gap="md">
      <Group justify="space-between">
        <div>
          <Title order={2}>California HIE Viewer Audit</Title>
          <Text size="sm" c="dimmed">
            Synthetic demonstration activity
          </Text>
        </div>
        <Tooltip label="Download filtered audit report" position="bottom" openDelay={500}>
          <ActionIcon
            aria-label="Download filtered audit report"
            component="a"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(toCsv(filteredEvents))}`}
            download="california-hie-viewer-audit.csv"
            variant="default"
          >
            <IconDownload size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Card withBorder padding="md">
        <Group align="end" grow>
          <Select label="Action" data={ACTION_OPTIONS} value={action} onChange={(value) => setAction(value ?? 'all')} />
          <TextInput label="Actor" value={actor} onChange={(event) => setActor(event.currentTarget.value)} />
          <TextInput
            label="Patient or resource"
            value={patient}
            onChange={(event) => setPatient(event.currentTarget.value)}
          />
          <TextInput
            label="Source organization"
            value={source}
            onChange={(event) => setSource(event.currentTarget.value)}
          />
          <TextInput
            label="From date"
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.currentTarget.value)}
          />
          <TextInput
            label="To date"
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.currentTarget.value)}
          />
        </Group>
      </Card>

      {loading ? (
        <Loader />
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Recorded</Table.Th>
              <Table.Th>Action</Table.Th>
              <Table.Th>Actor</Table.Th>
              <Table.Th>Patient or resource</Table.Th>
              <Table.Th>Source</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filteredEvents.map((event) => (
              <Table.Tr key={event.id}>
                <Table.Td>{event.recorded}</Table.Td>
                <Table.Td>{getEventDetail(event, 'viewer-action')}</Table.Td>
                <Table.Td>{event.agent?.[0]?.who?.display ?? event.agent?.[0]?.who?.reference}</Table.Td>
                <Table.Td>{event.entity?.[0]?.what?.reference}</Table.Td>
                <Table.Td>{getEventDetail(event, 'source-selection')}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

function isCaliforniaViewerEvent(event: AuditEvent): boolean {
  return (
    event.meta?.tag?.some((tag) => tag.system === CALIFORNIA_DEMO_TAG_SYSTEM && tag.code === 'viewer-audit') ?? false
  );
}

function getEventDetail(event: AuditEvent, type: string): string {
  return event.entity?.[0]?.detail?.find((detail) => detail.type === type)?.valueString ?? '';
}

function includesText(value: string, filter: string): boolean {
  return !filter || value.toLocaleLowerCase().includes(filter.toLocaleLowerCase());
}

function toCsv(events: AuditEvent[]): string {
  const rows = events.map((event) => [
    event.recorded ?? '',
    getEventDetail(event, 'viewer-action'),
    event.agent?.[0]?.who?.display ?? event.agent?.[0]?.who?.reference ?? '',
    event.entity?.[0]?.what?.reference ?? '',
    getEventDetail(event, 'source-selection'),
  ]);
  return [['Recorded', 'Action', 'Actor', 'Patient or resource', 'Source'], ...rows]
    .map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(','))
    .join('\n');
}
