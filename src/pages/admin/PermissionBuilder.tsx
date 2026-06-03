// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Checkbox, Group, Stack, Table, Text, TextInput } from '@mantine/core';
import type { AccessPolicy } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';

type AccessPolicyRule = NonNullable<AccessPolicy['resource']>[number];

const INTERACTIONS = ['create', 'read', 'search', 'update', 'delete', 'history', 'vread'] as const;

type DraftRule = {
  resourceType: string;
  interaction: string[];
  criteria: string;
  hiddenFields: string;
};

const EMPTY_RULE: DraftRule = {
  resourceType: '',
  interaction: ['read', 'search'],
  criteria: '',
  hiddenFields: '',
};

export type PermissionBuilderProps = {
  value: AccessPolicyRule[];
  onChange: (next: AccessPolicyRule[]) => void;
};

export function PermissionBuilder(props: PermissionBuilderProps): JSX.Element {
  const { value, onChange } = props;
  const [draft, setDraft] = useState<DraftRule>(EMPTY_RULE);

  const totalRules = useMemo(() => value.length, [value.length]);

  const addRule = (): void => {
    if (!draft.resourceType.trim() || draft.interaction.length === 0) {
      return;
    }

    const nextRule: AccessPolicyRule = {
      resourceType: draft.resourceType.trim(),
      interaction: draft.interaction as AccessPolicyRule['interaction'],
      criteria: draft.criteria.trim() || undefined,
      hiddenFields: draft.hiddenFields
        .split(',')
        .map((field) => field.trim())
        .filter(Boolean),
    };

    onChange([...value, nextRule]);
    setDraft(EMPTY_RULE);
  };

  const removeRule = (index: number): void => {
    onChange(value.filter((_, i) => i !== index));
  };

  const toggleInteraction = (interaction: string, checked: boolean): void => {
    setDraft((prev) => {
      const set = new Set(prev.interaction);
      if (checked) {
        set.add(interaction);
      } else {
        set.delete(interaction);
      }
      return { ...prev, interaction: [...set] };
    });
  };

  return (
    <Stack>
      <Text fw={600}>Permission Builder ({totalRules})</Text>

      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Resource</Table.Th>
            <Table.Th>Interactions</Table.Th>
            <Table.Th>Criteria</Table.Th>
            <Table.Th>Hidden Fields</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {value.length === 0 ? (
            <Table.Tr>
              <Table.Td colSpan={5}>
                <Text c="dimmed" size="sm">
                  No permission rules yet.
                </Text>
              </Table.Td>
            </Table.Tr>
          ) : (
            value.map((rule, index) => (
              <Table.Tr key={`${rule.resourceType}-${index}`}>
                <Table.Td>{rule.resourceType}</Table.Td>
                <Table.Td>{(rule.interaction || []).join(', ')}</Table.Td>
                <Table.Td>{rule.criteria || '-'}</Table.Td>
                <Table.Td>{(rule.hiddenFields || []).join(', ') || '-'}</Table.Td>
                <Table.Td>
                  <Button size="xs" color="red" variant="light" onClick={() => removeRule(index)}>
                    Remove
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))
          )}
        </Table.Tbody>
      </Table>

      <Stack gap="xs">
        <TextInput
          label="Resource Type"
          placeholder="Patient"
          value={draft.resourceType}
          onChange={(event) => setDraft((prev) => ({ ...prev, resourceType: event.currentTarget.value }))}
        />

        <Checkbox.Group label="Interactions" value={draft.interaction}>
          <Group>
            {INTERACTIONS.map((interaction) => (
              <Checkbox
                key={interaction}
                value={interaction}
                label={interaction}
                checked={draft.interaction.includes(interaction)}
                onChange={(event) => toggleInteraction(interaction, event.currentTarget.checked)}
              />
            ))}
          </Group>
        </Checkbox.Group>

        <TextInput
          label="Criteria (optional)"
          placeholder="Patient?_id=ALLOWED_EMPLOYEE_IDS"
          value={draft.criteria}
          onChange={(event) => setDraft((prev) => ({ ...prev, criteria: event.currentTarget.value }))}
        />

        <TextInput
          label="Hidden Fields (optional, comma-separated)"
          placeholder="address,birthDate,telecom"
          value={draft.hiddenFields}
          onChange={(event) => setDraft((prev) => ({ ...prev, hiddenFields: event.currentTarget.value }))}
        />

        <Group justify="flex-end">
          <Button onClick={addRule}>Add Rule</Button>
        </Group>
      </Stack>
    </Stack>
  );
}
