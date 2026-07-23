// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { normalizeErrorString } from '@medplum/core';
import type { Encounter } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';

export interface RosterEncounterFilters {
  groupId: string | undefined;
  daysBack: number;
  encounterClass: string | undefined;
  sortBy: 'date' | 'patientName';
  sortDirection: 'asc' | 'desc';
}

export interface UseRosterEncountersResult {
  encounters: Encounter[];
  loading: boolean;
  error: string | undefined;
  refresh: () => void;
}

function buildDateRange(daysBack: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - daysBack);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function sortEncounters(encounters: Encounter[], sortBy: 'date' | 'patientName', direction: 'asc' | 'desc'): Encounter[] {
  const sorted = [...encounters];
  const multiplier = direction === 'asc' ? 1 : -1;

  sorted.sort((a, b) => {
    if (sortBy === 'date') {
      const aDate = a.period?.start ?? a.meta?.lastUpdated ?? '';
      const bDate = b.period?.start ?? b.meta?.lastUpdated ?? '';
      return aDate.localeCompare(bDate) * multiplier;
    }

    const aName = getDisplayName(a);
    const bName = getDisplayName(b);
    return aName.localeCompare(bName) * multiplier;
  });

  return sorted;
}

function getDisplayName(encounter: Encounter): string {
  return encounter.subject?.display ?? encounter.subject?.reference?.split('/')[1] ?? 'Unknown';
}

export function useRosterEncounters(filters: RosterEncounterFilters): UseRosterEncountersResult {
  const medplum = useMedplum();
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);

  const { groupId, daysBack, encounterClass, sortBy, sortDirection } = filters;

  useEffect(() => {
    if (!groupId) {
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(undefined);

    const { start } = buildDateRange(daysBack);

    const searchParams: Record<string, string> = {
      _compartment: `Group/${groupId}`,
      date: `ge${start}`,
      _sort: '-_lastUpdated',
      _count: '100',
    };

    if (encounterClass) {
      searchParams.class = encounterClass;
    }

    medplum
      .search('Encounter', searchParams)
      .then((bundle) => {
        if (cancelled) {
          return;
        }
        const resources = (bundle.entry?.map((e) => e.resource).filter(Boolean) ?? []) as Encounter[];
        setEncounters(sortEncounters(resources, sortBy, sortDirection));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(normalizeErrorString(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [medplum, groupId, daysBack, encounterClass, sortBy, sortDirection, refreshKey]);

  return {
    encounters,
    loading,
    error,
    refresh: () => setRefreshKey((k) => k + 1),
  };
}
