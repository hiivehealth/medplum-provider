// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { getResourceTypes, tryGetDataType } from '@medplum/core';
import { ActionIcon, Autocomplete, Button, Checkbox, Group, MultiSelect, NativeSelect, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import type { AccessPolicy } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';

type AccessPolicyRule = NonNullable<AccessPolicy['resource']>[number];

const INTERACTIONS = ['create', 'read', 'search', 'update', 'delete', 'history', 'vread'] as const;
const COMMON_CRITERIA_PARAMETERS = ['_id', 'subject', 'patient', 'encounter', 'performer', 'organization'];
const TOKEN_DESCRIPTION_MAP: Record<string, string> = {
  ALLOWED_PATIENT_IDS: 'IDs of patients this user is allowed to access.',
  CURRENT_USER_ID: 'ID of the currently logged-in user.',
  CURRENT_ORG_ID: 'ID of the current organization context.',
  ALLOWED_ENCOUNTER_IDS: 'IDs of encounters this user is allowed to access.',
  CURRENT_PRACTITIONER_ID: 'Practitioner ID associated with the current user.',
};
const PATIENT_SCOPE_PARAMETER_BY_RESOURCE: Record<string, string> = {
  Encounter: 'subject',
  Observation: 'subject',
  Condition: 'subject',
  Task: 'for',
  QuestionnaireResponse: 'subject',
  EpisodeOfCare: 'patient',
  CarePlan: 'subject',
  MedicationRequest: 'subject',
  DiagnosticReport: 'subject',
  Procedure: 'subject',
  Immunization: 'patient',
  DocumentReference: 'subject',
};
const COMMON_RESOURCE_TYPES = [
  'Patient',
  'Encounter',
  'Observation',
  'Condition',
  'Task',
  'Questionnaire',
  'QuestionnaireResponse',
  'EpisodeOfCare',
  'CarePlan',
  'MedicationRequest',
  'DiagnosticReport',
  'Procedure',
  'Immunization',
  'DocumentReference',
  'Organization',
  'Practitioner',
  'PractitionerRole',
  'Location',
  'Appointment',
  'Schedule',
  'Slot',
  'ProjectMembership',
  'AccessPolicy',
  'AuditEvent',
] as const;

const RESOURCE_HIDDEN_FIELD_HINTS: Record<string, string[]> = {
  Patient: ['name', 'telecom', 'address', 'birthDate', 'gender', 'identifier', 'communication'],
  Encounter: ['status', 'class', 'type', 'subject', 'participant', 'period', 'reasonCode', 'location'],
  Observation: [
    'status',
    'category',
    'code',
    'subject',
    'effectiveDateTime',
    'valueQuantity',
    'valueString',
    'interpretation',
  ],
  Condition: ['clinicalStatus', 'verificationStatus', 'category', 'code', 'subject', 'onsetDateTime', 'recordedDate'],
  Task: ['status', 'intent', 'priority', 'code', 'focus', 'for', 'authoredOn', 'owner'],
  QuestionnaireResponse: ['status', 'subject', 'authored', 'author', 'item'],
  EpisodeOfCare: ['status', 'type', 'diagnosis', 'patient', 'managingOrganization', 'period', 'careManager'],
  CarePlan: ['status', 'intent', 'category', 'subject', 'period', 'careTeam', 'goal', 'activity'],
  MedicationRequest: ['status', 'intent', 'medicationCodeableConcept', 'subject', 'authoredOn', 'requester', 'dosageInstruction'],
  DiagnosticReport: ['status', 'category', 'code', 'subject', 'effectiveDateTime', 'performer', 'result'],
  Procedure: ['status', 'category', 'code', 'subject', 'performedDateTime', 'performer', 'reasonCode'],
  Immunization: ['status', 'vaccineCode', 'patient', 'occurrenceDateTime', 'primarySource', 'lotNumber'],
  DocumentReference: ['status', 'type', 'category', 'subject', 'date', 'author', 'content'],
  Organization: ['identifier', 'active', 'type', 'name', 'telecom', 'address'],
  Practitioner: ['identifier', 'active', 'name', 'telecom', 'address', 'qualification'],
  PractitionerRole: ['practitioner', 'organization', 'code', 'specialty', 'telecom', 'location'],
  Location: ['status', 'name', 'description', 'mode', 'type', 'telecom', 'address'],
  Appointment: ['status', 'serviceCategory', 'serviceType', 'appointmentType', 'start', 'end', 'participant'],
  Schedule: ['active', 'serviceCategory', 'serviceType', 'specialty', 'actor', 'planningHorizon'],
  Slot: ['schedule', 'status', 'start', 'end', 'overbooked', 'comment'],
  ProjectMembership: ['project', 'user', 'profile', 'accessPolicy', 'access', 'admin'],
  AccessPolicy: ['name', 'compartment', 'resource'],
  AuditEvent: ['type', 'subtype', 'action', 'recorded', 'outcome', 'agent', 'entity'],
};

type DraftRule = {
  resourceType: string;
  interaction: string[];
  criteria: string;
  hiddenFields: string[];
};

const EMPTY_RULE: DraftRule = {
  resourceType: '',
  interaction: ['read', 'search'],
  criteria: '',
  hiddenFields: [],
};

export type PermissionBuilderProps = {
  value: AccessPolicyRule[];
  onChange: (next: AccessPolicyRule[]) => void;
};

export function PermissionBuilder(props: PermissionBuilderProps): JSX.Element {
  const { value, onChange } = props;
  const medplum = useMedplum();
  const [draft, setDraft] = useState<DraftRule>(EMPTY_RULE);
  const [editingRuleIndex, setEditingRuleIndex] = useState<number | null>(null);
  const [schemaReloadCounter, setSchemaReloadCounter] = useState(0);
  const [criteriaMode, setCriteriaMode] = useState<'none' | 'preset' | 'id-token' | 'field-token' | 'manual'>('none');
  const [criteriaField, setCriteriaField] = useState('_id');
  const [criteriaValue, setCriteriaValue] = useState('ALLOWED_EMPLOYEE_IDS');
  const [criteriaPreset, setCriteriaPreset] = useState('');

  const totalRules = useMemo(() => value.length, [value.length]);
  const resourceTypeOptions = useMemo(() => {
    const medplumTypes = getResourceTypes();
    const currentPolicyTypes = value.map((rule) => rule.resourceType).filter(Boolean);
    return [...new Set([...COMMON_RESOURCE_TYPES, ...currentPolicyTypes, ...medplumTypes])].sort((a, b) =>
      a.localeCompare(b)
    );
  }, [value]);

  useEffect(() => {
    if (!draft.resourceType) {
      return;
    }

    medplum
      .requestSchema(draft.resourceType)
      .then(() => setSchemaReloadCounter((prev) => prev + 1))
      .catch(() => undefined);
  }, [draft.resourceType, medplum]);

  const hiddenFieldOptions = useMemo(() => {
    if (!draft.resourceType) {
      return [];
    }

    const typeSchema = tryGetDataType(draft.resourceType);
    const fallbackFields = RESOURCE_HIDDEN_FIELD_HINTS[draft.resourceType] ?? [];
    if (!typeSchema) {
      return fallbackFields;
    }

    const prefix = `${draft.resourceType}.`;
    const ignoredFields = new Set([
      'id',
      'meta',
      'implicitRules',
      'language',
      'text',
      'contained',
      'extension',
      'modifierExtension',
      'resourceType',
    ]);

    return [
      ...new Set(
        Object.keys(typeSchema.elements)
          .filter((path) => path.startsWith(prefix))
          .map((path) => path.slice(prefix.length))
          .filter(Boolean)
          .map((path) => path.split('.')[0].replace('[x]', ''))
          .filter((fieldName) => fieldName.length > 0 && !ignoredFields.has(fieldName))
          .concat(fallbackFields)
      ),
    ].sort((a, b) => a.localeCompare(b));
  }, [draft.resourceType, schemaReloadCounter]);

  const criteriaParameterOptions = useMemo(
    () => [...new Set([...COMMON_CRITERIA_PARAMETERS, ...hiddenFieldOptions])].sort((a, b) => a.localeCompare(b)),
    [hiddenFieldOptions]
  );

  const criteriaPresetOptions = useMemo(() => {
    const resourceType = draft.resourceType || 'Patient';
    const idTokenName = `ALLOWED_${resourceType.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_IDS`;
    const options = [
      {
        value: 'assigned-patients',
        label: 'Assigned patients only',
        criteria: 'Patient?_id=ALLOWED_PATIENT_IDS',
      },
    ];

    if (resourceType !== 'Patient') {
      options.push({
        value: 'resource-ids',
        label: `Only allowed ${resourceType} records`,
        criteria: `${resourceType}?_id=${idTokenName}`,
      });
    }

    const patientScopeParameter = PATIENT_SCOPE_PARAMETER_BY_RESOURCE[resourceType];
    if (patientScopeParameter) {
      options.unshift({
        value: 'patient-scope',
        label: 'Records linked to assigned patients',
        criteria: `${resourceType}?${patientScopeParameter}=ALLOWED_PATIENT_IDS`,
      });
    }

    return options;
  }, [draft.resourceType]);

  const criteriaValueSuggestions = useMemo(() => {
    if (criteriaMode !== 'id-token' && criteriaMode !== 'field-token') {
      return [];
    }

    const resourceType = draft.resourceType || 'Patient';
    const resourceIdToken = `ALLOWED_${resourceType.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_IDS`;
    const common = ['ALLOWED_PATIENT_IDS', 'CURRENT_USER_ID', 'CURRENT_ORG_ID'];

    if (criteriaMode === 'id-token') {
      return [...new Set([resourceIdToken, ...common])];
    }

    const fieldSpecific: Record<string, string[]> = {
      _id: [resourceIdToken],
      subject: ['ALLOWED_PATIENT_IDS'],
      patient: ['ALLOWED_PATIENT_IDS'],
      for: ['ALLOWED_PATIENT_IDS'],
      encounter: ['ALLOWED_ENCOUNTER_IDS'],
      organization: ['CURRENT_ORG_ID'],
      performer: ['CURRENT_PRACTITIONER_ID', 'CURRENT_USER_ID'],
    };

    return [...new Set([...(fieldSpecific[criteriaField] ?? []), ...common])];
  }, [criteriaMode, criteriaField, draft.resourceType]);

  const criteriaSuggestionDescriptions = useMemo(() => {
    return criteriaValueSuggestions.map((token) => {
      const dynamicResourceTokenMatch = token.match(/^ALLOWED_(.+)_IDS$/);
      const dynamicDescription = dynamicResourceTokenMatch
        ? `IDs of ${dynamicResourceTokenMatch[1].toLowerCase().replace(/_/g, ' ')} records this user is allowed to access.`
        : undefined;
      return {
        token,
        description: TOKEN_DESCRIPTION_MAP[token] ?? dynamicDescription ?? 'Context-specific token value.',
      };
    });
  }, [criteriaValueSuggestions]);

  useEffect(() => {
    if (!criteriaParameterOptions.includes(criteriaField)) {
      setCriteriaField(criteriaParameterOptions[0] ?? '_id');
    }
  }, [criteriaField, criteriaParameterOptions]);

  useEffect(() => {
    if (!criteriaPresetOptions.length) {
      setCriteriaPreset('');
      return;
    }

    if (!criteriaPresetOptions.some((option) => option.value === criteriaPreset)) {
      setCriteriaPreset(criteriaPresetOptions[0].value);
    }
  }, [criteriaPreset, criteriaPresetOptions]);

  useEffect(() => {
    if (!draft.resourceType) {
      setDraft((prev) => ({ ...prev, criteria: '' }));
      return;
    }

    if (criteriaMode === 'manual') {
      return;
    }

    if (criteriaMode === 'none') {
      setDraft((prev) => ({ ...prev, criteria: '' }));
      return;
    }

    if (criteriaMode === 'preset') {
      const selectedPreset = criteriaPresetOptions.find((option) => option.value === criteriaPreset);
      setDraft((prev) => ({ ...prev, criteria: selectedPreset?.criteria ?? '' }));
      return;
    }

    const value = criteriaValue.trim();
    if (!value) {
      setDraft((prev) => ({ ...prev, criteria: '' }));
      return;
    }

    if (criteriaMode === 'id-token') {
      setDraft((prev) => ({ ...prev, criteria: `${draft.resourceType}?_id=${value}` }));
      return;
    }

    setDraft((prev) => ({ ...prev, criteria: `${draft.resourceType}?${criteriaField}=${value}` }));
  }, [criteriaMode, criteriaField, criteriaValue, criteriaPreset, criteriaPresetOptions, draft.resourceType]);

  const addRule = (): void => {
    if (!draft.resourceType.trim() || draft.interaction.length === 0) {
      return;
    }

    const nextRule: AccessPolicyRule = {
      resourceType: draft.resourceType.trim(),
      interaction: draft.interaction as AccessPolicyRule['interaction'],
      criteria: draft.criteria.trim() || undefined,
      hiddenFields: draft.hiddenFields,
    };

    if (editingRuleIndex !== null) {
      onChange(value.map((rule, index) => (index === editingRuleIndex ? nextRule : rule)));
    } else {
      onChange([...value, nextRule]);
    }
    setDraft(EMPTY_RULE);
    setEditingRuleIndex(null);
    setCriteriaMode('none');
    setCriteriaField('_id');
    setCriteriaValue('ALLOWED_EMPLOYEE_IDS');
    setCriteriaPreset('');
  };

  const removeRule = (index: number): void => {
    onChange(value.filter((_, i) => i !== index));
    if (editingRuleIndex === index) {
      setEditingRuleIndex(null);
      setDraft(EMPTY_RULE);
      setCriteriaMode('none');
      return;
    }
    if (editingRuleIndex !== null && index < editingRuleIndex) {
      setEditingRuleIndex(editingRuleIndex - 1);
    }
  };

  const editRule = (index: number): void => {
    const rule = value[index];
    if (!rule) {
      return;
    }

    setEditingRuleIndex(index);
    setDraft({
      resourceType: rule.resourceType || '',
      interaction: [...(rule.interaction || ['read', 'search'])],
      criteria: rule.criteria || '',
      hiddenFields: [...(rule.hiddenFields || [])],
    });

    if (!rule.criteria) {
      setCriteriaMode('none');
      return;
    }

    setCriteriaMode('manual');
  };

  const cancelEdit = (): void => {
    setEditingRuleIndex(null);
    setDraft(EMPTY_RULE);
    setCriteriaMode('none');
    setCriteriaField('_id');
    setCriteriaValue('ALLOWED_EMPLOYEE_IDS');
    setCriteriaPreset('');
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
                  <Group gap="xs">
                    <Button size="xs" variant="light" onClick={() => editRule(index)}>
                      Edit
                    </Button>
                    <Button size="xs" color="red" variant="light" onClick={() => removeRule(index)}>
                      Remove
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))
          )}
        </Table.Tbody>
      </Table>

      <Stack gap="xs">
        <NativeSelect
          label="Resource Type"
          data={[
            { value: '', label: 'Select resource type' },
            ...resourceTypeOptions.map((resourceType) => ({ value: resourceType, label: resourceType })),
          ]}
          value={draft.resourceType}
          onChange={(event) => {
            const resourceType = event.currentTarget.value;
            setDraft((prev) => ({ ...prev, resourceType, hiddenFields: [] }));
          }}
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

        <NativeSelect
          label="Criteria Mode"
          description="Use guided options to generate valid criteria, or switch to manual mode for advanced expressions."
          value={criteriaMode}
          onChange={(event) => {
            const mode = event.currentTarget.value as 'none' | 'preset' | 'id-token' | 'field-token' | 'manual';
            setCriteriaMode(mode);
          }}
          data={[
            { value: 'none', label: 'No criteria (full access for this resource)' },
            { value: 'preset', label: 'Business-friendly preset' },
            { value: 'id-token', label: 'Limit by resource IDs token' },
            { value: 'field-token', label: 'Limit by field/value token' },
            { value: 'manual', label: 'Manual criteria (advanced)' },
          ]}
        />

        {criteriaMode === 'preset' && (
          <NativeSelect
            label="Preset"
            description="Select a business intent and the criteria string will be generated automatically."
            value={criteriaPreset}
            data={criteriaPresetOptions.map((option) => ({ value: option.value, label: option.label }))}
            onChange={(event) => {
              const preset = event.currentTarget.value;
              setCriteriaPreset(preset);
              if (!draft.resourceType && preset === 'assigned-patients') {
                setDraft((prev) => ({ ...prev, resourceType: 'Patient' }));
              }
            }}
            disabled={criteriaPresetOptions.length === 0}
          />
        )}

        {criteriaMode === 'field-token' && (
          <NativeSelect
            label="Field"
            value={criteriaField}
            data={criteriaParameterOptions.map((field) => ({ value: field, label: field }))}
            onChange={(event) => {
              const field = event.currentTarget.value;
              setCriteriaField(field);
            }}
          />
        )}

        {(criteriaMode === 'id-token' || criteriaMode === 'field-token') && (
          <>
            <Autocomplete
              label="Token Or Value"
              placeholder="ALLOWED_PATIENT_IDS"
              description="Type a value or pick a suggestion from the dropdown list. Use the X button to clear."
              value={criteriaValue}
              onChange={(event) => {
                setCriteriaValue(event);
              }}
              data={criteriaValueSuggestions}
              comboboxProps={{ width: 'target' }}
              rightSection={
                criteriaValue ? (
                  <ActionIcon
                    variant="subtle"
                    aria-label="Clear token or value"
                    onClick={() => setCriteriaValue('')}
                  >
                    <IconX size={14} />
                  </ActionIcon>
                ) : undefined
              }
            />

            {criteriaSuggestionDescriptions.length > 0 && (
              <Stack gap={2}>
                <Text size="sm" c="dimmed" fw={500}>
                  Suggested token meanings:
                </Text>
                {criteriaSuggestionDescriptions.map((item) => (
                  <Text key={item.token} size="sm" c="dimmed">
                    {item.token}: {item.description}
                  </Text>
                ))}
              </Stack>
            )}
          </>
        )}

        {criteriaMode === 'manual' ? (
          <TextInput
            label="Criteria (manual)"
            placeholder="Patient?_id=ALLOWED_EMPLOYEE_IDS"
            value={draft.criteria}
            onChange={(event) => {
              const criteria = event.currentTarget.value;
              setDraft((prev) => ({ ...prev, criteria }));
            }}
          />
        ) : (
          <TextInput label="Criteria Preview" value={draft.criteria} readOnly placeholder="No criteria" />
        )}

        <MultiSelect
          label="Hidden Fields (optional)"
          placeholder={draft.resourceType ? 'Select fields to hide' : 'Select a resource type first'}
          description="Choose top-level FHIR fields to hide for this rule."
          data={hiddenFieldOptions}
          value={draft.hiddenFields}
          onChange={(hiddenFields) => setDraft((prev) => ({ ...prev, hiddenFields }))}
          disabled={!draft.resourceType}
          searchable
          clearable
          nothingFoundMessage={draft.resourceType ? 'No known fields for this resource type' : 'Select a resource type first'}
        />

        <Group justify="flex-end">
          {editingRuleIndex !== null && (
            <Button variant="default" onClick={cancelEdit}>
              Cancel
            </Button>
          )}
          <Button onClick={addRule}>{editingRuleIndex !== null ? 'Update Rule' : 'Add Rule'}</Button>
        </Group>
      </Stack>
    </Stack>
  );
}
