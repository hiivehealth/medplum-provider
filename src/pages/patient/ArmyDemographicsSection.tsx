import { Group, Stack, Text } from '@mantine/core';
import { calculateAge } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { DescriptionList, DescriptionListEntry } from '@medplum/react';
import type { PatientSummarySectionConfig } from '@medplum/react';
import type { JSX } from 'react';

const namespace = 'https://ehr.hiivehealth.net/fhir';
const armyProfile = `${namespace}/StructureDefinition/hiive-army-demographics-patient`;
const militaryService = `${namespace}/StructureDefinition/military-service`;
export const armyDodIdSystem = `${namespace}/identifier/dod-id`;

export function isArmyDemographicsPatient(patient: Patient): boolean {
  return Boolean(
    patient.meta?.profile?.includes(armyProfile) ||
    patient.identifier?.some((identifier) => identifier.system === armyDodIdSystem) ||
    patient.extension?.some((extension) =>
      [
        militaryService,
        `${namespace}/StructureDefinition/administrative-blood-type`,
        `${namespace}/StructureDefinition/vip-status`,
      ].includes(extension.url)
    )
  );
}

export function ArmyDemographics({ patient, layout = 'sidebar' }: { patient: Patient; layout?: 'sidebar' | 'details' }): JSX.Element {
  const dodId = patient.identifier?.find((identifier) => identifier.system === armyDodIdSystem)?.value;
  const military = patient.extension?.find((extension) => extension.url === militaryService);
  const coding = (name: string): string | undefined => {
    const value = military?.extension?.find((extension) => extension.url === name)?.valueCoding;
    return value?.display ?? value?.code;
  };
  const bloodType = patient.extension?.find(
    (extension) => extension.url === `${namespace}/StructureDefinition/administrative-blood-type`
  )?.valueCoding;
  const vip = patient.extension?.find((extension) => extension.url === `${namespace}/StructureDefinition/vip-status`)
    ?.valueBoolean;
  const birthDate = patient.birthDate;
  const fullBirthDate = birthDate && /^\d{4}-\d{2}-\d{2}$/.test(birthDate);
  const birthday = fullBirthDate
    ? new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${birthDate}T00:00:00Z`)
      )
    : birthDate ?? 'Not recorded';
  const details = [
    ['DoD ID', dodId ?? 'Not recorded'],
    ['Gender', patient.gender ? patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1) : 'Not recorded'],
    ['Age', fullBirthDate ? String(calculateAge(birthDate).years) : 'Not recorded'],
    ['Birthday', birthday],
    ['Affiliation', coding('affiliation') ?? 'Not recorded'],
    ['Branch', coding('branch') ?? 'Not recorded'],
    ['Grade', coding('grade') ?? 'Not recorded'],
    ['Blood Type', bloodType?.code ?? bloodType?.display ?? 'Not recorded'],
    ['VIP', vip === undefined ? 'Not recorded' : vip ? 'Yes' : 'No'],
  ];

  if (layout === 'details') {
    return (
      <DescriptionList>
        {details.map(([label, value]) => (
          <DescriptionListEntry key={label} term={label}>
            <span>{value}</span>
          </DescriptionListEntry>
        ))}
      </DescriptionList>
    );
  }

  return (
    <Stack gap="xs" py={8}>
      {details.map(([label, value]) => (
        <Group key={label} gap="xs" wrap="wrap">
          <Text fz="sm" c="dimmed">
            {label}:
          </Text>
          <Text fz="sm">
            {value}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

export const armyDemographicsSection: PatientSummarySectionConfig = {
  key: 'army-demographics',
  title: 'Army Demographics',
  component: ArmyDemographics,
};