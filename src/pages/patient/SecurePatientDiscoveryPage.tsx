import { Alert, Button, Group, Modal, Paper, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { createReference, getDisplayString, normalizeErrorString } from '@medplum/core';
import { showNotification } from '@mantine/notifications';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import type { Patient } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { createBreakGlassAudit } from '../../utils/audit';

const DISCOVERY_BOT_ID = 'bc5b25f7-9adc-4334-9774-bd465c039df1';

type DiscoveryPatient = Pick<Patient, 'resourceType' | 'id' | 'name' | 'birthDate' | 'gender' | 'identifier'> & {
  consentStatus: string;
};

export function SecurePatientDiscoveryPage(): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DiscoveryPatient[]>([]);
  const [selected, setSelected] = useState<DiscoveryPatient>();
  const [reason, setReason] = useState('');
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const search = async (): Promise<void> => {
    setSearching(true);
    try {
      setResults(await medplum.executeBot(DISCOVERY_BOT_ID, { query }, 'application/json'));
    } catch (error) {
      showNotification({ color: 'red', message: normalizeErrorString(error), title: 'Search unavailable' });
    } finally {
      setSearching(false);
    }
  };

  const requestAccess = async (): Promise<void> => {
    if (!selected?.id || !profile || !reason.trim()) {
      return;
    }
    setSubmitting(true);
    try {
      await medplum.createResource(
        createBreakGlassAudit(selected.id, reason.trim(), createReference(profile), {
          consentStatus: selected.consentStatus,
          correlationId: globalThis.crypto.randomUUID(),
        })
      );
      showNotification({ color: 'blue', message: 'Emergency access request recorded. Refresh after processing completes.' });
      setSelected(undefined);
      setReason('');
    } catch (error) {
      showNotification({ color: 'red', message: normalizeErrorString(error), title: 'Unable to request access' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Paper m="md" p="md" shadow="xs">
      <Stack>
        <Title order={3}>Secure Patient Discovery</Title>
        <Text size="sm">Search returns directory information only. Clinical records require active consent or approved emergency access.</Text>
        <Group align="end">
          <TextInput label="Patient name or identifier" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          <Button onClick={() => void search()} loading={searching} disabled={query.trim().length < 2}>Search</Button>
        </Group>
        {results.map((patient) => (
          <Alert key={patient.id} color={patient.consentStatus === 'not-declared' ? 'yellow' : 'blue'}>
            <Group justify="space-between">
              <div>
                <Text fw={700}>{getDisplayString(patient)}</Text>
                <Text size="sm">Consent: {patient.consentStatus}</Text>
              </div>
              {patient.consentStatus === 'not-declared' ? (
                <Button size="xs" onClick={() => setSelected(patient)}>Break the glass</Button>
              ) : (
                <Button size="xs" onClick={() => navigate(`/Patient/${patient.id}`)?.catch(console.error)}>Open chart</Button>
              )}
            </Group>
          </Alert>
        ))}
      </Stack>
      <Modal opened={Boolean(selected)} onClose={() => setSelected(undefined)} title="Break the glass" centered>
        <Stack>
          <Text>Enter the clinical reason for temporary emergency access to {selected && getDisplayString(selected)}.</Text>
          <Textarea label="Reason for access" value={reason} onChange={(event) => setReason(event.currentTarget.value)} required minRows={3} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setSelected(undefined)}>Cancel</Button>
            <Button onClick={() => void requestAccess()} loading={submitting} disabled={!reason.trim()}>Request access</Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
