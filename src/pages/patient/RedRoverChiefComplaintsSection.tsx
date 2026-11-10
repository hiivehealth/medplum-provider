import { Modal, Stack, Text } from '@mantine/core';
import type { Observation } from '@medplum/fhirtypes';
import type { PatientSummarySectionConfig } from '@medplum/react';
import { summaryResourceListSection } from '@medplum/react';
import type { ComponentProps, JSX } from 'react';
import { useState } from 'react';

const namespace = 'https://hiivehealth.com/fhir/red-rover/uat/five-patient-test';
const projectId = '8588313a-c8c6-4e07-8c1d-e684ed25e522';
const sourceIds = new Set(['10330817993', '10330817995', '10330817997']);
const sourceId = (observation: Observation): string | undefined =>
  observation.identifier?.find((identifier) => identifier.system === `${namespace}/observations`)?.value;
const sourceStatus = (observation: Observation): string =>
  observation.extension?.find((extension) => extension.url === `${namespace}/observation-source-status`)?.valueCoding
    ?.display ?? 'Not supplied';
const createdUpdated = (observation: Observation): string | undefined =>
  observation.extension?.find((extension) => extension.url === `${namespace}/observation-source-created-updated`)
    ?.valueDateTime;
const performerId = (observation: Observation): string | undefined =>
  observation.extension?.find((extension) => extension.url === `${namespace}/observation-source-performed-by-id`)
    ?.valueString;

const nativeSection = summaryResourceListSection({
  key: 'red-rover-chief-complaints',
  title: 'Chief Complaints',
  search: { resourceType: 'Observation' },
  getDisplayString: (resource) => (resource as Observation).valueString ?? 'Text not supplied',
  getStatus: (resource) => ({ label: `Source: ${sourceStatus(resource as Observation)}`, color: 'gray' }),
  getSecondaryText: (resource) => {
    const observation = resource as Observation;
    return `Observation ${sourceId(observation)}; Observed: ${observation.effectiveDateTime ?? 'Not supplied'}`;
  },
});

function ChiefComplaints(props: ComponentProps<typeof nativeSection.component>): JSX.Element {
  const [selected, setSelected] = useState<Observation>();
  const observations = Object.values(props.results)
    .flat()
    .filter(
      (resource): resource is Observation =>
        resource.resourceType === 'Observation' &&
        resource.meta?.project === projectId &&
        resource.subject?.reference === `Patient/${props.patient.id}` &&
        sourceIds.has(sourceId(resource) ?? '') &&
        resource.meta.tag?.some(
          (tag) => tag.system === `${namespace}/mapping` && tag.code === 'owner-provisional-chief-complaints-v1'
        ) === true
    );
  const NativeSection = nativeSection.component;
  return (
    <>
      <NativeSection
        {...props}
        results={{ [nativeSection.key]: observations }}
        onClickResource={(resource) => setSelected(resource as Observation)}
      />
      <Modal opened={Boolean(selected)} onClose={() => setSelected(undefined)} title="Chief Complaint">
        {selected && (
          <Stack gap="xs" style={{ overflowWrap: 'anywhere' }}>
            <Text fw={600} style={{ whiteSpace: 'pre-wrap' }}>
              {selected.valueString ?? 'Text not supplied'}
            </Text>
            <Text size="sm">Source observation: {sourceId(selected)}</Text>
            <Text size="sm">Source status: {sourceStatus(selected)}</Text>
            <Text size="sm">Observed: {selected.effectiveDateTime ?? 'Not supplied'}</Text>
            <Text size="sm">Source created/updated: {createdUpdated(selected) ?? 'Not supplied'}</Text>
            <Text size="sm">Source performer ID: {performerId(selected) ?? 'Not supplied'}</Text>
            <Text size="sm">Clinical signature: Not supplied</Text>
          </Stack>
        )}
      </Modal>
    </>
  );
}

export const redRoverChiefComplaintsSection: PatientSummarySectionConfig = {
  ...nativeSection,
  component: ChiefComplaints,
};
