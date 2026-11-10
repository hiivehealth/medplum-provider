// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { createReference } from '@medplum/core';
import type {
  Coding,
  Encounter,
  Observation,
  Patient,
  Practitioner,
  QuestionnaireResponse,
  Reference,
} from '@medplum/fhirtypes';
import { isRedRoverLocalEncounter } from './encounter';
import { LOINC_CODES, UCUM_SYSTEM } from './loinc-codes';

export interface CreateVitalObservationInput {
  patient: Patient;
  encounter: Encounter;
  coding: Coding;
  value: number;
  unit: string;
  performer?: Reference<Practitioner>;
  effectiveDateTime?: string;
}

export function createVitalObservation(input: CreateVitalObservationInput): Observation {
  const { patient, encounter, coding, value, unit, performer, effectiveDateTime } = input;

  return {
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
    code: { coding: [coding] },
    subject: createReference(patient),
    encounter: createReference(encounter),
    performer: performer ? [performer] : undefined,
    effectiveDateTime: effectiveDateTime ?? new Date().toISOString(),
    valueQuantity: {
      value,
      unit,
      system: UCUM_SYSTEM,
      code: unit,
    },
  };
}

export const LOCAL_VITAL_IDENTIFIER_SYSTEM = 'https://hiivehealth.com/fhir/red-rover/local-authoring/vital';

const LOCAL_VITAL_FIELDS: [string, string, string][] = [
  ['temperature-f', 'bodyTemperature', '[degF]'],
  ['temperature-c', 'bodyTemperature', 'Cel'],
  ['heart-rate', 'heartRate', '/min'],
  ['respiratory-rate', 'respiratoryRate', '/min'],
  ['spO2', 'oxygenSaturation', '%'],
  ['systolic-bp', 'systolicBloodPressure', 'mm[Hg]'],
  ['diastolic-bp', 'diastolicBloodPressure', 'mm[Hg]'],
  ['weight-lb', 'bodyWeight', '[lb_av]'],
  ['weight-kg', 'bodyWeight', 'kg'],
  ['height-in', 'bodyHeight', '[in_i]'],
  ['height-cm', 'bodyHeight', 'cm'],
  ['blood-glucose', 'bloodGlucose', 'mg/dL'],
];

export function buildRedRoverLocalVitals(
  patient: Patient,
  encounter: Encounter,
  practitioner: Practitioner,
  response: QuestionnaireResponse,
  measuredAt: string
): Observation[] {
  if (
    !isRedRoverLocalEncounter(encounter) ||
    !encounter.id ||
    encounter.status !== 'in-progress' ||
    encounter.period?.end ||
    patient.id !== encounter.subject?.reference?.split('/')[1] ||
    patient.meta?.project !== encounter.meta?.project ||
    practitioner.meta?.project !== encounter.meta?.project ||
    !practitioner.id ||
    encounter.participant?.[0]?.individual?.reference !== `Practitioner/${practitioner.id}` ||
    response.subject?.reference !== encounter.subject?.reference ||
    response.encounter?.reference !== `Encounter/${encounter.id}` ||
    response.meta?.source
  )
    throw new Error('Vitals require the approved active local visit, patient and clinician');
  const timestamp = Date.parse(measuredAt);
  const visitStart = Date.parse(encounter.period?.start ?? '');
  if (!Number.isFinite(timestamp) || !Number.isFinite(visitStart) || timestamp < visitStart || timestamp > Date.now()) {
    throw new Error('Vital signs need an explicit measurement time during this visit, not in the future');
  }
  const groups = response.item?.filter((item) => item.linkId === 'vitals');
  if (groups?.length !== 1) throw new Error('Exactly one local vital-sign group is required');
  const observations: Observation[] = [];
  const codes = new Set<string>();
  for (const item of groups[0].item ?? []) {
    if (!item.answer?.length) continue;
    const field = LOCAL_VITAL_FIELDS.find(([linkId]) => linkId === item.linkId);
    if (!field) {
      if (!['temperature-unit', 'weight-unit', 'height-unit'].includes(item.linkId))
        throw new Error('Unsupported vital field');
      continue;
    }
    const value = item.answer[0].valueDecimal ?? item.answer[0].valueInteger;
    const coding = LOINC_CODES[field[1]];
    if (item.answer.length !== 1 || typeof value !== 'number' || !Number.isFinite(value) || codes.has(coding.code!)) {
      throw new Error('Vital readings must be finite scalar numbers without duplicate measurements');
    }
    codes.add(coding.code!);
    observations.push({
      ...createVitalObservation({
        patient,
        encounter,
        coding,
        value,
        unit: field[2],
        performer: createReference(practitioner),
        effectiveDateTime: new Date(timestamp).toISOString(),
      }),
      meta: { project: encounter.meta?.project },
      status: 'preliminary',
      identifier: [
        { system: LOCAL_VITAL_IDENTIFIER_SYSTEM, value: encounter.id },
        {
          system: `${LOCAL_VITAL_IDENTIFIER_SYSTEM}/measurement`,
          value: `${encounter.id}:${new Date(timestamp).toISOString()}:${coding.code}`,
        },
      ],
    });
  }
  if (!observations.length) throw new Error('Enter at least one vital before recording');
  return observations;
}
