import { MantineProvider } from '@mantine/core';
import type { Patient, Resource } from '@medplum/fhirtypes';
import { useMedplum, useSearchResources } from '@medplum/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { usePatient } from '../../hooks/usePatient';
import { CaliforniaViewerTab } from './CaliforniaViewerTab';

vi.mock('../../hooks/usePatient', () => ({ usePatient: vi.fn() }));
vi.mock('@medplum/react', () => ({ useMedplum: vi.fn(), useSearchResources: vi.fn() }));

const BAY_CARE_SOURCE = 'https://hiivehealth.com/fhir/Organization/california-demo-org-bay-care';
const CENTRAL_VALLEY_SOURCE = 'https://hiivehealth.com/fhir/Organization/california-demo-org-central-valley';

const patient: Patient = {
  resourceType: 'Patient',
  id: 'maya-chen',
  identifier: [
    {
      system: 'https://hiivehealth.com/fhir/identifier/california-demo-org-bay-care',
      assigner: { display: 'Bay Care Network', reference: 'Organization/california-demo-org-bay-care' },
    },
    {
      system: 'https://hiivehealth.com/fhir/identifier/california-demo-org-central-valley',
      assigner: {
        display: 'Central Valley Community Health',
        reference: 'Organization/california-demo-org-central-valley',
      },
    },
  ],
};

const resourcesByType: Record<string, Resource[]> = {
  Condition: [
    {
      resourceType: 'Condition',
      id: 'diabetes',
      meta: { source: BAY_CARE_SOURCE },
      code: { text: 'Type 2 diabetes mellitus' },
    },
  ],
  AllergyIntolerance: [
    {
      resourceType: 'AllergyIntolerance',
      id: 'penicillin-allergy',
      meta: { source: CENTRAL_VALLEY_SOURCE },
      criticality: 'high',
      code: { text: 'Penicillin' },
    },
  ],
  MedicationRequest: [],
  Observation: [
    {
      resourceType: 'Observation',
      id: 'critical-potassium',
      meta: { source: CENTRAL_VALLEY_SOURCE },
      code: { text: 'Potassium' },
      interpretation: [{ coding: [{ code: 'HH' }] }],
    },
    {
      resourceType: 'Observation',
      id: 'housing-status',
      meta: { source: CENTRAL_VALLEY_SOURCE },
      code: { coding: [{ code: '71802-3', display: 'Housing status' }] },
      valueCodeableConcept: { text: 'Unstable housing' },
    },
  ],
  Encounter: [],
  DocumentReference: [
    {
      resourceType: 'DocumentReference',
      id: 'care-transition-summary',
      meta: { source: CENTRAL_VALLEY_SOURCE },
      content: [{ attachment: { contentType: 'application/xml', title: 'Care transition summary.xml' } }],
    },
  ],
  Coverage: [
    {
      resourceType: 'Coverage',
      id: 'medi-cal',
      meta: { source: CENTRAL_VALLEY_SOURCE },
      payor: [{ display: 'California Medi-Cal' }],
    },
  ],
  CarePlan: [
    {
      resourceType: 'CarePlan',
      id: 'enhanced-care-management',
      meta: { source: CENTRAL_VALLEY_SOURCE },
      title: 'Enhanced Care Management',
    },
  ],
  DiagnosticReport: [
    {
      resourceType: 'DiagnosticReport',
      id: 'a1c-report',
      meta: { source: CENTRAL_VALLEY_SOURCE },
      code: { text: 'Hemoglobin A1c report' },
    },
  ],
  Immunization: [
    {
      resourceType: 'Immunization',
      id: 'influenza',
      meta: { source: CENTRAL_VALLEY_SOURCE },
      vaccineCode: { text: 'Seasonal influenza vaccine' },
    },
  ],
  Procedure: [
    {
      resourceType: 'Procedure',
      id: 'retinal-exam',
      meta: { source: CENTRAL_VALLEY_SOURCE },
      code: { text: 'Retinal examination' },
    },
  ],
  CareTeam: [
    {
      resourceType: 'CareTeam',
      id: 'care-team',
      meta: { source: CENTRAL_VALLEY_SOURCE },
      name: 'California Demo Care Team',
    },
  ],
  RelatedPerson: [
    {
      resourceType: 'RelatedPerson',
      id: 'emergency-contact',
      meta: { source: CENTRAL_VALLEY_SOURCE },
      name: [{ given: ['Jordan'], family: 'Chen' }],
    },
  ],
};

const createResource = vi.fn();

describe('CaliforniaViewerTab', () => {
  beforeEach(() => {
    createResource.mockClear();
    vi.mocked(usePatient).mockReturnValue(patient);
    vi.mocked(useMedplum).mockReturnValue({ createResource } as never);
    vi.mocked(useSearchResources).mockImplementation(
      (resourceType) => [resourcesByType[resourceType] ?? [], false] as never
    );
  });

  test('filters clinical records and safety alerts by selected source', async () => {
    const user = userEvent.setup();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(
      <MantineProvider>
        <MemoryRouter>
          <CaliforniaViewerTab />
        </MemoryRouter>
      </MantineProvider>
    );

    expect(screen.getByText('High-criticality allergy documented.')).toBeInTheDocument();
    expect(screen.getByText('Critical laboratory result requires review.')).toBeInTheDocument();
    expect(screen.getByText('Penicillin')).toBeInTheDocument();
    expect(screen.getByText('Type 2 diabetes mellitus')).toBeInTheDocument();
    expect(screen.getByText('Housing status: Unstable housing')).toBeInTheDocument();
    expect(screen.getByText('California Medi-Cal')).toBeInTheDocument();
    expect(screen.getByText('Enhanced Care Management')).toBeInTheDocument();
    expect(screen.getByText('Hemoglobin A1c report')).toBeInTheDocument();
    expect(screen.getByText('Seasonal influenza vaccine')).toBeInTheDocument();
    expect(screen.getByText('Retinal examination')).toBeInTheDocument();
    expect(screen.getByText('California Demo Care Team')).toBeInTheDocument();
    expect(screen.getByText('Jordan Chen')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Care transition summary.xml' })).toHaveAttribute(
      'href',
      '/Patient/maya-chen/DocumentReference/care-transition-summary'
    );
    expect(screen.getByRole('link', { name: 'Export patient data' })).toHaveAttribute(
      'href',
      '/Patient/maya-chen/export'
    );
    await waitFor(() =>
      expect(createResource).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'AuditEvent', action: 'R' }))
    );

    await user.click(screen.getByRole('button', { name: 'Print visible summary' }));
    expect(printSpy).toHaveBeenCalledOnce();

    await user.type(screen.getByLabelText('Filter details'), 'retinal');
    expect(screen.getByText('Retinal examination')).toBeInTheDocument();
    expect(screen.queryByText('Type 2 diabetes mellitus')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Filter details'));

    await user.click(screen.getByRole('tab', { name: /Care and support/ }));
    expect(screen.queryByText('Type 2 diabetes mellitus')).not.toBeInTheDocument();
    expect(screen.getByText('California Medi-Cal')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /All/ }));
    await user.click(await screen.findByRole('option', { name: 'Bay Care Network', hidden: true }));

    expect(screen.queryByText('Clinical safety alerts')).not.toBeInTheDocument();
    expect(screen.queryByText('Penicillin')).not.toBeInTheDocument();
    expect(screen.queryByText('Critical laboratory result requires review.')).not.toBeInTheDocument();
    expect(screen.queryByText('Housing status: Unstable housing')).not.toBeInTheDocument();
    expect(screen.queryByText('California Medi-Cal')).not.toBeInTheDocument();
    expect(screen.queryByText('Enhanced Care Management')).not.toBeInTheDocument();
    expect(screen.queryByText('Hemoglobin A1c report')).not.toBeInTheDocument();
    expect(screen.queryByText('Seasonal influenza vaccine')).not.toBeInTheDocument();
    expect(screen.queryByText('Retinal examination')).not.toBeInTheDocument();
    expect(screen.queryByText('California Demo Care Team')).not.toBeInTheDocument();
    expect(screen.queryByText('Jordan Chen')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Care transition summary.xml' })).not.toBeInTheDocument();
    expect(screen.getByText('Type 2 diabetes mellitus')).toBeInTheDocument();
  });
});
