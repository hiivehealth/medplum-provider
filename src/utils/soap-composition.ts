// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { createReference, getReferenceString } from '@medplum/core';
import type {
  CarePlan,
  ClinicalImpression,
  Composition,
  Condition,
  Encounter,
  Observation,
  Patient,
  Practitioner,
  QuestionnaireResponse,
  Reference,
} from '@medplum/fhirtypes';
import {
  REVIEW_OF_SYSTEMS_URL,
  SOAP_ASSESSMENT_URL,
  SOAP_OBJECTIVE_URL,
  SOAP_PLAN_URL,
  SOAP_SUBJECTIVE_URL,
} from '../data/soap-questionnaires';

export interface SoapCompositionResources {
  patient: Patient;
  encounter: Encounter;
  practitioner: Reference<Practitioner>;
  clinicalImpression?: ClinicalImpression;
  observations: Observation[];
  conditions: Condition[];
  carePlans: CarePlan[];
  questionnaireResponses: Map<string, QuestionnaireResponse | undefined>;
}

export function buildSoapComposition(resources: SoapCompositionResources): Composition {
  const { patient, encounter, practitioner, clinicalImpression, observations, conditions, carePlans, questionnaireResponses } = resources;

  const now = new Date().toISOString();

  const subjectiveObservations = observations.filter((o) =>
    o.code?.coding?.some((c) => c.code === '29545-4' || c.code === '10157-6')
  );
  const objectiveObservations = observations.filter((o) =>
    o.code?.coding?.some((c) => ['8310-5', '8867-4', '9279-1', '2708-6', '8480-6', '8462-4', '29463-7', '8302-2', '29544-7'].includes(c.code ?? ''))
  );
  const assessmentObservations = observations.filter((o) =>
    o.code?.coding?.some((c) => c.code === '51847-2')
  );

  const diagnosisConditions = conditions.filter((c) =>
    c.category?.some((cat) => cat.coding?.some((coding) => coding.code === 'encounter-diagnosis'))
  );
  const problemConditions = conditions.filter((c) =>
    c.category?.some((cat) => cat.coding?.some((coding) => coding.code === 'problem-list-item'))
  );

  const subjectiveResponse = questionnaireResponses.get(SOAP_SUBJECTIVE_URL);
  const rosResponse = questionnaireResponses.get(REVIEW_OF_SYSTEMS_URL);
  const objectiveResponse = questionnaireResponses.get(SOAP_OBJECTIVE_URL);
  const assessmentResponse = questionnaireResponses.get(SOAP_ASSESSMENT_URL);
  const planResponse = questionnaireResponses.get(SOAP_PLAN_URL);

  function toRefs(items: { id?: string; resourceType: string }[]): Reference[] {
    return items
      .filter((item): item is { id: string; resourceType: string } => Boolean(item.id))
      .map((item) => ({ reference: `${item.resourceType}/${item.id}` }));
  }

  const sectionEntries: Reference[] = [];
  if (clinicalImpression?.id) {
    sectionEntries.push({ reference: getReferenceString(clinicalImpression) });
  }

  return {
    resourceType: 'Composition',
    status: 'final',
    type: {
      coding: [{ system: 'http://loinc.org', code: '11506-3', display: 'Provider-unspecified Progress note' }],
      text: 'SOAP Note',
    },
    category: [
      {
        coding: [{ system: 'http://loinc.org', code: '11506-3', display: 'Provider-unspecified Progress note' }],
      },
    ],
    subject: createReference(patient),
    encounter: createReference(encounter),
    date: now,
    author: [practitioner],
    title: 'SOAP Note',
    section: [
      {
        title: 'Subjective',
        code: { coding: [{ system: 'http://loinc.org', code: '29545-4', display: 'History of present illness' }] },
        entry: [
          ...toRefs(subjectiveObservations),
          ...toRefs(problemConditions),
          ...(subjectiveResponse?.id ? [{ reference: `QuestionnaireResponse/${subjectiveResponse.id}` }] : []),
          ...(rosResponse?.id ? [{ reference: `QuestionnaireResponse/${rosResponse.id}` }] : []),
        ],
        text: {
          status: 'generated',
          div: buildSectionDiv('Subjective', subjectiveObservations, problemConditions, [
            subjectiveResponse,
            rosResponse,
          ]),
        },
      },
      {
        title: 'Objective',
        code: { coding: [{ system: 'http://loinc.org', code: '29544-7', display: 'Physical findings' }] },
        entry: [
          ...toRefs(objectiveObservations),
          ...(objectiveResponse?.id ? [{ reference: `QuestionnaireResponse/${objectiveResponse.id}` }] : []),
        ],
        text: {
          status: 'generated',
          div: buildSectionDiv('Objective', objectiveObservations, [], [objectiveResponse]),
        },
      },
      {
        title: 'Assessment',
        code: { coding: [{ system: 'http://loinc.org', code: '51847-2', display: 'Evaluation + Plan note' }] },
        entry: [
          ...toRefs(assessmentObservations),
          ...toRefs(diagnosisConditions),
          ...(assessmentResponse?.id ? [{ reference: `QuestionnaireResponse/${assessmentResponse.id}` }] : []),
        ],
        text: {
          status: 'generated',
          div: buildSectionDiv('Assessment', assessmentObservations, diagnosisConditions, [assessmentResponse]),
        },
      },
      {
        title: 'Plan',
        code: { coding: [{ system: 'http://loinc.org', code: '18776-5', display: 'Plan of care note' }] },
        entry: [
          ...toRefs(carePlans),
          ...(planResponse?.id ? [{ reference: `QuestionnaireResponse/${planResponse.id}` }] : []),
        ],
        text: {
          status: 'generated',
          div: buildPlanSectionDiv(carePlans, planResponse),
        },
      },
    ],
  };
}

function buildSectionDiv(
  title: string,
  observations: Observation[],
  conditions: Condition[],
  responses: (QuestionnaireResponse | undefined)[]
): string {
  const lines: string[] = [`<h3>${escapeHtml(title)}</h3>`];

  for (const obs of observations) {
    const text = obs.code?.text || obs.code?.coding?.[0]?.display || 'Observation';
    const value = obs.valueString || obs.valueQuantity?.value?.toString() || '';
    lines.push(`<p><strong>${escapeHtml(text)}:</strong> ${escapeHtml(value)}</p>`);
  }

  for (const cond of conditions) {
    const text = cond.code?.text || cond.code?.coding?.[0]?.display || 'Condition';
    lines.push(`<p><strong>Diagnosis:</strong> ${escapeHtml(text)}</p>`);
  }

  for (const response of responses) {
    if (!response) {
      continue;
    }
    const text = response.item?.map((item) => `${item.text || item.linkId}: ${answerText(item)}`).join('<br/>') || '';
    if (text) {
      lines.push(`<p>${text}</p>`);
    }
  }

  return `<div xmlns="http://www.w3.org/1999/xhtml">${lines.join('')}</div>`;
}

function buildPlanSectionDiv(carePlans: CarePlan[], planResponse: QuestionnaireResponse | undefined): string {
  const lines: string[] = ['<h3>Plan</h3>'];

  for (const carePlan of carePlans) {
    if (carePlan.description) {
      lines.push(`<p>${escapeHtml(carePlan.description)}</p>`);
    }
  }

  if (planResponse?.item) {
    const text = planResponse.item.map((item) => `${item.text || item.linkId}: ${answerText(item)}`).join('<br/>');
    if (text) {
      lines.push(`<p>${text}</p>`);
    }
  }

  return `<div xmlns="http://www.w3.org/1999/xhtml">${lines.join('')}</div>`;
}

function answerText(item: { answer?: { valueString?: string; valueCoding?: { display?: string } }[] }): string {
  if (!item.answer || item.answer.length === 0) {
    return '';
  }
  return item.answer
    .map((a) => a.valueString ?? a.valueCoding?.display ?? '')
    .filter(Boolean)
    .join(', ');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
