// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Bundle, Encounter } from '@medplum/fhirtypes';
import { useRosterEncounters } from './useRosterEncounters';

function TestHarness(props: {
  groupId: string | undefined;
  daysBack: number;
  encounterClass: string | undefined;
}): JSX.Element {
  const { encounters, loading, error } = useRosterEncounters({
    groupId: props.groupId,
    daysBack: props.daysBack,
    encounterClass: props.encounterClass,
    sortBy: 'date',
    sortDirection: 'desc',
  });

  return (
    <div>
      {loading && <span data-testid="loading">Loading</span>}
      {error && <span data-testid="error">{error}</span>}
      <ul data-testid="encounters">
        {encounters.map((e) => (
          <li key={e.id} data-testid={`encounter-${e.id}`}>
            {e.subject?.display}
          </li>
        ))}
      </ul>
    </div>
  );
}

describe('useRosterEncounters', () => {
  let medplum: MockClient;

  beforeEach(() => {
    medplum = new MockClient();
  });

  const setup = (groupId: string | undefined, encounterClass?: string): ReturnType<typeof render> =>
    render(
      <MedplumProvider medplum={medplum}>
        <TestHarness groupId={groupId} daysBack={30} encounterClass={encounterClass} />
      </MedplumProvider>
    );

  function makeBundle(entries: Encounter[]): Bundle {
    return {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: entries.map((resource) => ({ resource })),
    };
  }

  test('returns empty list when groupId is undefined', async () => {
    const searchSpy = vi.spyOn(medplum, 'search');
    setup(undefined);
    await waitFor(() => expect(screen.getByTestId('encounters')).toBeInTheDocument());
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId(/^encounter-/)).toHaveLength(0);
    expect(searchSpy).not.toHaveBeenCalled();
  });

  test('loads and displays roster encounters', async () => {
    const encounter: Encounter = {
      resourceType: 'Encounter',
      id: 'encounter-1',
      status: 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
      subject: { reference: 'Patient/patient-1', display: 'Patient Test' },
      period: { start: new Date().toISOString() },
    };

    const searchSpy = vi.spyOn(medplum, 'search').mockResolvedValueOnce(makeBundle([encounter]));

    setup('group-1');
    await waitFor(() => expect(screen.getByTestId('encounter-encounter-1')).toBeInTheDocument());
    expect(screen.getByText('Patient Test')).toBeInTheDocument();
    expect(searchSpy).toHaveBeenCalledWith(
      'Encounter',
      expect.objectContaining({
        _compartment: 'Group/group-1',
        _sort: '-_lastUpdated',
        _count: '100',
      })
    );
  });

  test('applies class filter', async () => {
    const searchSpy = vi.spyOn(medplum, 'search').mockResolvedValueOnce(makeBundle([]));

    setup('group-1', 'EMER');
    await waitFor(() => expect(screen.getByTestId('encounters')).toBeInTheDocument());
    expect(searchSpy).toHaveBeenCalledWith(
      'Encounter',
      expect.objectContaining({
        _compartment: 'Group/group-1',
        class: 'EMER',
      })
    );
  });

  test('surfaces errors from search failures', async () => {
    vi.spyOn(medplum, 'search').mockRejectedValueOnce(new Error('Network error'));

    setup('group-1');
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Network error'));
  });
});
