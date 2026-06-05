// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, Group, Loader, Modal, Stack, Table, Text, TextInput, Textarea, Title } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeErrorString } from '@medplum/core';
import type { AccessPolicy, Coding } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconCircleCheck, IconCircleOff } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PermissionBuilder } from './PermissionBuilder';
import { getRoleRulesCount, isProjectAdmin, isRolePolicy, logRbacAuditEvent } from './rbac-utils';

const DEFAULT_ROLE_RULES = JSON.stringify(
  [
    {
      resourceType: 'Patient',
      interaction: ['read', 'search', 'history', 'vread'],
    },
  ],
  null,
  2
);

const DEFAULT_ROLE_TAGS = JSON.stringify(
  [
    {
      system: 'https://hiivecare.example/tags/rbac',
      code: 'rbac-role',
      display: 'RBAC Role',
    },
  ],
  null,
  2
);

type RoleEditorState = {
  id?: string;
  name: string;
  rules: NonNullable<AccessPolicy['resource']>;
  tagsJson: string;
};

function getTagsJson(policy: AccessPolicy): string {
  return JSON.stringify(policy.meta?.tag || [], null, 2);
}

function parseRules(jsonText: string): AccessPolicy['resource'] {
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Role rules must be a non-empty JSON array.');
  }

  for (const [index, rule] of parsed.entries()) {
    if (!rule || typeof rule !== 'object') {
      throw new Error(`Rule #${index + 1} must be an object.`);
    }
    if (!rule.resourceType || typeof rule.resourceType !== 'string') {
      throw new Error(`Rule #${index + 1} must include resourceType.`);
    }
    if (!Array.isArray(rule.interaction) || rule.interaction.length === 0) {
      throw new Error(`Rule #${index + 1} must include a non-empty interaction array.`);
    }
  }

  return parsed as AccessPolicy['resource'];
}

function parseTags(jsonText: string): Coding[] | undefined {
  const trimmed = jsonText.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error('Tags must be a JSON array.');
  }

  for (const [index, tag] of parsed.entries()) {
    if (!tag || typeof tag !== 'object') {
      throw new Error(`Tag #${index + 1} must be an object.`);
    }
  }

  return parsed as Coding[];
}

export function RbacRolesPage(): JSX.Element {
  const medplum = useMedplum();
  const membership = medplum.getProjectMembership();
  const canManageRoles = isProjectAdmin(membership);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string>();
  const [error, setError] = useState<string>();
  const [policies, setPolicies] = useState<AccessPolicy[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorState, setEditorState] = useState<RoleEditorState>({
    name: 'RBAC: ',
    rules: parseRules(DEFAULT_ROLE_RULES) || [],
    tagsJson: DEFAULT_ROLE_TAGS,
  });

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    setError(undefined);

    try {
      const results = await medplum.searchResources(
        'AccessPolicy',
        new URLSearchParams([
          ['_count', '200'],
          ['_sort', 'name'],
        ]),
        { cache: 'no-cache' }
      );

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

  const sortedPolicies = useMemo(
    () => [...policies].sort((left, right) => (left.name || '').localeCompare(right.name || '')),
    [policies]
  );

  const openCreateModal = (): void => {
    setEditorState({
      name: 'RBAC: ',
      rules: parseRules(DEFAULT_ROLE_RULES) || [],
      tagsJson: DEFAULT_ROLE_TAGS,
    });
    setEditorOpen(true);
  };

  const openEditModal = (policy: AccessPolicy): void => {
    setEditorState({
      id: policy.id,
      name: policy.name || '',
      rules: (policy.resource || []) as NonNullable<AccessPolicy['resource']>,
      tagsJson: getTagsJson(policy),
    });
    setEditorOpen(true);
  };

  const handleSave = async (): Promise<void> => {
    const trimmedName = editorState.name.trim();
    if (!trimmedName) {
      setError('Role name is required.');
      return;
    }

    try {
      setSaving(true);
      setError(undefined);

      const resourceRules = editorState.rules;
      const tags = parseTags(editorState.tagsJson);

      const policyPayload: AccessPolicy = {
        resourceType: 'AccessPolicy',
        id: editorState.id,
        name: trimmedName,
        resource: resourceRules,
        meta: tags ? { tag: tags } : undefined,
      };

      if (editorState.id) {
        await medplum.updateResource(policyPayload);
        await logRbacAuditEvent(medplum, 'U', trimmedName, 'Updated RBAC role policy');
      } else {
        await medplum.createResource(policyPayload);
        await logRbacAuditEvent(medplum, 'C', trimmedName, 'Created RBAC role policy');
      }

      showNotification({
        icon: <IconCircleCheck />,
        title: editorState.id ? 'Role updated' : 'Role created',
        message: `${trimmedName} saved successfully.`,
      });

      setEditorOpen(false);
      await loadPolicies();
    } catch (err) {
      showNotification({
        color: 'red',
        icon: <IconCircleOff />,
        title: 'Unable to save role',
        message: normalizeErrorString(err),
      });
      setError(normalizeErrorString(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (policy: AccessPolicy): Promise<void> => {
    if (!policy.id || !policy.name) {
      return;
    }

    const confirmed = window.confirm(`Delete role \"${policy.name}\"?`);
    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(policy.id);
      await medplum.deleteResource('AccessPolicy', policy.id);
      await logRbacAuditEvent(medplum, 'D', policy.name, 'Deleted RBAC role policy');
      showNotification({
        icon: <IconCircleCheck />,
        title: 'Role deleted',
        message: `${policy.name} was removed.`,
      });
      await loadPolicies();
    } catch (err) {
      showNotification({
        color: 'red',
        icon: <IconCircleOff />,
        title: 'Unable to delete role',
        message: normalizeErrorString(err),
      });
    } finally {
      setDeletingId(undefined);
    }
  };

  if (!canManageRoles) {
    return (
      <Stack>
        <Title order={2}>RBAC Roles</Title>
        <Alert color="red" title="Access denied">
          Project admin access is required to manage role policies.
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack>
      <Group justify="space-between" align="center">
        <div>
          <Title order={2}>RBAC Roles</Title>
          <Text c="dimmed" size="sm">
            Manage AccessPolicy-backed role definitions for the provider RBAC admin workflow.
          </Text>
        </div>
        <Group>
          <Button variant="light" onClick={() => void loadPolicies()} disabled={loading || saving}>
            Refresh
          </Button>
          <Button onClick={openCreateModal}>New Role</Button>
        </Group>
      </Group>

      {loading ? <Loader /> : null}
      {error ? (
        <Alert color="red" title="Unable to load roles">
          {error}
        </Alert>
      ) : null}

      {!loading ? (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Role</Table.Th>
              <Table.Th>Policy ID</Table.Th>
              <Table.Th>Rules</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sortedPolicies.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={4}>
                  <Text c="dimmed" size="sm">
                    No RBAC role policies found.
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              sortedPolicies.map((policy) => (
                <Table.Tr key={policy.id || policy.name}>
                  <Table.Td>{policy.name}</Table.Td>
                  <Table.Td>{policy.id}</Table.Td>
                  <Table.Td>{getRoleRulesCount(policy)}</Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Button variant="light" size="xs" onClick={() => openEditModal(policy)}>
                        Edit
                      </Button>
                      <Button
                        color="red"
                        variant="light"
                        size="xs"
                        loading={deletingId === policy.id}
                        onClick={() => void handleDelete(policy)}
                      >
                        Delete
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      ) : null}

      <Modal
        opened={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editorState.id ? 'Edit RBAC Role Policy' : 'Create RBAC Role Policy'}
        size="xl"
      >
        <Stack>
          <TextInput
            label="Role name"
            value={editorState.name}
            onChange={(event) => setEditorState((prev) => ({ ...prev, name: event.currentTarget.value }))}
            placeholder="RBAC: Supervisor/HR Minimum Necessary"
            required
          />

          <PermissionBuilder
            value={editorState.rules}
            onChange={(nextRules) => setEditorState((prev) => ({ ...prev, rules: nextRules }))}
          />

          <Textarea
            label="Meta tags JSON"
            description="Optional JSON array for meta.tag (use rbac-role tag for discoverability)"
            value={editorState.tagsJson}
            minRows={6}
            autosize
            onChange={(event) => setEditorState((prev) => ({ ...prev, tagsJson: event.currentTarget.value }))}
          />

          <Group justify="flex-end">
            <Button variant="light" onClick={() => setEditorOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} loading={saving}>
              Save Role
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
