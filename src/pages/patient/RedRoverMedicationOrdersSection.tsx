import { Modal, Stack, Text } from '@mantine/core';
import type { MedicationRequest } from '@medplum/fhirtypes';
import type { PatientSummarySectionConfig } from '@medplum/react';
import { summaryResourceListSection } from '@medplum/react';
import type { ComponentProps, JSX } from 'react';
import { useState } from 'react';

const namespace = 'https://hiivehealth.com/fhir/red-rover/uat/five-patient-test';
const projectId = '8588313a-c8c6-4e07-8c1d-e684ed25e522';
const sourceIds = new Set(['9041332619', '9041332621', '9041332623', '9041332625', '9041332627']);
const sourceId = (order: MedicationRequest): string | undefined =>
  order.identifier?.find((identifier) => identifier.system === `${namespace}/medication-orders`)?.value;
const sourceStatus = (order: MedicationRequest): string =>
  order.extension?.find((extension) => extension.url === `${namespace}/medication-source-status`)?.valueCoding
    ?.display ?? 'Not supplied';
const period = (order: MedicationRequest) => order.dosageInstruction?.[0].timing?.repeat?.boundsPeriod;

const nativeSection = summaryResourceListSection({
  key: 'red-rover-medication-orders',
  title: 'Medication Orders',
  search: { resourceType: 'MedicationRequest' },
  getDisplayString: (resource) => (resource as MedicationRequest).medicationCodeableConcept?.text ?? 'Unnamed order',
  getStatus: (resource) => ({ label: `Source: ${sourceStatus(resource as MedicationRequest)}`, color: 'gray' }),
  getSecondaryText: (resource) => {
    const order = resource as MedicationRequest;
    return `Order ${sourceId(order)}; ${order.dosageInstruction?.[0].text ?? 'Instructions not supplied'}${period(order)?.end ? `; Stop: ${period(order)?.end}` : ''}`;
  },
});

function MedicationOrders(props: ComponentProps<typeof nativeSection.component>): JSX.Element {
  const [selected, setSelected] = useState<MedicationRequest>();
  const orders = Object.values(props.results)
    .flat()
    .filter(
      (resource): resource is MedicationRequest =>
        resource.resourceType === 'MedicationRequest' &&
        resource.meta?.project === projectId &&
        resource.subject.reference === `Patient/${props.patient.id}` &&
        sourceIds.has(sourceId(resource) ?? '') &&
        resource.meta.tag?.some(
          (tag) => tag.system === `${namespace}/mapping` && tag.code === 'owner-provisional-medication-orders-v1'
        ) === true
    );
  const NativeSection = nativeSection.component;
  return (
    <>
      <NativeSection
        {...props}
        results={{ [nativeSection.key]: orders }}
        onClickResource={(resource) => setSelected(resource as MedicationRequest)}
      />
      <Modal opened={Boolean(selected)} onClose={() => setSelected(undefined)} title="Medication Order">
        {selected && (
          <Stack gap="xs" style={{ overflowWrap: 'anywhere' }}>
            <Text fw={600}>{selected.medicationCodeableConcept?.text}</Text>
            <Text size="sm">Source order: {sourceId(selected)}</Text>
            <Text size="sm">Source status: {sourceStatus(selected)}</Text>
            <Text size="sm">Current use: Not established</Text>
            <Text size="sm">{selected.dosageInstruction?.[0].text ?? 'Instructions not supplied'}</Text>
            <Text size="sm">Ordered: {selected.authoredOn ?? 'Not supplied'}</Text>
            <Text size="sm">Start: {period(selected)?.start ?? 'Not supplied'}</Text>
            <Text size="sm">Stop: {period(selected)?.end ?? 'Not supplied'}</Text>
          </Stack>
        )}
      </Modal>
    </>
  );
}

export const redRoverMedicationOrdersSection: PatientSummarySectionConfig = {
  ...nativeSection,
  component: MedicationOrders,
};
