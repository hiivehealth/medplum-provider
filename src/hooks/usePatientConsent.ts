// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { useMedplum } from '@medplum/react';
import type { Consent, Patient } from '@medplum/fhirtypes';
import { useEffect, useState } from 'react';

export type ConsentStatus = 'opt-in' | 'opt-out' | 'not-declared' | 'loading' | 'error';

export interface UsePatientConsentResult {
  status: ConsentStatus;
  consent: Consent | undefined;
  error: Error | undefined;
  refresh: () => void;
}

const DEMO_TAG_SYSTEM = 'https://hiivehealth.com/fhir/identifier/nevada-demo';

function consentStatusFromResource(consent: Consent | undefined): ConsentStatus {
  if (!consent) {
    return 'not-declared';
  }

  const text = consent.category?.[0]?.text?.toLowerCase();
  if (text === 'opt-in') {
    return 'opt-in';
  }
  if (text === 'opt-out') {
    return 'opt-out';
  }
  if (text === 'not-declared') {
    return 'not-declared';
  }

  // Fallback: use provision type
  const provisionType = consent.provision?.type;
  if (provisionType === 'permit') {
    return 'opt-in';
  }
  if (provisionType === 'deny') {
    return 'opt-out';
  }

  return 'not-declared';
}

export function usePatientConsent(patientId: string | undefined): UsePatientConsentResult {
  const medplum = useMedplum();
  const [status, setStatus] = useState<ConsentStatus>(patientId ? 'loading' : 'not-declared');
  const [consent, setConsent] = useState<Consent | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!patientId) {
      return undefined;
    }

    let cancelled = false;

    medplum
      .search('Consent', {
        patient: `Patient/${patientId}`,
        status: 'active',
        _sort: '-_lastUpdated',
        _count: 1,
      })
      .then((bundle) => {
        if (cancelled) {
          return;
        }
        const resource = bundle.entry?.[0]?.resource as Consent | undefined;
        setConsent(resource);
        setStatus(consentStatusFromResource(resource));
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [medplum, patientId, refreshKey]);

  return {
    status,
    consent,
    error,
    refresh: () => setRefreshKey((k) => k + 1),
  };
}

export function isNevadaDemoConsent(consent: Consent | undefined): boolean {
  return consent?.identifier?.some((i) => i.system === DEMO_TAG_SYSTEM) ?? false;
}

export function isNevadaDemoPatient(patient: Patient | undefined): boolean {
  return patient?.identifier?.some((i) => i.system === DEMO_TAG_SYSTEM) ?? false;
}
