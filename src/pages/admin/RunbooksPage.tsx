// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, List, Stack, Text, Title } from '@mantine/core';
import type { JSX } from 'react';
import { RbacAdminNav } from './RbacAdminNav';
import { useMedplum } from '@medplum/react';
import { isProjectAdmin } from './rbac-utils';

export function RunbooksPage(): JSX.Element {
  const medplum = useMedplum();
  const canManage = isProjectAdmin(medplum.getProjectMembership());

  if (!canManage) {
    return (
      <Stack>
        <Title order={2}>Runbooks</Title>
        <Alert color="red" title="Access denied">Project admin access is required.</Alert>
      </Stack>
    );
  }

  return (
    <Stack>
      <RbacAdminNav />
      <Title order={2}>RBAC Runbooks and Staging Checklist</Title>
      <Text c="dimmed" size="sm">Operational guides for slices 13 and 14.</Text>

      <Alert color="blue" title="Runbooks">
        <List>
          <List.Item>Create read-only role: clone template, remove write interactions, test with visibility tester.</List.Item>
          <List.Item>Create minimum-necessary role: start from Supervisor/HR role and set hidden fields first.</List.Item>
          <List.Item>Update role with no downtime: clone role, assign clone to pilot users, validate, then migrate memberships.</List.Item>
          <List.Item>Audit changes: verify AuditEvent entries after each create/update/delete action.</List.Item>
        </List>
      </Alert>

      <Alert color="yellow" title="Staging Validation Checklist">
        <List>
          <List.Item>Verify seeded role policies exist and are assignable.</List.Item>
          <List.Item>Create pilot memberships for Practitioner, RelatedPerson, and Patient profiles.</List.Item>
          <List.Item>Run visibility tests for sensitive fields (identifier, telecom, address, birthDate, gender).</List.Item>
          <List.Item>Run bulk assignment with sample CSV and review success/failure summary.</List.Item>
          <List.Item>Confirm AuditEvent records are created for role and membership changes.</List.Item>
          <List.Item>Document rollback plan: restore previous AccessPolicy references for affected memberships.</List.Item>
        </List>
      </Alert>
    </Stack>
  );
}
