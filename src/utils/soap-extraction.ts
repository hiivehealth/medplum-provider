// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { createReference } from '@medplum/core';
import type {
  CarePlan,
  Condition,
  Encounter,
  Observation,
  Patient,
  Practitioner,
  QuestionnaireResponse,
  QuestionnaireResponseItem,
  QuestionnaireResponseItemAnswer,
  Reference,
  Resource,
} from '@medplum/fhirtypes';
import { LOINC_CODES, UCUM_SYSTEM, UCUM_UNITS } from './loinc-codes';

export interface ExtractedResources {
  observations: Observation[];
  conditions: Condition[];
  carePlans: CarePlan[];
}

export interface ExtractionContext {
  patient: Patient;
  encounter: Encounter;
  practitioner?: Practitioner | Reference<Practitioner>;
}

function toReference<T extends Resource>(
  resource: T | Reference<T> | undefined
): Reference<T> | undefined {
  if (!resource) {
    return undefined;
  }
  if ('reference' in resource && typeof resource.reference === 'string') {
    return resource as Reference<T>;
  }
  if ('resourceType' in resource && 'id' in resource && resource.id) {
    return { reference: `${resource.resourceType}/${resource.id}` };
  }
  return undefined;
}

function findItem(response: QuestionnaireResponse, linkId: string): QuestionnaireResponseItem | undefined {
  return response.item?.find((item) => item.linkId === linkId);
}

function getAnswer(item: QuestionnaireResponseItem | undefined): QuestionnaireResponseItemAnswer | undefined {
  return item?.answer?.[0];
}

function stringAnswer(item: QuestionnaireResponseItem | undefined): string | undefined {
  const answer = getAnswer(item);
  if (!answer) {
    return undefined;
  }
  return (answer as { valueString?: string; valueText?: string }).valueString ?? (answer as { valueString?: string; valueText?: string }).valueText;
}

function booleanAnswer(item: QuestionnaireResponseItem | undefined): boolean | undefined {
  return getAnswer(item)?.valueBoolean;
}

function dateAnswer(item: QuestionnaireResponseItem | undefined): string | undefined {
  const answer = getAnswer(item);
  return answer?.valueDate ?? answer?.valueDateTime;
}

function codingAnswer(item: QuestionnaireResponseItem | undefined): { code?: string; display?: string; system?: string } | undefined {
  return getAnswer(item)?.valueCoding;
}

function decimalAnswer(item: QuestionnaireResponseItem | undefined): number | undefined {
  const answer = getAnswer(item);
  return answer?.valueDecimal ?? answer?.valueInteger;
}

export function extractSubjective(
  response: QuestionnaireResponse,
  context: ExtractionContext
): ExtractedResources {
  const { patient, encounter, practitioner } = context;
  const result: ExtractedResources = { observations: [], conditions: [], carePlans: [] };

  const hpi = stringAnswer(findItem(response, 'hpi'));
  if (hpi) {
    result.observations.push({
      resourceType: 'Observation',
      status: 'final',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'survey',
              display: 'Survey',
            },
          ],
        },
      ],
      code: { coding: [LOINC_CODES.hpi] },
      subject: createReference(patient),
      encounter: createReference(encounter),
      performer: practitioner ? [toReference(practitioner) as Reference<Practitioner>] : undefined,
      effectiveDateTime: new Date().toISOString(),
      valueString: hpi,
    });
  }

  const chiefComplaints = findItem(response, 'chief-complaint')?.answer ?? [];
  for (const answer of chiefComplaints) {
    const text = (answer as { valueString?: string; valueText?: string }).valueString ?? (answer as { valueString?: string; valueText?: string }).valueText;
    if (!text) {
      continue;
    }
    result.conditions.push({
      resourceType: 'Condition',
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
      verificationStatus: {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'provisional' }],
      },
      category: [
        {
          coding: [
            { system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'problem-list-item', display: 'Problem List Item' },
          ],
        },
      ],
      code: { text },
      subject: createReference(patient),
      encounter: createReference(encounter),
    });
  }

  return result;
}

export function extractReviewOfSystems(
  response: QuestionnaireResponse,
  context: ExtractionContext
): ExtractedResources {
  const { patient, encounter, practitioner } = context;
  const result: ExtractedResources = { observations: [], conditions: [], carePlans: [] };

  for (const systemGroup of response.item ?? []) {
    if ((systemGroup as QuestionnaireResponseItem & { type?: string }).type !== 'group') {
      continue;
    }

    const systemName = systemGroup.text || systemGroup.linkId;
    const findings: string[] = [];
    let isNegative = false;

    for (const item of systemGroup.item ?? []) {
      const answer = booleanAnswer(item);
      if (item.linkId.endsWith('-negative') && answer) {
        isNegative = true;
      } else if (answer) {
        findings.push(item.text || item.linkId);
      }
    }

    if (isNegative || findings.length > 0) {
      result.observations.push({
        resourceType: 'Observation',
        status: 'final',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'survey',
                display: 'Survey',
              },
            ],
          },
        ],
        code: {
          coding: [LOINC_CODES.reviewOfSystems],
          text: `Review of Systems - ${systemName}`,
        },
        subject: createReference(patient),
        encounter: createReference(encounter),
        performer: practitioner ? [toReference(practitioner) as Reference<Practitioner>] : undefined,
        effectiveDateTime: new Date().toISOString(),
        valueString: isNegative ? 'Negative' : findings.join(', '),
        component: findings.map((finding) => ({
          code: { text: finding },
          valueString: finding,
        })),
      });
    }
  }

  return result;
}

export function extractObjective(
  response: QuestionnaireResponse,
  context: ExtractionContext
): ExtractedResources {
  const { patient, encounter, practitioner } = context;
  const result: ExtractedResources = { observations: [], conditions: [], carePlans: [] };

  const vitals: { linkId: string; coding: typeof LOINC_CODES.bodyTemperature; unit?: string; value?: number }[] = [
    { linkId: 'temperature', coding: LOINC_CODES.bodyTemperature, unit: UCUM_UNITS.fahrenheit },
    { linkId: 'heart-rate', coding: LOINC_CODES.heartRate, unit: UCUM_UNITS.bpm },
    { linkId: 'respiratory-rate', coding: LOINC_CODES.respiratoryRate, unit: UCUM_UNITS.breathsPerMin },
    { linkId: 'spO2', coding: LOINC_CODES.oxygenSaturation, unit: UCUM_UNITS.percent },
    { linkId: 'systolic-bp', coding: LOINC_CODES.systolicBloodPressure, unit: UCUM_UNITS.mmHg },
    { linkId: 'diastolic-bp', coding: LOINC_CODES.diastolicBloodPressure, unit: UCUM_UNITS.mmHg },
    { linkId: 'weight', coding: LOINC_CODES.bodyWeight, unit: UCUM_UNITS.lbs },
    { linkId: 'height', coding: LOINC_CODES.bodyHeight, unit: UCUM_UNITS.inches },
  ];

  for (const vital of vitals) {
    const value = decimalAnswer(findItem(response, vital.linkId));
    if (value === undefined || value === null) {
      continue;
    }

    result.observations.push({
      resourceType: 'Observation',
      status: 'final',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'vital-signs',
              display: 'Vital Signs',
            },
          ],
        },
      ],
      code: { coding: [vital.coding] },
      subject: createReference(patient),
      encounter: createReference(encounter),
      performer: practitioner ? [toReference(practitioner) as Reference<Practitioner>] : undefined,
      effectiveDateTime: new Date().toISOString(),
      valueQuantity: {
        value,
        unit: vital.unit,
        system: UCUM_SYSTEM,
        code: vital.unit,
      },
    });
  }

  const physicalExam = stringAnswer(findItem(response, 'physical-exam'));
  if (physicalExam) {
    result.observations.push({
      resourceType: 'Observation',
      status: 'final',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'exam',
              display: 'Exam',
            },
          ],
        },
      ],
      code: { coding: [LOINC_CODES.physicalExam] },
      subject: createReference(patient),
      encounter: createReference(encounter),
      performer: practitioner ? [toReference(practitioner) as Reference<Practitioner>] : undefined,
      effectiveDateTime: new Date().toISOString(),
      valueString: physicalExam,
    });
  }

  return result;
}

export function extractAssessment(
  response: QuestionnaireResponse,
  context: ExtractionContext
): ExtractedResources {
  const { patient, encounter } = context;
  const result: ExtractedResources = { observations: [], conditions: [], carePlans: [] };

  const diagnoses = findItem(response, 'diagnoses')?.answer ?? [];
  for (const answer of diagnoses) {
    const text = (answer as { valueString?: string; valueText?: string }).valueString ?? (answer as { valueString?: string; valueText?: string }).valueText ?? answer.valueCoding?.display;
    if (!text) {
      continue;
    }
    result.conditions.push({
      resourceType: 'Condition',
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
      verificationStatus: {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed' }],
      },
      category: [
        {
          coding: [
            { system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'encounter-diagnosis', display: 'Encounter Diagnosis' },
          ],
        },
      ],
      code: answer.valueCoding ? { coding: [answer.valueCoding] } : { text },
      subject: createReference(patient),
      encounter: createReference(encounter),
    });
  }

  const differentials = findItem(response, 'differential-diagnoses')?.answer ?? [];
  for (const answer of differentials) {
    const text = (answer as { valueString?: string; valueText?: string }).valueString ?? (answer as { valueString?: string; valueText?: string }).valueText ?? answer.valueCoding?.display;
    if (!text) {
      continue;
    }
    result.conditions.push({
      resourceType: 'Condition',
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
      verificationStatus: {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'differential' }],
      },
      category: [
        {
          coding: [
            { system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'encounter-diagnosis', display: 'Encounter Diagnosis' },
          ],
        },
      ],
      code: answer.valueCoding ? { coding: [answer.valueCoding] } : { text },
      subject: createReference(patient),
      encounter: createReference(encounter),
    });
  }

  const assessmentNote = stringAnswer(findItem(response, 'assessment-note'));
  if (assessmentNote) {
    result.observations.push({
      resourceType: 'Observation',
      status: 'final',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'survey',
              display: 'Survey',
            },
          ],
        },
      ],
      code: { coding: [LOINC_CODES.assessmentNote] },
      subject: createReference(patient),
      encounter: createReference(encounter),
      effectiveDateTime: new Date().toISOString(),
      valueString: assessmentNote,
    });
  }

  return result;
}

export interface PlanExtractionResult extends ExtractedResources {
  dispositionCode?: string;
  dispositionDisplay?: string;
  dispositionEndDate?: string;
}

export function extractPlan(response: QuestionnaireResponse, context: ExtractionContext): PlanExtractionResult {
  const { patient, encounter, practitioner } = context;
  const result: PlanExtractionResult = { observations: [], conditions: [], carePlans: [] };

  const planText = stringAnswer(findItem(response, 'plan-free-text'));
  const followUp = stringAnswer(findItem(response, 'follow-up-instructions'));
  const education = stringAnswer(findItem(response, 'patient-education'));

  if (planText || followUp || education) {
    result.carePlans.push({
      resourceType: 'CarePlan',
      status: 'active',
      intent: 'plan',
      title: 'SOAP Plan',
      description: [planText, followUp, education].filter(Boolean).join('\n\n'),
      subject: createReference(patient),
      encounter: createReference(encounter),
      author: practitioner ? (toReference(practitioner)) : undefined,
    });
  }

  const disposition = codingAnswer(findItem(response, 'patient-disposition'));
  if (disposition) {
    result.dispositionCode = disposition.code ?? undefined;
    result.dispositionDisplay = disposition.display ?? undefined;
  }

  const dispositionEndDate = dateAnswer(findItem(response, 'disposition-end-date'));
  if (dispositionEndDate) {
    result.dispositionEndDate = dispositionEndDate;
  }

  return result;
}

export function extractSoapResponse(
  questionnaireUrl: string,
  response: QuestionnaireResponse,
  context: ExtractionContext
): ExtractedResources | PlanExtractionResult {
  switch (questionnaireUrl) {
    case 'https://hiivehealth.com/questionnaire/soap-subjective':
      return extractSubjective(response, context);
    case 'https://hiivehealth.com/questionnaire/review-of-systems':
      return extractReviewOfSystems(response, context);
    case 'https://hiivehealth.com/questionnaire/soap-objective':
      return extractObjective(response, context);
    case 'https://hiivehealth.com/questionnaire/soap-assessment':
      return extractAssessment(response, context);
    case 'https://hiivehealth.com/questionnaire/soap-plan':
      return extractPlan(response, context);
    default:
      return { observations: [], conditions: [], carePlans: [] };
  }
}
