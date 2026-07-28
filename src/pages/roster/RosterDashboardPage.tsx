// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Select,
  Table,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core';
import type { Encounter, Practitioner } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { getRosterMembership } from '../../utils/roster';
import { useRosterCareGaps, type CareGap } from '../../hooks/useRosterCareGaps';
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
  const profile = useMedplumProfile();
  const membership = medplum.getProjectMembership();
  const roster = getRosterMembership(membership, profile as Practitioner | undefined);

  const [activeTab, setActiveTab] = useState<string | null>('encounters');
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
  const { gaps, loading: gapsLoading, error: gapsError } = useRosterCareGaps({ groupId });

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
                <Text component={Link} to={`/${getPatientReference(encounter)}/timeline`} c="blue">
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

  function formatCareGapDate(value: string | undefined): string {
    if (!value) {
      return 'Unknown';
    }
    return new Date(value).toLocaleDateString();
  }

  function getCareGapBadgeColor(type: CareGap['type']): string {
    return type === 'missing-lab' ? 'orange' : 'red';
  }

  function renderCareGapsTable(): JSX.Element {
    if (gapsLoading) {
      return <Loader />;
    }
    if (gapsError) {
      return <Alert color="red">{gapsError}</Alert>;
    }
    if (gaps.length === 0) {
      return <div className={classes.emptyState}>No care gaps found for this roster.</div>;
    }

    return (
      <Table striped highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Patient</Table.Th>
            <Table.Th>Gap</Table.Th>
            <Table.Th>Details</Table.Th>
            <Table.Th>Due / Last Event</Table.Th>
            <Table.Th>Status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {gaps.map((gap, index) => (
            <Table.Tr key={`${gap.patient.id ?? index}-${gap.type}`}>
              <Table.Td>
                <Text component={Link} to={`/Patient/${gap.patient.id}/timeline`} c="blue">
                  {gap.patient.name?.[0]?.given?.[0]} {gap.patient.name?.[0]?.family}
                </Text>
              </Table.Td>
              <Table.Td>{gap.title}</Table.Td>
              <Table.Td>{gap.description}</Table.Td>
              <Table.Td>
                {gap.dueDate ? (
                  <>Due {formatCareGapDate(gap.dueDate)}</>
                ) : gap.lastEventDate ? (
                  <>Last event {formatCareGapDate(gap.lastEventDate)}</>
                ) : (
                  'No prior event'
                )}
              </Table.Td>
              <Table.Td>
                <Badge color={getCareGapBadgeColor(gap.type)}>{gap.type === 'missing-lab' ? 'Lab overdue' : 'Refill overdue'}</Badge>
              </Table.Td>
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

      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List>
          <Tabs.Tab value="encounters">Encounters ({filteredEncounters.length})</Tabs.Tab>
          <Tabs.Tab value="caregaps">Gaps in Care ({gaps.length})</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="encounters" pt="md">
          <div className={classes.panel}>
            <div className={classes.panelHeader}>
              <div className={classes.panelTitle}>Encounters ({filteredEncounters.length})</div>
            </div>
            <div className={classes.panelBody}>{renderEncounterTable()}</div>
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="caregaps" pt="md">
          <div className={classes.panel}>
            <div className={classes.panelHeader}>
              <div className={classes.panelTitle}>Care Gaps ({gaps.length})</div>
            </div>
            <div className={classes.panelBody}>{renderCareGapsTable()}</div>
          </div>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
