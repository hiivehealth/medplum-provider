// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { createReference } from '@medplum/core';
import type { Coding, Encounter, Observation, Patient, Practitioner, Reference } from '@medplum/fhirtypes';
import { UCUM_SYSTEM } from './loinc-codes';

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