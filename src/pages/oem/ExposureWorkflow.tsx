import { Alert, Anchor, Button, Checkbox, Group, Modal, SegmentedControl, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import type { DocumentReference, Observation, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconCheck, IconDeviceFloppy, IconDownload, IconEye, IconRefresh, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState, type JSX } from 'react';
import { DECISION_REASONS, type DecisionInput } from './clinician-decision';
import { exposureSummary, sendExposureWorkflow, verifyExposureWorkflowResult, type ExposureWorkflowRequest, type ExposureWorkflowResult } from './exposure-workflow';
import { loadIntakeEvidence } from './intake';

interface ConfirmedAction { request: ExposureWorkflowRequest; preview: ExposureWorkflowResult; }
interface SavedStep { request: ExposureWorkflowRequest; result: ExposureWorkflowResult; }

export function ExposureWorkflow({ worker, exposure, enrollment, asOf, onEnrollmentSaved }: {
  worker: Patient; exposure: Observation; enrollment?: Observation; asOf: string;
  onEnrollmentSaved?: (reference: string) => Promise<void>;
}): JSX.Element {
  const client = useMedplum();
  const profile = client.getProfile();
  const scope = { patient: `Patient/${worker.id}`, exposure: `Observation/${exposure.id}/_history/${exposure.meta!.versionId}`,
    ...(enrollment ? { enrollment: `Observation/${enrollment.id}/_history/${enrollment.meta!.versionId}` } : {}), asOf };
  const scopeSignature = JSON.stringify(scope);
  const storageKey = `oem-exposure-workflow:${client.getProject()?.id}:${profile?.resourceType}/${profile?.id}:${scope.patient}:Observation/${exposure.id}`;
  const [advisory, setAdvisory] = useState<ExposureWorkflowResult>();
  const [steps, setSteps] = useState<SavedStep[]>([]);
  const [decision, setDecision] = useState<DecisionInput['decision']>('accept');
  const [reason, setReason] = useState<DecisionInput['reason']>('local-proposal-requested');
  const [due, setDue] = useState('');
  const [performedOn, setPerformedOn] = useState(asOf);
  const [confirmation, setConfirmation] = useState<ConfirmedAction>();
  const [pending, setPending] = useState<ConfirmedAction>();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recovering, setRecovering] = useState(true);
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const [evidence, setEvidence] = useState<DocumentReference[]>([]);
  const [evidenceError, setEvidenceError] = useState(false);
  const [determination, setDetermination] = useState<ExposureWorkflowRequest['determination']>();
  const [enrollmentStart, setEnrollmentStart] = useState(asOf);
  const [enrollmentEvidence, setEnrollmentEvidence] = useState<string | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    inFlight.current = false;
    setSteps([]); setAdvisory(undefined); setConfirmation(undefined); setPending(undefined); setChecked(false);
    setDecision('accept'); setReason('local-proposal-requested'); setDue(''); setPerformedOn(asOf);
    setBusy(false); setError(''); setRecovering(true); setRecoveryFailed(false);
    setDetermination(undefined); setEnrollmentStart(asOf); setEnrollmentEvidence(null);
    async function restore(): Promise<void> {
      try {
        const saved = JSON.parse(sessionStorage.getItem(`${storageKey}:saved`) ?? '[]') as SavedStep[];
        const uncertain = JSON.parse(sessionStorage.getItem(`${storageKey}:pending`) ?? 'null') as ConfirmedAction | null;
        if (!Array.isArray(saved) || saved.length > 12) throw new Error('Invalid recovery data');
        for (const step of saved) {
          if (step.request.patient !== scope.patient || step.request.exposure !== scope.exposure || step.request.enrollment !== scope.enrollment ||
              !['recommend', 'decide', 'complete'].includes(step.request.mode)) throw new Error('Invalid saved workflow scope');
          await verifyExposureWorkflowResult(client, step.request, step.result);
        }
        if (uncertain && (uncertain.request.patient !== scope.patient || uncertain.request.exposure !== scope.exposure ||
            uncertain.request.enrollment !== scope.enrollment || !['recommend', 'decide', 'complete', 'enroll'].includes(uncertain.request.mode) ||
            uncertain.request.fingerprint !== uncertain.preview.fingerprint || uncertain.request.confirmedSave !== true)) throw new Error('Invalid pending scope');
        if (generation.current === current) { setSteps(saved); setPending(uncertain ?? undefined); }
      } catch { if (generation.current === current) { setRecoveryFailed(true); setError('Saved workflow recovery could not be verified. Do not submit another action.'); } }
      finally { if (generation.current === current) setRecovering(false); }
    }
    void restore();
    return () => { generation.current++; };
  }, [client, storageKey, scopeSignature]);
  useEffect(() => {
    let active = true;
    setEvidence([]); setEvidenceError(false);
    if (!enrollment) loadIntakeEvidence(client, worker).then(records => { if (active) setEvidence(records); })
      .catch(() => { if (active) setEvidenceError(true); });
    return () => { active = false; };
  }, [client, worker, enrollment]);
  const recommendation = steps.find(step => step.result.phase === 'recommendation')?.result;
  const recordedDecision = steps.filter(step => step.result.phase === 'decision').at(-1)?.result;
  const completed = steps.find(step => step.result.phase === 'completion')?.result;
  const task = recordedDecision?.task ?? recommendation?.task;
  const locked = busy || recovering || recoveryFailed || !!pending;
  async function review(request: ExposureWorkflowRequest): Promise<void> {
    if (inFlight.current || locked) return;
    const current = generation.current;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await sendExposureWorkflow(client, request);
      if (generation.current !== current) return;
      if (request.mode === 'preview') setAdvisory(result);
      if (request.mode !== 'preview' || result.canRecommend) {
        const mode = request.mode === 'preview' ? 'recommend' : request.mode === 'decision-preview' ? 'decide'
          : request.mode === 'enrollment-preview' ? 'enroll' : 'complete';
        setConfirmation({ preview: result, request: { ...request, mode, fingerprint: result.fingerprint, confirmedSave: true } });
        setChecked(false);
      }
    } catch { if (generation.current === current) setError('This exposure workflow could not be verified. No save was requested. The matching service update may not be published.'); }
    finally { if (generation.current === current) { inFlight.current = false; setBusy(false); } }
  }
  async function save(): Promise<void> {
    if (!confirmation || !checked || inFlight.current || recoveryFailed) return;
    const current = generation.current;
    const snapshot = structuredClone(confirmation);
    inFlight.current = true; setBusy(true); setError('');
    try {
      sessionStorage.setItem(`${storageKey}:pending`, JSON.stringify(snapshot));
      setPending(snapshot);
      const result = await sendExposureWorkflow(client, snapshot.request);
      if (generation.current !== current) return;
      const updated = result.phase === 'enrollment' ? steps : [...steps, { request: snapshot.request, result }];
      sessionStorage.setItem(`${storageKey}:saved`, JSON.stringify(updated));
      sessionStorage.removeItem(`${storageKey}:pending`);
      setSteps(updated); setPending(undefined); setConfirmation(undefined); setChecked(false);
      if (result.phase === 'enrollment' && result.enrollmentRecord) await onEnrollmentSaved?.(result.enrollmentRecord);
    } catch { if (generation.current === current) { setPending(snapshot); setConfirmation(undefined); setError('Save outcome unconfirmed. Reconcile only this same confirmed action; do not start a different save.'); } }
    finally { if (generation.current === current) { inFlight.current = false; setBusy(false); } }
  }
  const reasons = DECISION_REASONS.filter(item => decision === 'accept' ? item.value === 'local-proposal-requested'
    : decision === 'modify' ? item.value === 'timing-adjusted' : !['local-proposal-requested', 'timing-adjusted'].includes(item.value));
  const action = confirmation?.request.mode === 'recommend' ? 'Save recommendation' : confirmation?.request.mode === 'decide' ? 'Record decision'
    : confirmation?.request.mode === 'enroll' ? 'Record enrollment determination' : 'Save synthetic attestation';
  return <Stack component="section" aria-label="Selected exposure workflow" gap="sm" style={{ minWidth: 0 }}>
    <Title order={3}>Saved recommendations and draft orders</Title>
    <Text size="sm" style={{ overflowWrap: 'anywhere' }}>Exposure: {scope.exposure}</Text>
    {recovering && <Text size="sm">Checking saved workflow</Text>}
    {error && <Alert color="yellow" title="Workflow not confirmed">{error}</Alert>}
    {pending && <Button variant="outline" leftSection={<IconRefresh size={16} />} disabled={busy || recoveryFailed}
      onClick={() => { setConfirmation(pending); setChecked(false); }}>Reconcile confirmed action</Button>}
    {!enrollment && <Stack gap="xs">
      <Title order={4}>Enrollment review for this exposure</Title>
      <Text size="sm">Authority: Synthetic OEM review. No enrollment inferred from measurements.</Text>
      {evidenceError && <Alert color="yellow" title="Enrollment evidence unavailable">Worker-linked evidence could not be verified.</Alert>}
      <Select label="New enrollment determination" value={determination ?? null} disabled={locked} allowDeselect={false}
        data={[{ value: 'enrolled', label: 'Enrolled' }, { value: 'not-enrolled', label: 'Not enrolled' }, { value: 'needs-review', label: 'Needs review' }]}
        onChange={value => setDetermination(value as ExposureWorkflowRequest['determination'])} />
      <TextInput type="date" label="Enrollment effective from for this exposure" value={enrollmentStart} disabled={locked}
        onChange={event => setEnrollmentStart(event.currentTarget.value)} />
      <Select label="Enrollment evidence for this exposure" value={enrollmentEvidence} disabled={locked || evidenceError}
        data={evidence.map(record => ({ value: `DocumentReference/${record.id}/_history/${record.meta!.versionId}`,
          label: `${record.description ?? record.content[0]?.attachment.title ?? record.id} / ${record.id}` }))}
        onChange={setEnrollmentEvidence} />
      <Group><Button leftSection={<IconEye size={16} />} disabled={locked || !determination || !enrollmentStart || !enrollmentEvidence || evidenceError}
        onClick={() => void review({ ...scope, mode: 'enrollment-preview', determination, enrollmentStart, enrollmentEvidence: enrollmentEvidence! })}>Review enrollment determination</Button></Group>
    </Stack>}
    {!recommendation && <Button leftSection={<IconEye size={16} />} disabled={locked} loading={busy}
      onClick={() => void review({ ...scope, mode: 'preview' })}>Review recommendation</Button>}
    {advisory && <>
      <Text fw={600}>Recommendation status: {advisory.status?.replaceAll('-', ' ')}</Text>
      <Text>{advisory.rationale}</Text>
      {!advisory.canRecommend && <Alert color="yellow" title="Source review required">No recommendation saved. Enrollment and exposure evidence must qualify before continuing.</Alert>}
    </>}
    {recommendation && <>
      <Anchor href={`/${recommendation.task}`} target="_blank" rel="noopener noreferrer">View this exposure's recommendation</Anchor>
      <Title order={3}>Clinician decision</Title>
      <Text size="sm">Audiogram: {recordedDecision ? recordedDecision.decision === 'accept' ? 'accepted' : recordedDecision.decision === 'dismiss' ? 'rejected' : 'requested' : 'requested'}</Text>
      <Text size="sm">Requirement classification: Unclassified</Text>
      {(!recordedDecision || recordedDecision.decision === 'modify') && <>
        <SegmentedControl aria-label="Decision for selected exposure" value={decision} disabled={locked} fullWidth
          data={[{ value: 'accept', label: 'Accept' }, { value: 'modify', label: 'Modify' }, { value: 'dismiss', label: 'Dismiss' }]}
          onChange={value => { setDecision(value as DecisionInput['decision']); setReason(value === 'accept' ? 'local-proposal-requested' : value === 'modify' ? 'timing-adjusted' : 'evidence-pending'); }} />
        <Select label="Decision reason for selected exposure" value={reason} data={reasons} disabled={locked} allowDeselect={false}
          onChange={value => setReason(value as DecisionInput['reason'])} />
        {decision === 'modify' && <TextInput type="date" label="Selected exposure due date" value={due} disabled={locked} onChange={event => setDue(event.currentTarget.value)} />}
        <Group><Button leftSection={<IconEye size={16} />} disabled={locked || decision === 'modify' && !due}
          onClick={() => void review({ ...scope, mode: 'decision-preview', task, decision, reason, ...(decision === 'modify' ? { due } : {}) })}>Review decision</Button></Group>
      </>}
    </>}
    {recordedDecision?.proposal && <>
      <Text size="sm">Local proposal: draft. Not signed, activated or sent.</Text>
      <Anchor href={`/${recordedDecision.proposal}`} target="_blank" rel="noopener noreferrer">View this exposure's draft order</Anchor>
      <Title order={3}>Synthetic follow-up</Title>
      <Text size="sm">Demo assumption: 12 calendar months; clinical review pending.</Text>
      {!completed && <>
        <TextInput type="date" label="Synthetic performed date" value={performedOn} disabled={locked} onChange={event => setPerformedOn(event.currentTarget.value)} />
        <Group><Button leftSection={<IconEye size={16} />} disabled={locked || !performedOn}
          onClick={() => void review({ ...scope, mode: 'completion-preview', task, performedOn })}>Preview synthetic follow-up</Button></Group>
      </>}
    </>}
    {completed && <>
      <Alert color="yellow" title="Synthetic attestation saved">Simulated attestation only. Clinical completion is not verified.</Alert>
      <Title order={3}>Exposure summary</Title>
      <Text size="sm">Simulated performed date: {completed.performedOn}</Text>
      <Text size="sm">Illustrative next periodic date: {completed.nextPeriodicOn}</Text>
      <Text size="sm">Accepted recommendation and local draft remain unchanged.</Text>
      <Anchor href={`/${completed.report}`} target="_blank" rel="noopener noreferrer">View this exposure's synthetic report</Anchor>
      <Anchor href={`/${completed.attestation}`} target="_blank" rel="noopener noreferrer">View this exposure's attestation</Anchor>
      <Group><Button leftSection={<IconDownload size={16} />} disabled={locked} onClick={() => {
        const bytes = new Blob([JSON.stringify(exposureSummary(completed), null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(bytes);
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = `synthetic-noise-exposure-${exposure.id}.json`; anchor.click(); URL.revokeObjectURL(url);
      }}>Download exposure summary</Button></Group>
    </>}
    <Modal opened={!!confirmation} onClose={() => { if (!busy) { setConfirmation(undefined); setChecked(false); } }} title="Confirm exposure workflow"
      closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy}>
      {confirmation && <Stack gap="sm" style={{ overflowWrap: 'anywhere' }}>
        <Text>{scope.patient}</Text><Text>{scope.exposure}</Text>
        <Text>{confirmation.preview.rationale ?? 'Synthetic workflow only. No order activation, external delivery or verified clinical completion.'}</Text>
        {confirmation.request.task && <Text>Recommendation: {confirmation.request.task}</Text>}
        {confirmation.request.decision && <Text>Decision: {confirmation.request.decision}</Text>}
        {confirmation.request.determination && <><Text>Enrollment determination: {confirmation.request.determination}</Text>
          <Text>Enrollment effective from: {confirmation.request.enrollmentStart}</Text><Text>Evidence: {confirmation.request.enrollmentEvidence}</Text></>}
        {confirmation.preview.performedOn && <Text>Simulated performed date: {confirmation.preview.performedOn}</Text>}
        {confirmation.preview.nextPeriodicOn && <Text>Illustrative next periodic date: {confirmation.preview.nextPeriodicOn}</Text>}
        <Checkbox label="I confirm this synthetic action for the displayed exposure only" checked={checked} disabled={busy} onChange={event => setChecked(event.currentTarget.checked)} />
        <Group><Button leftSection={confirmation.request.mode === 'decide' ? <IconCheck size={16} /> : <IconDeviceFloppy size={16} />}
          disabled={!checked || busy || recoveryFailed} loading={busy} onClick={() => void save()}>{pending ? 'Reconcile same action' : action}</Button>
          <Button variant="subtle" leftSection={<IconX size={16} />} disabled={busy} onClick={() => { setConfirmation(undefined); setChecked(false); }}>Cancel</Button></Group>
      </Stack>}
    </Modal>
  </Stack>;
}