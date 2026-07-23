// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { CcdaExportCard } from './CcdaExportCard';

describe('CcdaExportCard', () => {
  test('renders export link with patient id', () => {
    const medplum = new MockClient();
    render(
      <MemoryRouter>
        <MedplumProvider medplum={medplum}>
          <MantineProvider>
            <CcdaExportCard patientId="patient-123" />
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Export C-CDA')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /export/i });
    expect(link).toHaveAttribute('href', '/Patient/patient-123/export');
  });
});
