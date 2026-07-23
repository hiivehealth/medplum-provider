// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Card, Group, Text } from '@mantine/core';
import type { JSX } from 'react';
import { Link } from 'react-router';

export interface CcdaImportCardProps {
  patientId: string;
}

export function CcdaImportCard({ patientId }: CcdaImportCardProps): JSX.Element {
  return (
    <Card withBorder radius="md" p="md" mb="md">
      <Group justify="space-between" align="center">
        <div>
          <Text fw={500}>C-CDA Documents</Text>
          <Text size="sm" c="dimmed">
            Import external clinical documents for this patient.
          </Text>
        </div>
        <Button component={Link} to={`/admin/nevada/ccda-import?patient=${patientId}`}>
          Import C-CDA
        </Button>
      </Group>
    </Card>
  );
}
