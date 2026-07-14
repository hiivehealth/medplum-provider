// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Coding } from '@medplum/fhirtypes';

export const LOINC_SYSTEM = 'http://loinc.org';

export const LOINC_CODES: Record<string, Coding> = {
  bodyTemperature: {
    system: LOINC_SYSTEM,
    code: '8310-5',
    display: 'Body temperature',
  },
  heartRate: {
    system: LOINC_SYSTEM,
    code: '8867-4',
    display: 'Heart rate',
  },
  respiratoryRate: {
    system: LOINC_SYSTEM,
    code: '9279-1',
    display: 'Respiratory rate',
  },
  oxygenSaturation: {
    system: LOINC_SYSTEM,
    code: '2708-6',
    display: 'Oxygen saturation in Arterial blood',
  },
  systolicBloodPressure: {
    system: LOINC_SYSTEM,
    code: '8480-6',
    display: 'Systolic blood pressure',
  },
  diastolicBloodPressure: {
    system: LOINC_SYSTEM,
    code: '8462-4',
    display: 'Diastolic blood pressure',
  },
  bodyWeight: {
    system: LOINC_SYSTEM,
    code: '29463-7',
    display: 'Body weight',
  },
  bodyHeight: {
    system: LOINC_SYSTEM,
    code: '8302-2',
    display: 'Body height',
  },
  hpi: {
    system: LOINC_SYSTEM,
    code: '29545-4',
    display: 'History of present illness',
  },
  reviewOfSystems: {
    system: LOINC_SYSTEM,
    code: '10157-6',
    display: 'History of family member diseases',
  },
  physicalExam: {
    system: LOINC_SYSTEM,
    code: '29544-7',
    display: 'Physical findings',
  },
  assessmentNote: {
    system: LOINC_SYSTEM,
    code: '51847-2',
    display: 'Evaluation + Plan note',
  },
  planOfCare: {
    system: LOINC_SYSTEM,
    code: '18776-5',
    display: 'Plan of care note',
  },
};

export const UCUM_SYSTEM = 'http://unitsofmeasure.org';

export const UCUM_UNITS: Record<string, string> = {
  fahrenheit: '[degF]',
  bpm: '/min',
  breathsPerMin: '/min',
  percent: '%',
  mmHg: 'mm[Hg]',
  lbs: '[lb_av]',
  inches: '[in_i]',
};
