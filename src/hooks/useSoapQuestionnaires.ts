// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { getReferenceString, normalizeErrorString } from '@medplum/core';
import type { Encounter, Patient, Questionnaire, QuestionnaireResponse } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SOAP_QUESTIONNAIRE_URLS } from '../data/soap-questionnaires';
import { showErrorNotification } from '../utils/notifications';

export interface SoapQuestionnaireState {
  questionnaire: Questionnaire;
  response: QuestionnaireResponse | undefined;
  loading: boolean;
  error: string | undefined;
}

export interface UseSoapQuestionnairesResult {
  questionnaires: Map<string, SoapQuestionnaireState>;
  refresh: () => Promise<void>;
  saveResponse: (questionnaireUrl: string, response: QuestionnaireResponse) => Promise<void>;
}

export function useSoapQuestionnaires(
  encounter: Encounter | undefined,
  patient: Patient | undefined
): UseSoapQuestionnairesResult {
  const medplum = useMedplum();
  const author = useMedplumProfile();
  const [questionnaires, setQuestionnaires] = useState<Map<string, SoapQuestionnaireState>>(new Map());

  const encounterRef = useMemo(
    () => (encounter ? { reference: getReferenceString(encounter) } : undefined),
    [encounter]
  );
  const patientRef = useMemo(
    () => (patient ? { reference: getReferenceString(patient) } : undefined),
    [patient]
  );
  const authorRef = useMemo(
    () => (author ? { reference: getReferenceString(author) } : undefined),
    [author]
  );

  const loadQuestionnaires = useCallback(async (): Promise<void> => {
    if (!encounterRef || !patientRef) {
      return;
    }

    const nextMap = new Map<string, SoapQuestionnaireState>();

    await Promise.all(
      SOAP_QUESTIONNAIRE_URLS.map(async (url) => {
        nextMap.set(url, {
          questionnaire: { resourceType: 'Questionnaire', status: 'draft', url },
          response: undefined,
          loading: true,
          error: undefined,
        });

        try {
          const questionnaire = await medplum.searchOne('Questionnaire', { url });
          if (!questionnaire) {
            nextMap.set(url, {
              questionnaire: { resourceType: 'Questionnaire', status: 'draft', url },
              response: undefined,
              loading: false,
              error: `Questionnaire not found: ${url}`,
            });
            return;
          }

          const responses = await medplum.searchResources(
            'QuestionnaireResponse',
            `questionnaire=${encodeURIComponent(url)}&encounter=${encodeURIComponent(encounterRef?.reference ?? '')}&_count=20&_sort=-_lastUpdated`,
            { cache: 'no-cache' }
          );

          nextMap.set(url, {
            questionnaire,
            response: responses[0],
            loading: false,
            error: undefined,
          });
        } catch (err) {
          nextMap.set(url, {
            questionnaire: { resourceType: 'Questionnaire', status: 'draft', url },
            response: undefined,
            loading: false,
            error: normalizeErrorString(err),
          });
        }
      })
    );

    setQuestionnaires(nextMap);
  }, [encounterRef, patientRef, medplum]);

  const saveResponse = useCallback(
    async (questionnaireUrl: string, response: QuestionnaireResponse): Promise<void> => {
      const state = questionnaires.get(questionnaireUrl);
      if (!state || !encounterRef || !patientRef) {
        return;
      }

      const baseResponse = state.response || response;
      const updatedResponse: QuestionnaireResponse = {
        ...baseResponse,
        resourceType: 'QuestionnaireResponse',
        questionnaire: questionnaireUrl,
        status: 'in-progress',
        subject: patientRef,
        encounter: encounterRef,
        authored: new Date().toISOString(),
        source: authorRef,
        item: response.item,
      };

      try {
        const saved = updatedResponse.id
          ? await medplum.updateResource(updatedResponse)
          : await medplum.createResource(updatedResponse);

        setQuestionnaires((prev) => {
          const next = new Map(prev);
          next.set(questionnaireUrl, { ...state, response: saved });
          return next;
        });
      } catch (err) {
        showErrorNotification(err);
      }
    },
    [questionnaires, encounterRef, patientRef, authorRef, medplum]
  );

  useEffect(() => {
    let cancelled = false;
    loadQuestionnaires().catch((err) => {
      if (!cancelled) {
        showErrorNotification(err);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadQuestionnaires]);

  return { questionnaires, refresh: loadQuestionnaires, saveResponse };
}
