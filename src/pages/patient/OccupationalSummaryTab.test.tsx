// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import type { Encounter, EpisodeOfCare, Observation, Task } from '@medplum/fhirtypes';
import { HomerSimpson, MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { OccupationalSummaryTab } from './OccupationalSummaryTab';

const DEMO_CODE_SYSTEM = 'https://hiivecare.example/fhir/CodeSystem/medplum-ubix-demo';
const patientReference = `Patient/${HomerSimpson.id}`;

describe('OccupationalSummaryTab', () => {
  let medplum: MockClient;

  beforeEach(() => {
    medplum = new MockClient();
    vi.clearAllMocks();
  });

  const setup = (): ReturnType<typeof render> => {
    return render(
      <MemoryRouter initialEntries={[`/Patient/${HomerSimpson.id}/occupational`]}>
        <MedplumProvider medplum={medplum}>
          <MantineProvider>
            <Routes>
              <Route path="/Patient/:patientId/occupational" element={<OccupationalSummaryTab />} />
            </Routes>
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );
  };

  test('renders RTW status, restrictions, and occupational context', async () => {
    const observation: Observation = {
      resourceType: 'Observation',
      id: 'rtw-observation',
      status: 'final',
      code: codeableConcept('return-to-work-status', 'Return-to-work status'),
      subject: { reference: patientReference },
      focus: [{ reference: 'EpisodeOfCare/episode-1', display: 'Exposure Incident' }],
      valueString: 'pending-reevaluation',
      component: [
        { code: codeableConcept('restriction-type', 'Restriction type'), valueString: 'Field duty restricted' },
        {
          code: codeableConcept('restriction-summary', 'Restriction summary'),
          valueString: 'No field deployment; administrative duty only until reevaluation.',
        },
        {
          code: codeableConcept('restriction-limit', 'Restriction limit'),
          valueString: 'Avoid exposure response and prolonged standing over 2 hours.',
        },
        {
          code: codeableConcept('restriction-effective-date', 'Restriction effective date'),
          valueDateTime: '2026-05-12',
        },
        {
          code: codeableConcept('restriction-expiration-date', 'Restriction expiration date'),
          valueDateTime: '2026-05-26',
        },
        {
          code: codeableConcept('restriction-reevaluation-date', 'Restriction reevaluation date'),
          valueDateTime: '2026-05-26',
        },
      ],
    };
    const task: Task = {
      resourceType: 'Task',
      id: 'rtw-task',
      status: 'requested',
      intent: 'order',
      priority: 'routine',
      code: codeableConcept('rtw-follow-up', 'RTW case follow-up'),
      for: { reference: patientReference },
      focus: { reference: 'EpisodeOfCare/episode-1' },
      description: 'Follow RTW case with status pending-reevaluation.',
    };
    const episode: EpisodeOfCare = {
      resourceType: 'EpisodeOfCare',
      id: 'episode-1',
      status: 'active',
      type: [codeableConcept('exposure-incident', 'Exposure Incident')],
      patient: { reference: patientReference },
      managingOrganization: { reference: 'Organization/component-a', display: 'OccHealth Component A' },
    };
    const encounter: Encounter = {
      resourceType: 'Encounter',
      id: 'encounter-1',
      status: 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
      type: [codeableConcept('exposure-incident', 'Exposure Incident')],
      subject: { reference: patientReference },
      serviceProvider: { reference: 'Organization/component-a', display: 'OccHealth Component A' },
      location: [{ location: { reference: 'Location/hq-clinic', display: 'HQ Clinic' } }],
    };

    vi.spyOn(medplum, 'searchResources').mockImplementation(async (resourceType) => {
      if (resourceType === 'Observation') {
        return [observation] as any;
      }
      if (resourceType === 'Task') {
        return [task] as any;
      }
      if (resourceType === 'EpisodeOfCare') {
        return [episode] as any;
      }
      if (resourceType === 'Encounter') {
        return [encounter] as any;
      }
      return [] as any;
    });

    setup();

    await waitFor(() => {
      expect(screen.getAllByText('Pending Reevaluation').length).toBeGreaterThan(0);
    });
    expect(
      screen.getAllByText('No field deployment; administrative duty only until reevaluation.').length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('Avoid exposure response and prolonged standing over 2 hours.').length).toBeGreaterThan(
      0
    );
    expect(screen.getByText('OccHealth Component A')).toBeInTheDocument();
    expect(screen.getByText('HQ Clinic')).toBeInTheDocument();
    expect(screen.getAllByText('RTW case follow-up').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'RTW case follow-up' })).toHaveAttribute(
      'href',
      `/Patient/${HomerSimpson.id}/Task/rtw-task`
    );
  });
});

function codeableConcept(code: string, display: string) {
  return {
    coding: [{ system: DEMO_CODE_SYSTEM, code, display }],
    text: display,
  };
}
