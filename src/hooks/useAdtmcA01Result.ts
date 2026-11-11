// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { getReferenceString, normalizeErrorString  } from '@medplum/core';
import type {WithId} from '@medplum/core';
import type { ClinicalImpression, Encounter, QuestionnaireResponse, Reference } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { hasArmyAccess } from '../utils/adtmc';

export const ADTMC_ALGORITHM_ID_URL = 'https://ehr.hiivehealth.net/fhir/StructureDefinition/adtmc-algorithm-id';
export const ADTMC_A01_ALGORITHM_ID = 'A-01';

export interface AdtmcA01ResultState {
  clinicalImpression: WithId<ClinicalImpression> | undefined;
  questionnaireResponse: WithId<QuestionnaireResponse> | undefined;
  loading: boolean;
  error: string | undefined;
  refresh: () => void;
}

export function useAdtmcA01Result(encounter: Encounter | undefined): AdtmcA01ResultState {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const canRead = useCallback((): boolean => {
    const projectId = encounter?.meta?.project;
    return !!profile && !!projectId && hasArmyAccess(medplum, projectId);
  }, [encounter, medplum, profile]);
  const [result, setResult] = useState<AdtmcA01ResultState>({
    clinicalImpression: undefined,
    questionnaireResponse: undefined,
    loading: false,
    error: undefined,
    refresh: () => undefined,
  });
  const [refreshCount, setRefreshCount] = useState(0);
  const refresh = useCallback((): void => setRefreshCount((count) => count + 1), []);
  const encounterReference = useMemo(
    () => (encounter ? getReferenceString(encounter) : undefined),
    [encounter]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadResult(): Promise<void> {
      if (!encounterReference || !canRead()) {
        setResult({ clinicalImpression: undefined, questionnaireResponse: undefined, loading: false, error: undefined, refresh });
        return;
      }

      setResult({ clinicalImpression: undefined, questionnaireResponse: undefined, loading: true, error: undefined, refresh });
      try {
        const impressions = await medplum.searchResources(
          'ClinicalImpression',
          `encounter=${encodeURIComponent(encounterReference)}&_sort=-date&_count=20`,
          { cache: 'no-cache' }
        );
        const clinicalImpression = getMostRecentAdtmcA01ClinicalImpression(impressions);
        if (cancelled || !canRead()) {
          return;
        }
        if (!clinicalImpression) {
          if (!cancelled) {
            setResult({ clinicalImpression: undefined, questionnaireResponse: undefined, loading: false, error: undefined, refresh });
          }
          return;
        }
        if (!clinicalImpression.id) {
          throw new Error('A-01 ClinicalImpression is missing its id');
        }
        if (clinicalImpression.meta?.project !== encounter?.meta?.project || clinicalImpression.encounter?.reference !== encounterReference) {
          throw new Error('A-01 result is not available for this encounter.');
        }

        const sourceResponse = clinicalImpression.supportingInfo?.find(isQuestionnaireResponseReference);
        if (!sourceResponse) {
          throw new Error(`A-01 ClinicalImpression/${clinicalImpression.id} is missing its source QuestionnaireResponse`);
        }
        const questionnaireResponse = await medplum.readReference<QuestionnaireResponse>(sourceResponse);
        if (cancelled || !canRead()) {
          return;
        }
        if (questionnaireResponse.meta?.project !== encounter?.meta?.project || questionnaireResponse.encounter?.reference !== encounterReference) {
          throw new Error('A-01 response is not available for this encounter.');
        }
        if (!questionnaireResponse.id) {
          throw new Error(`A-01 ClinicalImpression/${clinicalImpression.id} source QuestionnaireResponse is missing its id`);
        }
        if (!cancelled) {
          setResult({
            clinicalImpression: clinicalImpression as WithId<ClinicalImpression>,
            questionnaireResponse: questionnaireResponse,
            loading: false,
            error: undefined,
            refresh,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setResult({ clinicalImpression: undefined, questionnaireResponse: undefined, loading: false, error: normalizeErrorString(err), refresh });
        }
      }
    }

    loadResult().catch(() => {
      // Errors are normalized in loadResult.
    });
    return () => {
      cancelled = true;
    };
  }, [encounterReference, medplum, refresh, refreshCount, canRead, encounter?.meta?.project]);

  return canRead() && result.clinicalImpression?.encounter?.reference === encounterReference ? result : {
    ...result, clinicalImpression: undefined, questionnaireResponse: undefined,
  };
}

export function isAdtmcA01ClinicalImpression(clinicalImpression: ClinicalImpression): boolean {
  return clinicalImpression.extension?.some(
    (extension) => extension.url === ADTMC_ALGORITHM_ID_URL && extension.valueString === ADTMC_A01_ALGORITHM_ID
  ) === true;
}

export function getMostRecentAdtmcA01ClinicalImpression(
  clinicalImpressions: ClinicalImpression[]
): ClinicalImpression | undefined {
  return clinicalImpressions
    .filter(isAdtmcA01ClinicalImpression)
    .sort((left, right) => getResultTimestamp(right) - getResultTimestamp(left))[0];
}

function getResultTimestamp(clinicalImpression: ClinicalImpression): number {
  const timestamp = clinicalImpression.date ?? clinicalImpression.meta?.lastUpdated;
  return timestamp ? new Date(timestamp).getTime() : 0;
}

function isQuestionnaireResponseReference(reference: Reference): reference is Reference<QuestionnaireResponse> {
  return reference.reference?.startsWith('QuestionnaireResponse/') === true;
}