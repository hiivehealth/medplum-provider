import type { MedplumClient, WithId } from '@medplum/core';
import type { Encounter, Task } from '@medplum/fhirtypes';
import { getHawaiiConsentStatus } from './consent';

export const HAWAII_FOLLOW_UP_SYSTEM = 'https://hiivehealth.com/fhir/identifier/hawaii-cqie-follow-up';

export function buildHawaiiFollowUp(
  encounter: Encounter,
  patientId: string,
  ownerReference: string,
  receivedAt: string
): Task {
  if (!encounter.id || encounter.status !== 'finished' || encounter.class.code !== 'IMP' ||
    encounter.subject?.reference !== `Patient/${patientId}` ||
    !encounter.period?.end || !Number.isFinite(Date.parse(encounter.period.end)) ||
    !/^Practitioner\/[A-Za-z0-9.-]+$/.test(ownerReference) ||
    !Number.isFinite(Date.parse(receivedAt))) {
    throw new Error('A finished patient-bound inpatient discharge and assigned clinician are required');
  }
  return {
    resourceType: 'Task',
    identifier: [{ system: HAWAII_FOLLOW_UP_SYSTEM, value: `Encounter/${encounter.id}` }],
    status: 'requested',
    intent: 'order',
    priority: 'routine',
    code: { text: 'Post-discharge follow-up' },
    description: 'Reconcile medications and arrange primary care follow-up.',
    for: { reference: `Patient/${patientId}` },
    focus: { reference: `Encounter/${encounter.id}` },
    encounter: { reference: `Encounter/${encounter.id}` },
    owner: { reference: ownerReference },
    requester: encounter.serviceProvider,
    authoredOn: receivedAt,
    input: [{ type: { text: 'Discharge event time' }, valueDateTime: encounter.period.end }],
  };
}

export function getHawaiiFollowUpIdentifier(encounterId: string): string {
  return `${HAWAII_FOLLOW_UP_SYSTEM}|Encounter/${encounterId}`;
}

export async function handleHawaiiDischarge(
  medplum: MedplumClient,
  input: Encounter,
  config: { patientId: string; ownerReference: string },
  receivedAt = new Date().toISOString()
): Promise<WithId<Task>> {
  if (input.resourceType !== 'Encounter' || !input.id) {
    throw new Error('A persisted discharge encounter is required');
  }
  const encounter = await medplum.readResource('Encounter', input.id, { cache: 'no-cache' });
  const task = buildHawaiiFollowUp(encounter, config.patientId, config.ownerReference, receivedAt);
  const consents = await medplum.searchResources('Consent', {
    patient: `Patient/${config.patientId}`, status: 'active', _count: '2',
  }, { cache: 'no-cache' });
  if (getHawaiiConsentStatus(consents, config.patientId) !== 'opt-in') {
    throw new Error('Discharge follow-up sharing permission is unavailable');
  }
  return medplum.createResourceIfNoneExist(task, new URLSearchParams({
    identifier: getHawaiiFollowUpIdentifier(encounter.id as string),
  }).toString());
}