// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { calculateAgeString } from '@medplum/core';
import type { Condition } from '@medplum/fhirtypes';
import { HomerSimpson, MockClient } from '@medplum/mock';
import { MedplumProvider, PatientSummary } from '@medplum/react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { EditTab } from './EditTab';
import { PatientPage } from './PatientPage';
import { redRoverChiefComplaintsSection } from './RedRoverChiefComplaintsSection';
import { redRoverMedicationOrdersSection } from './RedRoverMedicationOrdersSection';
import { TimelineTab } from './TimelineTab';

describe('PatientPage', () => {
  let medplum: MockClient;

  beforeEach(async () => {
    medplum = new MockClient();
    vi.clearAllMocks();
  });

  const setup = (initialPath = '/Patient/patient-123'): ReturnType<typeof render> => {
    window.history.pushState({}, '', initialPath);
    return render(
      <MemoryRouter initialEntries={[initialPath]}>
        <MedplumProvider medplum={medplum}>
          <MantineProvider>
            <Notifications />
            <Routes>
              <Route path="/Patient/:patientId/*" element={<PatientPage />}>
                <Route path="edit" element={<EditTab />} />
                <Route path="" element={<TimelineTab />} />
                <Route path="*" element={<TimelineTab />} />
              </Route>
            </Routes>
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );
  };

  test('queries only approved summary domains for the exact five-patient Red Rover cohort', async () => {
    const patient = await medplum.createResource({
      resourceType: 'Patient',
      meta: { project: '8588313a-c8c6-4e07-8c1d-e684ed25e522' },
      identifier: [
        { system: 'https://hiivehealth.com/fhir/red-rover/uat/five-patient-test/patient', value: '19128435' },
        {
          system: 'https://hiivehealth.com/fhir/red-rover/uat/five-patient-test/identifiers/mrn/pool/8454',
          value: '000456',
        },
      ],
    });
    const originalSearch = medplum.search.bind(medplum);
    const search = vi.spyOn(medplum, 'search').mockImplementation((resourceType, query, options) => {
      if (
        !['AllergyIntolerance', 'Condition', 'MedicationRequest', 'Observation', 'PractitionerRole'].includes(
          resourceType
        )
      ) {
        throw new Error(`Forbidden summary domain: ${resourceType}`);
      }
      return originalSearch(resourceType, query, options);
    });
    render(
      <MemoryRouter initialEntries={[`/Patient/${patient.id}`]}>
        <MedplumProvider medplum={medplum}>
          <MantineProvider>
            <Routes>
              <Route path="/Patient/:patientId/*" element={<PatientPage />} />
            </Routes>
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );
    expect(await screen.findByText('Allergies')).toBeInTheDocument();
    expect(await screen.findByText('Problems')).toBeInTheDocument();
    expect(await screen.findByText('MRN: 000456')).toBeInTheDocument();
    expect(search.mock.calls.map(([resourceType]) => resourceType)).toEqual(
      expect.arrayContaining(['AllergyIntolerance', 'Condition', 'MedicationRequest', 'Observation'])
    );
    const summaryCalls = search.mock.calls.filter(([resourceType]) => resourceType !== 'PractitionerRole');
    expect(
      summaryCalls.every(([resourceType]) =>
        ['AllergyIntolerance', 'Condition', 'MedicationRequest', 'Observation'].includes(resourceType)
      )
    ).toBe(true);
    expect(screen.queryByText(/Error loading patient summary/)).not.toBeInTheDocument();
    expect(screen.queryByText('Insurance')).not.toBeInTheDocument();
    expect(screen.queryByText('Medications')).not.toBeInTheDocument();
    expect(screen.queryByText('Labs')).not.toBeInTheDocument();
  });

  test('shows separate imported medication orders with read-only details and stop dates', async () => {
    const namespace = 'https://hiivehealth.com/fhir/red-rover/uat/five-patient-test';
    const project = '8588313a-c8c6-4e07-8c1d-e684ed25e522';
    const patient = await medplum.createResource({ resourceType: 'Patient', meta: { project } });
    const sourceIds = ['9041332619', '9041332621', '9041332623', '9041332625', '9041332627'];
    const names = [
      'lisinopril 10 mg',
      'atorvastatin 20 mg',
      'atorvastatin 20 mg',
      'metformin 500 mg',
      'loratadine 10 mg',
    ];
    for (const [index, identifier] of sourceIds.entries()) {
      await medplum.createResource({
        resourceType: 'MedicationRequest',
        status: 'unknown',
        intent: 'order',
        meta: { project, tag: [{ system: `${namespace}/mapping`, code: 'owner-provisional-medication-orders-v1' }] },
        subject: { reference: `Patient/${patient.id}` },
        identifier: [{ system: `${namespace}/medication-orders`, value: identifier }],
        medicationCodeableConcept: { text: names[index] },
        extension: [
          { url: `${namespace}/medication-source-status`, valueCoding: { code: '1177', display: 'Ordered' } },
        ],
        dosageInstruction: [
          {
            text: 'Synthetic source instruction',
            timing: {
              repeat: {
                boundsPeriod: {
                  start: '2026-10-04T20:39:00.000+00:00',
                  ...(index === 4 ? { end: '2026-10-11T20:39:00.000+00:00' } : {}),
                },
              },
            },
          },
        ],
      });
    }
    const update = vi.spyOn(medplum, 'updateResource');
    const create = vi.spyOn(medplum, 'createResource');
    render(
      <MemoryRouter>
        <MedplumProvider medplum={medplum}>
          <MantineProvider>
            <PatientSummary patient={patient} sections={[redRoverMedicationOrdersSection]} />
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );
    expect(await screen.findByText('lisinopril 10 mg')).toBeInTheDocument();
    expect(screen.getAllByText('atorvastatin 20 mg')).toHaveLength(2);
    expect(screen.getByText(/Order 9041332621;/)).toBeInTheDocument();
    expect(screen.getByText(/Order 9041332623;/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('loratadine 10 mg'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Current use: Not established')).toBeInTheDocument();
    expect(within(dialog).getByText('Stop: 2026-10-11T20:39:00.000+00:00')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /save|edit|prescribe/i })).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test('keeps three source complaints separate with read-only details and excludes unrelated observations', async () => {
    const namespace = 'https://hiivehealth.com/fhir/red-rover/uat/five-patient-test';
    const project = '8588313a-c8c6-4e07-8c1d-e684ed25e522';
    const patient = await medplum.createResource({ resourceType: 'Patient', meta: { project } });
    for (const [index, identifier] of [
      '10330817993',
      '10330817995',
      '10330817997',
      'other-source',
      '10330817993',
      '10330817993',
    ].entries()) {
      await medplum.createResource({
        resourceType: 'Observation',
        status: 'unknown',
        code: { text: 'Chief Complaint' },
        meta: {
          project: index === 4 ? 'other-project' : project,
          tag: [
            {
              system: `${namespace}/mapping`,
              code: index === 5 ? 'other-mapping' : 'owner-provisional-chief-complaints-v1',
            },
          ],
        },
        subject: { reference: `Patient/${patient.id}` },
        identifier: [{ system: `${namespace}/observations`, value: identifier }],
        valueString: index < 3 ? ' October 28 synthetic text ' : 'Excluded text',
        effectiveDateTime: `2026-10-04T20:50:0${index}.000+00:00`,
        extension: [
          { url: `${namespace}/observation-source-status`, valueCoding: { code: '654', display: 'Auth (Verified)' } },
          { url: `${namespace}/observation-source-created-updated`, valueDateTime: '2026-10-04T21:00:00.000+00:00' },
          { url: `${namespace}/observation-source-performed-by-id`, valueString: '123' },
        ],
      });
    }
    const create = vi.spyOn(medplum, 'createResource');
    const update = vi.spyOn(medplum, 'updateResource');
    render(
      <MemoryRouter>
        <MedplumProvider medplum={medplum}>
          <MantineProvider>
            <PatientSummary patient={patient} sections={[redRoverChiefComplaintsSection]} />
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );
    expect(await screen.findAllByText('October 28 synthetic text')).toHaveLength(3);
    expect(screen.queryByText('Excluded text')).not.toBeInTheDocument();
    expect(screen.getByText(/Observation 10330817993;/)).toBeInTheDocument();
    expect(screen.getByText(/Observation 10330817995;/)).toBeInTheDocument();
    expect(screen.getByText(/Observation 10330817997;/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByText('October 28 synthetic text')[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Source status: Auth (Verified)')).toBeInTheDocument();
    expect(within(dialog).getByText('Clinical signature: Not supplied')).toBeInTheDocument();
    expect(within(dialog).getByText('Source created/updated: 2026-10-04T21:00:00.000+00:00')).toBeInTheDocument();
    expect(within(dialog).getByText('October 28 synthetic text').textContent).toBe(' October 28 synthetic text ');
    expect(within(dialog).queryByRole('button', { name: /save|edit|sign/i })).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test('shows loader when patient is loading', async () => {
    // Use a non-existent patient ID to simulate loading
    setup('/Patient/non-existent-patient');

    await waitFor(() => {
      const loader = document.querySelector('.mantine-Loader-root');
      expect(loader).toBeInTheDocument();
    });
  });

  test('renders patient page when patient is loaded', async () => {
    setup(`/Patient/${HomerSimpson.id}`);

    await waitFor(() => {
      expect(screen.getByText('Timeline')).toBeInTheDocument();
    });
  });

  test('renders all tabs in navigation', async () => {
    setup(`/Patient/${HomerSimpson.id}`);

    await waitFor(() => {
      expect(screen.getByText('Timeline')).toBeInTheDocument();
    });

    // Check for some key tabs
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Visits')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Meds')).toBeInTheDocument();
  });

  test('sets initial tab from URL path', async () => {
    setup(`/Patient/${HomerSimpson.id}/edit`);

    await waitFor(() => {
      const editTab = screen.getByText('Edit');
      expect(editTab).toBeInTheDocument();
      expect(editTab.closest('[role="tab"]')).toHaveAttribute('aria-selected', 'true');
    });
  });

  test('handles tab change when clicking on tab', async () => {
    const user = userEvent.setup();
    setup(`/Patient/${HomerSimpson.id}`);

    await waitFor(() => {
      expect(screen.getByText('Timeline')).toBeInTheDocument();
    });

    const editTab = screen.getByText('Edit');
    await user.click(editTab);

    await waitFor(() => {
      const editTab = screen.getByText('Edit');
      expect(editTab).toBeInTheDocument();
      expect(editTab.closest('[role="tab"]')).toHaveAttribute('aria-selected', 'true');
    });
  });

  test('does not show tabs when patient is loading', async () => {
    setup('/Patient/non-existent-patient');

    await waitFor(() => {
      const loader = document.querySelector('.mantine-Loader-root');
      expect(loader).toBeInTheDocument();
    });

    expect(screen.queryByText('Timeline')).not.toBeInTheDocument();
  });

  test('defaults to timeline tab when URL does not match any tab', async () => {
    setup(`/Patient/${HomerSimpson.id}/unknown-path`);

    await waitFor(() => {
      const timelineTab = screen.getByText('Timeline');
      expect(timelineTab).toBeInTheDocument();
      expect(timelineTab.closest('[role="tab"]')).toHaveAttribute('aria-selected', 'true');
    });
  });

  test('renders homer summary information in sidebar', async () => {
    setup(`/Patient/${HomerSimpson.id}`);

    if (!HomerSimpson.birthDate) {
      throw new Error('Test data in unexpected state - homer has no birthdate');
    }

    const age = calculateAgeString(HomerSimpson.birthDate);

    expect(await screen.findByText('Male')).toBeInTheDocument();
    expect(await screen.findByText(`1956-05-12 (${age})`)).toBeInTheDocument();
  });

  test('replaces the default demographics section for Army patients', async () => {
    const patient = await medplum.createResource({
      resourceType: 'Patient',
      meta: { profile: ['https://ehr.hiivehealth.net/fhir/StructureDefinition/hiive-army-demographics-patient'] },
      identifier: [{ system: 'https://ehr.hiivehealth.net/fhir/identifier/dod-id', value: '1234567890' }],
    });
    setup(`/Patient/${patient.id}`);

    expect(await screen.findByText('1234567890')).toBeInTheDocument();
    expect(screen.getByText('DoD ID:')).toBeInTheDocument();
    expect(screen.queryByText('Demographics')).not.toBeInTheDocument();
  });

  test('shows diagnosis category and preserves source fields when saving the native-style editor', async () => {
    const namespace = 'https://hiivehealth.com/fhir/red-rover/uat/five-patient-test';
    const condition = await medplum.createResource({
      resourceType: 'Condition',
      meta: { project: '8588313a-c8c6-4e07-8c1d-e684ed25e522' },
      subject: { reference: `Patient/${HomerSimpson.id}` },
      encounter: { reference: 'Encounter/test-visit', display: 'Test visit October 5' },
      code: { text: 'Imported hyperlipidemia' },
      identifier: [{ system: `${namespace}/diagnoses`, value: 'synthetic-diagnosis' }],
      onsetDateTime: '2026-10-05T19:00:00.000+00:00',
      category: [
        {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'encounter-diagnosis' }],
        },
      ],
      extension: [
        { url: `${namespace}/source-date/diagnosisDateTime`, valueDateTime: '2026-10-05T19:00:00.000+00:00' },
        { url: `${namespace}/source-date/createdUpdatedDateTime`, valueDateTime: '2026-10-04T20:37:16.000+00:00' },
      ],
    });
    const create = vi.spyOn(medplum, 'createResource');
    const update = vi.spyOn(medplum, 'updateResource');
    const user = userEvent.setup();
    setup(`/Patient/${HomerSimpson.id}`);
    expect(await screen.findByText('Problems and Diagnoses')).toBeInTheDocument();
    expect(await screen.findByText(/Visit: Test visit October 5/)).toBeInTheDocument();
    await user.click(await screen.findByText('Imported hyperlipidemia'));
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit Diagnosis' }));
    expect(dialog.getByLabelText('Category')).toHaveValue('Encounter Diagnosis');
    expect(dialog.getByLabelText('Category')).toHaveAttribute('readonly');
    expect(dialog.getByLabelText('Problem')).toBeInTheDocument();
    expect(dialog.getByLabelText('Status')).toBeInTheDocument();
    const diagnosisDate = dialog.getByLabelText(/Dx Date/) as HTMLInputElement;
    expect(new Date(diagnosisDate.value).toISOString()).toBe('2026-10-05T19:00:00.000Z');
    expect(dialog.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Condition details' })).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(condition);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('opening the original editor leaves imported year-only onset unchanged', async () => {
    const condition = await medplum.createResource({
      resourceType: 'Condition',
      meta: { project: '8588313a-c8c6-4e07-8c1d-e684ed25e522' },
      subject: { reference: `Patient/${HomerSimpson.id}` },
      code: { text: 'Imported emphysema' },
      identifier: [
        { system: 'https://hiivehealth.com/fhir/red-rover/uat/five-patient-test/problems', value: 'synthetic-problem' },
      ],
      onsetDateTime: '2024',
      category: [
        { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'problem-list-item' }] },
      ],
    });
    const update = vi.spyOn(medplum, 'updateResource');
    setup(`/Patient/${HomerSimpson.id}`);
    await userEvent.setup().click(await screen.findByText('Imported emphysema'));
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit Problem' }));
    expect(dialog.getByLabelText('Category')).toHaveValue('Problem');
    expect(dialog.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    expect((await medplum.readResource('Condition', condition.id as string)).onsetDateTime).toBe('2024');
    await userEvent.setup().click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(condition);
  });

  test('keeps the editor open when the server denies a condition update', async () => {
    await medplum.createResource({
      resourceType: 'Condition',
      meta: { project: '8588313a-c8c6-4e07-8c1d-e684ed25e522' },
      subject: { reference: `Patient/${HomerSimpson.id}` },
      code: { text: 'Read-only condition' },
      identifier: [
        { system: 'https://hiivehealth.com/fhir/red-rover/uat/five-patient-test/problems', value: 'read-only' },
      ],
      category: [
        { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'problem-list-item' }] },
      ],
      onsetDateTime: '2024',
    });
    const update = vi.spyOn(medplum, 'updateResource').mockRejectedValue(new Error('Forbidden'));
    setup(`/Patient/${HomerSimpson.id}`);
    await userEvent.setup().click(await screen.findByText('Read-only condition'));
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit Problem' }));
    await userEvent.setup().click(dialog.getByRole('button', { name: 'Save' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Forbidden');
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'Edit Problem' })).toBeInTheDocument();
  });

  test('matches allergy header styling and supports both title and chevron toggles', async () => {
    await medplum.createResource({
      resourceType: 'Condition',
      meta: { project: '8588313a-c8c6-4e07-8c1d-e684ed25e522' },
      subject: { reference: `Patient/${HomerSimpson.id}` },
      code: { text: 'Collapsible diagnosis' },
      identifier: [
        { system: 'https://hiivehealth.com/fhir/red-rover/uat/five-patient-test/diagnoses', value: 'collapse-test' },
      ],
      category: [
        {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'encounter-diagnosis' }],
        },
      ],
      onsetDateTime: '2026-10-05T19:00:00Z',
    });
    const user = userEvent.setup();
    setup(`/Patient/${HomerSimpson.id}`);
    const title = await screen.findByText('Problems and Diagnoses');
    expect(title.className).toBe(screen.getByText('Allergies').className);
    expect(title.style.fontWeight).toBe(screen.getByText('Allergies').style.fontWeight);
    await user.click(title);
    expect(await screen.findByRole('button', { name: 'Show problems and diagnoses' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Collapsible diagnosis')).not.toBeVisible());
    await user.click(screen.getByRole('button', { name: 'Show problems and diagnoses' }));
    expect(await screen.findByRole('button', { name: 'Hide problems and diagnoses' })).toBeInTheDocument();
    expect(await screen.findByText('Collapsible diagnosis')).toBeVisible();
    await user.click(screen.getByText('Collapsible diagnosis'));
    expect(await screen.findByRole('dialog', { name: 'Edit Diagnosis' })).toBeInTheDocument();
  });

  test('groups only the approved matching source problems and edits the selected original entry', async () => {
    const originals: Condition[] = [];
    for (const sourceId of ['185305597', '185305603', '185305609', 'unrelated-source']) {
      originals.push(
        await medplum.createResource({
          resourceType: 'Condition',
          meta: { project: '8588313a-c8c6-4e07-8c1d-e684ed25e522' },
          subject: { reference: `Patient/${HomerSimpson.id}` },
          code: { text: 'Grouped emphysema', coding: [{ system: 'urn:test:condition', code: 'emphysema' }] },
          identifier: [
            { system: 'https://hiivehealth.com/fhir/red-rover/uat/five-patient-test/problems', value: sourceId },
          ],
          category: [
            {
              coding: [
                { system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'problem-list-item' },
              ],
            },
          ],
          clinicalStatus: {
            coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
          },
          verificationStatus: {
            coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed' }],
          },
          onsetDateTime: '2024',
        })
      );
    }
    const create = vi.spyOn(medplum, 'createResource');
    const update = vi.spyOn(medplum, 'updateResource');
    const remove = vi.spyOn(medplum, 'deleteResource');
    const user = userEvent.setup();
    setup(`/Patient/${HomerSimpson.id}`);
    const summary = await screen.findByText(/Show 3 source entries/);
    expect(await screen.findAllByText('Grouped emphysema')).toHaveLength(2);
    expect(summary).toHaveTextContent('Onset: 2024 (year only)');
    expect(screen.queryByText('Source entry 185305603')).not.toBeInTheDocument();
    await user.click(summary);
    expect(await screen.findByText('Source entry 185305597')).toBeVisible();
    expect(screen.getByText('Source entry 185305609')).toBeVisible();
    expect(update).not.toHaveBeenCalled();
    await user.click(screen.getByText('Source entry 185305603'));
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit Problem' }));
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(originals[1]));
    expect(create).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  test('does not group approved source entries with conflicting clinical status', async () => {
    for (const [index, sourceId] of ['185305597', '185305603', '185305609'].entries()) {
      await medplum.createResource({
        resourceType: 'Condition',
        meta: { project: '8588313a-c8c6-4e07-8c1d-e684ed25e522' },
        subject: { reference: `Patient/${HomerSimpson.id}` },
        code: { text: 'Conflicting emphysema' },
        identifier: [
          { system: 'https://hiivehealth.com/fhir/red-rover/uat/five-patient-test/problems', value: sourceId },
        ],
        category: [
          {
            coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'problem-list-item' }],
          },
        ],
        clinicalStatus: { coding: [{ code: index === 2 ? 'resolved' : 'active' }] },
        onsetDateTime: '2024',
      });
    }
    setup(`/Patient/${HomerSimpson.id}`);
    expect(await screen.findByText(/Show 2 source entries/)).toBeInTheDocument();
    expect(screen.getAllByText('Conflicting emphysema')).toHaveLength(2);
    expect(screen.queryByText(/Show 3 source entries/)).not.toBeInTheDocument();
  });

  test('keeps the normal problems view outside the Red Rover project', async () => {
    await medplum.createResource({
      resourceType: 'Condition',
      meta: { project: 'another-project' },
      subject: { reference: `Patient/${HomerSimpson.id}` },
      code: { text: 'Unrelated condition' },
      identifier: [
        { system: 'https://hiivehealth.com/fhir/red-rover/uat/five-patient-test/diagnoses', value: 'unrelated' },
      ],
    });
    setup(`/Patient/${HomerSimpson.id}`);
    expect(await screen.findByText('Unrelated condition')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Unrelated condition' })).not.toBeInTheDocument();
    expect(screen.queryByText('Diagnoses and problems')).not.toBeInTheDocument();
  });

  test('handles empty pathname correctly', async () => {
    setup(`/Patient/${HomerSimpson.id}/`);

    await waitFor(() => {
      const timelineTab = screen.getByText('Timeline');
      expect(timelineTab).toBeInTheDocument();
      expect(timelineTab.closest('[role="tab"]')).toHaveAttribute('aria-selected', 'true');
    });
  });

  test('highlights the Edit tab in a case-insensitive way even when /EDIT is used', async () => {
    setup(`/Patient/${HomerSimpson.id}/EDIT`);

    await waitFor(() => {
      const editTab = screen.getByText('Edit');
      expect(editTab).toBeInTheDocument();
      expect(editTab.closest('[role="tab"]')).toHaveAttribute('aria-selected', 'true');
    });
  });
});
