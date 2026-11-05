// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Stack, Title } from '@mantine/core';
import type { DocumentReference } from '@medplum/fhirtypes';
import { AttachmentDisplay, Loading, useMedplum, useMedplumProfile } from '@medplum/react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { A01_DOCUMENTS, A01_DOCUMENT_IDENTIFIER_SYSTEM, hasArmyAccess } from '../../utils/adtmc';

export function AdtmcDocumentPage(): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const { documentKey } = useParams();
  const definition = A01_DOCUMENTS.find((document) => document.key === documentKey);
  const armyAccess = hasArmyAccess(medplum);
  const projectId = medplum.getProject()?.id;
  const sessionKey = `${projectId}/${medplum.getProjectMembership()?.id}/${profile?.resourceType}/${profile?.id}`;
  const [result, setResult] = useState<{ document?: DocumentReference; sessionKey: string; documentKey: string }>();

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    if (!armyAccess || !definition) {
      return undefined;
    }
    const currentSession = (): boolean => !cancelled && hasArmyAccess(medplum) &&
      `${medplum.getProject()?.id}/${medplum.getProjectMembership()?.id}/${medplum.getProfile()?.resourceType}/${medplum.getProfile()?.id}` === sessionKey;

    const finish = (document?: DocumentReference): void => {
      if (currentSession()) {
        setResult({ document, sessionKey, documentKey: definition.key });
      }
    };
    medplum.searchResources('DocumentReference', {
      identifier: `${A01_DOCUMENT_IDENTIFIER_SYSTEM}|${definition.key}`,
      status: 'current',
      _count: '2',
    }).then(async (documents) => {
      const document = documents.length === 1 ? documents[0] : undefined;
      const attachment = document?.content[0]?.attachment;
      const url = attachment?.url;
      const validUrl = url && (/^Binary\/[A-Za-z0-9.-]+$/.test(url) || url.startsWith('https://'));
      if (currentSession() && document?.id && document.meta?.project === projectId &&
        attachment?.contentType === 'application/pdf' && !attachment.data && validUrl) {
        if (url.startsWith('Binary/')) {
          const blob = await medplum.download(url);
          if (!currentSession()) {
            return;
          }
          if (blob.type !== 'application/pdf') {
            finish();
            return;
          }
          objectUrl = URL.createObjectURL(blob);
          finish({
            ...document,
            content: [{ ...document.content[0], attachment: { ...attachment, url: objectUrl } }],
          });
        } else {
          finish(document);
        }
      } else {
        finish();
      }
    }).catch(() => { finish(); });
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [medplum, armyAccess, definition, projectId, sessionKey]);

  if (!armyAccess) {
    return <Alert color="red" title="Access denied">This document is unavailable.</Alert>;
  }
  const loaded = result?.sessionKey === sessionKey && result?.documentKey === documentKey ? result : undefined;
  if (definition && !loaded) {
    return <Loading />;
  }
  if (!loaded?.document) {
    return <Alert color="red" title="Document unavailable">This document could not be opened.</Alert>;
  }
  return (
    <Stack>
      <Title order={3}>{definition?.title}</Title>
      <AttachmentDisplay value={loaded.document.content[0].attachment} />
    </Stack>
  );
}