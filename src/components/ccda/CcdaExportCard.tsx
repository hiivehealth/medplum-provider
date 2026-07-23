// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Card, Group, Text } from '@mantine/core';
import type { JSX } from 'react';
import { Link } from 'react-router';

export interface CcdaExportCardProps {
  patientId: string;
}

export function CcdaExportCard({ patientId }: CcdaExportCardProps): JSX.Element {
  return (
    <Card withBorder radius="md" p="md" mb="md">
      <Group justify="space-between" align="center">
        <div>
          <Text fw={500}>Export C-CDA</Text>
          <Text size="sm" c="dimmed">
            Download this patient’s record as a C-CDA document.
          </Text>
        </div>
        <Button component={Link} to={`/Patient/${patientId}/export`}>
          Export
        </Button>
      </Group>
    </Card>
  );
}
