// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, Checkbox, Group, Loader, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeErrorString } from '@medplum/core';
import type { AccessPolicy } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconCircleCheck, IconCircleOff } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RbacAdminNav } from './RbacAdminNav';
import { isProjectAdmin, isRolePolicy, logRbacAuditEvent, mergeRolePolicies } from './rbac-utils';

export function AccessModelsPage(): JSX.Element {
  const medplum = useMedplum();
  const canManage = isProjectAdmin(medplum.getProjectMembership());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [policies, setPolicies] = useState<AccessPolicy[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [profileType, setProfileType] = useState('Practitioner');
  const [criteriaOverride, setCriteriaOverride] = useState('');

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const results = await medplum.searchResources('AccessPolicy', new URLSearchParams([['_count', '200'], ['_sort', 'name']]));
      setPolicies(results.filter(isRolePolicy));
    } catch (err) {
      setError(normalizeErrorString(err));
    } finally {
      setLoading(false);
    }
  }, [medplum]);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  const selectedPolicies = useMemo(
    () => policies.filter((policy) => policy.id && selectedIds.includes(policy.id)),
    [policies, selectedIds]
  );

  const composedRules = useMemo(() => mergeRolePolicies(selectedPolicies, criteriaOverride), [selectedPolicies, criteriaOverride]);

  const saveComposedPolicy = async (): Promise<void> => {
    if (!selectedPolicies.length) {
      setError('Select at least one role policy.');
      return;
    }

    try {
      setSaving(true);
      setError(undefined);
      const name = `RBAC Model: ${profileType} ${new Date().toISOString().slice(0, 10)}`;
      const created = await medplum.createResource<AccessPolicy>({
        resourceType: 'AccessPolicy',
        name,
        resource: composedRules,
        meta: {
          tag: [
            { system: 'https://hiivecare.example/tags/rbac', code: 'rbac-access-model', display: 'RBAC Access Model' },
            { system: 'https://hiivecare.example/tags/rbac', code: profileType.toLowerCase(), display: profileType },
          ],
        },
      });

      await logRbacAuditEvent(medplum, 'C', created.name || name, 'Created composed access model policy');
      showNotification({
        icon: <IconCircleCheck />,
        title: 'Access model policy created',
        message: `${created.name || name} (${created.id})`,
      });
    } catch (err) {
      showNotification({ color: 'red', icon: <IconCircleOff />, title: 'Unable to create access model', message: normalizeErrorString(err) });
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return (
      <Stack>
        <Title order={2}>RBAC Access Models</Title>
        <Alert color="red" title="Access denied">Project admin access is required.</Alert>
      </Stack>
    );
  }

  return (
    <Stack>
      <RbacAdminNav />
      <Group justify="space-between">
        <div>
          <Title order={2}>Access Models</Title>
          <Text c="dimmed" size="sm">Compose profile-specific policies from RBAC role AccessPolicies.</Text>
        </div>
        <Button variant="light" onClick={() => void loadPolicies()}>Refresh</Button>
      </Group>

      {loading ? <Loader /> : null}
      {error ? <Alert color="red">{error}</Alert> : null}

      <Group grow>
        <TextInput label="Profile Type" value={profileType} onChange={(event) => setProfileType(event.currentTarget.value)} />
        <TextInput
          label="Criteria Override (optional)"
          value={criteriaOverride}
          onChange={(event) => setCriteriaOverride(event.currentTarget.value)}
          placeholder="Patient?_id=ALLOWED_EMPLOYEE_IDS"
        />
      </Group>

      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Use</Table.Th>
            <Table.Th>Role Policy</Table.Th>
            <Table.Th>ID</Table.Th>
            <Table.Th>Rules</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {policies.map((policy) => (
            <Table.Tr key={policy.id || policy.name}>
              <Table.Td>
                <Checkbox
                  checked={Boolean(policy.id && selectedIds.includes(policy.id))}
                  onChange={(event) => {
                    if (!policy.id) {
                      return;
                    }
                    setSelectedIds((prev) =>
                      event.currentTarget.checked ? [...prev, policy.id as string] : prev.filter((id) => id !== policy.id)
                    );
                  }}
                />
              </Table.Td>
              <Table.Td>{policy.name}</Table.Td>
              <Table.Td>{policy.id}</Table.Td>
              <Table.Td>{policy.resource?.length || 0}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Alert color="blue" title="Composed policy preview">
        {selectedPolicies.length} source policies selected, {composedRules.length} total rules after merge.
      </Alert>

      <Group justify="flex-end">
        <Button onClick={() => void saveComposedPolicy()} loading={saving}>Create Access Model Policy</Button>
      </Group>
    </Stack>
  );
}
