import type { Consent } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import { getHawaiiConsentStatus } from './consent';

describe('Hawaii consent display gate', () => {
  const consent: Consent = {
    resourceType: 'Consent', status: 'active',
    scope: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy' }] },
    category: [{ text: 'Sharing' }],
    patient: { reference: 'Patient/patient-1' }, provision: { type: 'permit' },
  };
  const now = new Date('2026-10-16T12:00:00Z');
  test('requires exactly one active patient-specific permit', () => {
    expect(getHawaiiConsentStatus([consent], 'patient-1', now)).toBe('opt-in');
    expect(getHawaiiConsentStatus([], 'patient-1', now)).toBe('not-declared');
    expect(getHawaiiConsentStatus([{ ...consent, status: 'inactive' }], 'patient-1', now)).toBe('not-declared');
    expect(getHawaiiConsentStatus([consent, consent], 'patient-1', now)).toBe('unsupported');
    expect(getHawaiiConsentStatus([consent], 'other-patient', now)).toBe('unsupported');
  });
  test('never interprets a consent category label as permission', () => {
    expect(getHawaiiConsentStatus([{ ...consent, category: [{ text: 'opt-in' }], provision: undefined }], 'patient-1', now))
      .toBe('unsupported');
    expect(getHawaiiConsentStatus([{ ...consent, provision: { type: 'deny' } }], 'patient-1', now)).toBe('opt-out');
  });
  test.each([
    { type: 'permit' as const, provision: [{ type: 'deny' as const }] },
    { type: 'permit' as const, purpose: [{ code: 'TREAT' }] },
    { type: 'permit' as const, data: [{ meaning: 'instance' as const, reference: { reference: 'Observation/1' } }] },
  ])('does not approximate constrained policies: %j', (provision) => {
    expect(getHawaiiConsentStatus([{ ...consent, provision }], 'patient-1', now)).toBe('unsupported');
  });
  test.each([
    { start: '2027-01-01T00:00:00Z' }, { end: '2026-10-16T12:00:00Z' }, { end: 'invalid' },
  ])('blocks future, expired, or malformed periods: %j', (period) => {
    expect(getHawaiiConsentStatus([{ ...consent, provision: { type: 'permit', period } }], 'patient-1', now))
      .toBe('not-declared');
  });
});