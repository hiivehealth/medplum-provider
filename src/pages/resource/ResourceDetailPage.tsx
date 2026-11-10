// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Anchor, Code, Divider, Loader, Stack, Text, Title } from '@mantine/core';
import { getDisplayString } from '@medplum/core';
import type { Resource, ResourceType } from '@medplum/fhirtypes';
import { Document, ResourceTable, useMedplum, useResource } from '@medplum/react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { ArmyDemographics, isArmyDemographicsPatient } from '../patient/ArmyDemographicsSection';

/**
 * This is an example of a generic "Resource Display" page.
 * It uses the Medplum `<ResourceTable>` component to display a resource.
 * @returns A React component that displays a resource.
 */
export function ResourceDetailPage(): JSX.Element | null {
  const { resourceType, id } = useParams();
  const resource = useResource({ reference: resourceType + '/' + id });

  if (!resource) {
    return null;
  }

  const armyPatient = resource.resourceType === 'Patient' && isArmyDemographicsPatient(resource) ? resource : undefined;

  return (
    <Stack>
      <Title>{getDisplayString(resource)}</Title>
      <Stack gap={0}>
        <ResourceTable key={`${resourceType}/${id}`} value={resource} />
        {armyPatient && (
          <>
            <Divider />
            <ArmyDemographics patient={armyPatient} layout="details" />
          </>
        )}
      </Stack>
    </Stack>
  );
}

export function ResourceVersionPage(): JSX.Element {
  const medplum = useMedplum();
  const { resourceType, id, versionId } = useParams();
  const reference = `${resourceType}/${id}/_history/${versionId}`;
  const [result, setResult] = useState<{
    reference: string;
    resource?: Resource;
    failed?: boolean;
    schemaReady?: boolean;
  }>();

  useEffect(() => {
    let active = true;
    if (
      !resourceType ||
      !/^[A-Z][A-Za-z0-9]*$/.test(resourceType) ||
      !id ||
      !/^[A-Za-z0-9.-]{1,64}$/.test(id) ||
      !versionId ||
      !/^[A-Za-z0-9.-]{1,64}$/.test(versionId)
    ) {
      setResult({ reference, failed: true });
      return;
    }
    void medplum
      .readVersion(resourceType as ResourceType, id, versionId, { cache: 'no-cache' })
      .then(async (resource) => {
        if (`${resource.resourceType}/${resource.id}/_history/${resource.meta?.versionId}` !== reference) {
          throw new Error('Historical resource identity mismatch.');
        }
        const schemaReady = await medplum.requestSchema(resource.resourceType).then(
          () => true,
          () => false
        );
        if (active) setResult({ reference, resource, schemaReady });
      })
      .catch(() => {
        if (active) setResult({ reference, failed: true });
      });
    return () => {
      active = false;
    };
  }, [medplum, resourceType, id, versionId, reference]);

  const current = result?.reference === reference ? result : undefined;
  return (
    <Document>
      <Stack style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <Title order={2}>Resource version</Title>
        <Text size="sm">{reference}</Text>
        <Anchor href={`/${resourceType}/${id}/history`}>View resource history</Anchor>
        {!current ? (
          <Loader aria-label="Loading resource version" />
        ) : current.failed ? (
          <Alert color="red" title="Version unavailable" role="alert">
            The requested version could not be read or verified. It may be unavailable or access may be denied.
          </Alert>
        ) : (
          current.resource && (
            <Stack data-version-content>
              {current.schemaReady ? (
                <ResourceTable key={reference} value={current.resource} forceUseInput ignoreMissingValues />
              ) : (
                <>
                  <Alert color="yellow" title="Structured display unavailable">
                    Display metadata could not be loaded. The verified resource version is shown below.
                  </Alert>
                  <Code block style={{ maxWidth: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {JSON.stringify(current.resource, null, 2)}
                  </Code>
                </>
              )}
            </Stack>
          )
        )}
      </Stack>
    </Document>
  );
}
