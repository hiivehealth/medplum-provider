// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Encounter, EpisodeOfCare, Location, Observation, Patient, Task } from '@medplum/fhirtypes';
import { DEMO_CODE_SYSTEM } from './occupational-data';

export const occupationalPatient: Patient = {
  resourceType: 'Patient',
  id: 'patient-1',
  name: [{ given: ['Avery'], family: 'Rivera' }],
};

export const occupationalLocation: Location = {
  resourceType: 'Location',
  id: 'headquarters',
  status: 'active',
  name: 'Headquarters',
  type: [codeableConcept('duty-location', 'Duty location')],
  managingOrganization: { reference: 'Organization/component-a', display: 'Component A' },
};

export const occupationalEncounter: Encounter = {
  resourceType: 'Encounter',
  id: 'encounter-1',
  status: 'finished',
  class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
  type: [codeableConcept('exposure-incident', 'Exposure Incident')],
  subject: { reference: 'Patient/patient-1' },
  period: { start: '2026-05-12T12:00:00Z' },
  serviceProvider: { reference: 'Organization/component-a', display: 'Component A' },
  location: [{ location: { reference: 'Location/headquarters', display: 'Headquarters' } }],
};

export const occupationalEpisode: EpisodeOfCare = {
  resourceType: 'EpisodeOfCare',
  id: 'episode-1',
  status: 'active',
  type: [codeableConcept('exposure-incident', 'Exposure Incident')],
  patient: { reference: 'Patient/patient-1' },
  managingOrganization: { reference: 'Organization/component-a', display: 'Component A' },
};

export const occupationalObservation: Observation = {
  resourceType: 'Observation',
  id: 'observation-1',
  status: 'final',
  code: codeableConcept('return-to-work-status', 'Return-to-work status'),
  subject: { reference: 'Patient/patient-1' },
  valueString: 'pending-reevaluation',
  component: [
    {
      code: codeableConcept('restriction-summary', 'Restriction summary'),
      valueString: 'Administrative duty only until reevaluation.',
    },
    {
      code: codeableConcept('restriction-reevaluation-date', 'Restriction reevaluation date'),
      valueDateTime: '2026-05-26',
    },
  ],
};

export const occupationalTask: Task = {
  resourceType: 'Task',
  id: 'task-1',
  status: 'requested',
  intent: 'order',
  priority: 'routine',
  code: codeableConcept('rtw-follow-up', 'RTW case follow-up'),
  for: { reference: 'Patient/patient-1' },
  focus: { reference: 'EpisodeOfCare/episode-1' },
};

export function codeableConcept(code: string, display: string) {
  return {
    coding: [{ system: DEMO_CODE_SYSTEM, code, display }],
    text: display,
  };
}
