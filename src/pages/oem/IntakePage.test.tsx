import { MantineProvider } from '@mantine/core';
import type { DocumentReference, Observation, Patient, Questionnaire } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoPolicyAssumptions, IntakePage } from './IntakePage';
import { OEM_PROJECT_ID, OEM_REVIEW_BOT_ID } from './ih-review';
import {
  INTAKE_CANONICAL,
  LIFECYCLE_WORKER_ID,
  inspectRetainedWork,
  NOISE_PREVIEW_BOT_ID,
  NOISE_RULE_CANONICAL,
  loadExposureAmendmentDetails,
  loadIntake,
  loadIntakeAssessments,
  loadIntakeEvidence,
  loadIntakeExposures,
  loadNoiseCompletions,
  previewIntake,
  previewNoiseScenario,
  saveIntake,
} from './intake';

vi.mock('./intake', async () => ({
  ...(await vi.importActual('./intake')),
  loadIntake: vi.fn(),
  inspectRetainedWork: vi.fn(),
  loadExposureAmendmentDetails: vi.fn(),
  loadIntakeAssessments: vi.fn(),
  loadIntakeEvidence: vi.fn(),
  loadIntakeExposures: vi.fn(),
  loadNoiseCompletions: vi.fn(),
  previewIntake: vi.fn(),
  previewNoiseScenario: vi.fn(),
  saveIntake: vi.fn(),
}));
const codes = 'https://hiivehealth.com/fhir/CodeSystem/synthetic-oem-intake';
const patient: Patient = {
  resourceType: 'Patient',
  id: 'worker',
  name: [{ given: ['Synthetic'], family: 'Worker' }],
  meta: {
    project: OEM_PROJECT_ID,
    tag: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/demo-data', code: 'synthetic-only' }],
  },
};
const questionnaire: Questionnaire = {
  resourceType: 'Questionnaire',
  status: 'draft',
  url: INTAKE_CANONICAL.split('|')[0],
  version: 'demo-1',
  item: [
    {
      linkId: 'exposure',
      type: 'group',
      text: 'Exposure',
      item: [
        {
          linkId: 'worksite',
          type: 'choice',
          text: 'Worksite',
          required: true,
          answerOption: [{ valueCoding: { system: codes, code: 'maintenance-bay' } }],
        },
        { linkId: 'start', type: 'date', text: 'Exposure start' },
      ],
    },
    {
      linkId: 'measurement',
      type: 'group',
      text: 'Assessment',
      item: [
        {
          linkId: 'availability',
          type: 'choice',
          text: 'Availability',
          required: true,
          answerOption: [{ valueCoding: { system: codes, code: 'unknown' } }],
        },
        { linkId: 'measurement-evidence', type: 'reference', text: 'Evidence', required: true },
      ],
    },
  ],
};
const evidence: DocumentReference = {
  resourceType: 'DocumentReference',
  id: 'evidence',
  meta: { project: OEM_PROJECT_ID, versionId: 'v1' },
  status: 'current',
  subject: { reference: 'Patient/worker' },
  description: 'Worker assessment',
  content: [],
};

describe('demo-only policy assumptions', () => {
  it('exposes five labelled Matrix-informed assumptions without approval or clinical-action controls', async () => {
    render(<MantineProvider><DemoPolicyAssumptions /></MantineProvider>);
    const control = screen.getByRole('button', { name: 'Demo policy assumptions' });
    expect(control).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Demo policy details' })).not.toBeInTheDocument();
    fireEvent.click(control);
    const region = await screen.findByRole('region', { name: 'Demo policy details' });
    expect(region).toHaveAttribute('data-demo-policy', 'matrix-13-noise-503-demo-v1');
    expect(region).toHaveAttribute('data-clinically-approved', 'false'); expect(region).toHaveAttribute('data-periodic-months', '12');
    expect(within(region).getAllByRole('heading')).toHaveLength(5);
    expect(within(region).getByText(/Zero-day review marker.*not a clinical deadline/)).toBeInTheDocument();
    expect(within(region).getByText(/12 calendar months.*clinical completion unverified/)).toBeInTheDocument();
    expect(within(region).getByText(/Retain accepted work.*no automatic cancellation/)).toBeInTheDocument();
    expect(within(region).getByText(/Missing evidence stays needs-review/)).toBeInTheDocument();
    expect(within(region).getByText(/Additional Army\/site policy not assessed/)).toBeInTheDocument();
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
    expect(within(region).queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(control); expect(control).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('OEM native intake page', () => {
  let client: MockClient;
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
    client = new MockClient();
    vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    vi.spyOn(client, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
    vi.spyOn(client, 'readResource').mockResolvedValue({
      resourceType: 'Bot',
      id: OEM_REVIEW_BOT_ID,
      meta: { project: OEM_PROJECT_ID },
    });
    vi.mocked(loadIntake).mockResolvedValue({ questionnaire, workers: [patient] });
    vi.mocked(loadIntakeEvidence).mockResolvedValue([evidence]);
    vi.mocked(loadIntakeExposures).mockResolvedValue([]);
    vi.mocked(loadExposureAmendmentDetails).mockRejectedValue(new Error('Denied'));
    vi.mocked(loadNoiseCompletions).mockResolvedValue({ records: [], unverified: [], limited: false });
    vi.mocked(loadIntakeAssessments).mockResolvedValue({
      measurements: [],
      enrollments: [],
      unverified: [],
      limited: { measurement: false, enrollment: false },
    });
    vi.mocked(previewIntake).mockResolvedValue('active');
    vi.mocked(previewNoiseScenario).mockResolvedValue({
      status: 'needs-review',
      rationale: 'Authorized enrollment evidence is missing.',
      rule: NOISE_RULE_CANONICAL,
      sources: ['Observation/existing/_history/v7'],
    });
    vi.mocked(saveIntake).mockResolvedValue({
      status: 'completed',
      receipt: 'Task/receipt/_history/v1',
      replayed: false,
      resources: [],
    });
  });
  function content() {
    return (
      <MemoryRouter>
        <MedplumProvider medplum={client}>
          <MantineProvider env="test">
            <IntakePage />
          </MantineProvider>
        </MedplumProvider>
      </MemoryRouter>
    );
  }
  function setup(): ReturnType<typeof render> {
    return render(content());
  }
  function assessmentDefinition(legacy = false): Questionnaire {
    const definition = structuredClone(questionnaire);
    const measurement = definition.item![1];
    const selection = (linkId: string, text: string, options: string[]) => ({
      linkId, text, type: 'choice' as const, required: legacy,
      answerOption: options.map((code) => ({ valueCoding: { system: codes, code } })),
    });
    measurement.item = [
      { ...selection('availability', 'Availability', ['measured', 'unknown', 'not-provided']), required: true },
      selection('metric', 'Metric', ['eight-hour-twa', 'peak']),
      selection('unit', 'Unit', ['dBA', 'dBC', 'dB']),
      selection('basis', 'Averaging basis', ['8h', 'peak']),
      selection('method', 'Assessment method', ['synthetic-personal-dosimetry', 'synthetic-area-assessment']),
      { linkId: 'assessed', text: 'Assessment date', type: 'date', required: legacy },
      { ...measurement.item![1], required: legacy },
      { linkId: 'value', text: 'Measured value', type: 'decimal', required: true,
        enableWhen: [{ question: 'availability', operator: '=', answerCoding: { system: codes, code: 'measured' } }] },
    ];
    return definition;
  }
  it('hides unknown assessment details until selected and preserves exposure answers across availability changes', async () => {
    vi.mocked(loadIntake).mockResolvedValue({ questionnaire: assessmentDefinition(), workers: [patient] });
    setup();
    await choose('Worker', 'Synthetic Worker');
    await choose('Worksite', 'maintenance bay');
    await choose('Availability', 'unknown');
    const details = await screen.findByRole('checkbox', { name: 'Record known assessment details' });
    expect(details).not.toBeChecked();
    expect(screen.queryByRole('radio', { name: 'eight hour twa' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Assessment date')).not.toBeInTheDocument();
    await userEvent.click(details);
    expect(await screen.findByRole('radio', { name: 'eight hour twa' })).toBeInTheDocument();
    expect(screen.getByLabelText('Assessment date')).not.toBeRequired();
    await choose('Availability', 'measured');
    expect(await screen.findByLabelText(/Measured value/)).toBeRequired();
    expect(screen.getByLabelText(/Assessment date/)).toBeRequired();
    await choose('Availability', 'not provided');
    await waitFor(() => expect(screen.queryByRole('radio', { name: 'eight hour twa' })).not.toBeInTheDocument());
    expect(screen.queryByLabelText('Measured value')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Record known assessment details' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'maintenance bay' })).toBeChecked();
    expect(previewIntake).not.toHaveBeenCalled();
    expect(saveIntake).not.toHaveBeenCalled();
  });
  it('previews unknown without assessment details on the updated definition and omits the form-only toggle', async () => {
    vi.mocked(loadIntake).mockResolvedValue({ questionnaire: assessmentDefinition(), workers: [patient] });
    setup();
    await choose('Worker', 'Synthetic Worker');
    await choose('Worksite', 'maintenance bay');
    await choose('Availability', 'unknown');
    await screen.findByRole('checkbox', { name: 'Record known assessment details' });
    await userEvent.click(screen.getByRole('button', { name: 'Preview intake' }));
    await screen.findByRole('dialog', { name: 'Save synthetic intake?' });
    const request = vi.mocked(previewIntake).mock.calls[0][1];
    expect(request.response.item![1].item).toEqual([
      { linkId: 'availability', answer: [{ valueCoding: { system: codes, code: 'unknown' } }] },
    ]);
    expect(saveIntake).not.toHaveBeenCalled();
  });
  it('blocks simplified unknown preview on the legacy definition before dispatch', async () => {
    vi.mocked(loadIntake).mockResolvedValue({ questionnaire: assessmentDefinition(true), workers: [patient] });
    setup();
    await choose('Worker', 'Synthetic Worker');
    await choose('Worksite', 'maintenance bay');
    await choose('Availability', 'unknown');
    await screen.findByRole('checkbox', { name: 'Record known assessment details' });
    await userEvent.click(screen.getByRole('button', { name: 'Preview intake' }));
    expect(await screen.findByText('Simplified unknown assessments require the updated intake service. No submission was sent.')).toBeInTheDocument();
    expect(previewIntake).not.toHaveBeenCalled();
    expect(saveIntake).not.toHaveBeenCalled();
  });
  it('places exposure, measurement, enrollment and advisory between intake and retained work without submitting changes', async () => {
    vi.mocked(loadIntake).mockResolvedValue({ questionnaire, workers: [{ ...patient, id: LIFECYCLE_WORKER_ID }] });
    vi.mocked(loadIntakeEvidence).mockResolvedValue([{ ...evidence, subject: { reference: `Patient/${LIFECYCLE_WORKER_ID}` } }]);
    vi.mocked(inspectRetainedWork).mockResolvedValue({ inspectedAt: '2026-10-22T19:00:00.000Z', activity: 'active',
      status: 'requested', headState: 'unchanged-at-read-checks', reviewRequired: false, searchedRecommendations: 1,
      recommendations: [{ reference: 'Task/recommendation/_history/one', status: 'requested', reviewRequired: false }] });
    setup();
    await choose('Worker', 'Synthetic Worker');
    expect(screen.queryByRole('button', { name: 'Inspect retained work' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Earlier saved examples' }));
    const button = await screen.findByRole('button', { name: 'Inspect retained work' });
    const start = await screen.findByLabelText('Exposure start');
    const preview = screen.getByRole('button', { name: 'Preview intake' });
    expect(screen.getByPlaceholderText('Select worker').compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(start.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const timeline = screen.getByRole('heading', { name: 'Exposure timeline' });
    const measurements = await screen.findByRole('heading', { name: 'Noise measurements' });
    const enrollments = screen.getByRole('heading', { name: 'Enrollment determinations' });
    const advisory = screen.getByRole('heading', { name: 'Advisory scenario' });
    expect(preview.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(timeline.compareDocumentPosition(measurements) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(measurements.compareDocumentPosition(enrollments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(enrollments.compareDocumentPosition(advisory) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(advisory.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(previewIntake).not.toHaveBeenCalled();
    expect(previewNoiseScenario).not.toHaveBeenCalled();
    expect(saveIntake).not.toHaveBeenCalled();
    expect(inspectRetainedWork).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(await screen.findByText('Exposure: active. Recommendation: requested.')).toBeInTheDocument();
    expect(screen.getByText('Scope: bounded worker search.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View retained recommendation' })).toHaveAttribute('href', expect.stringContaining('/Task/'));
    expect(button).toHaveAccessibleName('Dismiss retained work');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(button);
    expect(screen.queryByText('Exposure: active. Recommendation: requested.')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View retained recommendation' })).not.toBeInTheDocument();
    expect(button).toHaveAccessibleName('Inspect retained work');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(inspectRetainedWork).toHaveBeenCalledTimes(1);
    await userEvent.click(button);
    expect(await screen.findByText('Exposure: active. Recommendation: requested.')).toBeInTheDocument();
    expect(inspectRetainedWork).toHaveBeenCalledTimes(2);
    expect(saveIntake).not.toHaveBeenCalled();
  });

  it('dismisses an in-flight retained-work inspection and ignores its late result', async () => {
    vi.mocked(loadIntake).mockResolvedValue({ questionnaire, workers: [{ ...patient, id: LIFECYCLE_WORKER_ID }] });
    vi.mocked(loadIntakeEvidence).mockResolvedValue([{ ...evidence, subject: { reference: `Patient/${LIFECYCLE_WORKER_ID}` } }]);
    let finish: ((value: Awaited<ReturnType<typeof inspectRetainedWork>>) => void) | undefined;
    vi.mocked(inspectRetainedWork).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    setup();
    await choose('Worker', 'Synthetic Worker');
    await userEvent.click(screen.getByRole('button', { name: 'Earlier saved examples' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect retained work' }));
    expect(await screen.findByLabelText('Inspecting retained work')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss retained work' }));
    expect(screen.queryByLabelText('Inspecting retained work')).not.toBeInTheDocument();
    await act(async () => {
      finish!({ inspectedAt: '2026-10-22T19:00:00.000Z', activity: 'active', status: 'requested',
        headState: 'unchanged-at-read-checks', reviewRequired: false, searchedRecommendations: 0, recommendations: [] });
    });
    expect(screen.queryByText('Exposure: active. Recommendation: requested.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inspect retained work' })).toHaveAttribute('aria-expanded', 'false');
    expect(inspectRetainedWork).toHaveBeenCalledTimes(1);
    expect(saveIntake).not.toHaveBeenCalled();
  });

  it('presents the accepted recommendation and its separate local draft without submitting new work', async () => {
    vi.mocked(loadIntake).mockResolvedValue({ questionnaire, workers: [{ ...patient, id: LIFECYCLE_WORKER_ID }] });
    vi.mocked(inspectRetainedWork).mockResolvedValue({ inspectedAt: '2026-10-23T19:00:00.000Z', activity: 'active',
      status: 'accepted', headState: 'unchanged-at-read-checks', reviewRequired: false, searchedRecommendations: 1,
      recommendations: [{ reference: 'Task/recommendation/_history/accepted', status: 'accepted', reviewRequired: false }],
      proposals: [{ reference: 'ServiceRequest/local-proposal/_history/one', status: 'draft', reviewRequired: false }] });
    setup();
    await choose('Worker', 'Synthetic Worker');
    await userEvent.click(screen.getByRole('button', { name: 'Earlier saved examples' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect retained work' }));
    expect(await screen.findByText('Exposure: active. Recommendation: accepted.')).toBeInTheDocument();
    expect(screen.getByText('Visible audiogram Tasks: 1. Retained recommendations: 1.')).toBeInTheDocument();
    expect(screen.getByText('Local proposal: draft')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View retained local draft proposal' })).toHaveAttribute('href', '/ServiceRequest/local-proposal/_history/one');
    expect(saveIntake).not.toHaveBeenCalled();
  });

  it('keeps retained-work read failures unavailable without exposing raw details', async () => {
    vi.mocked(loadIntake).mockResolvedValue({ questionnaire, workers: [{ ...patient, id: LIFECYCLE_WORKER_ID }] });
    vi.mocked(inspectRetainedWork).mockRejectedValue(new Error('private transport detail'));
    setup();
    await choose('Worker', 'Synthetic Worker');
    await userEvent.click(screen.getByRole('button', { name: 'Earlier saved examples' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect retained work' }));
    expect(await screen.findByText('Retained work inspection is unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('private transport detail')).not.toBeInTheDocument();
    expect(saveIntake).not.toHaveBeenCalled();
  });

  it('discards a retained-work response after the selected worker changes', async () => {
    vi.mocked(loadIntake).mockResolvedValue({ questionnaire, workers: [{ ...patient, id: LIFECYCLE_WORKER_ID },
      { ...patient, name: [{ given: ['Other'], family: 'Worker' }] }] });
    let complete!: (value: Awaited<ReturnType<typeof inspectRetainedWork>>) => void;
    vi.mocked(inspectRetainedWork).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    setup();
    await choose('Worker', 'Synthetic Worker');
    await userEvent.click(screen.getByRole('button', { name: 'Earlier saved examples' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect retained work' }));
    await choose('Worker', 'Other Worker');
    await act(async () => complete({ inspectedAt: '2026-10-22T19:00:00.000Z', activity: 'active',
      status: 'requested', headState: 'unchanged-at-read-checks', reviewRequired: false, searchedRecommendations: 1,
      recommendations: [{ reference: 'Task/recommendation/_history/one', status: 'requested', reviewRequired: false }] }));
    expect(screen.queryByText('Exposure: active. Recommendation: requested.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inspect retained work' })).not.toBeInTheDocument();
  });

  async function choose(label: string, option: string): Promise<void> {
    if (['Exposure episode', 'Amendment reason'].includes(label)) {
      await userEvent.click(await screen.findByRole('textbox', { name: label }));
      await userEvent.click(await screen.findByRole('option', { name: option }));
      return;
    }
    if (label === 'Worker') {
      await userEvent.click(await screen.findByPlaceholderText('Select worker'));
      await userEvent.click(await screen.findByRole('option', { name: option }));
      return;
    }
    if (label === 'Evidence') {
      const details = await screen.findByRole('checkbox', { name: 'Record known assessment details' });
      if (!(details as HTMLInputElement).checked) await userEvent.click(details);
    }
    const control = await waitFor(() => {
      const nativeOption = screen.queryByRole('option', { name: option });
      const select = nativeOption?.closest('select');
      if (select && nativeOption) return { select, option: nativeOption };
      const radio = screen.queryByRole('radio', { name: option });
      if (radio) return { radio };
      throw new Error(`Native choice ${label} is not ready.`);
    });
    if ('select' in control) await userEvent.selectOptions(control.select!, control.option!);
    else await userEvent.click(control.radio);
  }
  async function fill(): Promise<void> {
    await choose('Worker', 'Synthetic Worker');
    await choose('Worksite', 'maintenance bay');
    await choose('Availability', 'unknown');
    await choose('Evidence', 'Worker assessment (v1)');
  }
  it('refuses another Project before loading', () => {
    vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: 'other' });
    setup();
    expect(screen.getByText('OEM Project required')).toBeInTheDocument();
    expect(loadIntake).not.toHaveBeenCalled();
  });
  it('retains native form choices, pins worker evidence, previews and requires confirmation', async () => {
    const savedExposure: Observation = { resourceType: 'Observation', id: 'new-exposure', status: 'final',
      code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-stressor', code: '503' }] },
      subject: { reference: 'Patient/worker' }, meta: { project: OEM_PROJECT_ID, versionId: 'saved' }, effectivePeriod: { start: '2026-10-26' } };
    vi.mocked(loadIntakeExposures).mockResolvedValueOnce([]).mockResolvedValue([savedExposure]);
    vi.mocked(client.readResource).mockImplementation((_type, id) => Promise.resolve({ resourceType: 'Bot', id, meta: { project: OEM_PROJECT_ID } }) as never);
    vi.mocked(saveIntake).mockResolvedValue({ status: 'completed', receipt: 'Task/receipt/_history/v1', replayed: false,
      resources: [{ step: 'exposure', reference: 'Observation/new-exposure/_history/saved' }] });
    setup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Preview intake' }));
    await screen.findByRole('dialog', { name: 'Save synthetic intake?' });
    expect(saveIntake).not.toHaveBeenCalled();
    const request = vi.mocked(previewIntake).mock.calls[0][1];
    expect(request.response.item?.[1].item?.[1].answer).toEqual([
      { valueReference: { reference: 'DocumentReference/evidence/_history/v1' } },
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm save' }));
    expect(await screen.findByText('Intake saved')).toBeInTheDocument();
    expect(saveIntake).toHaveBeenCalledWith(client, request);
    expect(sessionStorage.length).toBe(0);
    expect(screen.queryByRole('heading', { name: 'Exposure timeline' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View saved exposure' }));
    const timeline = await screen.findByRole('heading', { name: 'Exposure timeline' });
    await waitFor(() => expect(timeline).toHaveFocus());
    expect(loadIntakeExposures).toHaveBeenCalledTimes(2);
    expect(loadIntakeExposures).toHaveBeenLastCalledWith(client, patient);
    expect(screen.getByPlaceholderText('Select worker')).toHaveValue('Synthetic Worker');
    expect(screen.getByPlaceholderText('Select worker')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Preview intake' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Exposure episode' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'maintenance bay' })).not.toBeInTheDocument();
    expect(screen.getByText('Intake saved')).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'Advisory exposure' })).toHaveValue('2026-10-26 / new-exposure');
    expect(screen.getByRole('textbox', { name: 'Advisory exposure' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Earlier saved examples' })).not.toBeInTheDocument();
    expect(previewIntake).toHaveBeenCalledTimes(1);
    expect(saveIntake).toHaveBeenCalledTimes(1);
  });
  it('does not submit when confirmation is cancelled', async () => {
    setup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Preview intake' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(saveIntake).not.toHaveBeenCalled();
  });
  it('locks the bound form and prevents duplicate submission while a save is in flight', async () => {
    let complete: ((result: Awaited<ReturnType<typeof saveIntake>>) => void) | undefined;
    vi.mocked(saveIntake).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    setup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Preview intake' }));
    await userEvent.dblClick(await screen.findByRole('button', { name: 'Confirm save' }));
    expect(saveIntake).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText('Select worker')).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'maintenance bay' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(sessionStorage.length).toBe(1);
    await act(async () => {
      complete!({ status: 'completed', receipt: 'Task/receipt/_history/v1', replayed: false, resources: [] });
    });
    expect(await screen.findByText('Intake saved')).toBeInTheDocument();
    expect(sessionStorage.length).toBe(0);
    expect(saveIntake).toHaveBeenCalledTimes(1);
  });
  it('does not open confirmation or save after a rejected preview', async () => {
    vi.mocked(previewIntake).mockRejectedValue(new Error('Exposure version is stale'));
    setup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Preview intake' }));
    expect(await screen.findByText('Exposure version is stale')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Select worker')).toBeEnabled();
    expect(saveIntake).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });
  it.each(['actor', 'project'])('retains the original recovery marker when a late save completes after an %s switch', async (scope) => {
    let complete!: (value: Awaited<ReturnType<typeof saveIntake>>) => void;
    vi.mocked(saveIntake).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const view = setup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Preview intake' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm save' }));
    const key = `oem-intake-pending:${OEM_PROJECT_ID}:Practitioner/clinician`;
    const marker = sessionStorage.getItem(key);
    expect(marker).not.toBeNull();
    if (scope === 'actor') vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other-clinician' });
    else vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: 'other-project' });
    if (scope === 'actor') await act(async () => { client.dispatchEvent({ type: 'change' }); });
    view.rerender(content());
    if (scope === 'project') await screen.findByText('OEM Project required');
    else await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await act(async () => {
      complete({ status: 'completed', receipt: 'Task/old-receipt/_history/v1', replayed: false, resources: [] });
    });
    expect(sessionStorage.getItem(key)).toBe(marker);
    expect(screen.queryByText('Intake saved')).not.toBeInTheDocument();
    vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
    if (scope === 'actor') await act(async () => { client.dispatchEvent({ type: 'change' }); });
    view.rerender(content());
    expect(await screen.findByText('Submission requires inspection')).toBeInTheDocument();
    expect(await screen.findByPlaceholderText('Select worker')).toBeDisabled();
    expect(saveIntake).toHaveBeenCalledTimes(1);
  });
  it.each(['resolve', 'reject'])('does not let a late old preview %s unlock the newer preview after returning to the Project', async (outcome) => {
    let oldReply!: (value: 'active') => void;
    let oldFailure!: (reason: Error) => void;
    let newReply!: (value: 'active') => void;
    vi.mocked(previewIntake)
      .mockReturnValueOnce(new Promise((resolve, reject) => { oldReply = resolve; oldFailure = reject; }))
      .mockReturnValueOnce(new Promise(resolve => { newReply = resolve; }));
    const view = setup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Preview intake' }));
    vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: 'other-project' });
    view.rerender(content());
    await screen.findByText('OEM Project required');
    vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    view.rerender(content());
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Preview intake' }));
    expect(previewIntake).toHaveBeenCalledTimes(2);
    await act(async () => {
      if (outcome === 'resolve') oldReply('active');
      else oldFailure(new Error('Obsolete preview failure'));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Obsolete preview failure')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview intake' })).toBeDisabled();
    expect(screen.getByPlaceholderText('Select worker')).toBeDisabled();
    await act(async () => { newReply('active'); });
    await screen.findByRole('dialog', { name: 'Save synthetic intake?' });
    expect(saveIntake).not.toHaveBeenCalled();
  });
  it('preserves the original marker when a save finishes after unmount', async () => {
    let complete!: (value: Awaited<ReturnType<typeof saveIntake>>) => void;
    vi.mocked(saveIntake).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const view = setup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Preview intake' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm save' }));
    const key = `oem-intake-pending:${OEM_PROJECT_ID}:Practitioner/clinician`;
    const marker = sessionStorage.getItem(key);
    view.unmount();
    await act(async () => { complete({ status: 'completed', receipt: 'Task/old/_history/v1', replayed: false, resources: [] }); });
    expect(sessionStorage.getItem(key)).toBe(marker);
    setup();
    expect(await screen.findByText('Submission requires inspection')).toBeInTheDocument();
    expect(await screen.findByPlaceholderText('Select worker')).toBeDisabled();
    expect(saveIntake).toHaveBeenCalledTimes(1);
  });
  it('does not send a save when safety storage fails at confirmation', async () => {
    setup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Preview intake' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm save' });
    const storage = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'QuotaExceededError');
    });
    try {
      await userEvent.click(confirm);
      expect(await screen.findByText(/Save completion was not confirmed/)).toBeInTheDocument();
      expect(storage).toHaveBeenCalledTimes(1);
      expect(saveIntake).not.toHaveBeenCalled();
    } finally {
      storage.mockRestore();
    }
  });
  it('blocks duplicate saves after an uncertain response and across remount', async () => {
    vi.mocked(saveIntake).mockRejectedValue(new Error('Network interruption'));
    const view = setup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Preview intake' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm save' }));
    await screen.findByText('Submission requires inspection');
    await waitFor(() => expect(saveIntake).toHaveBeenCalledTimes(1));
    view.unmount();
    setup();
    expect(await screen.findByText('Submission requires inspection')).toBeInTheDocument();
    expect(await screen.findByPlaceholderText('Select worker')).toBeDisabled();
    expect(saveIntake).toHaveBeenCalledTimes(1);
  });
  it('shows denied access instead of a working form', async () => {
    vi.mocked(loadIntake).mockRejectedValue(new Error('Denied'));
    setup();
    expect(
      await screen.findByText('Intake access or the pinned definition could not be verified.')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Worker')).not.toBeInTheDocument();
  });
  it('preloads an amendment and submits its exact original exposure version', async () => {
    vi.mocked(loadIntakeExposures).mockResolvedValue([
      {
        resourceType: 'Observation',
        id: 'existing',
        meta: { project: OEM_PROJECT_ID, versionId: 'v7' },
        status: 'final',
        code: {},
        effectivePeriod: { start: '2026-01-01' },
        extension: [
          { url: 'https://hiivehealth.com/fhir/StructureDefinition/synthetic-worksite', valueCode: 'maintenance-bay' },
        ],
      },
    ]);
    setup();
    await choose('Worker', 'Synthetic Worker');
    await choose('Exposure episode', '2026-01-01 / existing');
    await choose('Exposure episode', '2026-01-01 / existing');
    expect(await screen.findByText('Observation/existing/_history/v7')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'maintenance bay' })).toBeChecked();
    await choose('Amendment reason', 'Correct dates');
    await choose('Availability', 'unknown');
    await choose('Evidence', 'Worker assessment (v1)');
    await userEvent.click(screen.getByRole('button', { name: 'Preview intake' }));
    await screen.findByRole('dialog', { name: 'Save synthetic intake?' });
    expect(vi.mocked(previewIntake).mock.calls[0][1]).toMatchObject({
      exposure: 'Observation/existing/_history/v7',
      amendmentReason: 'correct-dates',
    });
  });
  it('does not offer clinical amendments to an IH operator', async () => {
    vi.mocked(client.readResource).mockRejectedValue(new Error('Review Bot denied'));
    setup();
    await choose('Worker', 'Synthetic Worker');
    await screen.findByText('Worksite');
    expect(screen.queryByRole('textbox', { name: 'Exposure episode' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Amendment reason' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Synthetic advisory scenario' })).not.toBeInTheDocument();
  });
  it('previews an explicit synthetic scenario without saving and clears it when its date changes', async () => {
    vi.mocked(client.readResource)
      .mockResolvedValueOnce({ resourceType: 'Bot', id: OEM_REVIEW_BOT_ID, meta: { project: OEM_PROJECT_ID } })
      .mockResolvedValueOnce({ resourceType: 'Bot', id: NOISE_PREVIEW_BOT_ID, meta: { project: OEM_PROJECT_ID } });
    const episode = {
      resourceType: 'Observation' as const,
      id: 'existing',
      status: 'final' as const,
      meta: { project: OEM_PROJECT_ID, versionId: 'v7' },
      code: {},
      subject: { reference: 'Patient/worker' },
      effectivePeriod: { start: '2026-01-01' },
    };
    vi.mocked(loadIntakeExposures).mockResolvedValue([episode]);
    const enrollment = {
      ...episode,
      id: 'enrollment',
      focus: [{ reference: 'Observation/existing' }],
      valueCodeableConcept: { text: 'enrolled' },
    };
    const completion = { ...episode, id: 'completion', focus: enrollment.focus, effectiveDateTime: '2026-06-15' };
    vi.mocked(loadIntakeAssessments).mockResolvedValue({
      measurements: [],
      enrollments: [enrollment],
      unverified: [],
      limited: { measurement: false, enrollment: false },
    });
    vi.mocked(loadNoiseCompletions).mockResolvedValue({ records: [completion], unverified: [], limited: false });
    setup();
    await choose('Worker', 'Synthetic Worker');
    const advisory = within(await screen.findByRole('region', { name: 'Synthetic advisory scenario' }));
    await userEvent.click(await advisory.findByRole('textbox', { name: 'Advisory exposure' }));
    await userEvent.click(await screen.findByRole('option', { name: '2026-01-01 / existing' }));
    await userEvent.click(advisory.getByRole('button', { name: 'Preview advisory' }));
    expect(await advisory.findByText('Scenario status: needs review')).toBeInTheDocument();
    expect(advisory.getByText(/Completion evidence: Not included/)).toBeInTheDocument();
    expect(previewNoiseScenario).toHaveBeenCalledWith(
      client,
      patient,
      episode,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      undefined,
      undefined
    );
    expect(saveIntake).not.toHaveBeenCalled();
    expect(advisory.queryByRole('button', { name: /accept|apply/i })).not.toBeInTheDocument();
    await userEvent.click(advisory.getByRole('textbox', { name: 'Advisory enrollment' }));
    await userEvent.click(await screen.findByRole('option', { name: 'enrolled / enrollment' }));
    await userEvent.click(advisory.getByRole('textbox', { name: 'Advisory completion' }));
    await userEvent.click(await screen.findByRole('option', { name: '2026-06-15 / completion' }));
    await userEvent.click(advisory.getByRole('button', { name: 'Preview advisory' }));
    await advisory.findByText('Scenario status: needs review');
    expect(previewNoiseScenario).toHaveBeenLastCalledWith(
      client,
      patient,
      episode,
      expect.any(String),
      enrollment,
      completion
    );
    expect(advisory.getByText(/Completion evidence: Selected synthetic record/)).toBeInTheDocument();
    fireEvent.change(advisory.getByLabelText('Scenario date'), { target: { value: '2026-01-03' } });
    await waitFor(() => expect(advisory.queryByText('Scenario status: needs review')).not.toBeInTheDocument());
    expect(advisory.getByText('Completion: Not included')).toBeInTheDocument();
  });
  function amendedExposure(): Observation {
    return {
      resourceType: 'Observation',
      id: 'amended',
      meta: { project: OEM_PROJECT_ID, versionId: 'v2' },
      status: 'final',
      subject: { reference: 'Patient/worker' },
      code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-stressor', code: '503' }] },
      effectivePeriod: { start: '2026-01-01' },
      extension: [
        { url: 'https://hiivehealth.com/fhir/StructureDefinition/exposure-source', valueCode: 'clinician-modified' },
      ],
    };
  }

  it('loads attribution only on demand and shows recorded facts and exact-version links without save controls', async () => {
    vi.mocked(loadIntakeExposures).mockResolvedValue([amendedExposure()]);
    vi.mocked(loadExposureAmendmentDetails).mockResolvedValue({
      actor: 'Practitioner/recorded-author',
      recorded: '2026-10-20T12:00:00.000Z',
      reason: 'Correct worksite',
      lineage: 'Provenance/lineage/_history/one',
      previous: 'Observation/amended/_history/v1',
    });
    setup();
    await choose('Worker', 'Synthetic Worker');
    const control = await screen.findByRole('button', { name: 'View amendment attribution' });
    expect(loadExposureAmendmentDetails).not.toHaveBeenCalled();
    await userEvent.click(control);
    const dialog = within(await screen.findByRole('dialog', { name: 'Amendment attribution' }));
    expect(await dialog.findByText('Correct worksite')).toBeInTheDocument();
    expect(dialog.getByText('2026-10-20T12:00:00.000Z')).toBeInTheDocument();
    expect(dialog.getByRole('link', { name: 'Practitioner/recorded-author' })).toHaveAttribute(
      'href',
      '/Practitioner/recorded-author'
    );
    expect(dialog.getByRole('link', { name: 'Prior exposure version' })).toHaveAttribute(
      'href',
      '/Observation/amended/_history/v1'
    );
    expect(dialog.getByRole('link', { name: 'Amendment lineage' })).toHaveAttribute(
      'href',
      '/Provenance/lineage/_history/one'
    );
    expect(dialog.queryByRole('button', { name: /save|apply|repair/i })).not.toBeInTheDocument();
    expect(saveIntake).not.toHaveBeenCalled();
  });

  it('shows a fixed unavailable state without raw denied-read details', async () => {
    vi.mocked(loadIntakeExposures).mockResolvedValue([amendedExposure()]);
    vi.mocked(loadExposureAmendmentDetails).mockRejectedValue(new Error('private foreign identity'));
    setup();
    await choose('Worker', 'Synthetic Worker');
    await userEvent.click(await screen.findByRole('button', { name: 'View amendment attribution' }));
    expect(await screen.findByText('Verified amendment attribution is unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('private foreign identity')).not.toBeInTheDocument();
    expect(screen.queryByText('Recorded by')).not.toBeInTheDocument();
  });

  it('discards an attribution response after the modal closes', async () => {
    vi.mocked(loadIntakeExposures).mockResolvedValue([amendedExposure()]);
    let resolve!: (value: Awaited<ReturnType<typeof loadExposureAmendmentDetails>>) => void;
    vi.mocked(loadExposureAmendmentDetails).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    setup();
    await choose('Worker', 'Synthetic Worker');
    await userEvent.click(await screen.findByRole('button', { name: 'View amendment attribution' }));
    expect(await screen.findByText('Loading amendment attribution')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close amendment attribution' }));
    await act(async () =>
      resolve({
        actor: 'Practitioner/late',
        recorded: '2026-10-20T12:00:00.000Z',
        reason: 'Late response',
        lineage: 'Provenance/late/_history/one',
        previous: 'Observation/amended/_history/v1',
      })
    );
    expect(screen.queryByRole('dialog', { name: 'Amendment attribution' })).not.toBeInTheDocument();
    expect(screen.queryByText('Late response')).not.toBeInTheDocument();
  });

  it.each([
    ['ih-ingested', 'IH-imported'],
    ['ih-entered', 'IH-entered'],
    ['clinician-entered', 'Clinician-entered'],
    ['clinician-modified', 'Clinician-amended'],
  ])(
    'shows retained exposure type, activity, %s source and history without enabling amendments for IH',
    async (source, label) => {
      vi.mocked(client.readResource).mockRejectedValue(new Error('Review Bot denied'));
      vi.mocked(loadIntakeExposures).mockResolvedValue([
        {
          resourceType: 'Observation',
          id: 'ended',
          meta: { project: OEM_PROJECT_ID, versionId: 'v2' },
          status: 'final',
          code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-stressor', code: '503' }] },
          effectivePeriod: { start: '2025-01-01', end: '2025-12-31' },
          extension: [
            { url: 'https://hiivehealth.com/fhir/StructureDefinition/exposure-source', valueCode: source },
            {
              url: 'https://hiivehealth.com/fhir/StructureDefinition/synthetic-worksite',
              valueCode: 'maintenance-bay',
            },
          ],
        },
      ]);
      setup();
      await choose('Worker', 'Synthetic Worker');
      const timeline = within(await screen.findByRole('table', { name: 'Exposure timeline' }));
      for (const heading of ['Exposure', 'Status', 'Source']) {
        expect(timeline.getByRole('columnheader', { name: heading })).toBeInTheDocument();
      }
      expect(timeline.getByText('Noise 503')).toBeInTheDocument();
      expect(timeline.getByText('Inactive')).toBeInTheDocument();
      expect(timeline.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(/^Status as of \d{4}-\d{2}-\d{2} \(UTC\)$/)).toBeInTheDocument();
      expect(timeline.getByText('2025-01-01')).toBeInTheDocument();
      expect(timeline.getByText('2025-12-31')).toBeInTheDocument();
      expect(timeline.getByText('maintenance bay')).toBeInTheDocument();
      expect(timeline.queryByText('v2')).not.toBeInTheDocument();
      expect(timeline.getByRole('link', { name: 'View exposure history' })).toHaveAttribute(
        'href',
        '/Observation/ended/history'
      );
      expect(timeline.queryByText('ended')).not.toBeInTheDocument();
      expect(timeline.queryByRole('columnheader', { name: 'Details' })).not.toBeInTheDocument();
      expect(timeline.queryByRole('columnheader', { name: 'Version' })).not.toBeInTheDocument();
      expect(timeline.queryByRole('button', { name: 'Exposure version details' })).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: 'Exposure episode' })).not.toBeInTheDocument();
      expect(saveIntake).not.toHaveBeenCalled();
    }
  );
  it('shows an explicit empty timeline without inventing exposure facts', async () => {
    setup();
    await choose('Worker', 'Synthetic Worker');
    expect(await screen.findByText('No recorded exposure episodes.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Exposure timeline' })).not.toBeInTheDocument();
  });
  it('keeps assessment denial separate from intake and never implies non-enrollment', async () => {
    vi.mocked(loadIntakeAssessments).mockRejectedValue(new Error('Denied'));
    setup();
    await choose('Worker', 'Synthetic Worker');
    expect(await screen.findByText('Assessment history unavailable')).toBeInTheDocument();
    expect(screen.getByText('Worksite')).toBeInTheDocument();
    expect(screen.queryByText('No recorded enrollment determinations in this result.')).not.toBeInTheDocument();
    expect(saveIntake).not.toHaveBeenCalled();
  });
  it('flags unverified source records without presenting them as absent or verified measurements', async () => {
    vi.mocked(loadIntakeAssessments).mockResolvedValue({
      measurements: [],
      enrollments: [],
      unverified: [
        {
          kind: 'measurement',
          reference: 'Observation/source/_history/v1',
          reason: 'A linked source does not match the required resource, worker or Project.',
        },
      ],
      limited: { measurement: true, enrollment: false },
    });
    setup();
    await choose('Worker', 'Synthetic Worker');
    expect(await screen.findByText('Records need source review')).toBeInTheDocument();
    const measurements = within(screen.getByRole('region', { name: 'Noise measurements' }));
    expect(measurements.getByText('Needs review: 1')).toBeInTheDocument();
    expect(measurements.getByText('No verified records in this result.')).toBeInTheDocument();
    expect(measurements.getByText('Noise measurements: record limit reached')).toBeInTheDocument();
    expect(screen.queryByText('No recorded noise measurements in this result.')).not.toBeInTheDocument();
    expect(
      screen.getByText('A linked source does not match the required resource, worker or Project.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View measurement record' })).toHaveAttribute(
      'href',
      '/Observation/source/_history/v1'
    );
    expect(saveIntake).not.toHaveBeenCalled();
  });
  it('shows unknown and zero measurements separately from recorded enrollment for IH', async () => {
    vi.mocked(client.readResource).mockRejectedValue(new Error('Review Bot denied'));
    const measured = {
      resourceType: 'Observation' as const,
      id: 'zero',
      meta: { project: OEM_PROJECT_ID, versionId: 'v1' },
      status: 'final' as const,
      code: {
        coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-noise-metric', code: 'eight-hour-twa' }],
      },
      effectiveDateTime: '2026-01-02',
      valueQuantity: { value: 0, unit: 'dBA' },
      focus: [{ reference: 'Observation/ended/_history/v2' }],
      derivedFrom: [{ reference: 'DocumentReference/evidence/_history/v1' }],
    };
    vi.mocked(loadIntakeAssessments).mockResolvedValue({
      unverified: [],
      limited: { measurement: false, enrollment: false },
      measurements: [
        measured,
        {
          ...measured,
          id: 'unknown',
          valueQuantity: undefined,
          dataAbsentReason: {
            coding: [{ system: 'http://terminology.hl7.org/CodeSystem/data-absent-reason', code: 'unknown' }],
          },
        },
      ],
      enrollments: [
        {
          resourceType: 'Observation',
          id: 'enrollment',
          status: 'final',
          meta: { project: OEM_PROJECT_ID, versionId: 'v3' },
          code: {},
          valueCodeableConcept: { text: 'needs-review' },
          effectivePeriod: { start: '2026-01-01', end: '2026-09-01' },
          focus: measured.focus,
          derivedFrom: measured.derivedFrom,
        },
      ],
    });
    setup();
    await choose('Worker', 'Synthetic Worker');
    const measurements = within(await screen.findByRole('table', { name: 'Noise measurements' }));
    expect(measurements.getByText('0 dBA')).toBeInTheDocument();
    expect(measurements.getByText('Unknown')).toBeInTheDocument();
    expect(measurements.getAllByRole('link', { name: 'DocumentReference/evidence/_history/v1' })[0]).toHaveAttribute(
      'href',
      '/DocumentReference/evidence/history'
    );
    const enrollment = within(screen.getByRole('table', { name: 'Enrollment determinations' }));
    expect(enrollment.getByText('needs review')).toBeInTheDocument();
    expect(enrollment.getByText('2026-09-01')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Amendment reason' })).not.toBeInTheDocument();
    expect(saveIntake).not.toHaveBeenCalled();
  });
  it('keeps missing exposure dates and worksite explicitly unrecorded', async () => {
    vi.mocked(loadIntakeExposures).mockResolvedValue([
      {
        resourceType: 'Observation',
        id: 'incomplete',
        meta: { project: OEM_PROJECT_ID, versionId: 'v1' },
        status: 'final',
        code: {},
      },
    ]);
    setup();
    await choose('Worker', 'Synthetic Worker');
    const timeline = within(await screen.findByRole('table', { name: 'Exposure timeline' }));
    expect(timeline.getAllByText('Not recorded')).toHaveLength(3);
    expect(timeline.getAllByText('Unknown')).toHaveLength(3);
  });
  it('warns when the exposure result reaches the bounded query limit', async () => {
    vi.mocked(loadIntakeExposures).mockResolvedValue(
      Array.from({ length: 50 }, (_, index) => ({
        resourceType: 'Observation',
        id: `episode-${index}`,
        meta: { project: OEM_PROJECT_ID, versionId: 'v1' },
        status: 'final',
        code: {},
      }))
    );
    setup();
    await choose('Worker', 'Synthetic Worker');
    expect(await screen.findByText('Record limit reached')).toBeInTheDocument();
    expect(screen.getByText(/older records may not be included/)).toBeInTheDocument();
  });
});
