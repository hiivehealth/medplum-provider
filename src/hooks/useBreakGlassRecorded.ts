// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { getReferenceString } from '@medplum/core';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { useEffect, useState } from 'react';

export interface UseBreakGlassRecordedResult {
  recorded: boolean;
  refresh: () => void;
}

/**
 * Returns true if the current user has recorded a break-the-glass AuditEvent
 * for the given patient. Returns false while loading.
 */
export function useBreakGlassRecorded(patientId: string | undefined): UseBreakGlassRecordedResult {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const [recorded, setRecorded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!patientId || !profile) {
      setRecorded(false);
      return undefined;
    }

    let cancelled = false;

    medplum
      .search('AuditEvent', {
        entity: `Patient/${patientId}`,
        subtype: 'emergency-access',
        agent: getReferenceString(profile),
        _count: '1',
      })
      .then((bundle) => {
        if (cancelled) {
          return;
        }
        setRecorded((bundle.entry?.length ?? 0) > 0);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setRecorded(false);
      });

    return () => {
      cancelled = true;
    };
  }, [medplum, patientId, profile, refreshKey]);

  return { recorded, refresh: () => setRefreshKey((k) => k + 1) };
}
