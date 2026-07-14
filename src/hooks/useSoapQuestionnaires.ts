// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { getReferenceString, normalizeErrorString } from '@medplum/core';
import type {
  CarePlan,
  Condition,
  Encounter,
  Identifier,
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
  persistAll: () => Promise<{
    observations: Observation[];
    conditions: Condition[];
    carePlans: CarePlan[];
    questionnaireResponses: Map<string, QuestionnaireResponse | undefined>;
  }>;
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

  const SOAP_EXTRACT_IDENTIFIER_SYSTEM = 'https://hiivehealth.com/fhir/identifier/soap-extract';

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

  const getExtractIdentifier = useCallback(
    (
      resource: Observation | Condition | CarePlan,
      sectionUrl: string,
      index: number
    ): Identifier => {
      const encounterId = encounter?.id ?? 'unknown';
      const sectionKey = sectionUrl.replace('https://hiivehealth.com/questionnaire/', '');

      let code = 'resource';
      if (resource.resourceType === 'Observation') {
        code =
          resource.code?.coding?.find((c) => c.code)?.code ??
          resource.code?.text ??
          'observation';
      } else if (resource.resourceType === 'Condition') {
        code =
          resource.code?.coding?.find((c) => c.code)?.code ??
          resource.code?.text ??
          'condition';
      } else if (resource.resourceType === 'CarePlan') {
        code = resource.title ?? 'careplan';
      }

      const safeCode = code.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 40);

      return {
        system: SOAP_EXTRACT_IDENTIFIER_SYSTEM,
        value: `${encounterId}-soap-${sectionKey}-${safeCode}-${index}`,
      };
    },
    [encounter?.id]
  );

  const upsertExtractedResource = useCallback(
    async <T extends Observation | Condition | CarePlan>(
      resource: T,
      sectionUrl: string,
      index: number
    ): Promise<T> => {
      const identifier = getExtractIdentifier(resource, sectionUrl, index);
      const resourceWithIdentifier: T = {
        ...resource,
        identifier: [...(resource.identifier ?? []), identifier],
      };

      const resourceType = resource.resourceType as 'Observation' | 'Condition' | 'CarePlan';
      const existing = await medplum.searchOne(resourceType, {
        identifier: `${identifier.system}|${identifier.value}`,
        encounter: encounterRef?.reference ?? '',
      });

      if (existing) {
        return medplum.updateResource({ ...resourceWithIdentifier, id: existing.id });
      }
      return medplum.createResource(resourceWithIdentifier);
    },
    [encounterRef, getExtractIdentifier, medplum]
  );

  const persistExtractedResources = useCallback(
    async (responses: Map<string, QuestionnaireResponse | undefined>): Promise<{
      observations: Observation[];
      conditions: Condition[];
      carePlans: CarePlan[];
    }> => {
      if (!patientResource || !encounter || !encounterRef) {
        return { observations: [], conditions: [], carePlans: [] };
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

        for (let i = 0; i < extracted.observations.length; i++) {
          const saved = await upsertExtractedResource(extracted.observations[i], url, i);
          createdObservations.push(saved);
        }

        for (let i = 0; i < extracted.conditions.length; i++) {
          const saved = await upsertExtractedResource(extracted.conditions[i], url, i);
          createdConditions.push(saved);
        }

        for (let i = 0; i < extracted.carePlans.length; i++) {
          const saved = await upsertExtractedResource(extracted.carePlans[i], url, i);
          createdCarePlans.push(saved);
        }

        if (url === SOAP_PLAN_URL && 'dispositionCode' in extracted) {
          const dispositionCode = extracted.dispositionCode;
          const dispositionDisplay = extracted.dispositionDisplay;
          const dispositionEndDate = extracted.dispositionEndDate;

          if (dispositionCode || dispositionEndDate) {
            const existingExtensions = encounter.hospitalization?.extension ?? [];
            const endDateExtensionUrl = 'https://hiivehealth.com/fhir/StructureDefinition/disposition-end-date';
            const existingEndDateIndex = existingExtensions.findIndex((e) => e.url === endDateExtensionUrl);

            let updatedExtensions = [...existingExtensions];
            if (dispositionEndDate) {
              const endDateExtension = { url: endDateExtensionUrl, valueDate: dispositionEndDate };
              if (existingEndDateIndex >= 0) {
                updatedExtensions[existingEndDateIndex] = endDateExtension;
              } else {
                updatedExtensions.push(endDateExtension);
              }
            }

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
                extension: updatedExtensions,
              },
            };
            await medplum.updateResource(updatedEncounter);
          }
        }
      }

      const result = {
        observations: createdObservations,
        conditions: createdConditions,
        carePlans: createdCarePlans,
      };
      setExtractedResources(result);
      return result;
    },
    [patientResource, encounter, encounterRef, author, medplum, upsertExtractedResource]
  );

  const persistAll = useCallback(async (): Promise<{
    observations: Observation[];
    conditions: Condition[];
    carePlans: CarePlan[];
    questionnaireResponses: Map<string, QuestionnaireResponse | undefined>;
  }> => {
    const responses = new Map<string, QuestionnaireResponse | undefined>();
    for (const [url, state] of questionnaires.entries()) {
      responses.set(url, state.response);
    }
    const resources = await persistExtractedResources(responses);
    return { ...resources, questionnaireResponses: responses };
  }, [questionnaires, persistExtractedResources]);

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
    persistAll,
    extractedResources,
    extractedDisposition,
  };
}
