import { ActionIcon, Alert, Badge, Box, Group, List, Loader, SimpleGrid, Stack, Text, Title, Tooltip } from '@mantine/core';
import type { Basic } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconRefresh } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { HAWAII_ONBOARDING_SITE, HAWAII_ONBOARDING_SYSTEM, readHawaiiOnboardingSnapshot,
  summarizeHawaiiOnboarding, type HawaiiOnboardingSnapshot } from './onboarding';

const labels: Record<string, string> = { assessment: 'Assessment', connectivity: 'Connectivity', mapping: 'Mapping',
  validation: 'Validation', cutover: 'Cutover', monitoring: 'Monitoring', completed: 'Completed',
  'in-progress': 'In progress', 'not-started': 'Not started', blocked: 'Blocked' };

function time(value: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Pacific/Honolulu' }).format(new Date(value)) + ' HST';
}

type Evidence = { resource: Basic; snapshot: HawaiiOnboardingSnapshot; retrievedAt: string };

export function HawaiiOnboardingPage(): JSX.Element {
  const medplum = useMedplum();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [evidence, setEvidence] = useState<Evidence>();

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setEvidence(undefined);
    void (async () => {
      try {
        const resources = await medplum.searchResources('Basic', {
          identifier: `${HAWAII_ONBOARDING_SYSTEM}|${HAWAII_ONBOARDING_SITE}`, _count: '2',
        }, { cache: 'no-cache' });
        if (cancelled) { return; }
        if (resources.length === 0) { setState('empty'); return; }
        if (resources.length !== 1 || !resources[0].id) { throw new Error('Ambiguous operational evidence'); }
        const snapshot = readHawaiiOnboardingSnapshot(resources[0]);
        setEvidence({ resource: resources[0], snapshot, retrievedAt: new Date().toISOString() });
        setState('ready');
      } catch {
        if (!cancelled) { setState('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [medplum, revision]);

  const summary = evidence && summarizeHawaiiOnboarding(evidence.snapshot);
  return <Stack p="md" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <Group justify="space-between" wrap="wrap">
      <Title order={2}>Participant Operations</Title>
      <Tooltip label="Refresh operational evidence"><ActionIcon aria-label="Refresh operational evidence" variant="subtle"
        disabled={state === 'loading'} onClick={() => { setState('loading'); setEvidence(undefined); setRevision((value) => value + 1); }}>
        <IconRefresh size={18} />
      </ActionIcon></Tooltip>
    </Group>
    <Text size="sm" c="dimmed">Synthetic site evidence · No statewide production participation</Text>
    {state === 'loading' && <Loader aria-label="Loading operational evidence" />}
    {state === 'error' && <Alert color="red" title="Operational evidence unavailable">Access or validation failed. No readiness assessment is available.</Alert>}
    {state === 'empty' && <Alert color="gray" title="No operational evidence available">No site snapshot is visible with your current access.</Alert>}
    {state === 'ready' && evidence && summary && <>
      <Title order={3}>{evidence.snapshot.siteName}</Title>
      <Text size="sm">Captured {time(evidence.snapshot.observedAt)} · Retrieved {time(evidence.retrievedAt)}</Text>
      <Text size="xs" c="dimmed">Source: Basic/{evidence.resource.id} · Version {evidence.resource.meta?.versionId ?? 'not supplied'}</Text>
      <Alert color={summary.readyForCutover ? 'green' : 'yellow'} title={summary.readyForCutover ? 'Ready for cutover' : 'Not ready for cutover'}>
        {summary.openIssues.length} unresolved validation findings · {summary.completedStages}/6 stages completed
      </Alert>
      <Box component="section" pt="sm" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
        <Title order={3}>Site Readiness</Title>
        <List type="ordered" mt="sm" spacing="sm">{summary.stages.map((stage) => <List.Item key={stage.code}>
          <Group gap="sm" wrap="wrap"><Text>{labels[stage.code]}</Text>
            <Badge color={stage.status === 'blocked' ? 'red' : stage.status === 'completed' ? 'green' : 'gray'}>{labels[stage.status]}</Badge>
          </Group>
        </List.Item>)}</List>
      </Box>
      <Box component="section" pt="sm" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
        <Title order={3}>Monthly Status</Title>
        <Text size="sm" c="dimmed">Reporting month {evidence.snapshot.reportingMonth} · UTC receipt dates · Historical synthetic feed snapshot</Text>
        <SimpleGrid cols={{ base: 1, sm: 3 }} mt="sm">
          <Box><Text fw={600}>Acceptance</Text><Text>{summary.acceptancePercent === undefined ? 'Not available' : `${summary.acceptancePercent.toFixed(1)}%`}</Text>
            <Text size="sm">{summary.accepted} accepted / {summary.submitted} submitted records</Text></Box>
          <Box><Text fw={600}>Rejected Records</Text><Text>{summary.rejected} / {summary.submitted} submitted records</Text></Box>
          <Box><Text fw={600}>Technical Assistance</Text><Text>{summary.assistanceCount} recorded sessions</Text></Box>
        </SimpleGrid>
        <Text size="xs" c="dimmed" mt="sm">Source: snapshot records and assistance entries. Acceptance = accepted / submitted × 100; no denominator yields no percentage. Not HEDIS or eCQM output.</Text>
        <Text size="sm" mt="sm">Brief-supplied targets: 75 CHRs and 28 suppliers. Targets are not achieved counts or necessarily distinct sites.</Text>
      </Box>
      <Box component="section" pt="sm" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
        <Title order={3}>Feed Receipts</Title>
        {evidence.snapshot.records.length === 0 && <Text>No captured receipts.</Text>}
        {evidence.snapshot.records.map((record) => <Group key={record.id} mt="sm" align="start" wrap="wrap">
          <Text fw={600}>{record.id}</Text><Badge color={record.result === 'accepted' ? 'green' : 'red'}>{record.result}</Badge>
          <Text size="sm">{time(record.receivedAt)}</Text>
        </Group>)}
      </Box>
      <Box component="section" pt="sm" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
        <Title order={3}>Validation Findings</Title>
        {evidence.snapshot.issues.length === 0 && <Text>No captured findings.</Text>}
        {evidence.snapshot.issues.map((issue) => <Stack key={issue.id} gap={4} mt="sm">
          <Group wrap="wrap"><Text fw={600}>{issue.id}</Text><Badge color={issue.status === 'open' ? 'red' : 'green'}>{issue.status}</Badge></Group>
          <Text>{issue.description}</Text><Text size="sm">{issue.recordId} · {issue.field} · {issue.code}</Text>
          <Text size="xs" c="dimmed">Detected {time(issue.detectedAt)}</Text>
        </Stack>)}
      </Box>
      <Box component="section" pt="sm" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
        <Title order={3}>Technical Assistance Log</Title>
        {evidence.snapshot.assistance.length === 0 && <Text>No recorded assistance.</Text>}
        {evidence.snapshot.assistance.map((entry) => <Stack key={entry.id} gap={4} mt="sm">
          <Text fw={600}>{entry.id} · {entry.category.replaceAll('-', ' ')}</Text><Text>{entry.summary}</Text>
          <Text size="xs" c="dimmed">{time(entry.occurredAt)}</Text>
        </Stack>)}
      </Box>
    </>}
  </Stack>;
}