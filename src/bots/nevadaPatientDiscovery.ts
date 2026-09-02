import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Consent, Patient } from '@medplum/fhirtypes';

interface DiscoveryRequest {
  readonly query?: string;
}

interface DiscoveryResult {
  readonly resourceType: 'Patient';
  readonly id: string;
  readonly name?: Patient['name'];
  readonly birthDate?: string;
  readonly gender?: Patient['gender'];
  readonly identifier?: Patient['identifier'];
  readonly consentStatus: string;
}

function getConsentStatus(consent: Consent | undefined): string {
  return consent?.category?.[0]?.text ?? 'not-declared';
}

function directoryIdentifiers(patient: Patient): Patient['identifier'] {
  return patient.identifier?.filter((identifier) => !identifier.system?.includes('us-ssn'));
}

/** Returns minimum-necessary directory data for secure Break-Glass discovery. */
export async function handler(
  medplum: MedplumClient,
  event: BotEvent<DiscoveryRequest>
): Promise<DiscoveryResult[]> {
  const query = event.input?.query?.trim();
  if (!query || query.length < 2) {
    return [];
  }

  const patients = (await medplum.searchResources('Patient', {
    name: query,
    active: 'true',
    _count: '20',
  })) as Patient[];

  return Promise.all(
    patients.filter((patient) => patient.id).map(async (patient) => {
      const consents = (await medplum.searchResources('Consent', {
        patient: `Patient/${patient.id}`,
        status: 'active',
        _sort: '-_lastUpdated',
        _count: '1',
      })) as Consent[];
      return {
        resourceType: 'Patient' as const,
        id: patient.id as string,
        name: patient.name,
        birthDate: patient.birthDate,
        gender: patient.gender,
        identifier: directoryIdentifiers(patient),
        consentStatus: getConsentStatus(consents[0]),
      };
    })
  );
}
