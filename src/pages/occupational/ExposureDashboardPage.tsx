// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Anchor, Badge, Button, Loader, Table, Text } from '@mantine/core';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import classes from './OccupationalPages.module.css';
import {
  buildLocationExposureSummaries,
  patientPath,
  rtwBadgeColor,
  type LocationExposureSummary,
} from './occupational-data';
import { useOccupationalData } from './useOccupationalData';

export function ExposureDashboardPage(): JSX.Element {
  const { data, error, loading } = useOccupationalData();
  const summaries = useMemo(() => (data ? buildLocationExposureSummaries(data) : []), [data]);
  const [selectedKey, setSelectedKey] = useState<string>();
  const selectedSummary = summaries.find((summary) => summary.key === selectedKey) || summaries[0];
  const totals = useMemo(() => buildTotals(summaries), [summaries]);

  if (loading) {
    return <Loader />;
  }

  if (error) {
    return (
      <div className={classes.page}>
        <Alert color="red" title="Exposure dashboard unavailable">
          {error}
        </Alert>
      </div>
    );
  }

  return (
    <div className={classes.page}>
      <div className={classes.header}>
        <div>
          <div className={classes.title}>Exposure Dashboard</div>
          <div className={classes.subtitle}>Duty-location exposure follow-up</div>
        </div>
        <Button component={Link} to="/Occupational/Supervisor" variant="light">
          Supervisor View
        </Button>
      </div>

      <div className={classes.metricGrid}>
        <Metric label="Duty locations" value={String(summaries.length)} />
        <Metric label="Affected employees" value={String(totals.affectedEmployees)} />
        <Metric label="Active cases" value={String(totals.activeCases)} />
        <Metric label="Open follow-ups" value={String(totals.openTasks)} />
      </div>

      {summaries.length === 0 ? (
        <div className={classes.panel}>
          <div className={classes.emptyState}>No exposure incidents found</div>
        </div>
      ) : (
        <div className={classes.panelGrid}>
          <section className={classes.panel}>
            <div className={classes.panelHeader}>
              <div className={classes.panelTitle}>Duty Locations</div>
            </div>
            <div className={classes.panelBody}>
              <div className={classes.locationList}>
                {summaries.map((summary) => (
                  <button
                    className={classes.locationButton}
                    data-active={summary.key === selectedSummary?.key}
                    key={summary.key}
                    onClick={() => setSelectedKey(summary.key)}
                    type="button"
                  >
                    <div className={classes.locationName}>{summary.locationName}</div>
                    <div className={classes.locationMeta}>
                      {summary.component} • {summary.affectedEmployeeCount} employees • {summary.openTaskCount}{' '}
                      follow-ups
                    </div>
                    <div className={classes.statusGrid}>
                      {Object.entries(summary.statusCounts).map(([status, count]) => (
                        <Badge color="gray" key={status} variant="light">
                          {status}: {count}
                        </Badge>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          {selectedSummary && <LocationDetail summary={selectedSummary} />}
        </div>
      )}
    </div>
  );
}

function LocationDetail(props: { summary: LocationExposureSummary }): JSX.Element {
  const { summary } = props;
  return (
    <section className={classes.panel}>
      <div className={classes.panelHeader}>
        <div>
          <div className={classes.panelTitle}>{summary.locationName}</div>
          <Text c="dimmed" size="sm">
            {summary.component} • Latest incident {summary.latestIncidentDate}
          </Text>
        </div>
        <Badge variant="light" color={summary.activeCaseCount > 0 ? 'blue' : 'gray'}>
          {summary.activeCaseCount} active
        </Badge>
      </div>
      <div className={classes.panelBody}>
        <div className={classes.tableWrapper}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Employee</Table.Th>
                <Table.Th>RTW</Table.Th>
                <Table.Th>Follow-up</Table.Th>
                <Table.Th>Case</Table.Th>
                <Table.Th>Chart</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {summary.employeeRows.map((row) => (
                <Table.Tr key={row.patientReference}>
                  <Table.Td>{row.patientName}</Table.Td>
                  <Table.Td>
                    <Badge color={rtwBadgeColor(row.rtwStatusCode)} variant="light">
                      {row.rtwStatus}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{row.notificationStatus}</Table.Td>
                  <Table.Td>{row.caseStatus}</Table.Td>
                  <Table.Td>
                    {row.patientId && (
                      <Anchor component={Link} to={patientPath(row.patientId, '/occupational') as string}>
                        Occupational
                      </Anchor>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
      </div>
    </section>
  );
}

function Metric(props: { label: string; value: string }): JSX.Element {
  return (
    <div className={classes.metric}>
      <div className={classes.metricLabel}>{props.label}</div>
      <div className={classes.metricValue}>{props.value}</div>
    </div>
  );
}

function buildTotals(summaries: LocationExposureSummary[]): {
  affectedEmployees: number;
  activeCases: number;
  openTasks: number;
} {
  return summaries.reduce(
    (totals, summary) => ({
      affectedEmployees: totals.affectedEmployees + summary.affectedEmployeeCount,
      activeCases: totals.activeCases + summary.activeCaseCount,
      openTasks: totals.openTasks + summary.openTaskCount,
    }),
    { affectedEmployees: 0, activeCases: 0, openTasks: 0 }
  );
}
