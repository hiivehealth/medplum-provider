// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  Alert,
  Button,
  Group,
  Loader,
  Select,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import type { Encounter } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { getRosterMembership } from '../../utils/roster';
import { useRosterEncounters } from '../../hooks/useRosterEncounters';
import classes from './RosterDashboardPage.module.css';

const DAY_OPTIONS = [
  { value: '30', label: 'Last 30 days' },
  { value: '60', label: 'Last 60 days' },
  { value: '90', label: 'Last 90 days' },
];

const CLASS_OPTIONS = [
  { value: '', label: 'All visit types' },
  { value: 'AMB', label: 'Ambulatory' },
  { value: 'EMER', label: 'Emergency' },
  { value: 'IMP', label: 'Inpatient' },
  { value: 'HH', label: 'Home health' },
];

function formatEncounterDate(encounter: Encounter): string {
  const start = encounter.period?.start;
  if (!start) {
    return 'Unknown';
  }
  return new Date(start).toLocaleDateString();
}

function getPatientReference(encounter: Encounter): string {
  return encounter.subject?.reference ?? '';
}

function getPatientName(encounter: Encounter): string {
  return encounter.subject?.display ?? 'Unknown';
}

function getClassDisplay(encounter: Encounter): string {
  return encounter.class?.code ?? 'Unknown';
}

function getTypeDisplay(encounter: Encounter): string {
  return encounter.type?.[0]?.coding?.[0]?.display ?? encounter.type?.[0]?.text ?? 'Unknown';
}

export function RosterDashboardPage(): JSX.Element {
  const medplum = useMedplum();
  const membership = medplum.getProjectMembership();
  const roster = getRosterMembership(membership);

  const [daysBack, setDaysBack] = useState(30);
  const [encounterClass, setEncounterClass] = useState<string>('');
  const [sortBy, setSortBy] = useState<'date' | 'patientName'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [nameFilter, setNameFilter] = useState('');

  const groupId = roster?.groupReference.reference?.split('/')[1];
  const { encounters, loading, error } = useRosterEncounters({
    groupId,
    daysBack,
    encounterClass: encounterClass || undefined,
    sortBy,
    sortDirection,
  });

  const filteredEncounters = useMemo(() => {
    if (!nameFilter.trim()) {
      return encounters;
    }
    const query = nameFilter.toLowerCase();
    return encounters.filter((e) => getPatientName(e).toLowerCase().includes(query));
  }, [encounters, nameFilter]);

  const toggleSort = (field: 'date' | 'patientName'): void => {
    if (sortBy === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDirection(field === 'date' ? 'desc' : 'asc');
    }
  };

  function getSortIndicator(field: 'date' | 'patientName'): string {
    if (sortBy !== field) {
      return '';
    }
    return sortDirection === 'asc' ? '↑' : '↓';
  }

  function renderEncounterTable(): JSX.Element {
    if (loading) {
      return <Loader />;
    }
    if (error) {
      return <Alert color="red">{error}</Alert>;
    }
    if (filteredEncounters.length === 0) {
      return <div className={classes.emptyState}>No encounters found for the selected filters.</div>;
    }

    return (
      <Table striped highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>
              <Button variant="subtle" size="xs" onClick={() => toggleSort('patientName')}>
                Patient {getSortIndicator('patientName')}
              </Button>
            </Table.Th>
            <Table.Th>
              <Button variant="subtle" size="xs" onClick={() => toggleSort('date')}>
                Date {getSortIndicator('date')}
              </Button>
            </Table.Th>
            <Table.Th>Class</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th>Status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {filteredEncounters.map((encounter) => (
            <Table.Tr key={encounter.id}>
              <Table.Td>
                <Text component={Link} to={`${getPatientReference(encounter)}/timeline`} c="blue">
                  {getPatientName(encounter)}
                </Text>
              </Table.Td>
              <Table.Td>{formatEncounterDate(encounter)}</Table.Td>
              <Table.Td>{getClassDisplay(encounter)}</Table.Td>
              <Table.Td>{getTypeDisplay(encounter)}</Table.Td>
              <Table.Td>{encounter.status}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    );
  }

  if (!roster) {
    return (
      <div className={classes.page}>
        <Alert color="red" title="Access denied">
          You do not have a roster assigned. Contact your administrator.
        </Alert>
      </div>
    );
  }

  return (
    <div className={classes.page}>
      <div className={classes.header}>
        <div>
          <div className={classes.title}>Roster Dashboard</div>
          <div className={classes.subtitle}>{roster.groupReference.display ?? roster.groupReference.reference}</div>
        </div>
      </div>

      <div className={classes.panel}>
        <div className={classes.panelHeader}>
          <div className={classes.panelTitle}>Filters</div>
        </div>
        <div className={classes.panelBody}>
          <Group gap="md" grow>
            <Select
              label="Date range"
              data={DAY_OPTIONS}
              value={String(daysBack)}
              onChange={(value) => setDaysBack(Number(value ?? 30))}
            />
            <Select
              label="Visit type"
              data={CLASS_OPTIONS}
              value={encounterClass}
              onChange={(value) => setEncounterClass(value ?? '')}
            />
            <TextInput
              label="Patient name"
              placeholder="Filter by name"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.currentTarget.value)}
            />
          </Group>
        </div>
      </div>

      <div className={classes.panel}>
        <div className={classes.panelHeader}>
          <div className={classes.panelTitle}>Encounters ({filteredEncounters.length})</div>
        </div>
        <div className={classes.panelBody}>{renderEncounterTable()}</div>
      </div>
    </div>
  );
}
