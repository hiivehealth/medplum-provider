// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Card, Divider, Group, Stack, Text, Textarea } from '@mantine/core';
import { createReference, formatDate } from '@medplum/core';
import type { Encounter, Provenance } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { IconLock, IconPencil, IconSignature } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { ChartNoteStatus } from '../../types/encounter';
import { isRedRoverImportedEncounter } from '../../utils/encounter';
import { showErrorNotification } from '../../utils/notifications';

interface SignAddendumProps {
  provenances: Provenance[];
  chartNoteStatus: ChartNoteStatus;
  encounter: Encounter;
}

interface ProvenanceDisplay {
  practitionerName: string;
  timestamp: string;
}

interface AddendumDisplay {
  authorName: string;
  timestamp: string;
  text: string;
}

function isRedRoverImport(provenance: Provenance): boolean {
  return (
    provenance.meta?.project === '8588313a-c8c6-4e07-8c1d-e684ed25e522' &&
    provenance.meta.tag?.some(
      (tag) => tag.system === 'https://hiivehealth.com/fhir/red-rover/uat/five-patient-test/import-operation'
    ) === true &&
    provenance.agent?.some((agent) => agent.who.reference === 'Device/5b04041c-b93e-4347-95a3-cb2be9e097d2') === true &&
    !provenance.signature?.length
  );
}

export const SignAddendum = ({ provenances, chartNoteStatus, encounter }: SignAddendumProps): JSX.Element | null => {
  const medplum = useMedplum();
  const author = useMedplumProfile();
  const authorReference = author ? createReference(author) : undefined;
  const [provenanceDisplays, setProvenanceDisplays] = useState<ProvenanceDisplay[]>([]);
  const [addendumDisplays, setAddendumDisplays] = useState<AddendumDisplay[]>([]);
  const [addendumText, setAddendumText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const importProvenances = provenances.filter(isRedRoverImport);
  const importOnly = provenances.length > 0 && importProvenances.length === provenances.length;
  const canLoadAddendums =
    !isRedRoverImportedEncounter(encounter) || provenances.some((provenance) => !isRedRoverImport(provenance));

  useEffect(() => {
    const loadProvenanceData = async (): Promise<void> => {
      const displays: ProvenanceDisplay[] = provenances
        .filter((prov) => !isRedRoverImport(prov))
        .map((prov) => ({
          practitionerName: prov.agent?.[0]?.who?.display || 'Unknown Practitioner',
          timestamp: formatDate(prov.recorded),
        }));
      setProvenanceDisplays(displays);
    };
    loadProvenanceData().catch(showErrorNotification);
  }, [provenances, medplum]);

  useEffect(() => {
    const loadAddendums = async (): Promise<void> => {
      try {
        const bundle = await medplum.searchResources('DocumentReference', {
          encounter: `Encounter/${encounter.id}`,
          type: '55107-7', // LOINC code for Addendum Document
          _sort: '-date',
        });

        const displays: AddendumDisplay[] = bundle.map((doc) => {
          const authorName = doc.author?.[0]?.display || 'Unknown Author';
          const timestamp = doc.date ? formatDate(doc.date) : 'Unknown Date';
          const encodedText = doc.content?.[0]?.attachment?.data;
          const text = encodedText ? atob(encodedText) : '';

          return {
            authorName,
            timestamp,
            text,
          };
        });
        setAddendumDisplays(displays);
      } catch (error) {
        showErrorNotification(error);
      }
    };

    if (encounter.id && !importOnly && canLoadAddendums) {
      loadAddendums().catch(console.error);
    }
  }, [encounter.id, medplum, importOnly, canLoadAddendums]);

  const handleAddAddendum = async (): Promise<void> => {
    setIsSubmitting(true);
    try {
      const documentReference = await medplum.createResource({
        resourceType: 'DocumentReference',
        status: 'current',
        type: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '55107-7',
              display: 'Addendum Document',
            },
          ],
        },
        subject: encounter.subject,
        author: [
          {
            reference: authorReference?.reference,
            display: authorReference?.display,
          },
        ],
        context: {
          encounter: [
            {
              reference: `Encounter/${encounter.id}`,
            },
          ],
        },
        date: new Date().toISOString(),
        content: [
          {
            attachment: {
              contentType: 'text/plain',
              data: btoa(addendumText),
              title: 'Addendum',
            },
          },
        ],
      });

      setAddendumDisplays([
        ...addendumDisplays,
        {
          authorName: authorReference?.display || 'Unknown Author',
          timestamp: formatDate(documentReference.date),
          text: addendumText,
        },
      ]);
      setAddendumText('');
    } catch (error) {
      showErrorNotification(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const importHistory =
    importProvenances.length > 0 ? (
      <Stack gap="xs">
        {importProvenances.map((provenance) => (
          <Stack key={provenance.id} gap={4}>
            <Text fw={500}>Imported from Red Rover</Text>
            <Text c="dimmed" size="sm">
              Imported on {formatDate(provenance.recorded)}
            </Text>
            <Text c="dimmed" size="sm">
              Clinical signature not supplied
            </Text>
          </Stack>
        ))}
      </Stack>
    ) : null;

  if (provenanceDisplays.length === 0) {
    return importHistory;
  }

  return (
    <Card withBorder shadow="sm">
      <Stack gap="md">
        {importHistory}
        {provenanceDisplays.map((display, index) => (
          <Stack key={`prov-${index}`}>
            <Group gap="sm">
              {provenanceDisplays.length - 1 === index && chartNoteStatus === ChartNoteStatus.SignedAndLocked ? (
                <IconLock size={20} />
              ) : (
                <IconSignature size={20} />
              )}
              <Text fw={500}>
                {provenanceDisplays.length - 1 === index && chartNoteStatus === ChartNoteStatus.SignedAndLocked
                  ? 'Signed and Locked by '
                  : 'Signed by '}
                {display.practitionerName}
              </Text>
              <Text c="dimmed" size="sm">
                {display.timestamp}
              </Text>
            </Group>
            <Divider />
          </Stack>
        ))}

        {addendumDisplays.map((addendum, index) => (
          <Stack key={`addendum-${index}`}>
            <Group gap="sm" align="flex-start">
              <IconPencil size={20} />
              <Stack gap="xs" style={{ flex: 1 }}>
                <Group gap="sm">
                  <Text fw={500}>Addendum by {addendum.authorName}</Text>
                  <Text c="dimmed" size="sm">
                    {addendum.timestamp}
                  </Text>
                </Group>
                <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                  {addendum.text}
                </Text>
              </Stack>
            </Group>
            <Divider />
          </Stack>
        ))}

        <Text fw={600} mt="sm">
          Add Addendum
        </Text>
        <Textarea
          placeholder="Add an addendum to this Visit..."
          value={addendumText}
          onChange={(e) => setAddendumText(e.target.value)}
          autosize
          minRows={3}
          maxRows={6}
        />
        <Group justify="flex-end">
          <Button
            leftSection={<IconPencil size={16} />}
            onClick={handleAddAddendum}
            disabled={!addendumText.trim() || isSubmitting}
            loading={isSubmitting}
          >
            Add Addendum
          </Button>
        </Group>
      </Stack>
    </Card>
  );
};
