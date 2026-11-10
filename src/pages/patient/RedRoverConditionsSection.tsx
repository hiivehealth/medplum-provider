import { Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import type { Condition, Encounter } from '@medplum/fhirtypes';
import type { PatientSummarySectionConfig } from '@medplum/react';
import {
  CodeableConceptInput,
  DateTimeInput,
  Form,
  ProblemListSection,
  SubmitButton,
  summaryResourceListSection,
  useMedplum,
} from '@medplum/react';
import type { ComponentProps, JSX } from 'react';
import { useEffect, useState } from 'react';

const projectId = '8588313a-c8c6-4e07-8c1d-e684ed25e522';
const namespace = 'https://hiivehealth.com/fhir/red-rover/uat/five-patient-test';
type SectionProps = ComponentProps<typeof ProblemListSection.component>;
type DisplayCondition = Condition & {
  sourceEntryCount?: number;
  sourceConditionId?: string;
  sourceEntry?: boolean;
  sourceExpanded?: boolean;
};

const emphysemaSourceIds = new Set(['185305597', '185305603', '185305609']);

function emphysemaGroupKey(condition: Condition): string | undefined {
  if (
    conditionCategory(condition) !== 'Problem' ||
    !condition.identifier?.some(
      (identifier) => identifier.system === `${namespace}/problems` && emphysemaSourceIds.has(identifier.value ?? '')
    )
  ) {
    return undefined;
  }
  return JSON.stringify([
    condition.subject,
    condition.code,
    condition.clinicalStatus,
    condition.verificationStatus,
    condition.onsetDateTime,
    condition.abatementDateTime,
  ]);
}

function isRedRoverCondition(condition: Condition): boolean {
  return (
    condition.meta?.project === projectId &&
    Boolean(
      condition.identifier?.some((identifier) =>
        [`${namespace}/diagnoses`, `${namespace}/problems`].includes(identifier.system ?? '')
      )
    )
  );
}

function conditionCategory(condition: Condition): string {
  const categories = condition.category
    ?.flatMap((category) => category.coding ?? [])
    .filter((coding) => coding.system === 'http://terminology.hl7.org/CodeSystem/condition-category');
  const diagnosis = categories?.some((coding) => coding.code === 'encounter-diagnosis');
  const problem = categories?.some((coding) => coding.code === 'problem-list-item');
  return diagnosis && problem
    ? 'Problem / Encounter Diagnosis'
    : diagnosis
      ? 'Encounter Diagnosis'
      : problem
        ? 'Problem'
        : 'Uncategorized';
}

function displayDate(value: string | undefined): string {
  if (!value) {
    return 'Not recorded';
  }
  if (/^\d{4}$/.test(value)) {
    return `${value} (year only)`;
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    return `${value} (month only)`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'UTC',
        timeZoneName: 'short',
      }).format(date)
    : value;
}

function conditionName(condition: Condition): string {
  return (
    condition.code?.text ?? condition.code?.coding?.find((coding) => coding.display)?.display ?? 'Unnamed condition'
  );
}

function ConditionEditor({
  condition,
  onSaved,
}: {
  condition: Condition;
  onSaved: (condition: Condition) => void;
}): JSX.Element {
  const medplum = useMedplum();
  const [code, setCode] = useState(condition.code);
  const [clinicalStatus, setClinicalStatus] = useState(condition.clinicalStatus);
  const [dateChanged, setDateChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Form
      onSubmit={async (formData) => {
        setSaving(true);
        setError(undefined);
        try {
          const updated = await medplum.updateResource({
            ...condition,
            code,
            clinicalStatus,
            ...(dateChanged
              ? { onsetDateTime: formData.onsetDateTime ? new Date(formData.onsetDateTime).toISOString() : undefined }
              : {}),
          });
          onSaved(updated);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Unable to save condition');
        } finally {
          setSaving(false);
        }
      }}
    >
      <Stack>
        <CodeableConceptInput
          name="code"
          label="Problem"
          path="Condition.code"
          data-autofocus
          binding="http://hl7.org/fhir/us/core/ValueSet/us-core-condition-code"
          defaultValue={condition.code}
          onChange={setCode}
        />
        <TextInput label="Category" value={conditionCategory(condition)} readOnly />
        <CodeableConceptInput
          name="clinicalStatus"
          label="Status"
          path="Condition.clinicalStatus"
          binding="http://hl7.org/fhir/ValueSet/condition-clinical"
          defaultValue={condition.clinicalStatus}
          onChange={setClinicalStatus}
        />
        <DateTimeInput
          name="onsetDateTime"
          label="Dx Date"
          defaultValue={condition.onsetDateTime}
          required
          onChange={() => setDateChanged(true)}
        />
        {error && (
          <Text role="alert" c="red" size="sm">
            {error}
          </Text>
        )}
        <Group justify="flex-end" gap={4} mt="md">
          <SubmitButton loading={saving}>Save</SubmitButton>
        </Group>
      </Stack>
    </Form>
  );
}

const SharedConditionsSection = summaryResourceListSection({
  key: 'red-rover-conditions',
  title: 'Problems and Diagnoses',
  search: { resourceType: 'Condition' },
  getDisplayString: (resource) => {
    const condition = resource as DisplayCondition;
    const identifier = condition.identifier?.find((identifier) => identifier.system === `${namespace}/problems`);
    return condition.sourceEntry ? `Source entry ${identifier?.value ?? condition.id}` : conditionName(condition);
  },
  getStatus: (resource) => {
    const label = conditionCategory(resource as Condition);
    return { label, color: label === 'Problem' ? 'teal' : 'blue' };
  },
  getSecondaryText: (resource) => {
    const condition = resource as DisplayCondition;
    const label = condition.encounter?.display ?? condition.encounter?.reference;
    const problem = conditionCategory(condition) === 'Problem';
    const updated = condition.extension?.find(
      (extension) => extension.url === `${namespace}/source-date/createdUpdatedDateTime`
    )?.valueDateTime;
    const clinical = problem ? condition.clinicalStatus?.coding?.[0]?.code : undefined;
    const verification = problem ? condition.verificationStatus?.coding?.[0]?.code : undefined;
    return `${problem ? 'Onset' : 'Dx Date'}: ${displayDate(condition.onsetDateTime)}${clinical ? `; Status: ${clinical}` : ''}${verification ? `; Verification: ${verification}` : ''}${label ? `; Visit: ${label}` : ''}${condition.sourceEntryCount ? `; ${condition.sourceExpanded ? 'Hide' : 'Show'} ${condition.sourceEntryCount} source entries` : ''}${condition.sourceEntry && updated ? `; Source updated: ${displayDate(updated)}` : ''}`;
  },
}).component;

function RedRoverConditions(props: SectionProps): JSX.Element {
  const medplum = useMedplum();
  const [selected, setSelected] = useState<Condition>();
  const [updated, setUpdated] = useState<Record<string, Condition>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [visitDates, setVisitDates] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const references = new Set(
      Object.values(props.results)
        .flat()
        .filter(
          (resource): resource is Condition => resource.resourceType === 'Condition' && isRedRoverCondition(resource)
        )
        .map((condition) => condition.encounter?.reference)
        .filter((reference): reference is string => Boolean(reference))
    );
    for (const reference of references) {
      medplum
        .readReference<Encounter>({ reference })
        .then((encounter) => {
          if (active && encounter.period?.start) {
            setVisitDates((previous) => ({ ...previous, [reference]: displayDate(encounter.period?.start) }));
          }
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [medplum, props.results]);
  const conditions = Object.values(props.results)
    .flat()
    .filter((resource): resource is Condition => resource.resourceType === 'Condition');
  const imported = conditions
    .filter(isRedRoverCondition)
    .map((condition) => updated[condition.id ?? ''] ?? condition)
    .filter((condition) => !condition.verificationStatus?.coding?.some((coding) => coding.code === 'entered-in-error'));
  const DefaultSection = ProblemListSection.component;
  if (!conditions.some(isRedRoverCondition)) {
    return <DefaultSection {...props} />;
  }
  const localResults = Object.fromEntries(
    Object.entries(props.results).map(([key, resources]) => [
      key,
      resources.filter((resource) => resource.resourceType !== 'Condition' || !isRedRoverCondition(resource)),
    ])
  );
  const groups = new Map<string, Condition[]>();
  for (const condition of imported) {
    const key = emphysemaGroupKey(condition) ?? (condition.id as string);
    const group = groups.get(key) ?? [];
    group.push(condition);
    groups.set(key, group);
  }
  const displayConditions: DisplayCondition[] = [];
  for (const [key, group] of groups) {
    if (group.length === 1) {
      displayConditions.push(group[0]);
    } else {
      displayConditions.push({
        ...group[0],
        id: `group-${group[0].id}`,
        sourceEntryCount: group.length,
        sourceExpanded: expandedGroups.has(key),
      });
      if (expandedGroups.has(key)) {
        displayConditions.push(
          ...group.map((condition) => ({ ...condition, sourceEntry: true, sourceConditionId: condition.id }))
        );
      }
    }
  }
  return (
    <>
      {conditions.some((condition) => !isRedRoverCondition(condition)) && (
        <DefaultSection {...props} results={localResults} />
      )}
      <SharedConditionsSection
        {...props}
        results={{
          'red-rover-conditions': displayConditions.map((condition) => ({
            ...condition,
            encounter: condition.encounter && {
              ...condition.encounter,
              display: condition.encounter.display ?? visitDates[condition.encounter.reference ?? ''],
            },
          })),
        }}
        onClickResource={(resource) => {
          const condition = resource as DisplayCondition;
          if (condition.sourceEntryCount) {
            const key = emphysemaGroupKey(condition) as string;
            setExpandedGroups((previous) => {
              const next = new Set(previous);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            });
          } else {
            setSelected(imported.find((original) => original.id === (condition.sourceConditionId ?? condition.id)));
          }
        }}
      />
      <Modal
        opened={Boolean(selected)}
        onClose={() => setSelected(undefined)}
        title={selected && conditionCategory(selected) === 'Encounter Diagnosis' ? 'Edit Diagnosis' : 'Edit Problem'}
      >
        {selected && (
          <ConditionEditor
            key={selected.id}
            condition={selected}
            onSaved={(condition) => {
              setUpdated((previous) => ({ ...previous, [condition.id as string]: condition }));
              setSelected(undefined);
            }}
          />
        )}
      </Modal>
    </>
  );
}

export const redRoverConditionsSection: PatientSummarySectionConfig = {
  ...ProblemListSection,
  title: 'Problems and Diagnoses',
  component: RedRoverConditions,
};
