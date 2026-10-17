import type { Basic } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import onboardingFixture from '../../../fhir/hawaii/onboarding-snapshot.json';
import { HAWAII_ONBOARDING_EXTENSION, HAWAII_ONBOARDING_SITE, HAWAII_ONBOARDING_SYSTEM,
  readHawaiiOnboardingSnapshot, summarizeHawaiiOnboarding, type HawaiiOnboardingSnapshot } from './onboarding';

function snapshotFixture(): HawaiiOnboardingSnapshot {
  return readHawaiiOnboardingSnapshot(resource(structuredClone(onboardingFixture)));
}

function resource(snapshot: unknown): Basic {
  return { resourceType: 'Basic', identifier: [{ system: HAWAII_ONBOARDING_SYSTEM, value: HAWAII_ONBOARDING_SITE }],
    code: { coding: [{ system: HAWAII_ONBOARDING_SYSTEM, code: 'site-readiness' }] },
    extension: [{ url: HAWAII_ONBOARDING_EXTENSION, valueString: JSON.stringify(snapshot) }] };
}

describe('persisted Hawaii onboarding evidence', () => {
  test('parses the explicit operational schema and reconciles metrics to records', () => {
    const snapshot = readHawaiiOnboardingSnapshot(resource(snapshotFixture()));
    expect(summarizeHawaiiOnboarding(snapshot)).toMatchObject({ submitted: 2, accepted: 1, rejected: 1,
      acceptancePercent: 50, completedStages: 3, assistanceCount: 1, readyForCutover: false });
  });

  test('unresolved validation overrides a falsely completed tracker and blocks cutover', () => {
    const snapshot = snapshotFixture();
    snapshot.stages.forEach((stage) => { stage.status = 'completed'; });
    const result = summarizeHawaiiOnboarding(snapshot);
    expect(result.readyForCutover).toBe(false);
    expect(result.completedStages).toBe(3);
    expect(result.stages.slice(3).every((stage) => stage.status === 'blocked')).toBe(true);
  });

  test('resolved issues alone do not bypass incomplete prerequisite stages', () => {
    const snapshot = snapshotFixture();
    snapshot.issues[0].status = 'resolved';
    expect(summarizeHawaiiOnboarding(snapshot).readyForCutover).toBe(false);
    snapshot.stages[3].status = 'completed';
    expect(summarizeHawaiiOnboarding(snapshot).readyForCutover).toBe(true);
  });

  test('empty monthly denominator is unknown, not a fabricated 100 percent', () => {
    const snapshot = snapshotFixture();
    snapshot.reportingMonth = '2026-09';
    expect(summarizeHawaiiOnboarding(snapshot)).toMatchObject({ submitted: 0, accepted: 0, rejected: 0, assistanceCount: 0 });
    expect(summarizeHawaiiOnboarding(snapshot).acceptancePercent).toBeUndefined();
  });

  for (const [name, mutate] of [
    ['duplicate stage', (snapshot: HawaiiOnboardingSnapshot) => { snapshot.stages[1] = snapshot.stages[0]; }],
    ['unlinked issue', (snapshot: HawaiiOnboardingSnapshot) => { snapshot.issues[0].recordId = 'missing'; }],
    ['duplicate record', (snapshot: HawaiiOnboardingSnapshot) => { snapshot.records.push(snapshot.records[0]); }],
    ['future record', (snapshot: HawaiiOnboardingSnapshot) => { snapshot.records[0].receivedAt = '2030-01-01T00:00:00Z'; }],
    ['missing rejection evidence', (snapshot: HawaiiOnboardingSnapshot) => { snapshot.issues = []; }],
    ['invalid time', (snapshot: HawaiiOnboardingSnapshot) => { snapshot.observedAt = 'invalid'; }],
  ] as const) {
    test(`rejects ${name}`, () => {
      const snapshot = snapshotFixture();
      mutate(snapshot);
      expect(() => readHawaiiOnboardingSnapshot(resource(snapshot))).toThrow();
    });
  }

  test('rejects a wrong operational identifier or ambiguous extension', () => {
    const value = resource(snapshotFixture());
    value.extension?.push(value.extension[0]);
    expect(() => readHawaiiOnboardingSnapshot(value)).toThrow();
    value.identifier = [];
    expect(() => readHawaiiOnboardingSnapshot(value)).toThrow();
  });
});