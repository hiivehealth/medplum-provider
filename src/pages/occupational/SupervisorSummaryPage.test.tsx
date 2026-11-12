// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  occupationalEncounter,
  occupationalEpisode,
  occupationalLocation,
  occupationalObservation,
  occupationalPatient,
  occupationalTask,
} from './occupational-test-data';
import { SupervisorSummaryPage } from './SupervisorSummaryPage';

describe('SupervisorSummaryPage', () => {
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

  test('renders minimum-necessary restriction and readiness fields', async () => {
    render(
      <MemoryRouter initialEntries={['/Occupational/Supervisor']}>
        <MedplumProvider medplum={medplum}>
          <MantineProvider>
            <Routes>
              <Route path="/Occupational/Supervisor" element={<SupervisorSummaryPage />} />
            </Routes>
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Avery Rivera')).toBeInTheDocument();
    });
    expect(screen.getByText('Component A')).toBeInTheDocument();
    expect(screen.getByText('Headquarters')).toBeInTheDocument();
    expect(screen.getByText('Administrative duty only until reevaluation.')).toBeInTheDocument();
    expect(screen.getByText('2026-05-26')).toBeInTheDocument();
    expect(screen.queryByText('Exposure Incident')).not.toBeInTheDocument();
  });
});
