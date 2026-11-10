import {
  Alert,
  Anchor,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { Task } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconCheck, IconEye, IconRefresh, IconX } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  DECISION_REASONS,
  decisionTaskReference,
  loadDecisionTask,
  sendDecision,
  type DecisionInput,
  type DecisionResult,
} from './clinician-decision';

interface Confirmation {
  input: DecisionInput;
  fingerprint: string;
}

export function ClinicianDecision(): JSX.Element {
  const medplum = useMedplum();
  const storageKey = `oem-clinician-decision:${medplum.getProject()?.id}:${medplum.getProfile()?.id}`;
  const [task, setTask] = useState<Task>();
  const [decision, setDecision] = useState<DecisionInput['decision']>('accept');
  const [reason, setReason] = useState<DecisionInput['reason']>('local-proposal-requested');
  const [due, setDue] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [pending, setPending] = useState<Confirmation>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DecisionResult>();
  const inFlight = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    inFlight.current = false;
    setTask(undefined);
    setDecision('accept');
    setReason('local-proposal-requested');
    setDue('');
    setConfirmation(undefined);
    setPending(undefined);
    setConfirmed(false);
    setBusy(false);
    setError('');
    setResult(undefined);
    setLoading(true);
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Confirmation;
        if (
          !parsed?.input ||
          !/^[a-f0-9]{64}$/.test(parsed.fingerprint) ||
          typeof parsed.input.task !== 'string' ||
          !['accept', 'modify', 'dismiss'].includes(parsed.input.decision) ||
          !DECISION_REASONS.some((item) => item.value === parsed.input.reason)
        )
          throw new Error('Invalid pending decision');
        setPending(parsed);
      }
    } catch {
      setError('Decision recovery data is unavailable. Do not submit another decision.');
    }
    loadDecisionTask(medplum)
      .then((value) => {
        if (generation.current === current) setTask(value);
      })
      .catch(() => {
        if (generation.current === current) setError('Clinician decisions are unavailable for this recommendation.');
      })
      .finally(() => {
        if (generation.current === current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [medplum, storageKey]);

  const preview = async (): Promise<void> => {
    if (!task || inFlight.current || pending || result || error) return;
    const input: DecisionInput = {
      task: decisionTaskReference(task),
      decision,
      reason,
      ...(decision === 'modify' ? { due } : {}),
    };
    inFlight.current = true;
    setBusy(true);
    const current = generation.current;
    try {
      const value = await sendDecision(medplum, input, 'preview');
      if (generation.current === current) {
        setConfirmation({ input, fingerprint: value.fingerprint });
        setConfirmed(false);
      }
    } catch {
      if (generation.current === current)
        setError('Preview could not be verified. Reload and review the current Task before continuing.');
    } finally {
      if (generation.current === current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };

  const save = async (): Promise<void> => {
    if (!confirmation || !confirmed || inFlight.current) return;
    const snapshot = structuredClone(confirmation);
    const current = generation.current;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
      setPending(snapshot);
      const value = await sendDecision(medplum, snapshot.input, 'decide', snapshot.fingerprint);
      if (generation.current === current) {
        sessionStorage.removeItem(storageKey);
        setPending(undefined);
        setResult(value);
        setConfirmation(undefined);
      }
    } catch {
      if (generation.current === current) {
        setPending(snapshot);
        setConfirmation(undefined);
        setError(
          'Decision outcome is unconfirmed. Reconcile only the original confirmed decision; do not submit a different decision.'
        );
      }
    } finally {
      if (generation.current === current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };

  const locked = busy || !!pending || !!result || !!error || task?.status !== 'requested';
  const reasons = DECISION_REASONS.filter((item) =>
    decision === 'accept'
      ? item.value === 'local-proposal-requested'
      : decision === 'modify'
        ? item.value === 'timing-adjusted'
        : !['local-proposal-requested', 'timing-adjusted'].includes(item.value)
  );
  return (
    <Stack gap="sm" style={{ minWidth: 0 }}>
      <Title order={3}>Clinician decision</Title>
      {loading ? (
        <Loader size="sm" aria-label="Loading clinician decision" />
      ) : (
        <>
          {error && (
            <Alert color="yellow" title="Decision not confirmed">
              {error}
            </Alert>
          )}
          {task && (
            <>
              <Group>
                <Text size="sm">
                  Audiogram:{' '}
                  {result
                    ? result.decision === 'accept'
                      ? 'accepted'
                      : result.decision === 'dismiss'
                        ? 'rejected'
                        : 'requested'
                    : task.status}
                </Text>
                <Anchor size="sm" href={`/${decisionTaskReference(task)}`}>
                  Review exact recommendation
                </Anchor>
              </Group>
              <Text size="sm">Requirement classification: Unclassified</Text>
              {!result && <Text size="sm">Recorded due date: {task.restriction?.period?.end ?? 'Not recorded'}</Text>}
              <SegmentedControl
                aria-label="Clinician decision"
                value={decision}
                disabled={locked}
                fullWidth
                data={[
                  { value: 'accept', label: 'Accept' },
                  { value: 'modify', label: 'Modify' },
                  { value: 'dismiss', label: 'Dismiss' },
                ]}
                onChange={(value) => {
                  setDecision(value as DecisionInput['decision']);
                  setReason(
                    value === 'accept'
                      ? 'local-proposal-requested'
                      : value === 'modify'
                        ? 'timing-adjusted'
                        : 'evidence-pending'
                  );
                }}
              />
              <Select
                label="Decision reason"
                data={reasons}
                value={reason}
                allowDeselect={false}
                disabled={locked}
                onChange={(value) => setReason(value as DecisionInput['reason'])}
              />
              {decision === 'modify' && (
                <TextInput
                  type="date"
                  label="Clinician-selected due date"
                  value={due}
                  disabled={locked}
                  onChange={(event) => setDue(event.currentTarget.value)}
                />
              )}
              <Group>
                <Button
                  leftSection={<IconEye size={16} />}
                  loading={busy && !confirmation}
                  disabled={locked || (decision === 'modify' && !due)}
                  onClick={() => void preview()}
                >
                  Review decision
                </Button>
                {pending && (
                  <Button
                    variant="outline"
                    leftSection={<IconRefresh size={16} />}
                    disabled={busy}
                    onClick={() => {
                      setConfirmation(pending);
                      setConfirmed(false);
                    }}
                  >
                    Reconcile confirmed decision
                  </Button>
                )}
              </Group>
            </>
          )}
          {result && (
            <Alert color="green" title="Decision recorded">
              <Stack gap={4}>
                <Text size="sm">
                  {result.decision}. Local synthetic record only. No external delivery or clinical completion.
                </Text>
                <Anchor href={`/${result.task}`}>View resulting Task</Anchor>
                <Anchor href={`/${result.receipt}`}>View decision receipt</Anchor>
                {result.proposal && <Anchor href={`/${result.proposal}`}>View local draft proposal</Anchor>}
              </Stack>
            </Alert>
          )}
        </>
      )}
      <Modal
        opened={!!confirmation}
        onClose={() => {
          if (!busy) setConfirmation(undefined);
        }}
        title={pending ? 'Reconcile original decision' : 'Confirm clinician decision'}
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        withCloseButton={!busy}
      >
        {confirmation && (
          <Stack>
            <Text>
              {confirmation.input.decision}:{' '}
              {DECISION_REASONS.find((item) => item.value === confirmation.input.reason)?.label}
            </Text>
            {confirmation.input.due && <Text>Due date: {confirmation.input.due}</Text>}
            <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
              {confirmation.input.task}
            </Text>
            <Text size="sm">
              Local synthetic record only. No external delivery, clinical completion or rule activation.
            </Text>
            <Checkbox
              label="I confirm this decision for the reviewed Task version"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
            />
            <Group justify="flex-end">
              <Button
                variant="default"
                leftSection={<IconX size={16} />}
                disabled={busy}
                onClick={() => setConfirmation(undefined)}
              >
                Cancel
              </Button>
              <Button
                leftSection={<IconCheck size={16} />}
                loading={busy}
                disabled={!confirmed || busy}
                onClick={() => void save()}
              >
                {pending ? 'Reconcile same decision' : 'Record decision'}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
