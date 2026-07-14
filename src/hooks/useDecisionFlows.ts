// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { getReferenceString, normalizeErrorString } from '@medplum/core';
import type { Encounter, Patient, Questionnaire, QuestionnaireResponse } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DECISION_FLOW_QUESTIONNAIRE_URLS } from '../data/decision-flows';
import { showErrorNotification } from '../utils/notifications';

export interface DecisionFlowState {
  questionnaire: Questionnaire | undefined;
  response: QuestionnaireResponse | undefined;
  loading: boolean;
  error: string | undefined;
}

export interface UseDecisionFlowsResult {
  flows: Map<string, DecisionFlowState>;
  selectedFlowUrl: string | null;
  setSelectedFlowUrl: (url: string | null) => void;
  saveResponse: (questionnaireUrl: string, response: QuestionnaireResponse) => Promise<void>;
}

export function useDecisionFlows(
  encounter: Encounter | undefined,
  patient: Patient | undefined
): UseDecisionFlowsResult {
  const medplum = useMedplum();
  const author = useMedplumProfile();
  const [flows, setFlows] = useState<Map<string, DecisionFlowState>>(new Map());
  const [selectedFlowUrl, setSelectedFlowUrl] = useState<string | null>(null);

  const SAVE_DEBOUNCE_MS = 750;
  const saveTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingSaves = useRef<Map<string, QuestionnaireResponse>>(new Map());

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

  const loadFlows = useCallback(async (): Promise<void> => {
    if (!encounterRef || !patientRef) {
      return;
    }

    const nextMap = new Map<string, DecisionFlowState>();

    await Promise.all(
      DECISION_FLOW_QUESTIONNAIRE_URLS.map(async (url) => {
        nextMap.set(url, {
          questionnaire: undefined,
          response: undefined,
          loading: true,
          error: undefined,
        });

        try {
          const questionnaire = await medplum.searchOne('Questionnaire', { url });
          if (!questionnaire) {
            nextMap.set(url, {
              questionnaire: undefined,
              response: undefined,
              loading: false,
              error: `Decision flow not found: ${url}`,
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
            questionnaire: undefined,
            response: undefined,
            loading: false,
            error: normalizeErrorString(err),
          });
        }
      })
    );

    setFlows(nextMap);
  }, [encounterRef, patientRef, medplum]);

  const doSaveResponse = useCallback(
    async (questionnaireUrl: string): Promise<void> => {
      const response = pendingSaves.current.get(questionnaireUrl);
      pendingSaves.current.delete(questionnaireUrl);
      if (!response) {
        return;
      }

      const state = flows.get(questionnaireUrl);
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

        setFlows((prev) => {
          const next = new Map(prev);
          next.set(questionnaireUrl, { ...state, response: saved });
          return next;
        });
      } catch (err) {
        showErrorNotification(err);
      }
    },
    [flows, encounterRef, patientRef, authorRef, medplum]
  );

  const saveResponse = useCallback(
    (questionnaireUrl: string, response: QuestionnaireResponse): void => {
      pendingSaves.current.set(questionnaireUrl, response);
      const existing = saveTimeouts.current.get(questionnaireUrl);
      if (existing) {
        clearTimeout(existing);
      }
      const timeout = setTimeout(() => {
        saveTimeouts.current.delete(questionnaireUrl);
        doSaveResponse(questionnaireUrl).catch(() => {
          // error is already shown by doSaveResponse
        });
      }, SAVE_DEBOUNCE_MS);
      saveTimeouts.current.set(questionnaireUrl, timeout);
    },
    [doSaveResponse]
  );

  useEffect(() => {
    let cancelled = false;
    loadFlows().catch((err) => {
      if (!cancelled) {
        showErrorNotification(err);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadFlows]);

  return { flows, selectedFlowUrl, setSelectedFlowUrl, saveResponse };
}
