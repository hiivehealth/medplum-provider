// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, Checkbox, Group, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeErrorString } from '@medplum/core';
import type { AccessPolicy } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconCircleCheck, IconCircleOff } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { RbacAdminNav } from './RbacAdminNav';
import { isProjectAdmin, isRolePolicy, logRbacAuditEvent, mergeRolePolicies } from './rbac-utils';

export function TemplatesPage(): JSX.Element {
  const medplum = useMedplum();
  const canManage = isProjectAdmin(medplum.getProjectMembership());
  const [policies, setPolicies] = useState<AccessPolicy[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [name, setName] = useState('RBAC: Custom Template Clone');
  const [error, setError] = useState<string>();

  useEffect(() => {
    medplum
      .searchResources('AccessPolicy', new URLSearchParams([['_count', '200'], ['_sort', 'name']]))
      .then((results) => setPolicies(results.filter(isRolePolicy)))
      .catch((err) => setError(normalizeErrorString(err)));
  }, [medplum]);

  const selectedPolicies = useMemo(
    () => policies.filter((policy) => policy.id && selectedIds.includes(policy.id)),
    [policies, selectedIds]
  );

  const mergedRules = useMemo(() => mergeRolePolicies(selectedPolicies), [selectedPolicies]);

  const createTemplateClone = async (): Promise<void> => {
    if (!name.trim()) {
      setError('Template name is required.');
      return;
    }

    try {
      const created = await medplum.createResource<AccessPolicy>({
        resourceType: 'AccessPolicy',
        name: name.trim(),
        resource: mergedRules,
        meta: {
          tag: [
            { system: 'https://hiivecare.example/tags/rbac', code: 'rbac-role', display: 'RBAC Role' },
            { system: 'https://hiivecare.example/tags/rbac', code: 'template-clone', display: 'Template Clone' },
          ],
        },
      });
      await logRbacAuditEvent(medplum, 'C', created.name || name, 'Created role template clone');
      showNotification({ icon: <IconCircleCheck />, title: 'Template clone created', message: `${created.name} (${created.id})` });
    } catch (err) {
      showNotification({ color: 'red', icon: <IconCircleOff />, title: 'Unable to create template clone', message: normalizeErrorString(err) });
    }
  };

  if (!canManage) {
    return (
      <Stack>
        <Title order={2}>Role Templates</Title>
        <Alert color="red" title="Access denied">Project admin access is required.</Alert>
      </Stack>
    );
  }

  return (
    <Stack>
      <RbacAdminNav />
      <Title order={2}>Role Templates and Composition</Title>
      <Text c="dimmed" size="sm">Compose new role policies by selecting existing role templates and cloning merged rules.</Text>

      {error ? <Alert color="red">{error}</Alert> : null}

      <TextInput label="New role name" value={name} onChange={(event) => setName(event.currentTarget.value)} />

      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Use</Table.Th>
            <Table.Th>Name</Table.Th>
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

      <Alert color="blue" title="Composition preview">
        Selected templates: {selectedPolicies.length}; merged rules: {mergedRules.length}
      </Alert>

      <Group justify="flex-end">
        <Button onClick={() => void createTemplateClone()}>Create Template Clone</Button>
      </Group>
    </Stack>
  );
}
