// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Paper, Stack, Text } from '@mantine/core';
import type { Patient } from '@medplum/fhirtypes';
import type { JSX } from 'react';

export interface PatientIdentifiersPanelProps {
  patient: Patient;
}

const ORG_ID_TO_NAME: Record<string, string> = {
  'nevada-demo-org-neighborhood-health': 'Neighborhood Health Center',
  'nevada-demo-org-desert-springs': 'Desert Springs Medical',
};

function getOrganizationName(patient: Patient): string | undefined {
  const managingOrg = patient.managingOrganization;
  const managingOrgRef = managingOrg?.reference;
  if (!managingOrgRef) {
    return undefined;
  }

  // Try to extract a known Nevada demo org id from the reference
  const idMatch = /Organization\/([^/]+)$/.exec(managingOrgRef);
  if (idMatch) {
    return ORG_ID_TO_NAME[idMatch[1]] ?? managingOrg.display ?? managingOrgRef;
  }

  return managingOrg.display ?? managingOrgRef;
}

function getIdentifierValue(patient: Patient, system: string): string | undefined {
  return patient.identifier?.find((i) => i.system === system)?.value;
}

export function PatientIdentifiersPanel({ patient }: PatientIdentifiersPanelProps): JSX.Element {
  const mrn = getIdentifierValue(patient, `https://nevada-demo-org-neighborhood-health.example/mrn`)
    ?? getIdentifierValue(patient, `https://nevada-demo-org-desert-springs.example/mrn`);
  const medicaidId = getIdentifierValue(patient, 'https://medicaid.nv.gov/member-id');
  const ssn = getIdentifierValue(patient, 'http://hl7.org/fhir/sid/us-ssn');
  const sourceOrg = getOrganizationName(patient);

  if (!mrn && !medicaidId && !ssn && !sourceOrg) {
    return <></>;
  }

  return (
    <Paper w="100%" p="sm" radius={0} withBorder>
      <Text fw={600} size="sm" mb="xs">
        Patient Identifiers
      </Text>
      <Stack gap={4}>
        {mrn && (
          <Text size="sm">
            <strong>MRN:</strong> {mrn}
          </Text>
        )}
        {sourceOrg && (
          <Text size="sm">
            <strong>Source organization:</strong> {sourceOrg}
          </Text>
        )}
        {ssn && (
          <Text size="sm">
            <strong>SSN:</strong> {ssn}
          </Text>
        )}
        {medicaidId && (
          <Text size="sm">
            <strong>Medicaid ID:</strong> {medicaidId}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
