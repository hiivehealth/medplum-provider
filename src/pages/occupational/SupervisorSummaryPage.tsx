// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Anchor, Badge, Button, Loader, Table } from '@mantine/core';
import type { JSX } from 'react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import classes from './OccupationalPages.module.css';
import { buildSupervisorRows, patientPath, rtwBadgeColor } from './occupational-data';
import { useOccupationalData } from './useOccupationalData';

export function SupervisorSummaryPage(): JSX.Element {
  const { data, error, loading } = useOccupationalData();
  const rows = useMemo(() => (data ? buildSupervisorRows(data) : []), [data]);
  const restrictedCount = rows.filter((row) => row.rtwStatusCode && row.rtwStatusCode !== 'full-duty').length;

  if (loading) {
    return <Loader />;
  }

  if (error) {
    return (
      <div className={classes.page}>
        <Alert color="red" title="Supervisor summary unavailable">
          {error}
        </Alert>
      </div>
    );
  }

  return (
    <div className={classes.page}>
      <div className={classes.header}>
        <div>
          <div className={classes.title}>Supervisor Summary</div>
          <div className={classes.subtitle}>Restriction and readiness view</div>
        </div>
        <Button component={Link} to="/Occupational/Exposure" variant="light">
          Exposure Dashboard
        </Button>
      </div>

      <div className={classes.metricGrid}>
        <Metric label="Employees" value={String(rows.length)} />
        <Metric label="Restricted or pending" value={String(restrictedCount)} />
        <Metric label="Open follow-ups" value={String(rows.reduce((sum, row) => sum + row.openTaskCount, 0))} />
      </div>

      <section className={classes.panel}>
        <div className={classes.panelHeader}>
          <div className={classes.panelTitle}>Minimum-Necessary Work Status</div>
        </div>
        <div className={classes.panelBody}>
          <div className={classes.tableWrapper}>
            <Table striped highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Employee</Table.Th>
                  <Table.Th>Work unit</Table.Th>
                  <Table.Th>Duty location</Table.Th>
                  <Table.Th>RTW</Table.Th>
                  <Table.Th>Restriction</Table.Th>
                  <Table.Th>Reevaluation</Table.Th>
                  <Table.Th>Notification</Table.Th>
                  <Table.Th>Action</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => (
                  <Table.Tr key={`${row.patientReference}-${row.dutyLocation}`}>
                    <Table.Td>{row.patientName}</Table.Td>
                    <Table.Td>{row.component}</Table.Td>
                    <Table.Td>{row.dutyLocation}</Table.Td>
                    <Table.Td>
                      <Badge color={rtwBadgeColor(row.rtwStatusCode)} variant="light">
                        {row.rtwStatus}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{row.restrictionSummary}</Table.Td>
                    <Table.Td>{row.reevaluationDate}</Table.Td>
                    <Table.Td>{row.notificationStatus}</Table.Td>
                    <Table.Td>
                      {row.patientId && (
                        <Anchor component={Link} to={patientPath(row.patientId, '/occupational') as string}>
                          View
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
    </div>
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
