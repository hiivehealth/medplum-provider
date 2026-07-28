// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient, ProfileResource } from '@medplum/core';
import { createReference } from '@medplum/core';
import type { Attachment, Communication, Media, Patient, Reference, ResourceType } from '@medplum/fhirtypes';
import { ResourceTimeline } from '@medplum/react';
import type { ResourceTimelineProps } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback } from 'react';

export interface PatientTimelineWithCcdaProps extends Pick<ResourceTimelineProps<Patient>, 'getMenu'> {
  readonly patient: Patient | Reference<Patient>;
}

export function PatientTimelineWithCcda(props: PatientTimelineWithCcdaProps): JSX.Element {
  const { patient, ...rest } = props;

  const loadTimelineResources = useCallback((medplum: MedplumClient, resourceType: ResourceType, id: string) => {
    const ref = `${resourceType}/${id}`;
    const _count = 100;
    return Promise.allSettled([
      // Default PatientTimeline searches
      medplum.readHistory('Patient', id),
      medplum.search('Communication', { subject: ref, _count }),
      medplum.search('Device', { patient: ref, _count }),
      medplum.search('DeviceRequest', { patient: ref, _count }),
      medplum.search('DiagnosticReport', { subject: ref, _count }),
      medplum.search('Media', { subject: ref, _count }),
      medplum.search('ServiceRequest', { subject: ref, _count }),
      medplum.search('Task', { subject: ref, _count }),
      // C-CDA clinical resources that should appear on the timeline
      medplum.search('AllergyIntolerance', { patient: ref, _count }),
      medplum.search('Condition', { patient: ref, _count }),
      medplum.search('DocumentReference', { subject: ref, _count }),
      medplum.search('Encounter', { patient: ref, _count }),
      medplum.search('Immunization', { patient: ref, _count }),
      medplum.search('MedicationRequest', { patient: ref, _count }),
      medplum.search('MedicationStatement', { patient: ref, _count }),
      medplum.search('Observation', { patient: ref, _count }),
      medplum.search('Procedure', { patient: ref, _count }),
    ]);
  }, []);

  return (
    <ResourceTimeline
      value={patient}
      loadTimelineResources={loadTimelineResources}
      createCommunication={(resource: Patient, sender, text: string): Communication => ({
        resourceType: 'Communication',
        status: 'completed',
        subject: createReference(resource),
        sender: createReference(sender),
        sent: new Date().toISOString(),
        payload: [{ contentString: text }],
      })}
      createMedia={(resource: Patient, operator, content: Attachment): Media => ({
        resourceType: 'Media',
        status: 'completed',
        subject: createReference(resource),
        operator: createReference(operator),
        issued: new Date().toISOString(),
        content,
      })}
      {...rest}
    />
  );
}
