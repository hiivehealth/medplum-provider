import { ActionIcon, Alert, Anchor, Badge, Button, Group, Loader, Stack, Text, Title, Tooltip } from '@mantine/core';
import type { Task } from '@medplum/fhirtypes';
import { ResourceName, useMedplum, useMedplumProfile } from '@medplum/react';
import { IconCheck, IconPlayerPlay, IconRefresh } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { getHawaiiConsentStatus } from './consent';
import { HAWAII_FOLLOW_UP_SYSTEM } from './followUp';

function isAssignedFollowUp(task: Task, ownerReference: string): boolean {
  return task.owner?.reference === ownerReference &&
    /^Patient\/[A-Za-z0-9.-]+$/.test(task.for?.reference ?? '') &&
    /^Encounter\/[A-Za-z0-9.-]+$/.test(task.focus?.reference ?? '') &&
    task.identifier?.some((identifier) => identifier.system === HAWAII_FOLLOW_UP_SYSTEM &&
      identifier.value === task.focus?.reference) === true;
}

function formatTime(value: string | undefined): string {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-US', {
    timeZone: 'Pacific/Honolulu', timeZoneName: 'short',
  }) : 'Not recorded';
}

export function HawaiiFollowUpPage(): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const ownerReference = profile?.resourceType === 'Practitioner' && profile.id ? `Practitioner/${profile.id}` : '';
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setTasks([]);
    const load = async (): Promise<void> => {
      try {
        if (!ownerReference) { throw new Error('An assigned clinician is required'); }
        const results = await medplum.searchResources('Task', {
          owner: ownerReference, identifier: `${HAWAII_FOLLOW_UP_SYSTEM}|`, _count: '50',
        }, { cache: 'no-cache' });
        const assigned = results.filter((task) => isAssignedFollowUp(task, ownerReference));
        const patientReferences = [...new Set(assigned.map((task) => task.for?.reference as string))];
        for (const reference of patientReferences) {
          const consents = await medplum.searchResources('Consent', {
            patient: reference, status: 'active', _count: '2',
          }, { cache: 'no-cache' });
          if (getHawaiiConsentStatus(consents, reference.slice('Patient/'.length)) !== 'opt-in') {
            throw new Error('Follow-up sharing permission is unavailable');
          }
        }
        if (!cancelled) {
          setTasks(assigned.sort((left, right) => (right.authoredOn ?? '').localeCompare(left.authoredOn ?? '')));
        }
      } catch {
        if (!cancelled) { setFailed(true); }
      } finally {
        if (!cancelled) { setLoading(false); }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [medplum, ownerReference, revision]);

  const advance = async (task: Task): Promise<void> => {
    if (!task.id || busy) { return; }
    setBusy(true);
    try {
      const current = await medplum.readResource('Task', task.id, { cache: 'no-cache' });
      if (!isAssignedFollowUp(current, ownerReference) || current.status !== task.status || !current.meta?.versionId ||
        !['requested', 'in-progress'].includes(current.status)) {
        throw new Error('The assigned follow-up changed; refresh before updating');
      }
      const reference = current.for?.reference as string;
      const consents = await medplum.searchResources('Consent', {
        patient: reference, status: 'active', _count: '2',
      }, { cache: 'no-cache' });
      if (getHawaiiConsentStatus(consents, reference.slice('Patient/'.length)) !== 'opt-in') {
        throw new Error('Follow-up sharing permission is unavailable');
      }
      await medplum.updateResource({
        ...current, status: current.status === 'requested' ? 'in-progress' : 'completed',
        lastModified: new Date().toISOString(),
      }, { headers: { 'If-Match': `W/"${current.meta.versionId}"` } });
      setRevision((value) => value + 1);
    } catch {
      setTasks([]);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return <Stack p="md">
    <Group justify="space-between">
      <Title order={2}>Follow-up work</Title>
      <Tooltip label="Refresh follow-up work"><ActionIcon aria-label="Refresh follow-up work" variant="subtle"
        disabled={loading || busy} onClick={() => setRevision((value) => value + 1)}><IconRefresh size={18} /></ActionIcon></Tooltip>
    </Group>
    <Text c="dimmed" size="sm">Synthetic demonstration</Text>
    {loading ? <Loader aria-label="Loading follow-up work" /> : failed ?
      <Alert color="red" title="Follow-up unavailable">Access or the current task state could not be verified. Refresh to retry.</Alert> :
      tasks.length === 0 ? <Text>No assigned follow-up work.</Text> : tasks.map((task) => <Stack key={task.id} gap="xs"
        role="region" aria-label={`Follow-up for ${task.focus?.reference}`}
        py="md" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Group justify="space-between" align="start">
          <Text fw={600}>{task.code?.text ?? 'Post-discharge follow-up'}</Text>
          <Badge color={task.status === 'completed' ? 'green' : 'blue'}>{task.status === 'in-progress' ? 'In progress' : task.status}</Badge>
        </Group>
        <Text fw={500} size="sm"><ResourceName value={task.for} /></Text>
        <Text size="sm">{task.description}</Text>
        <Text size="sm">Discharged: {formatTime(task.input?.find((input) => input.type.text === 'Discharge event time')?.valueDateTime)}</Text>
        <Text size="sm" c="dimmed">Received: {formatTime(task.authoredOn)}</Text>
        <Group wrap="wrap">
          <Anchor component={Link} to={`/hie/patients/${task.for?.reference?.slice('Patient/'.length)}`}>Review patient</Anchor>
          <Anchor component={Link} to={`/hie/patients/${task.for?.reference?.slice('Patient/'.length)}#${task.focus?.reference?.replace('/', '-')}`}>Source discharge</Anchor>
          {['requested', 'in-progress'].includes(task.status) && <Button variant="light" size="xs" disabled={busy}
            leftSection={task.status === 'requested' ? <IconPlayerPlay size={16} /> : <IconCheck size={16} />}
            onClick={() => void advance(task)}>{task.status === 'requested' ? 'Start follow-up' : 'Complete follow-up'}</Button>}
        </Group>
      </Stack>)}
  </Stack>;
}