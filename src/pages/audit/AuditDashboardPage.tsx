// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Anchor, Button, Group, Loader, Select, SimpleGrid, Table, TextInput } from '@mantine/core';
import { useMedplum } from '@medplum/react';
import type { AuditEventFilters } from '../../utils/auditReport';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { useAuditEvents } from '../../hooks/useAuditEvents';
import {
  exportAuditEventsToCsv,
  getAuditEventAction,
  getAuditEventEntity,
  getAuditEventEntityReference,
  getAuditEventOutcome,
  getAuditEventType,
  getAuditEventUser,
} from '../../utils/auditReport';
import classes from './AuditDashboardPage.module.css';

const ACTION_OPTIONS = [
  { value: '', label: 'All actions' },
  { value: 'C', label: 'Create' },
  { value: 'R', label: 'Read' },
  { value: 'U', label: 'Update' },
  { value: 'D', label: 'Delete' },
  { value: 'E', label: 'Execute' },
];

const MEDPLUM_APP_URL = 'https://app.ehr.hiivehealth.net';

function formatRecorded(recorded: string | undefined): string {
  if (!recorded) {
    return 'Unknown';
  }
  return new Date(recorded).toLocaleString();
}

function downloadCsv(csv: string, fileName: string): void {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export function AuditDashboardPage(): JSX.Element {
  const medplum = useMedplum();
  const membership = medplum.getProjectMembership();
  const isAdmin = membership?.admin === true;

  const [filters, setFilters] = useState<AuditEventFilters>({});
  const [agent, setAgent] = useState('');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const { events, loading, error } = useAuditEvents(filters);

  const metrics = useMemo(() => {
    const byUser = new Map<string, number>();
    const byAction = new Map<string, number>();
    for (const event of events) {
      const user = getAuditEventUser(event);
      byUser.set(user, (byUser.get(user) ?? 0) + 1);
      const actionKey = event.action ?? 'Unknown';
      byAction.set(actionKey, (byAction.get(actionKey) ?? 0) + 1);
    }
    return { total: events.length, byUser, byAction };
  }, [events]);

  const applyFilters = (): void => {
    setFilters({
      agent: agent || undefined,
      entity: entity || undefined,
      action: action || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });
  };

  const handleExportCsv = (): void => {
    const csv = exportAuditEventsToCsv(events);
    const fileName = `audit-export-${new Date().toISOString().split('T')[0]}.csv`;
    downloadCsv(csv, fileName);
  };

  function renderEventTable(): JSX.Element {
    if (loading) {
      return <Loader />;
    }
    if (error) {
      return <Alert color="red">{error}</Alert>;
    }
    if (events.length === 0) {
      return <div className={classes.emptyState}>No audit events found for the selected filters.</div>;
    }

    return (
      <Table striped highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Recorded</Table.Th>
            <Table.Th>User</Table.Th>
            <Table.Th>Action</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th>Entity</Table.Th>
            <Table.Th>Outcome</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {events.map((event) => (
            <Table.Tr key={event.id}>
              <Table.Td>{formatRecorded(event.recorded)}</Table.Td>
              <Table.Td>{getAuditEventUser(event)}</Table.Td>
              <Table.Td>{getAuditEventAction(event)}</Table.Td>
              <Table.Td>{getAuditEventType(event)}</Table.Td>
              <Table.Td>
                {(() => {
                  const entityRef = getAuditEventEntityReference(event);
                  const entityLabel = getAuditEventEntity(event);
                  if (entityRef) {
                    return (
                      <Anchor href={`${MEDPLUM_APP_URL}/${entityRef}`} target="_blank" rel="noopener noreferrer">
                        {entityLabel}
                      </Anchor>
                    );
                  }
                  return entityLabel;
                })()}
              </Table.Td>
              <Table.Td>{getAuditEventOutcome(event)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    );
  }

  if (!isAdmin) {
    return (
      <div className={classes.page}>
        <Alert color="red" title="Access denied">
          You must be a project administrator to view the audit dashboard.
        </Alert>
      </div>
    );
  }

  return (
    <div className={classes.page}>
      <div className={classes.header}>
        <div>
          <div className={classes.title}>Audit Dashboard</div>
        </div>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
        <div className={classes.metricCard}>
          <div className={classes.metricValue}>{metrics.total}</div>
          <div className={classes.metricLabel}>Total events</div>
        </div>
        <div className={classes.metricCard}>
          <div className={classes.metricValue}>{metrics.byAction.get('R') ?? 0}</div>
          <div className={classes.metricLabel}>Reads</div>
        </div>
        <div className={classes.metricCard}>
          <div className={classes.metricValue}>{metrics.byAction.get('U') ?? 0}</div>
          <div className={classes.metricLabel}>Updates</div>
        </div>
        <div className={classes.metricCard}>
          <div className={classes.metricValue}>{metrics.byAction.get('C') ?? 0}</div>
          <div className={classes.metricLabel}>Creates</div>
        </div>
      </SimpleGrid>

      <div className={classes.panel}>
        <div className={classes.panelHeader}>
          <div className={classes.panelTitle}>Filters</div>
        </div>
        <div className={classes.panelBody}>
          <Group gap="md" grow>
            <TextInput
              label="User"
              placeholder="e.g. Practitioner/123"
              value={agent}
              onChange={(e) => setAgent(e.currentTarget.value)}
            />
            <TextInput
              label="Entity"
              placeholder="e.g. Patient/456"
              value={entity}
              onChange={(e) => setEntity(e.currentTarget.value)}
            />
            <Select
              label="Action"
              data={ACTION_OPTIONS}
              value={action}
              onChange={(value) => setAction(value ?? '')}
            />
            <TextInput
              label="Start date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.currentTarget.value)}
            />
            <TextInput
              label="End date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.currentTarget.value)}
            />
          </Group>
          <Group gap="md" mt="md">
            <Button onClick={applyFilters}>Apply filters</Button>
            <Button variant="outline" onClick={handleExportCsv} disabled={events.length === 0}>
              Export CSV
            </Button>
          </Group>
        </div>
      </div>

      <div className={classes.panel}>
        <div className={classes.panelHeader}>
          <div className={classes.panelTitle}>Audit Events ({events.length})</div>
        </div>
        <div className={classes.panelBody}>{renderEventTable()}</div>
      </div>
    </div>
  );
}
