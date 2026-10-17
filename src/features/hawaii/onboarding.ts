import type { Basic } from '@medplum/fhirtypes';

export const HAWAII_ONBOARDING_SYSTEM = 'https://hiivehealth.com/fhir/identifier/hawaii-cqie-onboarding';
export const HAWAII_ONBOARDING_EXTENSION = 'https://hiivehealth.com/fhir/StructureDefinition/hawaii-cqie-onboarding';
export const HAWAII_ONBOARDING_SITE = 'synthetic-rural-site';
export const HAWAII_ONBOARDING_STAGES = ['assessment', 'connectivity', 'mapping', 'validation', 'cutover', 'monitoring'] as const;

export interface HawaiiOnboardingSnapshot {
  schemaVersion: 1;
  siteName: string;
  observedAt: string;
  reportingMonth: string;
  stages: { code: typeof HAWAII_ONBOARDING_STAGES[number]; status: 'not-started' | 'in-progress' | 'completed' }[];
  records: { id: string; receivedAt: string; result: 'accepted' | 'rejected' }[];
  issues: { id: string; recordId: string; field: string; code: string; status: 'open' | 'resolved'; detectedAt: string; description: string }[];
  assistance: { id: string; occurredAt: string; category: 'mapping-review' | 'validation-review' | 'training'; summary: string }[];
}

function requireCondition(condition: unknown): asserts condition {
  if (!condition) { throw new Error('Invalid operational snapshot'); }
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 2000;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function instant(value: unknown, latest?: number): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value)) && (latest === undefined || Date.parse(value) <= latest);
}

function uniqueIds(entries: Record<string, unknown>[]): boolean {
  return entries.every((entry) => text(entry.id)) && new Set(entries.map((entry) => entry.id)).size === entries.length;
}

export function readHawaiiOnboardingSnapshot(resource: Basic): HawaiiOnboardingSnapshot {
  requireCondition(resource.identifier?.some((identifier) => identifier.system === HAWAII_ONBOARDING_SYSTEM &&
    identifier.value === HAWAII_ONBOARDING_SITE));
  requireCondition(resource.code?.coding?.some((coding) => coding.system === HAWAII_ONBOARDING_SYSTEM && coding.code === 'site-readiness'));
  const extensions = resource.extension?.filter((extension) => extension.url === HAWAII_ONBOARDING_EXTENSION) ?? [];
  requireCondition(extensions.length === 1 && typeof extensions[0].valueString === 'string' && extensions[0].valueString.length <= 100000);
  const snapshot: unknown = JSON.parse(extensions[0].valueString);
  requireCondition(object(snapshot) && snapshot.schemaVersion === 1 && text(snapshot.siteName) && instant(snapshot.observedAt) &&
    typeof snapshot.reportingMonth === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(snapshot.reportingMonth));
  const latest = Date.parse(snapshot.observedAt);
  requireCondition(Array.isArray(snapshot.stages) && snapshot.stages.length === 6 && snapshot.stages.every(object));
  const stages = snapshot.stages;
  requireCondition(HAWAII_ONBOARDING_STAGES.every((code) => stages.filter((stage) => stage.code === code).length === 1) &&
    stages.every((stage) => ['not-started', 'in-progress', 'completed'].includes(stage.status as string)));
  for (const key of ['records', 'issues', 'assistance']) {
    requireCondition(Array.isArray(snapshot[key]) && snapshot[key].length <= 1000 && snapshot[key].every(object) && uniqueIds(snapshot[key]));
  }
  const records = snapshot.records as Record<string, unknown>[];
  const issues = snapshot.issues as Record<string, unknown>[];
  const assistance = snapshot.assistance as Record<string, unknown>[];
  requireCondition(records.every((record) => instant(record.receivedAt, latest) && ['accepted', 'rejected'].includes(record.result as string)));
  requireCondition(issues.every((issue) => text(issue.field) && text(issue.code) && text(issue.description) &&
    ['open', 'resolved'].includes(issue.status as string) && instant(issue.detectedAt, latest) &&
    records.some((record) => record.id === issue.recordId && record.result === 'rejected' &&
      Date.parse(issue.detectedAt as string) >= Date.parse(record.receivedAt as string))));
  requireCondition(records.every((record) => record.result !== 'rejected' || issues.some((issue) => issue.recordId === record.id)));
  requireCondition(assistance.every((entry) => instant(entry.occurredAt, latest) && text(entry.summary) &&
    ['mapping-review', 'validation-review', 'training'].includes(entry.category as string)));
  return snapshot as unknown as HawaiiOnboardingSnapshot;
}

export function summarizeHawaiiOnboarding(snapshot: HawaiiOnboardingSnapshot) {
  const monthlyRecords = snapshot.records.filter((record) => new Date(record.receivedAt).toISOString().startsWith(snapshot.reportingMonth));
  const accepted = monthlyRecords.filter((record) => record.result === 'accepted').length;
  const openIssues = snapshot.issues.filter((issue) => issue.status === 'open');
  const priorStages = HAWAII_ONBOARDING_STAGES.slice(0, 4);
  const readyForCutover = openIssues.length === 0 && priorStages.every((code) =>
    snapshot.stages.find((stage) => stage.code === code)?.status === 'completed');
  const stages = HAWAII_ONBOARDING_STAGES.map((code, index) => {
    const status = snapshot.stages.find((stage) => stage.code === code)?.status ?? 'not-started';
    const priorComplete = HAWAII_ONBOARDING_STAGES.slice(0, index).every((prior) =>
      snapshot.stages.find((stage) => stage.code === prior)?.status === 'completed');
    return { code, status: ((!priorComplete && status === 'completed') ||
      (openIssues.length > 0 && ['validation', 'cutover', 'monitoring'].includes(code))) ? 'blocked' : status };
  });
  return { stages, readyForCutover, openIssues, accepted, rejected: monthlyRecords.length - accepted,
    submitted: monthlyRecords.length, acceptancePercent: monthlyRecords.length ? accepted / monthlyRecords.length * 100 : undefined,
    completedStages: stages.filter((stage) => stage.status === 'completed').length,
    assistanceCount: snapshot.assistance.filter((entry) => new Date(entry.occurredAt).toISOString().startsWith(snapshot.reportingMonth)).length };
}