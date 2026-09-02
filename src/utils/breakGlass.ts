import type { Patient, Reference } from '@medplum/fhirtypes';

export const BREAK_GLASS_ACCESS_EXTENSION = 'https://hiivehealth.com/fhir/StructureDefinition/break-glass-access';
export const BREAK_GLASS_PROVIDER_EXTENSION = 'provider';
export const BREAK_GLASS_EXPIRATION_EXTENSION = 'expiresAt';
export const BREAK_GLASS_PATIENT_PARAMETER = 'patient';
export const BREAK_GLASS_EXPIRATION_PARAMETER = 'break_glass_expires_at';

export function buildBreakGlassAccessExtension(provider: Reference, expiresAt: string) {
  return {
    url: BREAK_GLASS_ACCESS_EXTENSION,
    extension: [
      { url: BREAK_GLASS_PROVIDER_EXTENSION, valueReference: provider },
      { url: BREAK_GLASS_EXPIRATION_EXTENSION, valueDateTime: expiresAt },
    ],
  };
}

export function getBreakGlassAccessExtensions(patient: Patient) {
  return (patient.extension ?? []).filter((extension) => extension.url === BREAK_GLASS_ACCESS_EXTENSION);
}

export function isBreakGlassAccessExpired(
  extension: NonNullable<Patient['extension']>[number],
  now = new Date()
): boolean {
  const expiresAt = extension.extension?.find((item) => item.url === BREAK_GLASS_EXPIRATION_EXTENSION)?.valueDateTime;
  return Boolean(expiresAt && Date.parse(expiresAt) <= now.getTime());
}

export function removeExpiredBreakGlassAccess(patient: Patient, now = new Date()): Patient {
  const extensions = patient.extension ?? [];
  const expiredProviders = new Set(
    getBreakGlassAccessExtensions(patient)
      .filter((extension) => isBreakGlassAccessExpired(extension, now))
      .map((extension) => extension.extension?.find((item) => item.url === BREAK_GLASS_PROVIDER_EXTENSION)?.valueReference?.reference)
      .filter((reference): reference is string => Boolean(reference))
  );

  if (expiredProviders.size === 0) {
    return patient;
  }

  return {
    ...patient,
    generalPractitioner: patient.generalPractitioner?.filter((provider) => !expiredProviders.has(provider.reference ?? '')),
    extension: extensions.filter(
      (extension) => extension.url !== BREAK_GLASS_ACCESS_EXTENSION || !isBreakGlassAccessExpired(extension, now)
    ),
  };
}