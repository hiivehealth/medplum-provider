// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import type { Patient, Resource } from '@medplum/fhirtypes';
import { IconFingerprint } from '@tabler/icons-react';
import type { JSX } from 'react';
import styles from './PatientIdentifiersPanel.module.css';

export interface PatientIdentifiersPanelProps {
  patient: Patient;
  onClickResource?: (resource: Resource) => void;
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

function IdentifierItem({ label, value }: { label: string; value: string | undefined }): JSX.Element | null {
  if (!value) {
    return null;
  }

  return (
    <Tooltip label={label} position="top-start" openDelay={650}>
      <Group gap="sm" align="center" ml={6} mr={2} style={{ cursor: 'default', flexWrap: 'nowrap', minWidth: 0 }}>
        <IconFingerprint size={16} stroke={2} color="var(--mantine-color-gray-6)" />
        <Text fz="sm" fw={400} truncate>
          {value}
        </Text>
      </Group>
    </Tooltip>
  );
}

export function PatientIdentifiersPanel({ patient, onClickResource }: PatientIdentifiersPanelProps): JSX.Element {
  const mrn = getIdentifierValue(patient, `https://nevada-demo-org-neighborhood-health.example/mrn`)
    ?? getIdentifierValue(patient, `https://nevada-demo-org-desert-springs.example/mrn`);
  const medicaidId = getIdentifierValue(patient, 'https://medicaid.nv.gov/member-id');
  const ssn = getIdentifierValue(patient, 'http://hl7.org/fhir/sid/us-ssn');
  const sourceOrg = getOrganizationName(patient);

  if (!mrn && !medicaidId && !ssn && !sourceOrg) {
    return <></>;
  }

  return (
    <Box className={styles.item} onClick={() => onClickResource?.(patient)}>
      <Stack gap="xs" py={8}>
        {mrn && <IdentifierItem label="MRN" value={mrn} />}
        {sourceOrg && <IdentifierItem label="Source organization" value={sourceOrg} />}
        {ssn && <IdentifierItem label="SSN" value={ssn} />}
        {medicaidId && <IdentifierItem label="Medicaid ID" value={medicaidId} />}
      </Stack>
    </Box>
  );
}
