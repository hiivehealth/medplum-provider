// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Divider, Stack, Title } from '@mantine/core';
import { getDisplayString } from '@medplum/core';
import { ResourceTable, useResource } from '@medplum/react';
import type { JSX } from 'react';
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
