// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, Checkbox, Group, Loader, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeErrorString } from '@medplum/core';
import type { AccessPolicy, ProjectMembership } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconCircleCheck, IconCircleOff } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { RbacAdminNav } from './RbacAdminNav';
import { isProjectAdmin, isRolePolicy, logRbacAuditEvent } from './rbac-utils';

type MembershipFormState = {
  userId: string;
  profileReference: string;
  accessPolicyId: string;
  admin: boolean;
};

const EMPTY_FORM: MembershipFormState = {
  userId: '',
  profileReference: '',
  accessPolicyId: '',
  admin: false,
};

export function MembershipManagerPage(): JSX.Element {
  const medplum = useMedplum();
  const canManage = isProjectAdmin(medplum.getProjectMembership());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [memberships, setMemberships] = useState<ProjectMembership[]>([]);
  const [policies, setPolicies] = useState<AccessPolicy[]>([]);
  const [form, setForm] = useState<MembershipFormState>(EMPTY_FORM);
  const [error, setError] = useState<string>();

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [membershipResults, policyResults] = await Promise.all([
        medplum.searchResources('ProjectMembership', new URLSearchParams([['_count', '100'], ['_sort', '-_lastUpdated']])),
        medplum.searchResources('AccessPolicy', new URLSearchParams([['_count', '200'], ['_sort', 'name']])),
      ]);
      setMemberships(membershipResults);
      setPolicies(policyResults.filter(isRolePolicy));
    } catch (err) {
      setError(normalizeErrorString(err));
    } finally {
      setLoading(false);
    }
  }, [medplum]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const createMembership = async (): Promise<void> => {
    if (!form.userId || !form.profileReference || !form.accessPolicyId) {
      setError('User ID, profile reference, and access policy ID are required.');
      return;
    }

    try {
      setSaving(true);
      setError(undefined);

      const projectRef = medplum.getProjectMembership()?.project;
      if (!projectRef) {
        throw new Error('Active project reference not found on current membership.');
      }

      const [profileType, profileId] = form.profileReference.split('/');
      if (!profileType || !profileId) {
        throw new Error('Profile reference must be in format ResourceType/id.');
      }

      const membership = await medplum.createResource<ProjectMembership>({
        resourceType: 'ProjectMembership',
        project: projectRef,
        user: { reference: `User/${form.userId}` },
        profile: { reference: `${profileType}/${profileId}` },
        accessPolicy: { reference: `AccessPolicy/${form.accessPolicyId}` },
        admin: form.admin,
      });

      await logRbacAuditEvent(medplum, 'C', membership.id || 'ProjectMembership', 'Created project membership from RBAC admin');
      showNotification({
        icon: <IconCircleCheck />,
        title: 'Membership created',
        message: membership.id || 'ProjectMembership created',
      });
      setForm(EMPTY_FORM);
      await loadData();
    } catch (err) {
      showNotification({
        color: 'red',
        icon: <IconCircleOff />,
        title: 'Unable to create membership',
        message: normalizeErrorString(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteMembership = async (membership: ProjectMembership): Promise<void> => {
    if (!membership.id) {
      return;
    }

    const confirmed = window.confirm(`Delete membership ${membership.id}?`);
    if (!confirmed) {
      return;
    }

    try {
      await medplum.deleteResource('ProjectMembership', membership.id);
      await logRbacAuditEvent(medplum, 'D', membership.id, 'Deleted project membership from RBAC admin');
      await loadData();
      showNotification({ icon: <IconCircleCheck />, title: 'Membership deleted', message: membership.id });
    } catch (err) {
      showNotification({ color: 'red', icon: <IconCircleOff />, title: 'Unable to delete membership', message: normalizeErrorString(err) });
    }
  };

  if (!canManage) {
    return (
      <Stack>
        <Title order={2}>Membership Manager</Title>
        <Alert color="red" title="Access denied">Project admin access is required.</Alert>
      </Stack>
    );
  }

  return (
    <Stack>
      <RbacAdminNav />
      <Title order={2}>Membership Manager</Title>
      <Text c="dimmed" size="sm">Assign users to profile + AccessPolicy combinations without code changes.</Text>

      {loading ? <Loader /> : null}
      {error ? <Alert color="red">{error}</Alert> : null}

      <Group grow>
        <TextInput
          label="User ID"
          placeholder="8f..."
          value={form.userId}
          onChange={(event) => setForm((prev) => ({ ...prev, userId: event.currentTarget.value }))}
        />
        <TextInput
          label="Profile Reference"
          placeholder="Practitioner/59ea2..."
          value={form.profileReference}
          onChange={(event) => setForm((prev) => ({ ...prev, profileReference: event.currentTarget.value }))}
        />
      </Group>
      <Group grow>
        <TextInput
          label="AccessPolicy ID"
          placeholder="074b3292-..."
          value={form.accessPolicyId}
          onChange={(event) => setForm((prev) => ({ ...prev, accessPolicyId: event.currentTarget.value }))}
        />
        <Stack gap={4}>
          <Text size="sm" fw={500}>Admin flag</Text>
          <Checkbox checked={form.admin} onChange={(event) => setForm((prev) => ({ ...prev, admin: event.currentTarget.checked }))} />
        </Stack>
      </Group>

      <Text size="sm" c="dimmed">
        Available role policies: {policies.map((policy) => `${policy.name} (${policy.id})`).join(' | ') || 'none'}
      </Text>

      <Group justify="flex-end">
        <Button onClick={() => void createMembership()} loading={saving}>Create Membership</Button>
      </Group>

      <Table withTableBorder striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>ID</Table.Th>
            <Table.Th>User</Table.Th>
            <Table.Th>Profile</Table.Th>
            <Table.Th>Policy</Table.Th>
            <Table.Th>Admin</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {memberships.map((membership) => (
            <Table.Tr key={membership.id}>
              <Table.Td>{membership.id}</Table.Td>
              <Table.Td>{membership.user?.reference}</Table.Td>
              <Table.Td>{membership.profile?.reference}</Table.Td>
              <Table.Td>{membership.accessPolicy?.reference}</Table.Td>
              <Table.Td>{membership.admin ? 'Yes' : 'No'}</Table.Td>
              <Table.Td>
                <Button color="red" variant="light" size="xs" onClick={() => void deleteMembership(membership)}>
                  Delete
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
