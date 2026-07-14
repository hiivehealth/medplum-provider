// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Accordion, ActionIcon, Badge, Button, Card, Group, Select, Stack, Text, Title } from '@mantine/core';
import { createReference, getReferenceString } from '@medplum/core';
import type { Encounter, MedicationRequest, Patient, Practitioner, ServiceRequest } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { showErrorNotification } from '../../../utils/notifications';

type Order = ServiceRequest | MedicationRequest;
type OrderType = 'lab' | 'imaging' | 'procedure' | 'medication' | 'immunization';

interface OrdersPanelProps {
  encounter: Encounter;
  patient: Patient;
  practitioner?: Practitioner;
  disabled?: boolean;
}



const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: 'lab', label: 'Lab' },
  { value: 'imaging', label: 'Imaging' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'medication', label: 'Medication' },
  { value: 'immunization', label: 'Immunization' },
];

const ORDER_SETS: { value: string; label: string }[] = [
  { value: 'https://hiivehealth.com/plandefinition/sick-call', label: 'Sick Call defaults' },
];

export function OrdersPanel(props: OrdersPanelProps): JSX.Element {
  const { encounter, patient, practitioner, disabled } = props;
  const medplum = useMedplum();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedType, setSelectedType] = useState<OrderType | null>(null);
  const [orderText, setOrderText] = useState('');
  const [selectedOrderSet, setSelectedOrderSet] = useState<string | null>(null);
  const [applyingOrderSet, setApplyingOrderSet] = useState(false);

  const encounterRef = createReference(encounter);
  const patientRef = createReference(patient);
  const practitionerRef = practitioner ? createReference(practitioner) : undefined;

  const loadOrders = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [serviceRequests, medicationRequests] = await Promise.all([
        medplum.searchResources('ServiceRequest', `encounter=${getReferenceString(encounter)}`, { cache: 'no-cache' }),
        medplum.searchResources('MedicationRequest', `encounter=${getReferenceString(encounter)}`, { cache: 'no-cache' }),
      ]);
      setOrders([...serviceRequests, ...medicationRequests]);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [encounter, medplum]);

  useEffect(() => {
    loadOrders().catch(showErrorNotification);
  }, [loadOrders]);

  const addOrder = useCallback(async (): Promise<void> => {
    if (!selectedType || !orderText.trim()) {
      return;
    }

    try {
      if (selectedType === 'medication') {
        const created = await medplum.createResource<MedicationRequest>({
          resourceType: 'MedicationRequest',
          status: 'draft',
          intent: 'order',
          medicationCodeableConcept: { text: orderText.trim() },
          subject: patientRef,
          encounter: encounterRef,
          requester: practitionerRef,
        });
        setOrders((prev) => [...prev, created]);
      } else {
        const category = getServiceRequestCategory(selectedType);

        const created = await medplum.createResource<ServiceRequest>({
          resourceType: 'ServiceRequest',
          status: 'draft',
          intent: 'order',
          category: [category],
          code: { text: orderText.trim() },
          subject: patientRef,
          encounter: encounterRef,
          requester: practitionerRef,
        });
        setOrders((prev) => [...prev, created]);
      }
      setOrderText('');
      setSelectedType(null);
    } catch (err) {
      showErrorNotification(err);
    }
  }, [selectedType, orderText, medplum, patientRef, encounterRef, practitionerRef]);

  const removeOrder = useCallback(
    async (order: Order): Promise<void> => {
      try {
        await medplum.deleteResource(order.resourceType, order.id as string);
        setOrders((prev) => prev.filter((o) => o.id !== order.id));
      } catch (err) {
        showErrorNotification(err);
      }
    },
    [medplum]
  );

  const applyOrderSet = useCallback(async (): Promise<void> => {
    if (!selectedOrderSet) {
      return;
    }

    setApplyingOrderSet(true);
    try {
      const planDefinition = await medplum.searchOne('PlanDefinition', { url: selectedOrderSet });
      if (!planDefinition?.id) {
        throw new Error(`PlanDefinition not found: ${selectedOrderSet}`);
      }

      await medplum.post(medplum.fhirUrl('PlanDefinition', planDefinition.id, '$apply'), {
        resourceType: 'Parameters',
        parameter: [
          { name: 'subject', valueString: getReferenceString(patient) },
          { name: 'encounter', valueString: getReferenceString(encounter) },
          ...(practitioner ? [{ name: 'practitioner', valueString: getReferenceString(practitioner) }] : []),
        ],
      });

      await loadOrders();
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setApplyingOrderSet(false);
    }
  }, [selectedOrderSet, medplum, patient, encounter, practitioner, loadOrders]);

  const getOrderTitle = (order: Order): string => {
    if (order.resourceType === 'MedicationRequest') {
      return order.medicationCodeableConcept?.text || 'Medication order';
    }
    return order.code?.text || order.code?.coding?.[0]?.display || `${order.resourceType}`;
  };

  const getOrderStatusBadge = (status: string): JSX.Element => {
    let color: string;
    if (status === 'completed') {
      color = 'green';
    } else if (status === 'draft') {
      color = 'yellow';
    } else {
      color = 'blue';
    }
    return <Badge color={color}>{status}</Badge>;
  };

  function getServiceRequestCategory(type: OrderType): { coding: { system: string; code: string; display: string }[] } {
    if (type === 'lab') {
      return { coding: [{ system: 'http://snomed.info/sct', code: '108252007', display: 'Laboratory procedure' }] };
    }
    if (type === 'imaging') {
      return { coding: [{ system: 'http://snomed.info/sct', code: '363679005', display: 'Imaging' }] };
    }
    if (type === 'immunization') {
      return { coding: [{ system: 'http://snomed.info/sct', code: '33879002', display: 'Immunization' }] };
    }
    return { coding: [{ system: 'http://snomed.info/sct', code: '387713003', display: 'Surgical procedure' }] };
  }

  return (
    <Card withBorder shadow="sm" mt="md">
      <Stack gap="sm">
        <Title order={3}>Orders</Title>

        <Accordion variant="separated" defaultValue="add-order">
          <Accordion.Item value="add-order">
            <Accordion.Control disabled={disabled}>+ Add Order</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <Select
                  label="Order type"
                  placeholder="Select order type"
                  data={ORDER_TYPES}
                  value={selectedType}
                  onChange={(value) => setSelectedType(value as OrderType)}
                  disabled={disabled}
                />
                {selectedType && (
                  <>
                    <Text size="sm" fw={500}>
                      Order description
                    </Text>
                    <input
                      type="text"
                      value={orderText}
                      onChange={(e) => setOrderText(e.target.value)}
                      placeholder="Enter order description"
                      disabled={disabled}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: '4px',
                        border: '1px solid #ced4da',
                      }}
                    />
                    <Button onClick={addOrder} disabled={disabled || !orderText.trim()} leftSection={<IconPlus size={16} />}>
                      Add Order
                    </Button>
                  </>
                )}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="order-sets">
            <Accordion.Control disabled={disabled}>Apply Order Set</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <Select
                  label="Order set"
                  placeholder="Select order set"
                  data={ORDER_SETS}
                  value={selectedOrderSet}
                  onChange={setSelectedOrderSet}
                  disabled={disabled}
                />
                <Button onClick={applyOrderSet} loading={applyingOrderSet} disabled={disabled || !selectedOrderSet}>
                  Apply Order Set
                </Button>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>

        {loading && <Text size="sm" c="dimmed">Loading orders...</Text>}

        {orders.length === 0 && !loading && <Text size="sm" c="dimmed">No orders placed.</Text>}

        {orders.map((order) => (
          <Group key={order.id} justify="space-between" p="xs" style={{ border: '1px solid #e9ecef', borderRadius: '4px' }}>
            <div>
              <Text size="sm" fw={500}>
                {getOrderTitle(order)}
              </Text>
              <Text size="xs" c="dimmed">
                {order.resourceType}
              </Text>
            </div>
            <Group gap="xs">
              {getOrderStatusBadge(order.status as string)}
              <ActionIcon
                color="red"
                variant="subtle"
                onClick={() => removeOrder(order)}
                disabled={disabled}
                aria-label={`Remove ${getOrderTitle(order)}`}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}
