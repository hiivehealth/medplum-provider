// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import type { WithId } from '@medplum/core';
import { createReference, ReadablePromise } from '@medplum/core';
import type {
  Encounter,
  Observation,
  Patient,
  Practitioner,
  QuestionnaireResponse,
  Resource,
  Task,
} from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { RedRoverLocalVisit } from '../../components/encounter/RedRoverLocalVisit';
import { RED_ROVER_AUTHORING_TEMPLATES as templates } from '../../data/red-rover-full-authoring-templates';
import { buildRedRoverTestEncounter } from '../../utils/encounter';
import { buildRedRoverLocalVitals } from '../../utils/vitals';
import { EncountersPage } from './EncountersPage';

const QUERY = '?_count=20&_fields=_lastUpdated,period,status,serviceType&_sort=-_lastUpdated';

describe('Bounded local SOAP authoring', () => {
  const project = '8588313a-c8c6-4e07-8c1d-e684ed25e522';
  const localBase = 'https://hiivehealth.com/fhir/red-rover/local-authoring';
  let client: MockClient;
  let records: Map<string, Resource>;
  let write: ReturnType<typeof vi.spyOn>;
  let transact: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sessionStorage.clear();
    client = new MockClient();
    const clinician: Practitioner = { resourceType: 'Practitioner', id: 'local-clinician', meta: { project } };
    vi.spyOn(client, 'getProfile').mockReturnValue(clinician);
    const visit: Encounter = {
      ...buildRedRoverTestEncounter(
        {
          resourceType: 'Patient',
          id: '56e610e8-2f17-43d1-b113-9d5f51ec1036',
          meta: { project },
          identifier: [
            { system: 'https://hiivehealth.com/fhir/red-rover/uat/five-patient-test/patient', value: '19128435' },
          ],
        },
        clinician,
        '2026-11-06T16:00:00.000Z'
      ),
      id: 'local-visit',
      extension: [
        {
          url: `${localBase}/sections`,
          extension: templates.map((_, index) => ({
            url: String(index),
            valueReference: { reference: `QuestionnaireResponse/draft-${index}` },
          })),
        },
      ],
    };
    const responses: QuestionnaireResponse[] = templates.map((template, index) => ({
      resourceType: 'QuestionnaireResponse',
      id: `draft-${index}`,
      meta: { project, versionId: '1' },
      status: 'in-progress',
      identifier: { system: `${localBase}/draft`, value: `local-visit:${index}` },
      questionnaire: `${template.url}${template.version ? `|${template.version}` : ''}`,
      subject: visit.subject,
      encounter: { reference: 'Encounter/local-visit' },
      author: { reference: 'Practitioner/local-clinician' },
      source: { reference: 'Practitioner/local-clinician' },
    }));
    records = new Map<string, Resource>(
      [visit, ...responses].map((resource) => [`${resource.resourceType}/${resource.id}`, resource])
    );
    vi.spyOn(client, 'readResource').mockImplementation(
      (type, id) =>
        new ReadablePromise(
          Promise.resolve().then(() => {
            const record = records.get(`${type}/${id}`);
            if (!record) throw new Error('Unexpected resource read');
            return structuredClone(record) as never;
          })
        )
    );
    write = vi.spyOn(client, 'updateResource').mockImplementation(async (resource) => {
      const result = {
        ...resource,
        meta: { ...resource.meta, versionId: String(Number(resource.meta?.versionId) + 1) },
      };
      records.set(`${resource.resourceType}/${resource.id}`, result);
      return structuredClone(result) as never;
    });
    transact = vi.spyOn(client, 'executeBatch').mockImplementation(async (bundle, options) => {
      expect(options?.maxRetries).toBe(0);
      expect(bundle.type).toBe('transaction');
      return {
        resourceType: 'Bundle',
        type: 'transaction-response',
        entry: bundle.entry?.map((entry, index) => {
          expect(entry.request?.method).toBe('POST');
          expect(entry.request?.url).toBe('Observation');
          expect(entry.request?.ifNoneExist).toContain('identifier=');
          const resource = {
            ...entry.resource,
            id: `recorded-vital-${index}`,
            meta: { project, versionId: '1' },
          } as Observation;
          records.set(`Observation/${resource.id}`, resource);
          return { response: { status: '201 Created', location: `Observation/${resource.id}/_history/1` } };
        }),
      };
    });
  });

  function localChart(): ReturnType<typeof render> {
    return render(
      <MemoryRouter>
        <MedplumProvider medplum={client}>
          <MantineProvider env="test">
            <RedRoverLocalVisit encounterId="local-visit" />
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );
  }

  test('builds only preliminary encounter-linked scalar vitals with explicit time and units', () => {
    const visit = records.get('Encounter/local-visit') as Encounter;
    const patient: Patient = {
      resourceType: 'Patient',
      id: visit.subject!.reference!.split('/')[1],
      meta: { project },
    };
    const response = records.get('QuestionnaireResponse/draft-1') as QuestionnaireResponse;
    response.item = [{ linkId: 'vitals', item: [{ linkId: 'heart-rate', answer: [{ valueInteger: 0 }] }] }];
    const measured = visit.period!.start!;
    const vitals = buildRedRoverLocalVitals(patient, visit, client.getProfile() as Practitioner, response, measured);
    expect(vitals).toHaveLength(1);
    expect(vitals[0]).toMatchObject({
      status: 'preliminary',
      subject: visit.subject,
      encounter: { reference: 'Encounter/local-visit' },
      performer: [{ reference: 'Practitioner/local-clinician' }],
      effectiveDateTime: measured,
      valueQuantity: { value: 0, code: '/min', system: 'http://unitsofmeasure.org' },
    });
    expect(() => buildRedRoverLocalVitals(patient, visit, client.getProfile() as Practitioner, response, '')).toThrow(
      'measurement time'
    );
    expect(() =>
      buildRedRoverLocalVitals(
        patient,
        { ...visit, status: 'finished' },
        client.getProfile() as Practitioner,
        response,
        measured
      )
    ).toThrow('approved active');
    expect(() =>
      buildRedRoverLocalVitals(
        patient,
        visit,
        { resourceType: 'Practitioner', id: 'foreign', meta: { project } },
        response,
        measured
      )
    ).toThrow('approved active');
    response.item[0].item!.push({ linkId: 'heart-rate', answer: [{ valueDecimal: 72 }] });
    expect(() =>
      buildRedRoverLocalVitals(patient, visit, client.getProfile() as Practitioner, response, measured)
    ).toThrow('duplicate');
  });

  test('loads exact draft IDs without writes, signing, routing or sending', async () => {
    localChart();
    expect(await screen.findByRole('heading', { name: 'Subjective' })).toBeInTheDocument();
    for (const name of ['Review of Systems', 'Physical Examination', 'Clinical Decision Support', 'Assessment', 'Plan'])
      expect(screen.getByRole('heading', { name, level: 3 })).toBeInTheDocument();
    expect(screen.getByText('Red Rover delivery disabled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign|send|complete|route/i })).not.toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
  });

  test('routes only the marked local encounter to the SOAP draft editor', async () => {
    render(
      <MemoryRouter initialEntries={['/Patient/56e610e8-2f17-43d1-b113-9d5f51ec1036/Encounter/local-visit']}>
        <MedplumProvider medplum={client}>
          <MantineProvider>
            <Routes>
              <Route path="/Patient/:patientId/Encounter/:encounterId" element={<EncountersPage />} />
            </Routes>
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );
    expect(await screen.findByRole('heading', { name: 'Subjective' })).toBeInTheDocument();
    expect(screen.queryByText('Note & Tasks')).not.toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
  });

  test('saves only the selected draft with version matching and independent readback', async () => {
    const user = userEvent.setup();
    localChart();
    await user.type(await screen.findByLabelText('Plan Free Text'), 'Synthetic clinician-entered plan');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Plan draft saved');
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'draft-3',
        status: 'in-progress',
        subject: { reference: 'Patient/56e610e8-2f17-43d1-b113-9d5f51ec1036' },
        encounter: { reference: 'Encounter/local-visit' },
        author: { reference: 'Practitioner/local-clinician' },
      }),
      expect.objectContaining({ maxRetries: 0, headers: { 'If-Match': 'W/"1"' } })
    );
  });

  test('refuses drafts belonging to another patient before rendering editable fields', async () => {
    const draft = records.get('QuestionnaireResponse/draft-3') as QuestionnaireResponse;
    draft.subject = { reference: 'Patient/foreign' };
    localChart();
    expect(await screen.findByRole('alert')).toHaveTextContent('patient/visit linkage');
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
  });

  test('does not retry an uncertain save', async () => {
    const user = userEvent.setup();
    write.mockRejectedValue(new Error('Synthetic lost response'));
    localChart();
    await screen.findByRole('heading', { name: 'Subjective' });
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save not confirmed');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(write).toHaveBeenCalledTimes(1);
  });

  test('preserves zero vital values and requires an explicit measurement time', async () => {
    const user = userEvent.setup();
    const draft = records.get('QuestionnaireResponse/draft-1') as QuestionnaireResponse;
    draft.item = [{ linkId: 'vitals', item: [{ linkId: 'heart-rate', answer: [{ valueInteger: 0 }] }] }];
    localChart();
    await user.click(await screen.findByRole('button', { name: 'Add vitals' }));
    expect(await screen.findByRole('textbox', { name: 'HR' })).toHaveValue('0');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('measurement time is required');
    expect(write).not.toHaveBeenCalled();
    const measured = new Date('2026-11-06T16:01:00.000Z');
    const localTime = new Date(measured.getTime() - measured.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await user.click(screen.getByRole('button', { name: 'Add vitals' }));
    fireEvent.change(await screen.findByLabelText('Vitals measured at'), { target: { value: localTime } });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Objective draft saved');
    const saved = records.get('QuestionnaireResponse/draft-1') as QuestionnaireResponse;
    expect(
      saved.item?.find((item) => item.linkId === 'vitals')?.item?.find((item) => item.linkId === 'heart-rate')
        ?.answer?.[0]?.valueInteger
    ).toBe(0);
    expect(saved.extension).toContainEqual({
      url: `${localBase}/vitals-measured-at`,
      valueDateTime: measured.toISOString(),
    });
  });

  test('preserves false answers in an incomplete unsigned draft', async () => {
    const user = userEvent.setup();
    const draft = records.get('QuestionnaireResponse/draft-0') as QuestionnaireResponse;
    draft.item = [{ linkId: 'complaint', item: [{ linkId: 'complaint-is-chief', answer: [{ valueBoolean: false }] }] }];
    localChart();
    await screen.findByRole('heading', { name: 'Subjective' });
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Subjective draft saved');
    const saved = records.get('QuestionnaireResponse/draft-0') as QuestionnaireResponse;
    expect(
      saved.item
        ?.find((item) => item.linkId === 'complaint')
        ?.item?.find((item) => item.linkId === 'complaint-is-chief')?.answer?.[0]?.valueBoolean
    ).toBe(false);
    expect(saved.status).toBe('in-progress');
  });

  test('refuses a stale draft without dispatching a write', async () => {
    const user = userEvent.setup();
    localChart();
    await screen.findByRole('heading', { name: 'Subjective' });
    const draft = records.get('QuestionnaireResponse/draft-0') as QuestionnaireResponse;
    draft.meta!.versionId = 'changed-elsewhere';
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('changed elsewhere');
    expect(write).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  });

  test('selects and saves the original ROS template without creating or deleting responses', async () => {
    const user = userEvent.setup();
    const remove = vi.spyOn(client, 'deleteResource');
    const create = vi.spyOn(client, 'createResource');
    localChart();
    await user.click(await screen.findByRole('textbox', { name: 'ROS template' }));
    await user.click(await screen.findByRole('option', { name: 'ROS - Brief Normal' }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('status')).toHaveTextContent('ROS - Brief Normal draft saved');
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'draft-5',
        questionnaire: `${templates[5].url}${templates[5].version ? `|${templates[5].version}` : ''}`,
        status: 'in-progress',
      }),
      expect.anything()
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('textbox', { name: 'ROS template' }));
    await user.click(await screen.findByRole('option', { name: 'ROS - Extended Normal' }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(3));
    expect((records.get('QuestionnaireResponse/draft-5') as QuestionnaireResponse).item).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(transact).not.toHaveBeenCalled();
  });

  test('searches A-01 and saves incomplete screening without completing or routing', async () => {
    const user = userEvent.setup();
    localChart();
    await user.type(await screen.findByRole('textbox', { name: 'Decision flow' }), 'A-01');
    await user.click(await screen.findByRole('option', { name: 'A-01 Sore Throat / Hoarseness' }));
    await user.click(screen.getAllByRole('radio', { name: 'No' })[0]);
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('status')).toHaveTextContent('ADTMC A-01 draft saved');
    expect((records.get('QuestionnaireResponse/draft-4') as QuestionnaireResponse).status).toBe('in-progress');
    expect(write).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /complete|route|sign|send/i })).not.toBeInTheDocument();
    expect(transact).not.toHaveBeenCalled();
  });

  async function enterVital(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(await screen.findByRole('button', { name: 'Add vitals' }));
    await user.type(await screen.findByRole('textbox', { name: 'HR' }), '72');
    const measured = new Date('2026-11-06T16:01:00.000Z');
    fireEvent.change(screen.getByLabelText('Vitals measured at'), {
      target: { value: new Date(measured.getTime() - measured.getTimezoneOffset() * 60000).toISOString().slice(0, 16) },
    });
  }

  test('records modal vitals only after a versioned draft save and exact independent readback', async () => {
    const user = userEvent.setup();
    localChart();
    await enterVital(user);
    await user.click(screen.getByRole('button', { name: 'Record vitals' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Vitals recorded; SOAP remains an unsigned draft');
    expect(transact).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(records.get('Observation/recorded-vital-0')).toMatchObject({
      status: 'preliminary',
      valueQuantity: { value: 72, code: '/min' },
      encounter: { reference: 'Encounter/local-visit' },
    });
    expect(screen.getByText('Heart rate')).toBeInTheDocument();
    expect(sessionStorage.getItem('hiive.local-vitals.pending:local-visit')).toBeNull();
  });

  test('blocks an unconfirmed vitals transaction across reload without retrying', async () => {
    const user = userEvent.setup();
    transact.mockRejectedValue(new Error('Synthetic unconfirmed transaction'));
    const view = localChart();
    await enterVital(user);
    await user.click(screen.getByRole('button', { name: 'Record vitals' }));
    await waitFor(() =>
      expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('No retry is enabled'))).toBe(
        true
      )
    );
    expect(transact).toHaveBeenCalledTimes(1);
    view.unmount();
    localChart();
    expect(await screen.findByRole('alert')).toHaveTextContent('earlier vitals recording is unconfirmed');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(transact).toHaveBeenCalledTimes(1);
  });
});

describe('EncountersPage', () => {
  let medplum: MockClient;
  let patient: WithId<Patient>;
  let practitioner: WithId<Practitioner>;

  beforeEach(async () => {
    medplum = new MockClient();
    patient = await medplum.createResource({
      resourceType: 'Patient',
      name: [{ given: ['Jane'], family: 'Doe' }],
    });
    practitioner = await medplum.createResource({
      resourceType: 'Practitioner',
      name: [{ given: ['Gregory'], family: 'House' }],
    });
    vi.clearAllMocks();
    notifications.clean();
    notifications.cleanQueue();
  });

  async function createVisit(subject: WithId<Patient>, props?: Partial<Encounter>): Promise<WithId<Encounter>> {
    return medplum.createResource<Encounter>({
      resourceType: 'Encounter',
      status: 'in-progress',
      class: { code: 'AMB', display: 'Ambulatory' },
      type: [{ text: 'Office Visit' }],
      period: { start: '2026-08-10T09:00:00Z' },
      subject: createReference(subject),
      participant: [{ individual: createReference(practitioner) }],
      ...props,
    });
  }

  function renderAt(path: string): ReturnType<typeof render> {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <MedplumProvider medplum={medplum}>
          <MantineProvider>
            <Notifications />
            <Routes>
              <Route path="/Patient/:patientId/Encounter" element={<EncountersPage />} />
              <Route path="/Patient/:patientId/Encounter/:encounterId/Task?/:taskId?" element={<EncountersPage />} />
            </Routes>
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );
  }

  function setup(encounterId?: string): ReturnType<typeof render> {
    const path = encounterId
      ? `/Patient/${patient.id}/Encounter/${encounterId}${QUERY}`
      : `/Patient/${patient.id}/Encounter${QUERY}`;
    return renderAt(path);
  }

  test('Lists the patient encounters with type, status, and practitioner', async () => {
    await createVisit(patient);
    setup();

    expect(await screen.findByText('Office Visit')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(await screen.findByText('Gregory House')).toBeInTheDocument();
  });

  test('requests patient linkage and local identifiers needed to select the correct chart', async () => {
    await createVisit(patient);
    const search = vi.spyOn(medplum, 'search');
    setup();
    expect(await screen.findByText('Office Visit')).toBeInTheDocument();
    const query = search.mock.calls.find((call) => call[0] === 'Encounter')?.[1];
    const fields =
      typeof query === 'string'
        ? new URLSearchParams(query.replace(/^\?/, '')).get('_fields')
        : (query as Record<string, string>)._fields;
    expect(fields?.split(',')).toEqual(expect.arrayContaining(['subject', 'identifier']));
  });

  test('Excludes encounters of other patients', async () => {
    const other: WithId<Patient> = await medplum.createResource({
      resourceType: 'Patient',
      name: [{ given: ['John'], family: 'Smith' }],
    });
    await createVisit(patient, { type: [{ text: 'Office Visit' }] });
    await createVisit(other, { type: [{ text: 'Telehealth Visit' }] });
    setup();

    expect(await screen.findByText('Office Visit')).toBeInTheDocument();
    expect(screen.queryByText('Telehealth Visit')).not.toBeInTheDocument();
  });

  test('Shows the encounter chart as the detail pane for the selected encounter', async () => {
    const encounter = await createVisit(patient);
    setup(encounter.id);

    expect(await screen.findByText('Note & Tasks')).toBeInTheDocument();
    expect(screen.getByText('Details & Billing')).toBeInTheDocument();
  });

  test('Auto-selects the first encounter and opens its chart', async () => {
    await createVisit(patient);
    setup();

    expect(await screen.findByText('Note & Tasks')).toBeInTheDocument();
  });

  test('Shows the empty state when the patient has no encounters', async () => {
    setup();

    expect(await screen.findByText('No visits.')).toBeInTheDocument();
  });

  test('Keeps the task modal open through the search-normalization redirect', async () => {
    const encounter = await createVisit(patient);
    const task = await medplum.createResource<Task>({
      resourceType: 'Task',
      status: 'in-progress',
      intent: 'order',
      code: { text: 'Review Labs' },
      for: createReference(patient),
      encounter: createReference(encounter),
    });
    // No query string, mimicking a relative navigation from the task panel.
    renderAt(`/Patient/${patient.id}/Encounter/${encounter.id}/Task/${task.id}`);

    // The modal title renders the task code as a heading.
    expect(await screen.findByRole('heading', { name: 'Review Labs' })).toBeInTheDocument();
    // Wait for the list to load after the redirect pins the normalized query.
    // 'Office Visit' appears in both the list row and the chart header.
    expect((await screen.findAllByText('Office Visit')).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Review Labs' })).toBeInTheDocument();
  });

  test('Reflects a task saved in the modal on the chart task list', async () => {
    const user = userEvent.setup();
    const encounter = await createVisit(patient);
    const task = await medplum.createResource<Task>({
      resourceType: 'Task',
      status: 'in-progress',
      intent: 'order',
      code: { text: 'Review Labs' },
      for: createReference(patient),
      encounter: createReference(encounter),
    });
    vi.spyOn(medplum, 'updateResource').mockResolvedValue({ ...task, status: 'completed' });
    renderAt(`/Patient/${patient.id}/Encounter/${encounter.id}/Task/${task.id}`);

    expect(await screen.findByRole('heading', { name: 'Review Labs' })).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();

    await user.click(await screen.findByText('Save Changes'));

    // The modal closes and the chart's task badge shows the saved status.
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Review Labs' })).not.toBeInTheDocument();
    });
    expect(await screen.findByText('Completed')).toBeInTheDocument();
  });

  test('Reflects a status change from the chart on the list row', async () => {
    const user = userEvent.setup();
    const encounter = await createVisit(patient);
    setup(encounter.id);

    // Status renders on both the list row badge and the chart header button.
    expect(await screen.findByRole('button', { name: 'In Progress' })).toBeInTheDocument();
    expect(screen.getAllByText('In Progress')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'In Progress' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Finished' }));

    // The chart header and the refreshed list row both show the new status.
    await waitFor(() => {
      expect(screen.getAllByText('Finished')).toHaveLength(2);
    });
    expect(screen.queryByText('In Progress')).not.toBeInTheDocument();
  });
});
