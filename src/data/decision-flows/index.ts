// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Questionnaire } from '@medplum/fhirtypes';

export const CHEST_PAIN_DECISION_FLOW_URL = 'https://hiivehealth.com/questionnaire/decision-flow/chest-pain';
export const RESPIRATORY_DECISION_FLOW_URL = 'https://hiivehealth.com/questionnaire/decision-flow/respiratory';

export const DECISION_FLOW_QUESTIONNAIRE_URLS: string[] = [CHEST_PAIN_DECISION_FLOW_URL, RESPIRATORY_DECISION_FLOW_URL];

export interface DecisionFlowDefinition {
  url: string;
  name: string;
  title: string;
  fileName: string;
}

export const DECISION_FLOWS: DecisionFlowDefinition[] = [
  {
    url: CHEST_PAIN_DECISION_FLOW_URL,
    name: 'HiiveDecisionFlowChestPain',
    title: 'Chest Pain Triage',
    fileName: 'chest-pain.json',
  },
  {
    url: RESPIRATORY_DECISION_FLOW_URL,
    name: 'HiiveDecisionFlowRespiratory',
    title: 'Respiratory Triage',
    fileName: 'respiratory.json',
  },
];

export function isDecisionFlowQuestionnaire(questionnaire: Questionnaire): boolean {
  return DECISION_FLOW_QUESTIONNAIRE_URLS.includes(questionnaire.url ?? '');
}
