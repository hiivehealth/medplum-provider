import { MantineProvider } from '@mantine/core';
import { calculateAge } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, test } from 'vitest';
import { ResourceDetailPage } from './ResourceDetailPage';

const namespace = 'https://ehr.hiivehealth.net/fhir';

describe('Patient resource details', () => {
  test('keeps non-Army Patient details unchanged', async () => {
    const medplum = new MockClient();
    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ family: 'Smith', given: ['Alex'] }],
    });

    render(
      <MedplumProvider medplum={medplum}>
        <MantineProvider>
          <MemoryRouter initialEntries={[`/Patient/${patient.id}`]}>
            <Routes>
              <Route path="/:resourceType/:id" element={<ResourceDetailPage />} />
            </Routes>
          </MemoryRouter>
        </MantineProvider>
      </MedplumProvider>
    );

    expect(await screen.findByText('Alex Smith')).toBeInTheDocument();
    expect(screen.queryByText('Army Demographics')).not.toBeInTheDocument();
  });

  test('shows Army demographic extensions on the Details tab', async () => {
    const medplum = new MockClient();
    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ family: 'Armtest', given: ['Taylor'] }],
      gender: 'female',
      birthDate: '2000-03-04',
      meta: { profile: [`${namespace}/StructureDefinition/hiive-army-demographics-patient`] },
      identifier: [{ system: `${namespace}/identifier/dod-id`, value: '1234567890' }],
      extension: [
        {
          url: `${namespace}/StructureDefinition/military-service`,
          extension: [
            { url: 'affiliation', valueCoding: { code: 'active', display: 'Active Duty' } },
            { url: 'branch', valueCoding: { code: 'army', display: 'Army' } },
            { url: 'grade', valueCoding: { code: 'E-5' } },
          ],
        },
        { url: `${namespace}/StructureDefinition/administrative-blood-type`, valueCoding: { code: 'A-', display: 'A negative' } },
        { url: `${namespace}/StructureDefinition/vip-status`, valueBoolean: false },
      ],
    });

    render(
      <MedplumProvider medplum={medplum}>
        <MantineProvider>
          <MemoryRouter initialEntries={[`/Patient/${patient.id}`]}>
            <Routes>
              <Route path="/:resourceType/:id" element={<ResourceDetailPage />} />
            </Routes>
          </MemoryRouter>
        </MantineProvider>
      </MedplumProvider>
    );

    expect(await screen.findByText('DoD ID')).toBeInTheDocument();
    expect(await screen.findByText('Identifier')).toBeInTheDocument();
    expect(screen.getByText('DoD ID').tagName).toBe('DT');
    expect(screen.getByText('DoD ID').closest('dl')).toBeTruthy();
    const armyRows = screen.getByText('DoD ID').closest('dl') as HTMLElement;
    expect(within(armyRows).getByText('Gender')).toBeInTheDocument();
    expect(within(armyRows).getByText('Female')).toBeInTheDocument();
    expect(within(armyRows).getByText('Age')).toBeInTheDocument();
    expect(within(armyRows).getByText(String(calculateAge('2000-03-04').years))).toBeInTheDocument();
    expect(within(armyRows).getByText('Birthday')).toBeInTheDocument();
    expect(within(armyRows).getByText('3/4/2000')).toBeInTheDocument();
    expect(screen.getByText('DoD ID').closest('dl')?.previousElementSibling?.previousElementSibling?.tagName).toBe(
      'DL'
    );
    expect(screen.getByText('Active Duty')).toBeInTheDocument();
    expect(screen.getByText('Army')).toBeInTheDocument();
    expect(screen.getByText('E-5')).toBeInTheDocument();
    expect(within(armyRows).getByText('A-')).toBeInTheDocument();
    expect(screen.queryByText('A negative')).not.toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByText('1234567890')).toBeInTheDocument();
    expect(screen.queryByText('******7890')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /(?:Show|Hide) DoD ID/ })).not.toBeInTheDocument();
  });

  test('shows unrecorded Army fields on a Patient with a DoD ID', async () => {
    const medplum = new MockClient();
    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      identifier: [{ system: `${namespace}/identifier/dod-id`, value: '1234567890' }],
    });

    render(
      <MedplumProvider medplum={medplum}>
        <MantineProvider>
          <MemoryRouter initialEntries={[`/Patient/${patient.id}`]}>
            <Routes>
              <Route path="/:resourceType/:id" element={<ResourceDetailPage />} />
            </Routes>
          </MemoryRouter>
        </MantineProvider>
      </MedplumProvider>
    );

    expect(await screen.findByText('DoD ID')).toBeInTheDocument();
    const armyRows = screen.getByText('DoD ID').closest('dl') as HTMLElement;
    expect(screen.getByText('Affiliation')).toBeInTheDocument();
    expect(within(armyRows).getByText('Gender')).toBeInTheDocument();
    expect(within(armyRows).getByText('Age')).toBeInTheDocument();
    expect(within(armyRows).getByText('Birthday')).toBeInTheDocument();
    expect(screen.getByText('Branch')).toBeInTheDocument();
    expect(screen.getByText('Grade')).toBeInTheDocument();
    expect(screen.getByText('Blood Type')).toBeInTheDocument();
    expect(screen.getByText('VIP')).toBeInTheDocument();
    expect(screen.getAllByText('Not recorded')).toHaveLength(8);
  });
});