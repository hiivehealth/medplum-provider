import { ActionIcon, Alert, Anchor, Button, Checkbox, Group, Loader, Modal, NumberInput, SegmentedControl, Select, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { getDisplayString } from '@medplum/core';
import type { DocumentReference, Observation, Patient } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { IconDeviceFloppy, IconEye, IconHistory, IconPlus, IconRefresh, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState, type JSX } from 'react';
import { sendExposureWorkflow, type ExposureWorkflowRequest, type ExposureWorkflowResult, type MeasurementAuditEntry } from './exposure-workflow';
import { loadIntakeEvidence, measurementResult } from './intake';

interface ConfirmedMeasurement { request: ExposureWorkflowRequest; preview: ExposureWorkflowResult; }

export function ExposureMeasurements({ worker, exposure, measurements, asOf, onSaved }: {
  worker: Patient; exposure: Observation; measurements: Observation[]; asOf: string; onSaved?: (records: Observation[]) => void;
}): JSX.Element {
  const [opened, setOpened] = useState(false);
  return <>
    <Tooltip label="Measurements and audit trail">
      <ActionIcon variant="subtle" size={32} aria-label={`Measurements and audit trail for exposure ${exposure.id}`}
        onClick={() => setOpened(true)}><IconPlus size={18} /></ActionIcon>
    </Tooltip>
    <Modal opened={opened} onClose={() => setOpened(false)} title="Measurements and audit trail" size="xl">
      {opened && <MeasurementEditor worker={worker} exposure={exposure} measurements={measurements} asOf={asOf} onSaved={onSaved} />}
    </Modal>
  </>;
}

function MeasurementEditor({ worker, exposure, measurements, asOf, onSaved }: {
  worker: Patient; exposure: Observation; measurements: Observation[]; asOf: string; onSaved?: (records: Observation[]) => void;
}): JSX.Element {
  const client = useMedplum();
  const profile = useMedplumProfile();
  const actor = `${profile?.resourceType}/${profile?.id}`;
  const patient = `Patient/${worker.id}`;
  const exposureReference = `Observation/${exposure.id}/_history/${exposure.meta!.versionId}`;
  const storageKey = `oem-measurement-pending:${client.getProject()?.id}:${actor}:${patient}:Observation/${exposure.id}`;
  const [entries, setEntries] = useState<MeasurementAuditEntry[]>([]);
  const [evidence, setEvidence] = useState<DocumentReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [unsafe, setUnsafe] = useState(false);
  const [editing, setEditing] = useState(false);
  const [metric, setMetric] = useState<'eight-hour-twa' | 'peak'>('eight-hour-twa');
  const [value, setValue] = useState<number | string>('');
  const [unit, setUnit] = useState<'dBA' | 'dBC' | 'dB'>('dBA');
  const [method, setMethod] = useState<'synthetic-personal-dosimetry' | 'synthetic-area-assessment' | null>(null);
  const [assessedOn, setAssessedOn] = useState(asOf);
  const [evidenceReference, setEvidenceReference] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmedMeasurement>();
  const [pending, setPending] = useState<ConfirmedMeasurement>();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<ExposureWorkflowResult>();
  const generation = useRef(0);
  const inFlight = useRef(false);
  const scope = { patient, exposure: exposureReference, asOf };
  useEffect(() => {
    const current = ++generation.current;
    inFlight.current = false;
    setLoading(true); setHistoryError(false); setUnsafe(false); setEntries([]); setEvidence([]);
    setConfirmation(undefined); setPending(undefined); setBusy(false); setError(''); setSaved(undefined); setEditing(false);
    setMetric('eight-hour-twa'); setValue(''); setUnit('dBA'); setMethod(null); setAssessedOn(asOf); setEvidenceReference(null); setChecked(false);
    async function load(): Promise<void> {
      try {
        const recovered = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as ConfirmedMeasurement | null;
        if (recovered && (recovered.request.mode !== 'measure' || recovered.request.patient !== patient ||
            recovered.request.exposure !== exposureReference || recovered.request.enrollment || recovered.request.confirmedSave !== true ||
            recovered.preview.phase !== 'measurement' || recovered.preview.persisted !== false ||
            recovered.preview.patient !== patient || recovered.preview.exposure !== exposureReference ||
            !/^[a-f0-9]{64}$/.test(recovered.request.fingerprint ?? '') || recovered.request.fingerprint !== recovered.preview.fingerprint)) {
          throw new Error('Invalid pending measurement');
        }
        if (generation.current === current) setPending(recovered ?? undefined);
      } catch {
        if (generation.current === current) { setUnsafe(true); setError('Pending measurement recovery could not be verified. No save is allowed.'); }
      }
      try {
        const [history, documents] = await Promise.all([
          sendExposureWorkflow(client, { patient, exposure: exposureReference, asOf, mode: 'measurement-history' }),
          loadIntakeEvidence(client, worker),
        ]);
        if (generation.current === current) { setEntries(history.entries!); setEvidence(documents); }
      } catch { if (generation.current === current) setHistoryError(true); }
      finally { if (generation.current === current) setLoading(false); }
    }
    void load();
    return () => { generation.current++; };
  }, [client, worker, patient, exposureReference, asOf, storageKey]);
  const locked = loading || busy || unsafe || historyError || !!pending || !!confirmation;
  async function review(): Promise<void> {
    if (locked || inFlight.current || typeof value !== 'number' || !method || !evidenceReference) return;
    const current = generation.current;
    inFlight.current = true; setBusy(true); setError(''); setSaved(undefined);
    try {
      const request: ExposureWorkflowRequest = { ...scope, mode: 'measurement-preview', submissionId: crypto.randomUUID(),
        measurement: { metric, value, unit, basis: metric === 'peak' ? 'peak' : '8h', method, assessedOn, evidence: evidenceReference } };
      const preview = await sendExposureWorkflow(client, request);
      if (generation.current === current) {
        setConfirmation({ preview, request: { ...request, mode: 'measure', fingerprint: preview.fingerprint, confirmedSave: true } });
        setChecked(false);
      }
    } catch { if (generation.current === current) setError('Measurement preview was not verified. No save was requested.'); }
    finally { if (generation.current === current) { inFlight.current = false; setBusy(false); } }
  }
  async function save(): Promise<void> {
    if (!confirmation || !checked || inFlight.current || unsafe) return;
    const current = generation.current;
    const snapshot = structuredClone(confirmation);
    try { sessionStorage.setItem(storageKey, JSON.stringify(snapshot)); }
    catch { setUnsafe(true); setError('Submission safety storage is unavailable. No save was requested.'); return; }
    inFlight.current = true; setBusy(true); setPending(snapshot); setError('');
    try {
      const result = await sendExposureWorkflow(client, snapshot.request);
      if (generation.current !== current) return;
      sessionStorage.removeItem(storageKey);
      setSaved(result); setPending(undefined); setConfirmation(undefined); setChecked(false); setEditing(false); setValue('');
      try {
        const history = await sendExposureWorkflow(client, { ...scope, mode: 'measurement-history' });
        if (generation.current === current) {
          setEntries(history.entries!); setHistoryError(false); onSaved?.(history.entries!.map(entry => entry.record));
        }
      } catch { if (generation.current === current) setHistoryError(true); }
    } catch {
      if (generation.current === current) { setConfirmation(undefined); setChecked(false); setError('Save outcome unconfirmed. Reconcile only the original measurement; do not enter it again.'); }
    } finally { if (generation.current === current) { inFlight.current = false; setBusy(false); } }
  }
  const original = measurements.filter(record => record.focus?.some(focus => focus.reference?.split('/').slice(0, 2).join('/') === `Observation/${exposure.id}`) &&
    !record.identifier?.some(identifier => identifier.system === 'https://hiivehealth.com/fhir/CodeSystem/oem-exposure-workflow/measurement'));
  const link = (reference: string, label: string): JSX.Element => <Anchor href={`/${reference}`} target="_blank" rel="noopener noreferrer" size="sm">{label}</Anchor>;
  return <Stack gap="md" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <Text size="sm">Exposure: {exposureReference}</Text>
    <Group>{link(exposureReference, 'Exposure version')}{link(`Observation/${exposure.id}/history`, 'Exposure version history')}</Group>
    {loading && <Loader size="sm" aria-label="Loading measurement audit trail" />}
    {historyError && <Alert color="yellow" title="Measurement audit unavailable">The saved audit trail could not be verified. The measurement service update may not be published. No new entry is allowed.</Alert>}
    {error && <Alert color="yellow" title="Measurement not confirmed">{error}</Alert>}
    {saved && <Alert color="teal" title="Measurement saved">A separate measurement and attributed audit trail were saved. Earlier exposure and measurement records were not replaced.
      <Group mt="xs">{link(saved.measurementRecord!, 'Saved measurement')}{link(saved.lineage!, 'Saved lineage')}{link(saved.audit!, 'Saved audit event')}</Group></Alert>}
    {pending && <Button variant="outline" leftSection={<IconRefresh size={16} />} disabled={busy || unsafe}
      onClick={() => { setConfirmation(pending); setChecked(false); }}>Reconcile measurement</Button>}
    {!editing && !pending && <Group><Button leftSection={<IconPlus size={16} />} disabled={locked} onClick={() => { setEditing(true); setSaved(undefined); }}>Add measurement</Button></Group>}
    {editing && <Stack component="section" aria-label="Later noise measurement" gap="sm">
      <Title order={3} size="h4">Later noise measurement</Title>
      <SegmentedControl aria-label="Noise measurement metric" value={metric} disabled={locked} fullWidth
        data={[{ value: 'eight-hour-twa', label: 'Eight-hour TWA' }, { value: 'peak', label: 'Peak' }]}
        onChange={next => { setMetric(next as typeof metric); setUnit('dBA'); }} />
      <Group grow align="start">
        <NumberInput label="Noise measurement value" value={value} onChange={setValue} min={0} allowNegative={false} disabled={locked} />
        <Select label="Noise measurement unit" value={unit} allowDeselect={false} disabled={locked || metric === 'eight-hour-twa'}
          data={metric === 'peak' ? ['dBA', 'dBC', 'dB'] : ['dBA']} onChange={next => setUnit(next as typeof unit)} />
      </Group>
      <Text size="sm">Averaging basis: {metric === 'peak' ? 'Peak' : '8 hours'}</Text>
      <Select label="Measurement method" value={method} disabled={locked} allowDeselect={false}
        data={[{ value: 'synthetic-personal-dosimetry', label: 'Synthetic personal dosimetry' }, { value: 'synthetic-area-assessment', label: 'Synthetic area assessment' }]}
        onChange={next => setMethod(next as typeof method)} />
      <TextInput type="date" label="Measurement assessed on" value={assessedOn} min={exposure.effectivePeriod?.start}
        max={exposure.effectivePeriod?.end && exposure.effectivePeriod.end < asOf ? exposure.effectivePeriod.end : asOf}
        disabled={locked} onChange={event => setAssessedOn(event.currentTarget.value)} />
      <Select label="Measurement evidence" value={evidenceReference} disabled={locked} data={evidence.map(document => ({
        value: `DocumentReference/${document.id}/_history/${document.meta!.versionId}`,
        label: `${document.description ?? document.content[0]?.attachment.title ?? document.id} / ${document.id}`,
      }))} onChange={setEvidenceReference} />
      <Group><Button leftSection={<IconEye size={16} />} disabled={locked || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !method || !assessedOn || !evidenceReference}
        onClick={() => void review()}>Review measurement</Button>
        <Button variant="subtle" leftSection={<IconX size={16} />} disabled={locked} onClick={() => setEditing(false)}>Cancel entry</Button></Group>
    </Stack>}
    {confirmation && <Stack component="section" aria-label="Confirm measurement" gap="sm">
      <Title order={3} size="h4">Confirm measurement</Title>
      <Text size="sm">{patient}</Text><Text size="sm">{exposureReference}</Text>
      <Text>Measurement: {confirmation.request.measurement?.value} {confirmation.request.measurement?.unit}</Text>
      <Text size="sm">Assessed on: {confirmation.request.measurement?.assessedOn}</Text>
      <Text size="sm">Evidence: {confirmation.request.measurement?.evidence}</Text>
      <Text size="sm">New measurement only. No exposure amendment, enrollment change, order activation or external delivery.</Text>
      <Checkbox label="I confirm this synthetic measurement for this saved exposure" checked={checked} disabled={busy} onChange={event => setChecked(event.currentTarget.checked)} />
      <Group><Button leftSection={<IconDeviceFloppy size={16} />} disabled={!checked || busy || unsafe} onClick={() => void save()}>{pending ? 'Reconcile same measurement' : 'Save measurement'}</Button>
        <Button variant="subtle" leftSection={<IconX size={16} />} disabled={busy} onClick={() => { setConfirmation(undefined); setChecked(false); }}>Cancel confirmation</Button></Group>
    </Stack>}
    <Stack component="section" aria-label="Measurement audit trail" gap="xs">
      <Title order={3} size="h4">Measurement audit trail</Title>
      <Text size="sm" c="dimmed">Verified entries below cover later measurements recorded through this action, not all clinical access or earlier intake attribution.</Text>
      {!loading && !historyError && entries.length === 0 && <Text size="sm">No later measurement entries recorded for this exposure.</Text>}
      {entries.length > 0 && <Table.ScrollContainer minWidth={880}><Table aria-label="Measurement audit entries" striped style={{ whiteSpace: 'nowrap' }}>
        <Table.Thead><Table.Tr><Table.Th>Assessed</Table.Th><Table.Th>Measurement</Table.Th><Table.Th>Recorded at (UTC)</Table.Th><Table.Th>Recorded by</Table.Th><Table.Th>Evidence and audit</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{entries.toReversed().map(entry => <Table.Tr key={entry.record.id}>
          <Table.Td>{entry.record.effectiveDateTime}</Table.Td>
          <Table.Td><Text size="sm">{measurementResult(entry.record)}</Text><Text size="xs">{entry.record.code.coding?.[0]?.code?.replaceAll('-', ' ')}</Text></Table.Td>
          <Table.Td>{entry.lineage.recorded}</Table.Td>
          <Table.Td>{profile && link(actor, getDisplayString(profile))}</Table.Td>
          <Table.Td><Stack gap={2}>
            {link(`Observation/${entry.record.id}/_history/${entry.record.meta!.versionId}`, 'Measurement version')}
            {link(entry.record.derivedFrom![0].reference!, 'Evidence version')}
            {link(`Provenance/${entry.lineage.id}/_history/${entry.lineage.meta!.versionId}`, 'Lineage')}
            {link(`AuditEvent/${entry.audit.id}/_history/${entry.audit.meta!.versionId}`, 'Audit event')}
          </Stack></Table.Td>
        </Table.Tr>)}</Table.Tbody>
      </Table></Table.ScrollContainer>}
    </Stack>
    {original.length > 0 && <Stack gap="xs">
      <Title order={3} size="h4">Earlier measurement records</Title>
      <Text size="sm" c="dimmed">Original intake records remain separate. Their actor attribution is not verified by this later-entry audit view.</Text>
      {original.map(record => <Group key={record.id} justify="space-between">
        <Text size="sm">{record.effectiveDateTime ?? 'Date not recorded'}: {measurementResult(record)}</Text>
        {link(`Observation/${record.id}/_history/${record.meta!.versionId}`, 'Earlier measurement version')}
      </Group>)}
    </Stack>}
    <Text size="xs" c="dimmed"><IconHistory size={12} /> Saved resource versions and workflow audit entries only; not a complete clinical-access audit.</Text>
  </Stack>;
}