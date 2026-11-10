import { Alert, Anchor, Button, Checkbox, Group, Stack, Text, Title } from '@mantine/core';
import { useMedplum } from '@medplum/react';
import { IconDeviceFloppy, IconEye, IconRefresh, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState, type JSX } from 'react';
import type { CompletionPreviewResult } from './completion-preview';
import { inspectSyntheticCompletion, saveSyntheticCompletion, type SavedSyntheticCompletion } from './completion-save';

export function CompletionPreview(): JSX.Element {
  const medplum = useMedplum();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CompletionPreviewResult>();
  const [error, setError] = useState(false);
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false);
  const [fingerprint, setFingerprint] = useState<string>();
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [pending, setPending] = useState<string>();
  const [recorded, setRecorded] = useState<SavedSyntheticCompletion>();
  const inFlight = useRef(false);
  const generation = useRef(0);
  const scope = `${medplum.getProject()?.id}:${medplum.getProfile()?.id}`;
  const pendingKey = `oem-synthetic-completion:${scope}`;
  useEffect(() => {
    generation.current++;
    inFlight.current = false;
    setResult(undefined);
    setConfirmed(false);
    setBusy(false);
    setError(false);
    setFingerprint(undefined);
    setSaveConfirmed(false);
    setRecorded(undefined);
    setPending(undefined);
    setRecoveryUnavailable(false);
    try {
      const saved = sessionStorage.getItem(pendingKey);
      if (saved !== null && !/^[a-f0-9]{64}$/.test(saved)) throw new Error('Invalid recovery fingerprint');
      setPending(saved ?? undefined);
    } catch {
      setRecoveryUnavailable(true);
    }
    return () => { generation.current++; };
  }, [medplum, scope, pendingKey]);

  const preview = async (): Promise<void> => {
    if (!confirmed || recoveryUnavailable || inFlight.current || result) return;
    const current = generation.current;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      const value = await inspectSyntheticCompletion(medplum, confirmed);
      if (generation.current === current) {
        setResult(value.preview); setFingerprint(value.fingerprint); setRecorded(value.recorded);
        if (value.recorded) { sessionStorage.removeItem(pendingKey); setPending(undefined); }
      }
    } catch {
      if (generation.current === current) setError(true);
    } finally {
      if (generation.current === current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };
  const save = async (): Promise<void> => {
    if (!saveConfirmed || recoveryUnavailable || !fingerprint || recorded || inFlight.current || (pending && pending !== fingerprint)) return;
    const current = generation.current;
    inFlight.current = true; setBusy(true); setError(false);
    try {
      try {
        sessionStorage.setItem(pendingKey, fingerprint);
      } catch {
        if (generation.current === current) setRecoveryUnavailable(true);
        return;
      }
      setPending(fingerprint); setSaveConfirmed(false);
      const value = await saveSyntheticCompletion(medplum, fingerprint, true);
      if (generation.current === current) {
        sessionStorage.removeItem(pendingKey);
        setRecorded(value); setPending(undefined);
      }
    } catch { if (generation.current === current) setError(true); }
    finally {
      if (generation.current === current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <Stack gap="sm" style={{ minWidth: 0 }}>
      <Title order={3}>Simulated completion</Title>
      <Text size="sm">Demo assumption: 12 calendar months; clinical review pending.</Text>
      {recoveryUnavailable && <Alert color="yellow" title="Recovery unavailable">Completion recovery data cannot be verified. Do not submit another synthetic save.</Alert>}
      {error && <Alert color="yellow" title="Preview unavailable">The accepted work remains unchanged.</Alert>}
      {pending && !recorded && <Alert color="yellow" title="Save outcome uncertain">Only the same explicitly reconfirmed synthetic save may be reconciled. The accepted work remains unchanged.</Alert>}
      {!result && <>
        <Checkbox label="I confirm this is a synthetic example" checked={confirmed} disabled={busy || recoveryUnavailable}
          onChange={event => setConfirmed(event.currentTarget.checked)} />
        <Group><Button leftSection={<IconEye size={16} />} disabled={!confirmed || busy || recoveryUnavailable} loading={busy} onClick={preview}>
          Preview simulated completion
        </Button></Group>
      </>}
      {result && <>
        <Alert color="yellow" title={recorded ? 'Synthetic attestation saved' : 'Preview not saved'}>Simulated attestation only. Clinical completion is not verified.</Alert>
        <Text size="sm">Simulated performed date: {result.performedOn}</Text>
        <Text size="sm">Illustrative next periodic date: {result.nextPeriodicOn}</Text>
        <Anchor size="sm" style={{ overflowWrap: 'anywhere' }} href={`/${result.report}`}>View synthetic audiogram report</Anchor>
        <Text size="sm">Accepted recommendation and local draft remain unchanged.</Text>
        {recorded ? <Group gap="sm">
          <Anchor href={`/${recorded.attestation}`}>View synthetic attestation</Anchor>
          <Anchor href={`/${recorded.lineage}`}>View attestation lineage</Anchor>
          <Anchor href={`/${recorded.receipt}`}>View save receipt</Anchor>
        </Group> : <>
          <Checkbox label={pending ? 'I confirm reconciliation of this same synthetic save' : 'I confirm saving this synthetic attestation only'}
            checked={saveConfirmed} disabled={busy || recoveryUnavailable || !!pending && pending !== fingerprint} onChange={event => setSaveConfirmed(event.currentTarget.checked)} />
          <Group><Button color="teal" leftSection={pending ? <IconRefresh size={16} /> : <IconDeviceFloppy size={16} />}
            disabled={!saveConfirmed || busy || recoveryUnavailable || !!pending && pending !== fingerprint} loading={busy} onClick={save}>
            {pending ? 'Reconcile synthetic save' : 'Save synthetic attestation'}
          </Button></Group>
        </>}
        {!pending && <Group><Button variant="subtle" disabled={busy} leftSection={<IconX size={16} />} onClick={() => { setResult(undefined); setConfirmed(false); setRecorded(undefined); setSaveConfirmed(false); setFingerprint(undefined); }}>Dismiss preview</Button></Group>}
      </>}
    </Stack>
  );
}