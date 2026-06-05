// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, Group, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { normalizeErrorString } from '@medplum/core';
import type { AccessPolicy, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { RbacAdminNav } from './RbacAdminNav';
import { isProjectAdmin } from './rbac-utils';

const PATIENT_SENSITIVE_FIELDS = [
  'identifier',
  'telecom',
  'address',
  'birthDate',
  'gender',
  'contact',
  'photo',
  'maritalStatus',
] as const;

export function VisibilityTesterPage(): JSX.Element {
  const medplum = useMedplum();
  const canManage = isProjectAdmin(medplum.getProjectMembership());
  const [policyId, setPolicyId] = useState('');
  const [patientId, setPatientId] = useState('');
  const [policy, setPolicy] = useState<AccessPolicy>();
  const [patient, setPatient] = useState<Patient>();
  const [error, setError] = useState<string>();

  const patientRule = useMemo(
    () => policy?.resource?.find((rule) => rule.resourceType === 'Patient'),
    [policy]
  );

  const hidden = new Set(patientRule?.hiddenFields || []);

  const loadPreview = async (): Promise<void> => {
    if (!policyId || !patientId) {
      setError('Policy ID and Patient ID are required.');
      return;
    }

    try {
      setError(undefined);
      const [loadedPolicy, loadedPatient] = await Promise.all([
        medplum.readResource('AccessPolicy', policyId),
        medplum.readResource('Patient', patientId),
      ]);
      setPolicy(loadedPolicy);
      setPatient(loadedPatient);
    } catch (err) {
      setError(normalizeErrorString(err));
    }
  };

  if (!canManage) {
    return (
      <Stack>
        <Title order={2}>Visibility Tester</Title>
        <Alert color="red" title="Access denied">Project admin access is required.</Alert>
      </Stack>
    );
  }

  return (
    <Stack>
      <RbacAdminNav />
      <Title order={2}>Minimum-Necessary Visibility Tester</Title>
      <Text c="dimmed" size="sm">Validate hidden fields for a policy against a sample patient record.</Text>

      {error ? <Alert color="red">{error}</Alert> : null}

      <Group grow>
        <TextInput label="AccessPolicy ID" value={policyId} onChange={(event) => setPolicyId(event.currentTarget.value)} />
        <TextInput label="Patient ID" value={patientId} onChange={(event) => setPatientId(event.currentTarget.value)} />
      </Group>

      <Group justify="flex-end">
        <Button onClick={() => void loadPreview()}>Load Preview</Button>
      </Group>

      {policy && patient ? (
        <>
          <Alert color="blue" title="Policy loaded">
            {policy.name} ({policy.id})
          </Alert>
          <Table withTableBorder striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Field</Table.Th>
                <Table.Th>Patient Has Value</Table.Th>
                <Table.Th>Visible For Policy</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {PATIENT_SENSITIVE_FIELDS.map((field) => {
                const patientRecord = patient as unknown as Record<string, unknown>;
                const hasValue = Boolean(patientRecord[field]);
                const visible = !hidden.has(field);
                return (
                  <Table.Tr key={field}>
                    <Table.Td>{field}</Table.Td>
                    <Table.Td>{hasValue ? 'Yes' : 'No'}</Table.Td>
                    <Table.Td>{visible ? 'Visible' : 'Hidden'}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </>
      ) : null}
    </Stack>
  );
}
