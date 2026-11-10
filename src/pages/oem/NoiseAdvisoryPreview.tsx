import { Alert, Anchor, Badge, Button, Group, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import type { Observation, Patient } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { IconEye } from '@tabler/icons-react';
import { useEffect, useState, type JSX } from 'react';
import { OEM_PROJECT_ID } from './ih-review';
import { loadNoiseCompletions, NOISE_PREVIEW_BOT_ID, previewNoiseScenario, type NoiseScenario } from './intake';
import { ExposureWorkflow } from './ExposureWorkflow';

export function NoiseAdvisoryPreview({
  worker,
  exposures,
  enrollments,
  initialExposureId,
  initialEnrollmentId,
}: {
  worker: Patient;
  exposures: Observation[];
  enrollments: Observation[];
  initialExposureId?: string;
  initialEnrollmentId?: string;
}): JSX.Element {
  const client = useMedplum();
  const profile = useMedplumProfile();
  const actor = profile ? `${profile.resourceType}/${profile.id}` : '';
  const [permitted, setPermitted] = useState<boolean>();
  const [exposureId, setExposureId] = useState<string | null>(initialExposureId ?? null);
  const [enrollmentId, setEnrollmentId] = useState<string | null>(initialEnrollmentId ?? null);
  const [recordedEnrollments, setRecordedEnrollments] = useState<Observation[]>([]);
  const [completionId, setCompletionId] = useState<string | null>(null);
  const [completions, setCompletions] = useState<Awaited<ReturnType<typeof loadNoiseCompletions>>>();
  const [completionError, setCompletionError] = useState('');
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NoiseScenario>();
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setPermitted(undefined);
    setResult(undefined);
    if (client.getProject()?.id !== OEM_PROJECT_ID) return;
    client
      .readResource('Bot', NOISE_PREVIEW_BOT_ID, { cache: 'no-cache' })
      .then((bot) => {
        if (!cancelled) setPermitted(bot.id === NOISE_PREVIEW_BOT_ID && bot.meta?.project === OEM_PROJECT_ID);
      })
      .catch(() => {
        if (!cancelled) setPermitted(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, actor]);
  const exposure = exposures.find((record) => record.id === exposureId);
  const eligible = [...enrollments, ...recordedEnrollments.filter(record => !enrollments.some(value => value.id === record.id))].filter(
    (record) => record.focus?.length === 1 && record.focus[0].reference === `Observation/${exposureId}`
  );
  const enrollment = eligible.find((record) => record.id === enrollmentId);
  useEffect(() => {
    let cancelled = false;
    setCompletions(undefined);
    setCompletionError('');
    if (!permitted) return;
    loadNoiseCompletions(client, worker)
      .then((data) => {
        if (!cancelled) setCompletions(data);
      })
      .catch(() => {
        if (!cancelled) setCompletionError('Completion history could not be verified.');
      });
    return () => {
      cancelled = true;
    };
  }, [client, worker, permitted, actor]);
  const eligibleCompletions = (completions?.records ?? []).filter(
    (record) =>
      exposure &&
      enrollment &&
      record.focus?.[0]?.reference === `Observation/${exposure.id}` &&
      !!record.effectiveDateTime &&
      !!exposure.effectivePeriod?.start &&
      !!enrollment.effectivePeriod?.start &&
      record.effectiveDateTime <= asOf &&
      record.effectiveDateTime >= exposure.effectivePeriod.start &&
      record.effectiveDateTime >= enrollment.effectivePeriod.start
  );
  const completion = eligibleCompletions.find((record) => record.id === completionId);
  useEffect(() => {
    setResult(undefined);
    setError('');
  }, [exposureId, enrollmentId, completionId, asOf]);
  async function preview(): Promise<void> {
    if (!exposure || !permitted || busy) return;
    setBusy(true);
    setResult(undefined);
    setError('');
    try {
      const value = await previewNoiseScenario(client, worker, exposure, asOf, enrollment, completion);
      if (
        client.getProject()?.id === OEM_PROJECT_ID &&
        `${client.getProfile()?.resourceType}/${client.getProfile()?.id}` === actor
      )
        setResult(value);
    } catch {
      setError('The scenario preview could not be verified. No decision was saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack component="section" aria-label="Synthetic advisory scenario" gap="xs" style={{ minWidth: 0 }}>
      <Group justify="space-between">
        <Title order={3}>Advisory scenario</Title>
        <Badge color="yellow">Synthetic preview only</Badge>
      </Group>
      <Alert color="yellow" title="Not clinical guidance">
        Completion evidence: {completion ? 'Selected synthetic record' : 'Not included'}. This scenario does not
        establish current compliance.
      </Alert>
      {permitted === undefined ? (
        <Text size="sm">Checking advisory access</Text>
      ) : !permitted ? (
        <Text size="sm" c="dimmed">
          Advisory preview unavailable for this account.
        </Text>
      ) : (
        <>
          <Select
            label="Advisory exposure"
            placeholder="Select advisory exposure"
            value={exposureId}
            data={exposures.map((record) => ({
              value: record.id!,
              label: `${record.effectivePeriod?.start ?? 'Date unknown'} / ${record.id}`,
            }))}
            disabled={busy || !!initialExposureId}
            onChange={(value) => {
              setExposureId(value);
              setEnrollmentId(null);
              setCompletionId(null);
            }}
          />
          <Select
            label="Advisory enrollment"
            value={enrollmentId ?? 'omitted'}
            disabled={busy || !exposure}
            data={[
              { value: 'omitted', label: 'Not included' },
              ...eligible.map((record) => ({
                value: record.id!,
                label: `${record.valueCodeableConcept?.text ?? 'Determination unknown'} / ${record.id}`,
              })),
            ]}
            onChange={(value) => {
              setEnrollmentId(value === 'omitted' ? null : value);
              setCompletionId(null);
            }}
          />
          {!completions && !completionError && <Text size="sm">Loading completion history</Text>}
          {completionError && (
            <Alert color="red" title="Completion history unavailable">
              {completionError}
            </Alert>
          )}
          {completions?.limited && (
            <Alert color="yellow" title="Completion record limit reached">
              Showing up to 50 recently updated records; older records may not be included.
            </Alert>
          )}
          {!!completions?.unverified.length && (
            <Alert color="yellow" title="Completions need source review">
              <Stack gap="xs">
                {completions.unverified.map((reference) => (
                  <Anchor key={reference} href={`/${reference.split('/').slice(0, 2).join('/')}/history`}>
                    {reference}
                  </Anchor>
                ))}
              </Stack>
            </Alert>
          )}
          <Select
            label="Advisory completion"
            value={completion?.id ?? 'omitted'}
            disabled={busy || !enrollment || !completions || !!completionError}
            data={[
              { value: 'omitted', label: 'Not included' },
              ...eligibleCompletions.map((record) => ({
                value: record.id!,
                label: `${record.effectiveDateTime} / ${record.id}`,
              })),
            ]}
            onChange={(value) => setCompletionId(value === 'omitted' ? null : value)}
          />
          <TextInput
            type="date"
            label="Scenario date"
            value={asOf}
            disabled={busy}
            onChange={(event) => {
              setAsOf(event.currentTarget.value);
              setCompletionId(null);
            }}
          />
          {exposure && (
            <Text size="sm">{`Exposure: Observation/${exposure.id}/_history/${exposure.meta!.versionId}`}</Text>
          )}
          <Text size="sm">
            {enrollment
              ? `Enrollment: Observation/${enrollment.id}/_history/${enrollment.meta!.versionId}`
              : 'Enrollment: Not included'}
          </Text>
          <Text size="sm">
            {completion
              ? `Completion: Observation/${completion.id}/_history/${completion.meta!.versionId}`
              : 'Completion: Not included'}
          </Text>
          {completion && (
            <Text size="sm">
              Performed: {completion.effectiveDateTime} /{' '}
              {
                completion.extension?.find(
                  (item) => item.url === 'https://hiivehealth.com/fhir/StructureDefinition/oem-completion-kind'
                )?.valueCode
              }
            </Text>
          )}
          <Group>
            <Button
              leftSection={<IconEye size={16} />}
              loading={busy}
              disabled={!exposure || !asOf}
              onClick={() => void preview()}
            >
              Preview advisory
            </Button>
          </Group>
        </>
      )}
      {error && (
        <Alert color="red" title="Advisory not confirmed">
          {error}
        </Alert>
      )}
      {result && (
        <Stack gap="xs">
          <Text fw={600}>Scenario status: {result.status.replaceAll('-', ' ')}</Text>
          <Text>{result.rationale}</Text>
          {result.due && <Text size="sm">Scenario due date: {result.due}</Text>}
          {result.stage && <Text size="sm">Stage: {result.stage}</Text>}
          <Text size="sm">Rule: {result.rule}</Text>
          <Text size="sm">Not saved. No order or recommendation was sent.</Text>
          {result.sources.map((reference) => (
            <Anchor key={reference} href={`/${reference.split('/').slice(0, 2).join('/')}/history`}>
              {reference}
            </Anchor>
          ))}
        </Stack>
      )}
      {permitted && exposure && <ExposureWorkflow
        key={`${actor}:${worker.id}:${exposure.id}:${exposure.meta?.versionId}:${enrollment?.id ?? 'none'}:${enrollment?.meta?.versionId ?? 'none'}:${asOf}`}
        worker={worker} exposure={exposure} enrollment={enrollment} asOf={asOf}
        onEnrollmentSaved={async reference => {
          const [, id, , version] = reference.split('/');
          const record = await client.readVersion('Observation', id, version, { cache: 'no-cache', maxRetries: 0 });
          if (client.getProject()?.id !== OEM_PROJECT_ID || `${client.getProfile()?.resourceType}/${client.getProfile()?.id}` !== actor ||
              record.meta?.project !== OEM_PROJECT_ID || record.meta.versionId !== version || record.subject?.reference !== `Patient/${worker.id}` ||
              record.focus?.[0]?.reference !== `Observation/${exposure.id}`) throw new Error('Enrollment scope changed');
          setRecordedEnrollments(values => [...values.filter(value => value.id !== record.id), record]);
          setEnrollmentId(id);
        }} />}
    </Stack>
  );
}
