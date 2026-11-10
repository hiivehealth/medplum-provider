import { Alert, Anchor, Button, Checkbox, Group, SegmentedControl, Stack, Table, Tabs, Text, TextInput, Title } from '@mantine/core';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { IconDownload, IconFileAnalytics, IconFileCheck, IconHistory, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState, type JSX } from 'react';
import { downloadNativeReport, generateNativeReport, generateNativeCohortReport, generateNativeCompletionReport, REPORT_SOURCES, REPORT_CLINICIAN, HISTORY_CHECKPOINTS, inspectNativeHistory, inspectNativeEvidenceHistory, inspectNativeLineageHistory, inspectNativeRecordedTime, inspectNativeRuleHistory, inspectNativeMatrixHistory, type VerifiedNativeReport, type VerifiedNativeHistory } from './native-report';
import { OEM_PROJECT_ID } from './ih-review';
import { inspectNativeMatrixPdf, type VerifiedMatrixPdf } from './native-report';

export function NativeMatrixPdf(): JSX.Element | null {
  const medplum = useMedplum(); const profile = useMedplumProfile();
  const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const [result, setResult] = useState<VerifiedMatrixPdf>();
  const generation = useRef(0); const inFlight = useRef(false);
  const scope = `${medplum.getProject()?.id}:${profile?.resourceType}/${profile?.id}`;
  useEffect(() => {
    generation.current++; inFlight.current = false; setConfirmed(false); setBusy(false); setError(false); setResult(undefined);
    return () => { generation.current++; };
  }, [medplum, scope]);
  const inspect = async (): Promise<void> => {
    if (!confirmed || inFlight.current || result) return;
    const current = generation.current; inFlight.current = true; setBusy(true); setError(false);
    try {
      const verified = await inspectNativeMatrixPdf(medplum, true);
      if (generation.current === current) setResult(verified);
    } catch {
      if (generation.current === current) { setError(true); setConfirmed(false); }
    } finally {
      if (generation.current === current) { inFlight.current = false; setBusy(false); }
    }
  };
  if (medplum.getProject()?.id !== OEM_PROJECT_ID || `${profile?.resourceType}/${profile?.id}` !== REPORT_CLINICIAN) return null;
  return <Stack component="section" aria-label="Matrix PDF verification" gap="sm" style={{ minWidth: 0, scrollMarginTop: 48 }}>
    <Title order={3}>Matrix PDF verification</Title>
    <Text size="sm">PDF bytes: {result ? 'verified' : 'not inspected'}. Clinical interpretation and rule approval: unverified.</Text>
    <Text size="xs" c="dimmed">Clinical completion: unverified. Compliance: not assessed.</Text>
    {error && <Alert color="yellow" title="PDF verification unavailable">No clinical record was changed.</Alert>}
    {!result && <>
      <Checkbox label="I confirm synthetic PDF verification" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.currentTarget.checked)} />
      <Group><Button leftSection={<IconFileCheck size={16} />} disabled={!confirmed || busy} loading={busy} onClick={inspect}>Verify Matrix PDF bytes</Button></Group>
    </>}
    {result && <>
      <Text size="sm" style={{ overflowWrap: 'anywhere' }}>Verified at {result.inspectedAt} (UTC)</Text>
      <Text size="sm">{result.byteLength.toLocaleString('en-US')} bytes - application/pdf</Text>
      <Text size="xs" style={{ overflowWrap: 'anywhere' }}>PDF SHA-256: {result.checksum}</Text>
      <Text size="xs" aria-label="Verified Matrix document" data-reference={result.document} style={{ overflowWrap: 'anywhere' }}>Document version: {result.document.split('/').at(-1)}</Text>
      <Text size="xs" aria-label="Verified Matrix Binary" data-reference={result.binary} style={{ overflowWrap: 'anywhere' }}>Binary version: {result.binary.split('/').at(-1)}</Text>
      <Group><Button variant="subtle" leftSection={<IconX size={16} />} onClick={() => { generation.current++; setResult(undefined); setConfirmed(false); setError(false); }}>Dismiss PDF verification</Button></Group>
    </>}
  </Stack>;
}

export function NativeHistory(): JSX.Element | null {
  return <ConfiguredNativeHistory evidence={false} />;
}

export function NativeEvidenceHistory(): JSX.Element | null {
  return <ConfiguredNativeHistory evidence />;
}

export function NativeLineageHistory(): JSX.Element | null {
  return <ConfiguredNativeHistory evidence lineage />;
}

export function NativeRecordedTime(): JSX.Element | null {
  return <ConfiguredNativeHistory evidence lineage recordedTime />;
}

export function NativeRuleHistory(): JSX.Element | null {
  return <ConfiguredNativeHistory evidence lineage recordedTime ruleHistory />;
}

export function NativeMatrixHistory(): JSX.Element | null {
  return <ConfiguredNativeHistory evidence lineage recordedTime ruleHistory matrixHistory />;
}

function ConfiguredNativeHistory({ evidence, lineage = false, recordedTime = false, ruleHistory = false, matrixHistory = false }: { evidence: boolean; lineage?: boolean; recordedTime?: boolean; ruleHistory?: boolean; matrixHistory?: boolean }): JSX.Element | null {
  const medplum = useMedplum(); const profile = useMedplumProfile();
  const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const [history, setHistory] = useState<VerifiedNativeHistory>(); const [checkpoint, setCheckpoint] = useState('0');
  const [instant, setInstant] = useState(HISTORY_CHECKPOINTS[0].slice(0, -1));
  const generation = useRef(0); const inFlight = useRef(false);
  const scope = `${medplum.getProject()?.id}:${profile?.resourceType}/${profile?.id}:${evidence}:${lineage}:${recordedTime}:${ruleHistory}:${matrixHistory}`;
  useEffect(() => {
    generation.current++; inFlight.current = false; setConfirmed(false); setBusy(false); setError(false); setHistory(undefined); setCheckpoint('0');
    setInstant(HISTORY_CHECKPOINTS[0].slice(0, -1));
    return () => { generation.current++; };
  }, [medplum, scope]);
  const inspect = async (): Promise<void> => {
    if (!confirmed || inFlight.current || history) return;
    const current = generation.current; inFlight.current = true; setBusy(true); setError(false);
    try { const result = recordedTime ? await (matrixHistory ? inspectNativeMatrixHistory : ruleHistory ? inspectNativeRuleHistory : inspectNativeRecordedTime)(medplum, true, new Date(`${instant}Z`).toISOString()) :
      await (lineage ? inspectNativeLineageHistory : evidence ? inspectNativeEvidenceHistory : inspectNativeHistory)(medplum, true); if (generation.current === current) setHistory(result); }
    catch { if (generation.current === current) setError(true); }
    finally { if (generation.current === current) { inFlight.current = false; setBusy(false); } }
  };
  if (medplum.getProject()?.id !== OEM_PROJECT_ID || `${profile?.resourceType}/${profile?.id}` !== REPORT_CLINICIAN) return null;
  const title = matrixHistory ? 'Matrix source history' : ruleHistory ? 'Rule and review history' : recordedTime ? 'Explore recorded time' : lineage ? 'Synthetic technical history' : evidence ? 'Synthetic evidence history' : 'Recorded history';
  return <Stack component="section" aria-label={title} gap="sm" style={{ minWidth: 0, scrollMarginTop: 48 }}>
    <Title order={3}>{title}</Title>
    <Text size="sm">Clinical completion: unverified. Compliance: not assessed.</Text>
    <Text size="xs" c="dimmed">Source graph: incomplete. Deleted records: not reconstructed.</Text>
    {evidence && <Text size="xs">Synthetic performed date: 2026-06-15. Clinical rule approval: unverified.</Text>}
    {lineage && <Text size="xs">Saved technical receipts are not clinical completion.</Text>}
    {ruleHistory && !matrixHistory && <Text size="xs">Rule approval: unverified. Referenced Matrix document: not inspected.</Text>}
    {matrixHistory && <Text size="xs">Matrix metadata: {history ? 'verified' : 'not inspected'}. PDF content: unverified. Rule approval: unverified.</Text>}
    {recordedTime && <TextInput type="datetime-local" step="0.001" label={matrixHistory ? 'Matrix-history instant (UTC)' : ruleHistory ? 'Rule-history instant (UTC)' : 'Recorded instant (UTC)'} value={instant} disabled={busy}
      onChange={event => { generation.current++; setInstant(event.currentTarget.value); setHistory(undefined); setConfirmed(false); setError(false); setCheckpoint('0'); }} />}
    {error && <Alert color="yellow" title="History unavailable">No clinical record was changed.</Alert>}
    {!history && <>
      <Checkbox label={matrixHistory ? 'I confirm this is synthetic Matrix history' : ruleHistory ? 'I confirm this is synthetic rule history' : recordedTime ? 'I confirm this is synthetic recorded-time inspection' : lineage ? 'I confirm this is synthetic technical history' : evidence ? 'I confirm this is synthetic evidence history' : 'I confirm this is a synthetic history'} checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.currentTarget.checked)} />
      <Group><Button leftSection={<IconHistory size={16} />} disabled={!confirmed || busy || (recordedTime && !instant)} loading={busy} onClick={inspect}>{matrixHistory ? 'Inspect Matrix history' : ruleHistory ? 'Inspect rule history' : recordedTime ? 'Inspect selected recorded time' : lineage ? 'Inspect synthetic technical history' : evidence ? 'Inspect synthetic evidence history' : 'Inspect recorded history'}</Button></Group>
    </>}
    {history && <>
      <Tabs value={checkpoint} onChange={value => setCheckpoint(value ?? '0')} keepMounted={false}>
        <Tabs.List grow>{recordedTime ? <Tabs.Tab value="0">Selected instant</Tabs.Tab> : <><Tabs.Tab value="0">Before acceptance</Tabs.Tab><Tabs.Tab value="1">{lineage ? 'After synthetic save' : evidence ? 'After synthetic attestation' : 'After acceptance'}</Tabs.Tab></>}</Tabs.List>
        {(recordedTime && history.selected ? [history.selected] : history.checkpoints).map((snapshot, index) => <Tabs.Panel key={snapshot.asOf} value={String(index)} pt="sm">
          <Stack gap="xs" style={{ minWidth: 0 }}>
            <Text size="sm" style={{ overflowWrap: 'anywhere' }}>Recorded as of {snapshot.asOf} (UTC)</Text>
            <Table style={{ tableLayout: 'fixed', width: '100%', overflowWrap: 'anywhere' }}>
              <Table.Thead><Table.Tr><Table.Th>Record</Table.Th><Table.Th>Status</Table.Th><Table.Th>Version</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{snapshot.records.map(record => <Table.Tr key={record.label}>
                <Table.Td>{record.label}</Table.Td><Table.Td style={{ overflowWrap: 'anywhere' }}>{record.status}</Table.Td>
                <Table.Td>{record.reference ? record.linkable === false ? <Text size="xs" title={record.reference} data-reference={record.reference} aria-label={`${record.label} reference`} style={{ overflowWrap: 'anywhere' }}>{record.reference.split('/').at(-1)}</Text> : <Anchor size="xs" aria-label={`View ${record.label.toLowerCase()} history`} href={`/${record.reference}`} style={{ overflowWrap: 'anywhere' }}>{record.reference.split('/').at(-1)}</Anchor> : '-'}</Table.Td>
              </Table.Tr>)}</Table.Tbody>
            </Table>
          </Stack>
        </Tabs.Panel>)}
      </Tabs>
      <Group><Button variant="subtle" leftSection={<IconX size={16} />} onClick={() => { setHistory(undefined); setConfirmed(false); setError(false); setCheckpoint('0'); }}>{matrixHistory ? 'Dismiss Matrix history' : ruleHistory ? 'Dismiss rule history' : recordedTime ? 'Dismiss selected history' : lineage ? 'Dismiss technical history' : evidence ? 'Dismiss evidence history' : 'Dismiss history'}</Button></Group>
    </>}
  </Stack>;
}

export function NativeReport(): JSX.Element {
  const medplum = useMedplum(); const [confirmed, setConfirmed] = useState(false);
  const [reportScope, setReportScope] = useState('worker');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false); const [report, setReport] = useState<VerifiedNativeReport>();
  const inFlight = useRef(false); const generation = useRef(0);
  const scope = `${medplum.getProject()?.id}:${medplum.getProfile()?.id}`;
  useEffect(() => {
    generation.current++; setConfirmed(false); setBusy(false); setError(false); setReport(undefined); setReportScope('worker');
    return () => { generation.current++; };
  }, [medplum, scope]);
  const generate = async (): Promise<void> => {
    if (!confirmed || inFlight.current || report) return;
    const current = generation.current; inFlight.current = true; setBusy(true); setError(false);
    try { const result = await (reportScope === 'completion' ? generateNativeCompletionReport : reportScope === 'cohort' ? generateNativeCohortReport : generateNativeReport)(medplum, true); if (generation.current === current) setReport(result); }
    catch { if (generation.current === current) setError(true); }
    finally { inFlight.current = false; if (generation.current === current) setBusy(false); }
  };
  const download = (kind: 'csv' | 'manifest'): void => {
    try { if (report) downloadNativeReport(medplum, report, kind); } catch { setError(true); setReport(undefined); }
  };
  return <Stack gap="sm" style={{ minWidth: 0 }}>
    <Title order={3}>Synthetic worker report</Title>
    <Text size="sm">Unclassified. Clinical completion and compliance are not assessed.</Text>
    <SegmentedControl aria-label="Report scope" fullWidth size="xs" styles={{ label: { paddingInline: 6 } }} value={reportScope} disabled={busy}
      data={[{ label: 'Selected worker', value: 'worker' }, { label: 'Three workers', value: 'cohort' }, { label: 'Examples', value: 'completion' }]}
      onChange={value => { if (inFlight.current) return; generation.current++; setReportScope(value); setReport(undefined); setConfirmed(false); setError(false); }} />
    {error && <Alert color="yellow" title="Report unavailable">No clinical record was changed. No report is available for download.</Alert>}
    {!report && <>
      <Checkbox label="I confirm this is a synthetic report" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.currentTarget.checked)} />
      <Group><Button leftSection={<IconFileAnalytics size={16} />} disabled={!confirmed || busy} loading={busy} onClick={generate}>Generate synthetic report</Button></Group>
    </>}
    {report && <>
      <Text size="sm">As of {report.asOf} (UTC) - {report.cohortRows ? '3 supplied workers - 3 supplied obligations' : '1 supplied worker - 1 supplied obligation'}</Text>
      {report.cohortRows ? <>
        {report.cohortRows.map(row => <Stack key={row.label} gap={2}>
          <Text size="sm">{row.label} - {row.timing}{row.due ? ` - ${row.completion ? 'Illustrative periodic' : 'Synthetic baseline'} due ${row.due}` : ' - No configured enrollment'}</Text>
          {row.completion && <Text size="xs">Synthetic example performed {row.completion.performedOn}. Clinical completion unverified.</Text>}
          <Group gap="sm"><Anchor size="xs" aria-label={`View ${row.label} exposure`} href={`/${row.exposure}`}>Exposure</Anchor>
            {row.enrollment && <Anchor size="xs" aria-label={`View ${row.label} enrollment`} href={`/${row.enrollment}`}>Enrollment</Anchor>}
            {row.completion && <><Anchor size="xs" aria-label={`View ${row.label} example`} href={`/${row.completion.record}`}>Example</Anchor>
              <Anchor size="xs" aria-label={`View ${row.label} evidence`} href={`/${row.completion.evidence}`}>Evidence</Anchor></>}</Group>
        </Stack>)}
        <Anchor size="sm" href={`/${REPORT_SOURCES[3]}`}>View report rule source</Anchor>
      </> : <>
      <Text size="sm">Audiogram - {report.timing} (synthetic timing) - Baseline due {report.due}</Text>
      <Group gap="sm"><Anchor href={`/${REPORT_SOURCES[1]}`}>View report exposure</Anchor><Anchor href={`/${REPORT_SOURCES[2]}`}>View report enrollment</Anchor><Anchor href={`/${REPORT_SOURCES[3]}`}>View report rule source</Anchor></Group>
      </>}
      <Text size="sm">Not a clinic census or historical reconstruction. The saved synthetic attestation is not counted as clinical completion.</Text>
      <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>CSV SHA-256: {report.checksum}</Text>
      <Group><Button leftSection={<IconDownload size={16} />} onClick={() => download('csv')}>Download synthetic CSV</Button>
        <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => download('manifest')}>Download report manifest</Button>
        <Button variant="subtle" leftSection={<IconX size={16} />} onClick={() => { setReport(undefined); setConfirmed(false); setError(false); }}>Dismiss report</Button></Group>
    </>}
  </Stack>;
}
