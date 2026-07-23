// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { normalizeErrorString } from '@medplum/core';
import type { AuditEvent } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';
import type { AuditEventFilters } from '../utils/auditReport';
import { buildAuditSearchParams } from '../utils/auditReport';

export interface UseAuditEventsResult {
  events: AuditEvent[];
  loading: boolean;
  error: string | undefined;
  refresh: () => void;
}

export function useAuditEvents(filters: AuditEventFilters): UseAuditEventsResult {
  const medplum = useMedplum();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);

    const params = buildAuditSearchParams(filters);

    medplum
      .search('AuditEvent', params)
      .then((bundle) => {
        if (cancelled) {
          return;
        }
        const resources = (bundle.entry?.map((e) => e.resource).filter(Boolean) ?? []) as AuditEvent[];
        setEvents(resources);
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
  }, [medplum, filters, refreshKey]);

  return {
    events,
    loading,
    error,
    refresh: () => setRefreshKey((k) => k + 1),
  };
}
