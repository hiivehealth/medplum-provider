// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { HomerSimpson, MockClient } from '@medplum/mock';
const { patientExportFormSpy } = vi.hoisted(() => ({
  patientExportFormSpy: vi.fn(() => null),
}));

vi.mock('@medplum/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@medplum/react')>();
  return {
    ...actual,
    PatientExportForm: patientExportFormSpy,
  };
});

import * as medplumReact from '@medplum/react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ExportTab } from './ExportTab';

describe('ExportTab', () => {
  let medplum: MockClient;

  beforeEach(async () => {
    medplum = new MockClient();
    vi.clearAllMocks();
  });

  const setup = (url: string): ReturnType<typeof render> => {
    return render(
      <MemoryRouter initialEntries={[url]}>
        <medplumReact.MedplumProvider medplum={medplum}>
          <MantineProvider>
            <Notifications />
            <Routes>
              <Route path="/Patient/:patientId/export" element={<ExportTab />} />
            </Routes>
          </MantineProvider>
        </medplumReact.MedplumProvider>
      </MemoryRouter>
    );
  };

  test('Renders PatientExportForm', async () => {
    setup(`/Patient/${HomerSimpson.id}/export`);

    await waitFor(() => {
      expect(patientExportFormSpy).toHaveBeenCalled();
    });
  });

  test('Passes correct patient reference to PatientExportForm', async () => {
    setup(`/Patient/${HomerSimpson.id}/export`);

    await waitFor(() => {
      expect(patientExportFormSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          patient: { reference: `Patient/${HomerSimpson.id}` },
        }),
        undefined
      );
    });
  });
});
