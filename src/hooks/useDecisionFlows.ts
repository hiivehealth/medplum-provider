// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { getReferenceString, normalizeErrorString } from '@medplum/core';
import type { Encounter, Patient, Questionnaire, QuestionnaireResponse } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { A01_SORE_THROAT_DECISION_FLOW_URL, DECISION_FLOW_QUESTIONNAIRE_URLS } from '../data/decision-flows';
import { hasArmyAccess } from '../utils/adtmc';
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
  saveResponse: (questionnaireUrl: string, response: QuestionnaireResponse) => void;
  completeResponse: (questionnaireUrl: string, response: QuestionnaireResponse) => Promise<void>;
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
  const [loadedEncounter, setLoadedEncounter] = useState<string | undefined>(undefined);

  const canAccessFlow = useCallback((url: string): boolean => {
    if (!DECISION_FLOW_QUESTIONNAIRE_URLS.includes(url)) {
      return false;
    }
    if (url !== A01_SORE_THROAT_DECISION_FLOW_URL) {
      return true;
    }
    const projectId = encounter?.meta?.project;
    return !!author && !!projectId && patient?.meta?.project === projectId && hasArmyAccess(medplum, projectId);
  }, [encounter, patient, medplum, author]);

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

  const loadFlows = useCallback(async (signal: AbortSignal): Promise<void> => {
    if (signal.aborted || !encounterRef || !patientRef) {
      return;
    }

    const nextMap = new Map<string, DecisionFlowState>();

    await Promise.all(
      DECISION_FLOW_QUESTIONNAIRE_URLS.map(async (url) => {
        if (!canAccessFlow(url)) {
          return;
        }
        nextMap.set(url, {
          questionnaire: undefined,
          response: undefined,
          loading: true,
          error: undefined,
        });

        try {
          const questionnaire = await medplum.searchOne('Questionnaire', { url });
          if (!questionnaire || (url === A01_SORE_THROAT_DECISION_FLOW_URL && questionnaire.meta?.project !== encounter?.meta?.project)) {
            nextMap.set(url, {
              questionnaire: undefined,
              response: undefined,
              loading: false,
              error: 'Decision flow is not available.',
            });
            return;
          }
          if (signal.aborted || !canAccessFlow(url)) {
            return;
          }

          const responses = await medplum.searchResources(
            'QuestionnaireResponse',
            `questionnaire=${encodeURIComponent(url)}&encounter=${encodeURIComponent(encounterRef?.reference ?? '')}&_count=20&_sort=-_lastUpdated`,
            { cache: 'no-cache' }
          );
          if (url === A01_SORE_THROAT_DECISION_FLOW_URL && responses.some((response) => response.meta?.project !== encounter?.meta?.project)) {
            throw new Error('Decision flow is not available.');
          }

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

    if (!signal.aborted) {
      setLoadedEncounter(encounterRef.reference);
      setFlows(nextMap);
    }
  }, [encounterRef, patientRef, medplum, canAccessFlow, encounter]);

  const doSaveResponse = useCallback(
    async (questionnaireUrl: string): Promise<void> => {
      const response = pendingSaves.current.get(questionnaireUrl);
      pendingSaves.current.delete(questionnaireUrl);
      if (!response) {
        return;
      }

      const state = flows.get(questionnaireUrl);
      if (!state?.questionnaire || state.error || !encounterRef || !patientRef || !canAccessFlow(questionnaireUrl)) {
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
    [flows, encounterRef, patientRef, authorRef, medplum, canAccessFlow]
  );

  const saveResponse = useCallback(
    (questionnaireUrl: string, response: QuestionnaireResponse): void => {
      if (!canAccessFlow(questionnaireUrl)) {
        return;
      }
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
    [doSaveResponse, canAccessFlow]
  );

  const completeResponse = useCallback(
    async (questionnaireUrl: string, response: QuestionnaireResponse): Promise<void> => {
      const pendingSave = saveTimeouts.current.get(questionnaireUrl);
      if (pendingSave) {
        clearTimeout(pendingSave);
        saveTimeouts.current.delete(questionnaireUrl);
      }
      pendingSaves.current.delete(questionnaireUrl);

      const state = flows.get(questionnaireUrl);
      if (!state?.questionnaire || state.error || !encounterRef || !patientRef || !canAccessFlow(questionnaireUrl)) {
        throw new Error('Decision flow is not available.');
      }

      const completedResponse: QuestionnaireResponse = {
        ...(state.response || response),
        resourceType: 'QuestionnaireResponse',
        questionnaire: `${questionnaireUrl}|${state.questionnaire?.version ?? ''}`,
        status: 'completed',
        subject: patientRef,
        encounter: encounterRef,
        authored: new Date().toISOString(),
        source: authorRef,
        item: response.item,
      };

      const saved = completedResponse.id
        ? await medplum.updateResource(completedResponse)
        : await medplum.createResource(completedResponse);
      setFlows((previous) => {
        const next = new Map(previous);
        next.set(questionnaireUrl, { ...state, response: saved });
        return next;
      });
    },
    [authorRef, encounterRef, flows, medplum, patientRef, canAccessFlow]
  );

  useEffect(() => {
    const controller = new AbortController();
    const timeouts = saveTimeouts.current;
    const drafts = pendingSaves.current;
    Promise.resolve().then(() => loadFlows(controller.signal)).catch((err) => {
      if (!controller.signal.aborted) {
        showErrorNotification(err);
      }
    });
    return () => {
      controller.abort();
      timeouts.forEach(clearTimeout);
      timeouts.clear();
      drafts.clear();
    };
  }, [loadFlows]);

  const visibleFlows = loadedEncounter === encounterRef?.reference
    ? new Map([...flows].filter(([url]) => canAccessFlow(url)))
    : new Map<string, DecisionFlowState>();
  return {
    flows: visibleFlows,
    selectedFlowUrl: selectedFlowUrl && visibleFlows.has(selectedFlowUrl) ? selectedFlowUrl : null,
    setSelectedFlowUrl,
    saveResponse,
    completeResponse,
  };
}
