import type { Consent } from '@medplum/fhirtypes';

export type HawaiiConsentStatus = 'opt-in' | 'opt-out' | 'not-declared' | 'unsupported';

export function getHawaiiConsentStatus(consents: Consent[], patientId: string, now = new Date()): HawaiiConsentStatus {
  const active = consents.filter((consent) => consent.status === 'active');
  if (active.length === 0) {
    return 'not-declared';
  }
  if (active.length !== 1) {
    return 'unsupported';
  }
  const consent = active[0];
  if (consent.patient?.reference !== `Patient/${patientId}` || !consent.provision) {
    return 'unsupported';
  }
  if (consent.provision.type === 'deny') {
    return 'opt-out';
  }
  if (consent.provision.type !== 'permit' ||
    Object.keys(consent.provision).some((key) => !['type', 'period'].includes(key))) {
    return 'unsupported';
  }
  const { start, end } = consent.provision.period ?? {};
  if ((start && (!Number.isFinite(Date.parse(start)) || Date.parse(start) > now.getTime())) ||
    (end && (!Number.isFinite(Date.parse(end)) || Date.parse(end) <= now.getTime()))) {
    return 'not-declared';
  }
  return 'opt-in';
}