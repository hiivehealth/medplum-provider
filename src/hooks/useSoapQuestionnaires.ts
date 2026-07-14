// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { getReferenceString, normalizeErrorString } from '@medplum/core';
import type {
  CarePlan,
  Condition,
  Encounter,
  Observation,
  Patient,
  Practitioner,
  Questionnaire,
  QuestionnaireResponse,
} from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SOAP_PLAN_URL, SOAP_QUESTIONNAIRE_URLS } from '../data/soap-questionnaires';
import { extractSoapResponse } from '../utils/soap-extraction';
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
  extractedResources: {
    observations: Observation[];
    conditions: Condition[];
    carePlans: CarePlan[];
  };
  extractedDisposition: {
    code?: string;
    display?: string;
    endDate?: string;
  };
}

export function useSoapQuestionnaires(
  encounter: Encounter | undefined,
  patientResource: Patient | undefined
): UseSoapQuestionnairesResult {
  const medplum = useMedplum();
  const author = useMedplumProfile();
  const [questionnaires, setQuestionnaires] = useState<Map<string, SoapQuestionnaireState>>(new Map());
  const [extractedResources, setExtractedResources] = useState<{
    observations: Observation[];
    conditions: Condition[];
    carePlans: CarePlan[];
  }>({ observations: [], conditions: [], carePlans: [] });
  const [extractedDisposition, setExtractedDisposition] = useState<{ code?: string; display?: string; endDate?: string }>({});

  const encounterRef = useMemo(
    () => (encounter ? { reference: getReferenceString(encounter) } : undefined),
    [encounter]
  );
  const patientRef = useMemo(
    () => (patientResource ? { reference: getReferenceString(patientResource) } : undefined),
    [patientResource]
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

  const extractResources = useCallback(
    (responses: Map<string, QuestionnaireResponse | undefined>): void => {
      if (!patientResource || !encounter) {
        return;
      }

      const context = {
        patient: patientResource,
        encounter,
        practitioner: author as Practitioner | undefined,
      };

      const allObservations: Observation[] = [];
      const allConditions: Condition[] = [];
      const allCarePlans: CarePlan[] = [];
      let disposition: { code?: string; display?: string; endDate?: string } = {};

      for (const [url, response] of responses.entries()) {
        if (!response) {
          continue;
        }
        const extracted = extractSoapResponse(url, response, context);
        allObservations.push(...extracted.observations);
        allConditions.push(...extracted.conditions);
        allCarePlans.push(...extracted.carePlans);

        if (url === SOAP_PLAN_URL && 'dispositionCode' in extracted) {
          disposition = {
            code: extracted.dispositionCode,
            display: extracted.dispositionDisplay,
            endDate: extracted.dispositionEndDate,
          };
        }
      }

      setExtractedResources({
        observations: allObservations,
        conditions: allConditions,
        carePlans: allCarePlans,
      });
      setExtractedDisposition(disposition);
    },
    [patientResource, encounter, author]
  );

  const persistExtractedResources = useCallback(
    async (responses: Map<string, QuestionnaireResponse | undefined>): Promise<void> => {
      if (!patientResource || !encounter || !encounterRef) {
        return;
      }

      const context = {
        patient: patientResource,
        encounter,
        practitioner: author as Practitioner | undefined,
      };

      const createdObservations: Observation[] = [];
      const createdConditions: Condition[] = [];
      const createdCarePlans: CarePlan[] = [];

      for (const [url, response] of responses.entries()) {
        if (!response) {
          continue;
        }
        const extracted = extractSoapResponse(url, response, context);

        for (const observation of extracted.observations) {
          const saved = observation.id
            ? await medplum.updateResource(observation)
            : await medplum.createResource(observation);
          createdObservations.push(saved);
        }

        for (const condition of extracted.conditions) {
          const saved = condition.id
            ? await medplum.updateResource(condition)
            : await medplum.createResource(condition);
          createdConditions.push(saved);
        }

        for (const carePlan of extracted.carePlans) {
          const saved = carePlan.id
            ? await medplum.updateResource(carePlan)
            : await medplum.createResource(carePlan);
          createdCarePlans.push(saved);
        }

        if (url === SOAP_PLAN_URL && 'dispositionCode' in extracted) {
          const dispositionCode = extracted.dispositionCode;
          const dispositionDisplay = extracted.dispositionDisplay;
          const dispositionEndDate = extracted.dispositionEndDate;

          if (dispositionCode || dispositionEndDate) {
            const updatedEncounter: Encounter = {
              ...encounter,
              hospitalization: {
                ...encounter.hospitalization,
                dischargeDisposition: dispositionCode
                  ? {
                      coding: [
                        {
                          system: 'https://hiivehealth.com/fhir/soap/disposition',
                          code: dispositionCode,
                          display: dispositionDisplay,
                        },
                      ],
                    }
                  : encounter.hospitalization?.dischargeDisposition,
                extension: dispositionEndDate
                  ? [
                      ...(encounter.hospitalization?.extension ?? []),
                      {
                        url: 'https://hiivehealth.com/fhir/StructureDefinition/disposition-end-date',
                        valueDate: dispositionEndDate,
                      },
                    ]
                  : encounter.hospitalization?.extension,
              },
            };
            await medplum.updateResource(updatedEncounter);
          }
        }
      }

      setExtractedResources({
        observations: createdObservations,
        conditions: createdConditions,
        carePlans: createdCarePlans,
      });
    },
    [patientResource, encounter, encounterRef, author, medplum]
  );

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

        const nextResponses = new Map<string, QuestionnaireResponse | undefined>();
        setQuestionnaires((prev) => {
          const next = new Map(prev);
          next.set(questionnaireUrl, { ...state, response: saved });
          for (const [url, s] of next.entries()) {
            nextResponses.set(url, s.response);
          }
          extractResources(nextResponses);
          return next;
        });

        await persistExtractedResources(nextResponses);
      } catch (err) {
        showErrorNotification(err);
      }
    },
    [questionnaires, encounterRef, patientRef, authorRef, medplum, extractResources, persistExtractedResources]
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

  return {
    questionnaires,
    refresh: loadQuestionnaires,
    saveResponse,
    extractedResources,
    extractedDisposition,
  };
}
