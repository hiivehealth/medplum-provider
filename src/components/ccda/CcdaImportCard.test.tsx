// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { CcdaImportCard } from './CcdaImportCard';

describe('CcdaImportCard', () => {
  test('renders import link with patient id', () => {
    const medplum = new MockClient();
    render(
      <MemoryRouter>
        <MedplumProvider medplum={medplum}>
          <MantineProvider>
            <CcdaImportCard patientId="patient-123" />
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('C-CDA Documents')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /import c-cda/i });
    expect(link).toHaveAttribute('href', '/admin/nevada/ccda-import?patient=patient-123');
  });
});
