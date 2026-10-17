import { Alert, Loader, Modal, Stack, Text } from '@mantine/core';
import { useMedplum } from '@medplum/react';
import type { DocumentReference } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { describeHawaiiRecord, readHawaiiTextAttachment } from './clinical';
import { getHawaiiConsentStatus } from './consent';

export function HawaiiDocumentViewer({ patientId, documentId, onClose }: {
  patientId: string;
  documentId: string;
  onClose: () => void;
}): JSX.Element {
  const medplum = useMedplum();
  const [result, setResult] = useState<{ document: DocumentReference; text: string }>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const consents = await medplum.searchResources('Consent', {
          patient: `Patient/${patientId}`, status: 'active', _count: '2',
        }, { cache: 'no-cache' });
        if (cancelled) {
          return;
        }
        if (getHawaiiConsentStatus(consents, patientId) !== 'opt-in') {
          throw new Error('Current sharing permission unavailable');
        }
        const document = await medplum.readResource('DocumentReference', documentId, { cache: 'no-cache' });
        if (document.subject?.reference !== `Patient/${patientId}` || document.status !== 'current' ||
          document.content.length !== 1) {
          throw new Error('Document is not available for this patient');
        }
        const text = readHawaiiTextAttachment(document.content[0].attachment);
        if (!cancelled) {
          setResult({ document, text });
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [documentId, medplum, patientId]);

  const entry = result && describeHawaiiRecord(result.document);
  return <Modal opened onClose={onClose} title="Clinical document" size="lg" centered closeButtonProps={{ 'aria-label': 'Close document' }}>
    {failed ? <Alert color="red" title="Document unavailable">The document could not be verified or its format is not supported.</Alert> :
      !result || !entry ? <Loader aria-label="Checking document access" /> : <Stack>
        <Text fw={600}>{entry.label}</Text>
        <Text c="dimmed" size="sm">{entry.source}</Text>
        <Text c="dimmed" size="sm">{entry.date}</Text>
        <Text component="div" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{result.text}</Text>
      </Stack>}
  </Modal>;
}