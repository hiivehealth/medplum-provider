// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, Group, Stack, Text, Textarea, Title } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeErrorString } from '@medplum/core';
import type { ProjectMembership, User } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconCircleCheck, IconCircleOff } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useState } from 'react';
import { RbacAdminNav } from './RbacAdminNav';
import { isProjectAdmin, logRbacAuditEvent } from './rbac-utils';

export function BulkAssignmentPage(): JSX.Element {
  const medplum = useMedplum();
  const canManage = isProjectAdmin(medplum.getProjectMembership());
  const [csvText, setCsvText] = useState('email,profileReference,accessPolicyId,admin\n');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string>('');

  const runBulkAssign = async (): Promise<void> => {
    const lines = csvText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length <= 1) {
      setResult('No data rows found.');
      return;
    }

    let created = 0;
    let failed = 0;
    const failures: string[] = [];

    try {
      setRunning(true);
      const projectRef = medplum.getProjectMembership()?.project;
      if (!projectRef) {
        throw new Error('Active project reference not found on current membership.');
      }
      for (const row of lines.slice(1)) {
        const [email, profileReference, accessPolicyId, adminValue] = row.split(',').map((part) => part.trim());
        if (!email || !profileReference || !accessPolicyId) {
          failed++;
          failures.push(`${row} -> missing required values`);
          continue;
        }

        try {
          const users = await medplum.searchResources('User', new URLSearchParams([['email', email], ['_count', '1']]));
          const user = users[0] as User | undefined;
          if (!user?.id) {
            throw new Error(`User not found for email: ${email}`);
          }

          const [profileType, profileId] = profileReference.split('/');
          if (!profileType || !profileId) {
            throw new Error('profileReference must be ResourceType/id');
          }

          await medplum.createResource<ProjectMembership>({
            resourceType: 'ProjectMembership',
            project: projectRef,
            user: { reference: `User/${user.id}` },
            profile: { reference: `${profileType}/${profileId}` },
            accessPolicy: { reference: `AccessPolicy/${accessPolicyId}` },
            admin: adminValue?.toLowerCase() === 'true',
          });
          created++;
        } catch (err) {
          failed++;
          failures.push(`${row} -> ${normalizeErrorString(err)}`);
        }
      }

      await logRbacAuditEvent(medplum, 'E', 'Bulk Membership Assignment', `Created: ${created}, Failed: ${failed}`);
      setResult(`Created: ${created}; Failed: ${failed}${failures.length ? `\n${failures.join('\n')}` : ''}`);
      showNotification({
        icon: <IconCircleCheck />,
        title: 'Bulk assignment complete',
        message: `Created ${created}, failed ${failed}`,
      });
    } catch (err) {
      showNotification({ color: 'red', icon: <IconCircleOff />, title: 'Bulk assignment failed', message: normalizeErrorString(err) });
    } finally {
      setRunning(false);
    }
  };

  if (!canManage) {
    return (
      <Stack>
        <Title order={2}>Bulk Assignment</Title>
        <Alert color="red" title="Access denied">Project admin access is required.</Alert>
      </Stack>
    );
  }

  return (
    <Stack>
      <RbacAdminNav />
      <Title order={2}>Bulk Membership Assignment</Title>
      <Text c="dimmed" size="sm">
        CSV format: email,profileReference,accessPolicyId,admin
      </Text>
      <Textarea value={csvText} minRows={10} autosize onChange={(event) => setCsvText(event.currentTarget.value)} />
      <Group justify="flex-end">
        <Button loading={running} onClick={() => void runBulkAssign()}>Run Bulk Assignment</Button>
      </Group>
      {result ? <Alert color="blue"><pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{result}</pre></Alert> : null}
    </Stack>
  );
}
