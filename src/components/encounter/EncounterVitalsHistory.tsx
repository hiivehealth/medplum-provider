// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { ActionIcon, Alert, Button, Divider, Group, LoadingOverlay, Modal, Stack, Text, Tooltip } from '@mantine/core';
import { formatDateTime, getReferenceString } from '@medplum/core';
import type { Encounter, Observation } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconTrash } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { showErrorNotification } from '../../utils/notifications';

interface VitalGroup {
  code: string;
  label: string;
  observations: Observation[];
}

export interface EncounterVitalsHistoryProps {
  encounter: Encounter;
  disabled?: boolean;
  refreshKey: number;
}

function getVitalLabel(observation: Observation): string {
  return observation.code?.coding?.[0]?.display ?? observation.code?.text ?? 'Vital sign';
}

function getVitalValue(observation: Observation): string {
  const quantity = observation.valueQuantity;
  if (!quantity?.value && quantity?.value !== 0) {
    return 'No value';
  }
  return `${quantity.value} ${quantity.unit ?? quantity.code ?? ''}`.trim();
}

function groupVitals(observations: Observation[]): VitalGroup[] {
  const groups = new Map<string, VitalGroup>();

  for (const observation of observations) {
    const coding = observation.code?.coding?.[0];
    const code = coding?.code ?? observation.code?.text ?? observation.id ?? 'unknown';
    const existing = groups.get(code);
    if (existing) {
      existing.observations.push(observation);
    } else {
      groups.set(code, { code, label: getVitalLabel(observation), observations: [observation] });
    }
  }

  return [...groups.values()];
}

export function EncounterVitalsHistory(props: EncounterVitalsHistoryProps): JSX.Element | null {
  const { encounter, disabled, refreshKey } = props;
  const medplum = useMedplum();
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState<Observation>();
  const [deleting, setDeleting] = useState(false);

  const loadVitals = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const resources = await medplum.searchResources(
        'Observation',
        `encounter=${encodeURIComponent(getReferenceString(encounter) ?? '')}&category=vital-signs&_sort=-date`,
        { cache: 'no-cache' }
      );
      setObservations(resources);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load recorded vitals.');
    } finally {
      setLoading(false);
    }
  }, [encounter, medplum]);

  useEffect(() => {
    void loadVitals();
  }, [loadVitals, refreshKey]);

  const handleDelete = async (): Promise<void> => {
    if (!pendingDelete?.id) {
      return;
    }

    setDeleting(true);
    try {
      await medplum.deleteResource('Observation', pendingDelete.id);
      setObservations((current) => current.filter((observation) => observation.id !== pendingDelete.id));
      setPendingDelete(undefined);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setDeleting(false);
    }
  };

  if (!loading && !error && observations.length === 0) {
    return null;
  }

  const groups = groupVitals(observations);

  return (
    <Stack gap="xs" pos="relative" aria-label="Recorded vitals">
      <LoadingOverlay visible={loading} overlayProps={{ radius: 'sm', blur: 1 }} />
      <Divider label="Recorded vitals" labelPosition="left" />
      {error && <Alert color="red" title="Unable to load recorded vitals">{error}</Alert>}
      {groups.map((group) => (
        <Stack gap={4} key={group.code}>
          <Text fw={600}>{group.label}: {getVitalValue(group.observations[0])}</Text>
          {group.observations.map((observation) => {
            const value = getVitalValue(observation);
            const dateTime = observation.effectiveDateTime ?? observation.meta?.lastUpdated;
            const recordedAt = typeof dateTime === 'string' ? formatDateTime(dateTime) : 'Time unavailable';
            const deleteLabel = `Delete ${group.label} reading ${value} recorded ${recordedAt}`;

            return (
              <Group justify="space-between" wrap="nowrap" key={observation.id ?? `${group.code}-${recordedAt}`} pl="md">
                <Text>{value}</Text>
                <Group gap="xs" wrap="nowrap">
                  <Text c="dimmed" size="sm">{recordedAt}</Text>
                  {!disabled && observation.id && (
                    <Tooltip label={deleteLabel}>
                      <ActionIcon aria-label={deleteLabel} color="red" variant="subtle" onClick={() => setPendingDelete(observation)}>
                        <IconTrash size={18} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              </Group>
            );
          })}
        </Stack>
      ))}
      <Modal opened={Boolean(pendingDelete)} onClose={() => setPendingDelete(undefined)} title="Delete recorded vital" centered>
        <Stack>
          <Text>
            Delete {pendingDelete ? `${getVitalLabel(pendingDelete)} ${getVitalValue(pendingDelete)}` : 'this vital'} from this unsigned encounter?
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPendingDelete(undefined)} disabled={deleting}>Cancel</Button>
            <Button color="red" onClick={() => void handleDelete()} loading={deleting}>Delete</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}