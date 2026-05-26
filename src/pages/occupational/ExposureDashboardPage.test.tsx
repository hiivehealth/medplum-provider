// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ExposureDashboardPage } from './ExposureDashboardPage';
import {
  occupationalEncounter,
  occupationalEpisode,
  occupationalLocation,
  occupationalObservation,
  occupationalPatient,
  occupationalTask,
} from './occupational-test-data';

describe('ExposureDashboardPage', () => {
  let medplum: MockClient;

  beforeEach(() => {
    medplum = new MockClient();
    vi.clearAllMocks();
    vi.spyOn(medplum, 'searchResources').mockImplementation(async (resourceType) => {
      if (resourceType === 'Location') {
        return [occupationalLocation] as any;
      }
      if (resourceType === 'Encounter') {
        return [occupationalEncounter] as any;
      }
      if (resourceType === 'EpisodeOfCare') {
        return [occupationalEpisode] as any;
      }
      if (resourceType === 'Observation') {
        return [occupationalObservation] as any;
      }
      if (resourceType === 'Task') {
        return [occupationalTask] as any;
      }
      return [] as any;
    });
    vi.spyOn(medplum, 'readResource').mockResolvedValue(occupationalPatient as any);
  });

  test('renders duty-location exposure metrics and affected employees', async () => {
    render(
      <MemoryRouter initialEntries={['/Occupational/Exposure']}>
        <MedplumProvider medplum={medplum}>
          <MantineProvider>
            <Routes>
              <Route path="/Occupational/Exposure" element={<ExposureDashboardPage />} />
            </Routes>
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Headquarters').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Avery Rivera').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pending Reevaluation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 follow-up open').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Occupational' })).toHaveAttribute(
      'href',
      '/Patient/patient-1/occupational'
    );
  });
});
