import type { WithId } from '@medplum/core';
import { MantineProvider } from '@mantine/core';
import type { Encounter, Patient, Practitioner, Project, ProjectMembership, Questionnaire } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { A01_SORE_THROAT_DECISION_FLOW_URL, DECISION_FLOW_QUESTIONNAIRE_URLS } from '../data/decision-flows';
import { useDecisionFlows } from './useDecisionFlows';
import { DecisionFlowsPanel } from '../components/encounter/DecisionFlowsPanel/DecisionFlowsPanel';

const profile: WithId<Practitioner> = { resourceType: 'Practitioner', id: 'template-provider' };
const project: WithId<Project> = {
  resourceType: 'Project', id: 'army-project', name: 'Synthetic Army', features: ['army'] as Project['features'],
};
const membership: WithId<ProjectMembership> = {
  resourceType: 'ProjectMembership', id: 'membership', active: true,
  project: { reference: 'Project/army-project' }, profile: { reference: 'Practitioner/template-provider' },
};
const encounter: WithId<Encounter> = {
  resourceType: 'Encounter', id: 'encounter', meta: { project: 'army-project' }, status: 'in-progress',
  class: { code: 'AMB' }, subject: { reference: 'Patient/patient' },
};
const patient: WithId<Patient> = { resourceType: 'Patient', id: 'patient', meta: { project: 'army-project' } };
let medplum: MockClient;

function wrapper({ children }: { children: ReactNode }): ReactNode {
  return <MedplumProvider medplum={medplum}>{children}</MedplumProvider>;
}

beforeEach(async () => {
  medplum = new MockClient();
  vi.spyOn(medplum, 'getProject').mockReturnValue(project);
  vi.spyOn(medplum, 'getProjectMembership').mockReturnValue(membership);
  vi.spyOn(medplum, 'getProfile').mockReturnValue(profile);
  for (const [index, url] of DECISION_FLOW_QUESTIONNAIRE_URLS.entries()) {
    await medplum.createResource<Questionnaire>({
      resourceType: 'Questionnaire', id: `flow-${index}`, url, version: '1.0.0', status: 'active',
      meta: { project: 'army-project' },
    });
  }
});

test.each(['non-Army', 'missing eligibility', 'invalid eligibility', 'missing membership', 'inactive membership', 'cross-tenant', 'missing tenant'])(
  '%s context cannot load or submit A-01, but retains generic flows', async (context) => {
    if (context === 'non-Army') vi.mocked(medplum.getProject).mockReturnValue({ ...project, features: [] });
    if (context === 'missing eligibility') vi.mocked(medplum.getProject).mockReturnValue(undefined);
    if (context === 'invalid eligibility') vi.mocked(medplum.getProject).mockReturnValue({ ...project, features: 'army' as unknown as Project['features'] });
    if (context === 'missing membership') vi.mocked(medplum.getProjectMembership).mockReturnValue(undefined);
    if (context === 'inactive membership') vi.mocked(medplum.getProjectMembership).mockReturnValue({ ...membership, active: false });
    const scopedPatient = context === 'cross-tenant' ? { ...patient, meta: { project: 'other-project' } }
      : context === 'missing tenant' ? { ...patient, meta: undefined } : patient;
    const search = vi.spyOn(medplum, 'searchOne');
    const create = vi.spyOn(medplum, 'createResource');
    const { result } = renderHook(() => useDecisionFlows(encounter, scopedPatient), { wrapper });

    await waitFor(() => expect(result.current.flows.size).toBe(2));
    expect(result.current.flows.has(A01_SORE_THROAT_DECISION_FLOW_URL)).toBe(false);
    expect(search).not.toHaveBeenCalledWith('Questionnaire', { url: A01_SORE_THROAT_DECISION_FLOW_URL });
    await expect(result.current.completeResponse(A01_SORE_THROAT_DECISION_FLOW_URL, {
      resourceType: 'QuestionnaireResponse', status: 'completed',
    })).rejects.toThrow('not available');
    expect(create).not.toHaveBeenCalled();
  }
);

test('an authorized member can complete A-01 in the matching project', async () => {
  const { result } = renderHook(() => useDecisionFlows(encounter, patient), { wrapper });
  await waitFor(() => expect(result.current.flows.get(A01_SORE_THROAT_DECISION_FLOW_URL)?.questionnaire?.id).toBeDefined());
  const create = vi.spyOn(medplum, 'createResource');
  await act(async () => result.current.completeResponse(A01_SORE_THROAT_DECISION_FLOW_URL, {
    resourceType: 'QuestionnaireResponse', status: 'completed',
  }));
  expect(create).toHaveBeenCalledWith(expect.objectContaining({
    questionnaire: `${A01_SORE_THROAT_DECISION_FLOW_URL}|1.0.0`,
    encounter: { reference: 'Encounter/encounter' }, subject: { reference: 'Patient/patient' },
  }));
});

test('cross-project Questionnaires cannot be submitted', async () => {
  const questionnaire = await medplum.searchOne('Questionnaire', { url: A01_SORE_THROAT_DECISION_FLOW_URL });
  await medplum.updateResource({ ...questionnaire!, meta: { project: 'other-project' } });
  const { result } = renderHook(() => useDecisionFlows(encounter, patient), { wrapper });
  await waitFor(() => expect(result.current.flows.get(A01_SORE_THROAT_DECISION_FLOW_URL)?.loading).toBe(false));
  expect(result.current.flows.get(A01_SORE_THROAT_DECISION_FLOW_URL)?.questionnaire).toBeUndefined();
  await expect(result.current.completeResponse(A01_SORE_THROAT_DECISION_FLOW_URL, {
    resourceType: 'QuestionnaireResponse', status: 'completed',
  })).rejects.toThrow('not available');
});

test.each(['read', 'write'])('an Army member remains subject to server %s restrictions', async (interaction) => {
  if (interaction === 'read') {
    const search = medplum.searchOne.bind(medplum);
    vi.spyOn(medplum, 'searchOne').mockImplementation((resourceType, query, options) => {
      if (typeof query === 'object' && query && 'url' in query && query.url === A01_SORE_THROAT_DECISION_FLOW_URL) {
        return Promise.reject(new Error('Forbidden')) as never;
      }
      return search(resourceType, query, options) as never;
    });
  }
  const { result } = renderHook(() => useDecisionFlows(encounter, patient), { wrapper });
  await waitFor(() => expect(result.current.flows.get(A01_SORE_THROAT_DECISION_FLOW_URL)?.loading).toBe(false));
  const create = vi.spyOn(medplum, 'createResource').mockRejectedValue(new Error('Forbidden'));
  await expect(result.current.completeResponse(A01_SORE_THROAT_DECISION_FLOW_URL, {
    resourceType: 'QuestionnaireResponse', status: 'completed',
  })).rejects.toThrow(interaction === 'read' ? 'not available' : 'Forbidden');
  expect(result.current.flows.get(A01_SORE_THROAT_DECISION_FLOW_URL)?.response).toBeUndefined();
  if (interaction === 'read') expect(create).not.toHaveBeenCalled();
});

test.each([false, true])('selector exposes A-01 only with verified Army access (%s)', async (army) => {
  if (!army) vi.mocked(medplum.getProject).mockReturnValue({ ...project, features: [] });
  const { result } = renderHook(() => useDecisionFlows(encounter, patient), { wrapper });
  await waitFor(() => expect(result.current.flows.size).toBe(army ? 3 : 2));
  render(<MantineProvider><DecisionFlowsPanel decisionFlows={result.current} /></MantineProvider>);
  await userEvent.click(screen.getByRole('textbox', { name: 'Decision flow' }));
  expect(screen.getByText('Chest Pain Triage')).toBeInTheDocument();
  expect(screen.queryByText('Sore Throat/Hoarseness, A-01') !== null).toBe(army);
});

test('revoking eligibility immediately hides loaded A-01 state and prevents writes', async () => {
  const { result, rerender } = renderHook(() => useDecisionFlows(encounter, patient), { wrapper });
  await waitFor(() => expect(result.current.flows.get(A01_SORE_THROAT_DECISION_FLOW_URL)?.questionnaire).toBeDefined());
  vi.mocked(medplum.getProject).mockReturnValue({ ...project, features: [] });
  rerender();
  expect(result.current.flows.has(A01_SORE_THROAT_DECISION_FLOW_URL)).toBe(false);
  await expect(result.current.completeResponse(A01_SORE_THROAT_DECISION_FLOW_URL, {
    resourceType: 'QuestionnaireResponse', status: 'completed',
  })).rejects.toThrow('not available');
});