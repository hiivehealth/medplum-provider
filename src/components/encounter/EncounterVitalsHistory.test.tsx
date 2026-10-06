// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import type { Encounter, Observation } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { EncounterVitalsHistory } from './EncounterVitalsHistory';

const encounter: Encounter = {
  resourceType: 'Encounter',
  id: 'encounter-1',
  status: 'in-progress',
  class: { code: 'AMB' },
};

const temperature: Observation = {
  resourceType: 'Observation',
  id: 'temperature-1',
  status: 'final',
  encounter: { reference: 'Encounter/encounter-1' },
  code: { coding: [{ system: 'http://loinc.org', code: '8310-5', display: 'Body temperature' }] },
  effectiveDateTime: '2026-09-22T13:18:00Z',
  valueQuantity: { value: 101, unit: '[degF]', system: 'http://unitsofmeasure.org', code: '[degF]' },
};

describe('EncounterVitalsHistory', () => {
  let medplum: MockClient;

  beforeEach(() => {
    medplum = new MockClient();
    vi.spyOn(medplum, 'searchResources').mockResolvedValue([temperature] as any);
    vi.spyOn(medplum, 'deleteResource');
    vi.clearAllMocks();
  });

  function setup(): void {
    render(
      <MedplumProvider medplum={medplum}>
        <MantineProvider>
          <EncounterVitalsHistory encounter={encounter} refreshKey={0} />
        </MantineProvider>
      </MedplumProvider>
    );
  }

  test('keeps a vital when deletion is cancelled', async () => {
    const user = userEvent.setup();
    setup();

    const deleteButton = await screen.findByRole('button', { name: /Delete Body temperature reading 101/ });
    await user.click(deleteButton);
    await screen.findByRole('button', { name: 'Cancel' });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(medplum.deleteResource).not.toHaveBeenCalled();
    expect(screen.getByText('101 [degF]')).toBeInTheDocument();
  });

  test('deletes the selected vital after confirmation', async () => {
    const user = userEvent.setup();
    vi.spyOn(medplum, 'deleteResource').mockResolvedValue({} as any);
    setup();

    await user.click(await screen.findByRole('button', { name: /Delete Body temperature reading 101/ }));
  await user.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(medplum.deleteResource).toHaveBeenCalledWith('Observation', 'temperature-1');
      expect(screen.queryByText('101 [degF]')).not.toBeInTheDocument();
    });
  });
});