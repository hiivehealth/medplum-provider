import { MantineProvider } from '@mantine/core';
import { calculateAge } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { armyDemographicsSection, isArmyDemographicsPatient } from './ArmyDemographicsSection';

const namespace = 'https://ehr.hiivehealth.net/fhir';
const profile = `${namespace}/StructureDefinition/hiive-army-demographics-patient`;

describe('Army demographics sidebar', () => {
  test('only selects Patients with the exact Army profile', () => {
    expect(isArmyDemographicsPatient({ resourceType: 'Patient', meta: { profile: [profile] } })).toBe(true);
    expect(isArmyDemographicsPatient({ resourceType: 'Patient', meta: { profile: [`${profile}-evil`] } })).toBe(false);
    expect(isArmyDemographicsPatient({ resourceType: 'Patient' })).toBe(false);
    expect(
      isArmyDemographicsPatient({
        resourceType: 'Patient',
        identifier: [{ system: `${namespace}/identifier/dod-id`, value: '1234567890' }],
      })
    ).toBe(true);
  });

  test('shows recorded Army fields with the DoD identifier visible', () => {
    const patient: Patient = {
      resourceType: 'Patient',
      meta: { profile: [profile] },
      gender: 'female',
      birthDate: '2000-03-04',
      identifier: [{ system: `${namespace}/identifier/dod-id`, value: '1234567890' }],
      extension: [
        {
          url: `${namespace}/StructureDefinition/military-service`,
          extension: [
            { url: 'affiliation', valueCoding: { code: 'active', display: 'Active Duty' } },
            { url: 'branch', valueCoding: { code: 'army', display: 'Army' } },
            { url: 'grade', valueCoding: { code: 'E-5', display: 'Sergeant' } },
          ],
        },
        { url: `${namespace}/StructureDefinition/administrative-blood-type`, valueCoding: { code: 'A+', display: 'A positive' } },
        { url: `${namespace}/StructureDefinition/vip-status`, valueBoolean: false },
      ],
    };

    const Section = armyDemographicsSection.component;
    render(
      <MantineProvider>
        <Section patient={patient} results={{}} />
      </MantineProvider>
    );

    expect(screen.queryByText('Army Demographics')).not.toBeInTheDocument();
    expect(screen.getByText('1234567890')).toBeInTheDocument();
    expect(screen.getByText('Gender:')).toBeInTheDocument();
    expect(screen.getByText('Female')).toBeInTheDocument();
    expect(screen.getByText('Age:')).toBeInTheDocument();
    expect(screen.getByText(String(calculateAge('2000-03-04').years))).toBeInTheDocument();
    expect(screen.getByText('Birthday:')).toBeInTheDocument();
    expect(screen.getByText('3/4/2000')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /(?:Show|Hide) DoD ID/ })).not.toBeInTheDocument();
    expect(screen.getByText('Active Duty')).toBeInTheDocument();
    expect(screen.getByText('Army')).toBeInTheDocument();
    expect(screen.getByText('E-5')).toBeInTheDocument();
    expect(screen.queryByText('Sergeant')).not.toBeInTheDocument();
    expect(screen.getByText('A+')).toBeInTheDocument();
    expect(screen.queryByText('A positive')).not.toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });
});