// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Questionnaire } from '@medplum/fhirtypes';

export const SOAP_SUBJECTIVE_URL = 'https://hiivehealth.com/questionnaire/soap-subjective';
export const SOAP_OBJECTIVE_URL = 'https://hiivehealth.com/questionnaire/soap-objective';
export const SOAP_ASSESSMENT_URL = 'https://hiivehealth.com/questionnaire/soap-assessment';
export const SOAP_PLAN_URL = 'https://hiivehealth.com/questionnaire/soap-plan';
export const REVIEW_OF_SYSTEMS_URL = 'https://hiivehealth.com/questionnaire/review-of-systems';

export const SOAP_QUESTIONNAIRE_URLS: string[] = [
  SOAP_SUBJECTIVE_URL,
  SOAP_OBJECTIVE_URL,
  SOAP_ASSESSMENT_URL,
  SOAP_PLAN_URL,
  REVIEW_OF_SYSTEMS_URL,
];

export interface SoapQuestionnaireDefinition {
  url: string;
  name: string;
  title: string;
  fileName: string;
}

export const SOAP_QUESTIONNAIRES: SoapQuestionnaireDefinition[] = [
  { url: SOAP_SUBJECTIVE_URL, name: 'HiiveSOAPSubjective', title: 'Subjective', fileName: 'soap-subjective.json' },
  { url: SOAP_OBJECTIVE_URL, name: 'HiiveSOAPObjective', title: 'Objective', fileName: 'soap-objective.json' },
  { url: SOAP_ASSESSMENT_URL, name: 'HiiveSOAPAssessment', title: 'Assessment', fileName: 'soap-assessment.json' },
  { url: SOAP_PLAN_URL, name: 'HiiveSOAPPlan', title: 'Plan', fileName: 'soap-plan.json' },
  {
    url: REVIEW_OF_SYSTEMS_URL,
    name: 'HiiveReviewOfSystems',
    title: 'Review of Systems',
    fileName: 'review-of-systems.json',
  },
];

export function isSoapQuestionnaire(questionnaire: Questionnaire): boolean {
  return SOAP_QUESTIONNAIRE_URLS.includes(questionnaire.url ?? '');
}
