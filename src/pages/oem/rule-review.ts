import type { MedplumClient } from '@medplum/core';
import type { DocumentReference, PlanDefinition, Resource, Task } from '@medplum/fhirtypes';
import { OEM_PROJECT_ID } from './ih-review';

export const OEM_RULE_BOT_ID = 'af6d0db8-4e2e-4400-aa8b-6a14f95fb825';
const NS = 'https://hiivehealth.com/fhir';
const CODE = `${NS}/CodeSystem/oem-rule-review`;
const SOURCE_HASH = 'c60c0406b829ec59122de1966a81b562b9e6eac348550cca2496cf7246309b03';
const REQUIREMENTS = [
  'baseline-timing',
  'periodic-anchor',
  'termination-policy',
  'enrollment-authority',
  'supplementary-policy',
];
export const RULE_CHANGE_REASONS = [
  { value: 'timing-unresolved', label: 'Timing unresolved' },
  { value: 'evidence-unresolved', label: 'Evidence unresolved' },
  { value: 'policy-unresolved', label: 'Policy unresolved' },
] as const;
export type RuleDecision = 'approve' | 'request-changes';
export type RuleReason = (typeof RULE_CHANGE_REASONS)[number]['value'] | 'source-contract-verified';

function scope(client: MedplumClient): void {
  if (client.getProject()?.id !== OEM_PROJECT_ID) throw new Error('The Army OEM Synthetic Demo Project is required.');
}

function history(value: string | undefined, type: string): string {
  if (!value || !new RegExp(`^${type}/[A-Za-z0-9.-]+/_history/[A-Za-z0-9.-]+$`).test(value)) {
    throw new Error('An exact rule-review history is required.');
  }
  return value;
}

function exact(resource: Resource): string {
  if (resource.meta?.project !== OEM_PROJECT_ID || !resource.id || !resource.meta.versionId) {
    throw new Error('Rule review resource Project or identity differs.');
  }
  return history(`${resource.resourceType}/${resource.id}/_history/${resource.meta.versionId}`, resource.resourceType);
}

export function ruleTaskReference(task: Task): string {
  if (
    task.resourceType !== 'Task' ||
    task.intent !== 'proposal' ||
    task.for ||
    !['requested', 'completed'].includes(task.status) ||
    !task.code?.coding?.some((coding) => coding.system === CODE && coding.code === 'noise-503') ||
    task.input?.length !== 1 ||
    task.input[0].type.text !== 'Rule fingerprint' ||
    !/^[a-f0-9]{64}$/.test(task.input[0].valueString ?? '') ||
    (task.status === 'requested' && task.output?.length)
  )
    throw new Error('Unsupported rule review Task.');
  history(task.focus?.reference, 'PlanDefinition');
  return exact(task);
}

export async function browserRuleFingerprint(rule: PlanDefinition): Promise<string> {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([first], [second]) => first.localeCompare(second))
          .map(([key, child]) => [key, canonical(child)])
      );
    return value;
  };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(rule))));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadRuleReviews(client: MedplumClient, status: 'requested' | 'completed'): Promise<Task[]> {
  scope(client);
  const bot = await client.readResource('Bot', OEM_RULE_BOT_ID, { cache: 'no-cache' });
  if (bot.id !== OEM_RULE_BOT_ID || bot.meta?.project !== OEM_PROJECT_ID)
    throw new Error('Admin rule-review access is required.');
  const tasks = await client.searchResources(
    'Task',
    { code: `${CODE}|noise-503`, status, _count: '50', _sort: '-_lastUpdated' },
    { cache: 'no-cache' }
  );
  tasks.forEach((task) => {
    ruleTaskReference(task);
    if (task.status !== status) throw new Error('Rule review status differs.');
  });
  return tasks;
}

export interface RuleReviewDetail {
  task: string;
  rule: PlanDefinition;
  source: DocumentReference;
  policyDocuments: DocumentReference[];
  blockers: { code: string; description: string }[];
  fingerprint: string;
  stale: boolean;
  approvalBlocked: boolean;
}

export async function loadRuleReviewDetail(client: MedplumClient, task: Task): Promise<RuleReviewDetail> {
  scope(client);
  const taskReference = ruleTaskReference(task);
  const focus = history(task.focus?.reference, 'PlanDefinition');
  const [, ruleId, , version] = focus.split('/');
  const [rule, head, currentTask] = await Promise.all([
    client.readVersion('PlanDefinition', ruleId, version, { cache: 'no-cache' }),
    client.readResource('PlanDefinition', ruleId, { cache: 'no-cache' }),
    client.readResource('Task', task.id!, { cache: 'no-cache' }),
  ]);
  if (
    rule.resourceType !== 'PlanDefinition' ||
    head.resourceType !== 'PlanDefinition' ||
    rule.id !== head.id ||
    exact(rule) !== focus ||
    rule.url !== `${NS}/PlanDefinition/noise-503-matrix-13` ||
    rule.status !== 'draft' ||
    rule.experimental !== true ||
    !rule.version ||
    rule.extension?.find((item) => item.url === `${NS}/StructureDefinition/oem-source-sha256`)?.valueString !==
      SOURCE_HASH ||
    currentTask.id !== task.id
  )
    throw new Error('The exact source-derived draft could not be verified.');
  const currentReference = ruleTaskReference(currentTask);
  const fingerprint = await browserRuleFingerprint(rule);
  if (fingerprint !== task.input![0].valueString) throw new Error('Rule content fingerprint differs.');
  const sourceReference = history(
    rule.relatedArtifact?.find((item) => item.type === 'derived-from')?.resource,
    'DocumentReference'
  );
  const resolutions =
    rule.extension?.filter((item) => item.url === `${NS}/StructureDefinition/oem-rule-resolution`) ?? [];
  const evidenceReferences = resolutions.map((item) =>
    history(item.extension?.find((child) => child.url === 'evidence')?.valueReference?.reference, 'DocumentReference')
  );
  const documents = await Promise.all(
    [...new Set([sourceReference, ...evidenceReferences])].map(async (reference) => {
      const [, id, , documentVersion] = reference.split('/');
      const document = await client.readVersion('DocumentReference', id, documentVersion, { cache: 'no-cache' });
      if (
        document.resourceType !== 'DocumentReference' ||
        exact(document) !== reference ||
        document.subject ||
        document.status !== 'current' ||
        document.docStatus === 'entered-in-error' ||
        !document.meta?.tag?.some(
          (tag) => tag.system === `${NS}/CodeSystem/oem-policy-document` && tag.code === 'noise-503'
        )
      ) {
        throw new Error('Exact non-patient policy documentation could not be verified.');
      }
      return document;
    })
  );
  const blockers = (rule.extension ?? [])
    .filter((item) => item.url === `${NS}/StructureDefinition/oem-rule-blocker`)
    .map((item) => ({
      code: item.extension?.find((child) => child.url === 'code')?.valueCode ?? 'unverified',
      description:
        item.extension?.find((child) => child.url === 'description')?.valueString ?? 'Unverified rule requirement',
    }));
  const distinctResolutions = new Set(
    resolutions.map((item) => item.extension?.find((child) => child.url === 'code')?.valueCode)
  );
  const resolved =
    resolutions.length === REQUIREMENTS.length &&
    distinctResolutions.size === REQUIREMENTS.length &&
    REQUIREMENTS.every((code) =>
      resolutions.some(
        (item) =>
          item.extension?.find((child) => child.url === 'code')?.valueCode === code &&
          item.extension?.find((child) => child.url === 'disposition')?.valueCode ===
            (code === 'termination-policy' ? 'requires-clinician-review' : 'policy-confirmed')
      )
    );
  return {
    task: taskReference,
    rule,
    source: documents[0],
    policyDocuments: documents.slice(1),
    blockers,
    fingerprint,
    stale: exact(head) !== focus || currentReference !== taskReference,
    approvalBlocked: blockers.length > 0 || !resolved,
  };
}

export async function submitRuleReview(
  client: MedplumClient,
  task: Task,
  decision: RuleDecision,
  reason: RuleReason
): Promise<string> {
  scope(client);
  if (
    task.status !== 'requested' ||
    !['approve', 'request-changes'].includes(decision) ||
    !(decision === 'approve'
      ? reason === 'source-contract-verified'
      : RULE_CHANGE_REASONS.some((item) => item.value === reason))
  ) {
    throw new Error('An open review and supported structured decision are required.');
  }
  const detail = await loadRuleReviewDetail(client, task);
  if (detail.stale || (decision === 'approve' && detail.approvalBlocked))
    throw new Error('Reload the review or resolve its policy requirements before deciding.');
  const result: { status?: string; task?: string; decision?: string; activated?: boolean; clinicalWrites?: number } =
    await client.post(
      `fhir/R4/Bot/${OEM_RULE_BOT_ID}/$execute`,
      { mode: 'review-noise-rule', task: ruleTaskReference(task), decision, reason },
      'application/json',
      { maxRetries: 0 }
    );
  const completed = history(result.task, 'Task');
  if (
    !['recorded', 'replayed'].includes(result.status ?? '') ||
    result.decision !== decision ||
    result.activated !== false ||
    result.clinicalWrites !== 0 ||
    completed.split('/')[1] !== task.id ||
    completed === ruleTaskReference(task)
  )
    throw new Error('Rule-review completion is uncertain. Reload before retrying.');
  return completed;
}
