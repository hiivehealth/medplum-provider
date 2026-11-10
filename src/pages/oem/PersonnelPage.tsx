import {
  Alert,
  Anchor,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { getDisplayString } from '@medplum/core';
import type { QuestionnaireResponse } from '@medplum/fhirtypes';
import { QuestionnaireForm, useMedplum, useMedplumProfile } from '@medplum/react';
import { IconDeviceFloppy, IconEye, IconRefresh, IconX } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { OEM_PROJECT_ID } from './ih-review';
import type {
  PersonnelContext,
  PersonnelHistory,
  PersonnelPending,
  PersonnelResult,
  PersonnelSaved,
} from './personnel';
import {
  assertPersonnelPending,
  loadPersonnelHistory,
  loadPersonnelPreview,
  pendingPersonnel,
  PERSONNEL_PENDING_KEY,
  personnelCanSave,
  personnelForm,
  previewPersonnel,
  savePersonnel,
} from './personnel';

export function PersonnelPage(): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const actor = profile ? `${profile.resourceType}/${profile.id}` : '';
  const project = medplum.getProject()?.id;
  const [context, setContext] = useState<PersonnelContext>();
  const [response, setResponse] = useState<QuestionnaireResponse>();
  const [result, setResult] = useState<PersonnelResult>();
  const [canSave, setCanSave] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<PersonnelPending>();
  const [saved, setSaved] = useState<PersonnelSaved>();
  const [history, setHistory] = useState<PersonnelHistory>();
  const [historyError, setHistoryError] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(0);
  const generation = useRef(0);
  const submitting = useRef(false);

  useEffect(() => {
    const version = ++generation.current;
    setContext(undefined);
    setResponse(undefined);
    setResult(undefined);
    setCanSave(false);
    setConfirming(false);
    setPending(undefined);
    setSaved(undefined);
    setError('');
    setBusy(false);
    submitting.current = false;
    setLoading(true);
    if (project !== OEM_PROJECT_ID) {
      setError('The Army OEM Synthetic Demo Project is required.');
      setLoading(false);
      return;
    }
    void loadPersonnelPreview(medplum)
      .then(async (data) => {
        const allowed = await personnelCanSave(medplum);
        const marker = sessionStorage.getItem(PERSONNEL_PENDING_KEY);
        const restored = marker ? (JSON.parse(marker) as PersonnelPending) : undefined;
        if (restored) assertPersonnelPending(medplum, restored);
        if (generation.current === version) {
          setContext(data);
          setCanSave(allowed);
          setPending(restored);
        }
      })
      .catch(() => {
        if (generation.current === version)
          setError('Personnel preview access, worker, form or source could not be verified.');
      })
      .finally(() => {
        if (generation.current === version) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [medplum, actor, project]);

  useEffect(() => {
    let active = true;
    setHistory(undefined);
    setHistoryError(false);
    if (context && canSave && project === OEM_PROJECT_ID) {
      void loadPersonnelHistory(medplum)
        .then((value) => {
          if (active) setHistory(value);
        })
        .catch(() => {
          if (active) setHistoryError(true);
        });
    }
    return () => {
      active = false;
    };
  }, [medplum, actor, project, context, canSave, saved]);

  async function preview(): Promise<void> {
    if (submitting.current || !context || !response || pending || confirming) return;
    submitting.current = true;
    const version = generation.current;
    setBusy(true);
    setResult(undefined);
    setSaved(undefined);
    setError('');
    try {
      const value = await previewPersonnel(medplum, response);
      if (generation.current === version) setResult(value);
    } catch {
      if (generation.current === version)
        setError('The personnel preview could not be verified. Review required selections and try again.');
    } finally {
      if (generation.current === version) {
        submitting.current = false;
        setBusy(false);
      }
    }
  }

  async function save(): Promise<void> {
    if (submitting.current || !canSave || (!pending && (!result || !confirming))) return;
    submitting.current = true;
    const version = generation.current;
    setBusy(true);
    setError('');
    let sent = false;
    try {
      const operation = pending ?? pendingPersonnel(medplum, result!);
      assertPersonnelPending(medplum, operation);
      const encoded = JSON.stringify(operation);
      const existing = sessionStorage.getItem(PERSONNEL_PENDING_KEY);
      if (pending ? existing !== encoded : existing !== null) throw new Error('Pending submission differs.');
      sessionStorage.setItem(PERSONNEL_PENDING_KEY, encoded);
      if (sessionStorage.getItem(PERSONNEL_PENDING_KEY) !== encoded)
        throw new Error('Pending submission was not retained.');
      setPending(operation);
      setConfirming(false);
      sent = true;
      const value = await savePersonnel(medplum, operation);
      if (generation.current === version) {
        if (sessionStorage.getItem(PERSONNEL_PENDING_KEY) !== encoded) throw new Error('Pending submission changed.');
        sessionStorage.removeItem(PERSONNEL_PENDING_KEY);
        setPending(undefined);
        setSaved(value);
        setResult(undefined);
        setResponse(undefined);
        setReset((value) => value + 1);
      }
    } catch {
      if (generation.current === version)
        setError(
          sent
            ? 'Save is unconfirmed. The same submission is retained for retry or independent review.'
            : 'Save was not sent because its pending record could not be verified or retained.'
        );
    } finally {
      if (generation.current === version) {
        submitting.current = false;
        setBusy(false);
      }
    }
  }

  const submission = result?.collection.entry?.find(
    (entry) => entry.resource?.resourceType === 'QuestionnaireResponse'
  )?.resource;
  const fact = result?.collection.entry?.find((entry) => entry.resource?.resourceType === 'Observation')?.resource;
  return (
    <Container size="lg" py="md" style={{ minWidth: 0 }}>
      <Stack>
        <Group justify="space-between">
          <Title order={2}>Personnel Facts</Title>
          <Badge color="yellow">Synthetic</Badge>
        </Group>
        <Alert color="yellow" title="Synthetic Personnel Attestation">
          Not authoritative personnel data, enrollment authority, clinical approval or an activated rule.
        </Alert>
        {loading && <Loader aria-label="Loading personnel preview" />}
        {error && (
          <Alert color="red" title={pending ? 'Save Unconfirmed' : 'Preview Unavailable'} role="alert">
            {error}
          </Alert>
        )}
        {context && (
          <>
            <Title order={3}>{getDisplayString(context.patient)}</Title>
            <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
              Supporting record:{' '}
              <Anchor href={`/DocumentReference/${context.source.id}/history`}>
                Synthetic personnel preview fixture
              </Anchor>
            </Text>
            <fieldset
              disabled={busy || !!pending || confirming}
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            >
              <QuestionnaireForm
                key={`${actor}:${reset}`}
                questionnaire={personnelForm(context)}
                excludeButtons
                onChange={(value) => {
                  if (submitting.current || pending || confirming) return;
                  generation.current++;
                  setResponse(value);
                  setResult(undefined);
                  setError('');
                }}
              />
            </fieldset>
            <Group>
              <Button
                leftSection={<IconEye size={16} />}
                onClick={() => void preview()}
                disabled={!response || !!pending || confirming}
                loading={busy}
              >
                Preview
              </Button>
              <Button
                variant="default"
                leftSection={<IconX size={16} />}
                disabled={busy || !!pending || confirming}
                onClick={() => {
                  generation.current++;
                  setResponse(undefined);
                  setResult(undefined);
                  setError('');
                  setReset((value) => value + 1);
                }}
              >
                Cancel
              </Button>
            </Group>
          </>
        )}
        {pending && (
          <Alert color="yellow" title="Pending Submission">
            <Stack gap="xs">
              <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                {pending.submissionId}
              </Text>
              <Button
                leftSection={<IconRefresh size={16} />}
                onClick={() => void save()}
                loading={busy}
                disabled={!canSave}
              >
                Retry Same Save
              </Button>
            </Stack>
          </Alert>
        )}
        {result && (
          <Stack component="section" aria-label="Personnel preview result" gap="xs">
            <Group>
              <Title order={3}>Personnel Fact Preview</Title>
              <Badge color="yellow">Not Saved</Badge>
            </Group>
            <Text>{fact?.resourceType === 'Observation' ? fact.code.coding?.[0]?.code?.replaceAll('-', ' ') : ''}</Text>
            {fact?.resourceType === 'Observation' && (
              <Text>
                {fact.valueCodeableConcept
                  ? `Population: ${fact.valueCodeableConcept.coding?.[0]?.code}`
                  : `Event: ${fact.effectiveDateTime} (${fact.component?.[0]?.valueCodeableConcept?.coding?.[0]?.code})`}
              </Text>
            )}
            <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
              Clinician: {submission?.resourceType === 'QuestionnaireResponse' ? submission.author?.reference : ''}
            </Text>
            <Text size="sm">
              Recorded: {submission?.resourceType === 'QuestionnaireResponse' ? submission.authored : ''}
            </Text>
            <Table.ScrollContainer minWidth={460}>
              <Table aria-label="Proposed personnel resources">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Proposed Resource</Table.Th>
                    <Table.Th>Proposed Identity</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {result.collection.entry?.map((entry) => (
                    <Table.Tr key={entry.fullUrl}>
                      <Table.Td>{entry.resource?.resourceType}</Table.Td>
                      <Table.Td style={{ overflowWrap: 'anywhere' }}>{entry.fullUrl}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {canSave && !pending && (
              <Group>
                <Button
                  leftSection={<IconDeviceFloppy size={16} />}
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                >
                  Save
                </Button>
              </Group>
            )}
          </Stack>
        )}
        {saved && (
          <Stack component="section" aria-label="Saved personnel attestation" gap="xs">
            <Group>
              <Title order={3}>Personnel Attestation</Title>
              <Badge color="green">Saved</Badge>
            </Group>
            <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
              Receipt: {saved.receipt}
            </Text>
            {saved.resources.map((item) => (
              <Text key={item.step} size="sm" style={{ overflowWrap: 'anywhere' }}>
                {item.step}: {item.reference}
              </Text>
            ))}
          </Stack>
        )}
        {context && canSave && (
          <Stack component="section" aria-label="Verified personnel history" gap="xs">
            <Title order={3}>Saved Personnel Attestations</Title>
            {historyError ? (
              <Alert color="red" title="History Unverified">
                Saved personnel history could not be independently verified.
              </Alert>
            ) : !history ? (
              <Loader aria-label="Loading saved personnel history" />
            ) : history.entries.length === 0 ? (
              <Text>No saved personnel attestations recorded.</Text>
            ) : (
              history.entries.map((entry) => (
                <Stack key={entry.saved.receipt} gap={4}>
                  <Text fw={600}>
                    {entry.kind.replaceAll('-', ' ')}: {entry.value.replaceAll('-', ' ')}
                  </Text>
                  <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                    Clinician: {entry.actor}
                  </Text>
                  <Text size="sm">Recorded: {entry.recorded}</Text>
                  <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                    Receipt: {entry.saved.receipt}
                  </Text>
                  {entry.saved.resources.map((item) => (
                    <Text key={item.step} size="sm" style={{ overflowWrap: 'anywhere' }}>
                      {item.step}: {item.reference}
                    </Text>
                  ))}
                </Stack>
              ))
            )}
            {history?.limited && (
              <Alert color="yellow" title="History Limited">
                Only the ten most recent saved attestations are shown.
              </Alert>
            )}
          </Stack>
        )}
        <Modal
          opened={confirming}
          onClose={() => {
            if (!busy) setConfirming(false);
          }}
          title="Confirm Personnel Save"
          closeOnClickOutside={!busy}
          closeOnEscape={!busy}
          withCloseButton={!busy}
        >
          <Stack>
            <Text>Synthetic clinician attestation</Text>
            <Text>{fact?.resourceType === 'Observation' ? fact.code.coding?.[0]?.code?.replaceAll('-', ' ') : ''}</Text>
            <Text>
              {fact?.resourceType === 'Observation'
                ? (fact.valueCodeableConcept?.coding?.[0]?.code ??
                  `${fact.effectiveDateTime} (${fact.component?.[0]?.valueCodeableConcept?.coding?.[0]?.code})`)
                : ''}
            </Text>
            <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
              Clinician: {actor}
            </Text>
            <Text size="sm">No rule activation, enrollment decision or orders.</Text>
            <Group justify="flex-end">
              <Button
                variant="default"
                leftSection={<IconX size={16} />}
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button leftSection={<IconDeviceFloppy size={16} />} loading={busy} onClick={() => void save()}>
                Confirm Save
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    </Container>
  );
}
