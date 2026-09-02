import type { BotEvent, MedplumClient } from '@medplum/core';
import type { AuditEvent, Consent, ProjectMembership, Reference } from '@medplum/fhirtypes';
import { createBreakGlassProvenance } from '../utils/audit';
import { BREAK_GLASS_EXPIRATION_PARAMETER, BREAK_GLASS_PATIENT_PARAMETER } from '../utils/breakGlass';

const BREAK_GLASS_POLICY_NAME = 'Nevada HIE Provider Break-Glass Production Policy';
const BREAK_GLASS_DURATION_MINUTES = 60;
const BREAK_GLASS_EXPIRATION_URL = 'https://hiivehealth.com/fhir/StructureDefinition/break-glass-expiration';

function isNotDeclaredConsent(consent: Consent | undefined): boolean {
  if (!consent) {
    return true;
  }
  const status = consent.category?.[0]?.text?.toLowerCase();
  return status === 'not-declared' || (!status && consent.provision?.type === 'deny');
}

function getPatientReference(event: AuditEvent): string | undefined {
  return event.entity?.find((entity) => entity.what?.reference?.startsWith('Patient/'))?.what?.reference;
}

function getProviderReference(event: AuditEvent): Reference | undefined {
  return event.agent?.find((agent) => agent.requestor !== false)?.who;
}

function isBreakGlassRequest(event: AuditEvent): boolean {
  return (
    event.subtype?.some((coding) => coding.code === 'emergency-access') === true &&
    event.action === 'R' &&
    event.outcome === '0' &&
    Boolean(event.outcomeDesc?.trim())
  );
}

function isEventAuthorMatchingProvider(event: AuditEvent, providerReference: Reference): boolean {
  return event.meta?.author?.reference === providerReference.reference;
}

function hasPatientGrant(
  membership: ProjectMembership,
  patientReference: string,
  breakGlassPolicyReferences: Set<string>
): boolean {
  return membership.access?.some((access) =>
    Boolean(access.policy?.reference && breakGlassPolicyReferences.has(access.policy.reference)) &&
    access.parameter?.some(
      (parameter) => parameter.name === BREAK_GLASS_PATIENT_PARAMETER && parameter.valueReference?.reference === patientReference
    )
  ) ?? false;
}

/**
 * Medplum Bot handler for activating a temporary Break-Glass membership grant.
 * The provider must already be assigned to the restricted policy; this handler never
 * upgrades a broad policy or changes a provider's permanent access policy.
 */
export async function handler(medplum: MedplumClient, event: BotEvent<AuditEvent>): Promise<ProjectMembership | undefined> {
  const audit = event.input;
  if (!isBreakGlassRequest(audit)) {
    return undefined;
  }

  const patientReference = getPatientReference(audit);
  const providerReference = getProviderReference(audit);
  if (!patientReference || !providerReference?.reference?.startsWith('Practitioner/')) {
    throw new Error('Break-Glass request must identify a Patient and Practitioner.');
  }
  if (!isEventAuthorMatchingProvider(audit, providerReference)) {
    throw new Error('Break-Glass request author does not match the requesting Practitioner.');
  }

  const patientId = patientReference.replace('Patient/', '');
  const consents = (await medplum.searchResources('Consent', {
    patient: patientReference,
    status: 'active',
    _sort: '-_lastUpdated',
    _count: '1',
  })) as Consent[];
  const consent = consents[0];
  if (!isNotDeclaredConsent(consent)) {
    throw new Error('Break-Glass is only permitted while patient consent is not declared.');
  }

  const breakGlassPolicies = await medplum.searchResources('AccessPolicy', { name: BREAK_GLASS_POLICY_NAME, _count: '10' });
  const breakGlassPolicyReferences = new Set(
    breakGlassPolicies.filter((policy) => policy.id).map((policy) => `AccessPolicy/${policy.id}`)
  );
  if (breakGlassPolicyReferences.size === 0) {
    throw new Error('Restricted Break-Glass policy is not configured in this project.');
  }

  const memberships = (await medplum.searchResources('ProjectMembership', {
    profile: providerReference.reference,
    active: 'true',
    _count: '20',
  })) as ProjectMembership[];
  const membership = memberships.find((candidate) =>
    candidate.access?.some(
      (access) => Boolean(access.policy?.reference && breakGlassPolicyReferences.has(access.policy.reference))
    )
  );
  if (!membership?.id) {
    throw new Error('Provider is not assigned to the restricted Break-Glass policy.');
  }
  if (hasPatientGrant(membership, patientReference, breakGlassPolicyReferences)) {
    return membership;
  }

  const expiresAt = new Date(Date.now() + BREAK_GLASS_DURATION_MINUTES * 60 * 1000).toISOString();
  const access = membership.access ?? [];
  const policyAccess = access.find(
    (entry) => Boolean(entry.policy?.reference && breakGlassPolicyReferences.has(entry.policy.reference))
  );
  if (!policyAccess) {
    throw new Error('Restricted Break-Glass policy access entry is missing.');
  }
  policyAccess.parameter = [
    ...(policyAccess.parameter ?? []),
    { name: BREAK_GLASS_PATIENT_PARAMETER, valueReference: { reference: patientReference } },
    { name: BREAK_GLASS_EXPIRATION_PARAMETER, valueString: expiresAt },
  ];

  const updated = await medplum.updateResource({ ...membership, access });
  await medplum.updateResource({
    ...audit,
    extension: [
      ...(audit.extension ?? []).filter((extension) => extension.url !== BREAK_GLASS_EXPIRATION_URL),
      { url: BREAK_GLASS_EXPIRATION_URL, valueDateTime: expiresAt },
    ],
  });
  await medplum.createResource(
    createBreakGlassProvenance(patientId, audit.outcomeDesc ?? 'Emergency access', providerReference)
  );
  return updated;
}