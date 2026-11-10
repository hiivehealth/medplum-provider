import type { MedplumClient } from '@medplum/core';
import type { Resource, Task } from '@medplum/fhirtypes';
import { OEM_PROJECT_ID } from './ih-review';
import { LIFECYCLE_WORKER_ID } from './intake';

export const DECISION_BOT_ID = 'e198aa1a-31c8-4316-b8f4-e14f0214bc33';
export const DECISION_TASK_ID = '790e5844-e7f4-446e-ae9a-f6ead2b1a37b';
const NS = 'https://hiivehealth.com/fhir';
export const DECISION_SYSTEM = `${NS}/CodeSystem/oem-clinician-decision`;
export const DECISION_REASONS = [
  { value: 'local-proposal-requested', label: 'Local proposal requested' },
  { value: 'timing-adjusted', label: 'Timing adjusted' },
  { value: 'evidence-pending', label: 'Evidence pending' },
  { value: 'already-addressed', label: 'Already addressed' },
  { value: 'not-indicated-for-demo', label: 'Not indicated for this demo' },
] as const;
export interface DecisionInput {
  task: string;
  decision: 'accept' | 'modify' | 'dismiss';
  reason: (typeof DECISION_REASONS)[number]['value'];
  due?: string;
}
export interface DecisionResult {
  status: 'preview' | 'recorded' | 'replayed';
  decision: DecisionInput['decision'];
  task: string;
  receipt?: string;
  proposal?: string;
  fingerprint: string;
  persisted: boolean;
}

function scope(client: MedplumClient): string {
  const actor = client.getProfile();
  if (client.getProject()?.id !== OEM_PROJECT_ID || actor?.resourceType !== 'Practitioner' || !actor.id) {
    throw new Error('The authenticated OEM clinician is required.');
  }
  return `Practitioner/${actor.id}`;
}

function exact(resource: Resource, type = resource.resourceType): string {
  const value = `${resource.resourceType}/${resource.id}/_history/${resource.meta?.versionId}`;
  if (
    resource.resourceType !== type ||
    resource.meta?.project !== OEM_PROJECT_ID ||
    !resource.id ||
    !resource.meta.versionId ||
    !new RegExp(`^${type}/[A-Za-z0-9.-]+/_history/[A-Za-z0-9.-]+$`).test(value)
  ) {
    throw new Error('The exact OEM decision resource could not be verified.');
  }
  return value;
}

export async function loadDecisionTask(client: MedplumClient): Promise<Task> {
  scope(client);
  const bot = await client.readResource('Bot', DECISION_BOT_ID, { cache: 'no-cache' });
  if (bot.resourceType !== 'Bot' || bot.id !== DECISION_BOT_ID || bot.meta?.project !== OEM_PROJECT_ID)
    throw new Error('Decision access is unavailable.');
  const task = await client.readResource('Task', DECISION_TASK_ID, { cache: 'no-cache' });
  exact(task, 'Task');
  if (
    task.id !== DECISION_TASK_ID ||
    task.for?.reference !== `Patient/${LIFECYCLE_WORKER_ID}` ||
    task.intent !== 'proposal' ||
    !['requested', 'accepted', 'rejected'].includes(task.status) ||
    !task.code?.coding?.some(
      (coding) => coding.system === `${NS}/CodeSystem/oem-surveillance-action` && coding.code === 'audiogram'
    )
  ) {
    throw new Error('The configured synthetic recommendation is unavailable.');
  }
  return task;
}

export function decisionTaskReference(task: Task): string {
  return exact(task, 'Task');
}

export async function sendDecision(
  client: MedplumClient,
  input: DecisionInput,
  mode: 'preview' | 'decide',
  fingerprint?: string
): Promise<DecisionResult> {
  const actor = scope(client);
  if (
    !new RegExp(`^Task/${DECISION_TASK_ID}/_history/[A-Za-z0-9.-]+$`).test(input.task) ||
    Object.keys(input).sort().join('|') !==
      (input.decision === 'modify' ? 'decision|due|reason|task' : 'decision|reason|task') ||
    !['accept', 'modify', 'dismiss'].includes(input.decision) ||
    !DECISION_REASONS.some((reason) => reason.value === input.reason) ||
    (input.decision === 'accept' && input.reason !== 'local-proposal-requested') ||
    (input.decision === 'modify' &&
      (input.reason !== 'timing-adjusted' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.due ?? '') ||
        !Number.isFinite(Date.parse(input.due!)) ||
        new Date(input.due!).toISOString().slice(0, 10) !== input.due)) ||
    (input.decision === 'dismiss' &&
      !['evidence-pending', 'already-addressed', 'not-indicated-for-demo'].includes(input.reason)) ||
    (mode === 'decide' && !/^[a-f0-9]{64}$/.test(fingerprint ?? ''))
  ) {
    throw new Error('An exact Task version and supported structured decision are required.');
  }
  const raw: DecisionResult & { activated?: boolean; externalDispatch?: boolean; completionRecorded?: boolean } =
    await client.post(`fhir/R4/Bot/${DECISION_BOT_ID}/$execute`, { ...input, mode }, 'application/json', {
      maxRetries: 0,
    });
  if (
    !raw ||
    raw.decision !== input.decision ||
    !/^[a-f0-9]{64}$/.test(raw.fingerprint) ||
    raw.activated !== false ||
    raw.externalDispatch !== false ||
    raw.completionRecorded !== false ||
    (mode === 'preview'
      ? raw.status !== 'preview' ||
        raw.persisted !== false ||
        raw.task !== input.task ||
        !!raw.receipt ||
        !!raw.proposal
      : !['recorded', 'replayed'].includes(raw.status) ||
        raw.persisted !== true ||
        raw.fingerprint !== fingerprint ||
        !new RegExp(`^Task/${DECISION_TASK_ID}/_history/[A-Za-z0-9.-]+$`).test(raw.task))
  ) {
    throw new Error('Decision outcome is unconfirmed. Reconcile the original decision before continuing.');
  }
  if (mode === 'decide') {
    const read = async (reference: string | undefined, type: Resource['resourceType']): Promise<Resource> => {
      if (!reference || !new RegExp(`^${type}/[A-Za-z0-9.-]+/_history/[A-Za-z0-9.-]+$`).test(reference))
        throw new Error('Exact decision evidence is missing.');
      const [, id, , version] = reference.split('/');
      const resource = await client.readVersion(type, id, version, { cache: 'no-cache' });
      if (exact(resource, type) !== reference) throw new Error('Decision history differs.');
      return resource;
    };
    const task = (await read(raw.task, 'Task')) as Task;
    const receipt = (await read(raw.receipt, 'Task')) as Task;
    const expectedStatus =
      input.decision === 'accept' ? 'accepted' : input.decision === 'dismiss' ? 'rejected' : 'requested';
    const names = input.decision === 'accept' ? ['proposal', 'task', 'audit', 'lineage'] : ['task', 'audit', 'lineage'];
    if (
      task.for?.reference !== `Patient/${LIFECYCLE_WORKER_ID}` ||
      task.status !== expectedStatus ||
      task.owner?.reference !== actor ||
      !task.extension?.some(
        (extension) =>
          extension.url === `${NS}/StructureDefinition/oem-clinician-decision-fingerprint` &&
          extension.valueString === fingerprint
      ) ||
      receipt.status !== 'completed' ||
      receipt.for?.reference !== task.for.reference ||
      receipt.requester?.reference !== actor ||
      receipt.focus?.reference !== input.task ||
      receipt.code?.coding?.[0]?.system !== DECISION_SYSTEM ||
      receipt.code.coding[0].code !== 'receipt' ||
      receipt.input?.[0]?.valueString !== fingerprint ||
      receipt.input?.[1]?.valueCode !== input.decision ||
      receipt.input?.[2]?.valueCode !== input.reason ||
      receipt.output?.length !== names.length ||
      receipt.output.some((output, index) => output.type.text !== names[index]) ||
      receipt.output.find((output) => output.type.text === 'task')?.valueReference?.reference !== raw.task
    ) {
      throw new Error('The saved decision and receipt are not bound to this clinician and Task version.');
    }
    if (input.decision === 'accept') {
      const proposal = await read(raw.proposal, 'ServiceRequest');
      if (
        proposal.resourceType !== 'ServiceRequest' ||
        proposal.subject.reference !== task.for.reference ||
        proposal.status !== 'draft' ||
        proposal.intent !== 'proposal' ||
        proposal.requester?.reference !== actor ||
        !proposal.meta?.tag?.some(
          (tag) => tag.system === `${NS}/CodeSystem/oem-decision-worker` && tag.code === task.for?.reference
        ) ||
        receipt.output[0].valueReference?.reference !== raw.proposal ||
        task.output?.filter((output) => output.type.text === 'Local proposal').length !== 1 ||
        task.output.find((output) => output.type.text === 'Local proposal')?.valueReference?.reference !==
          raw.proposal!.split('/').slice(0, 2).join('/')
      ) {
        throw new Error('The local proposal could not be verified.');
      }
    } else if (raw.proposal) throw new Error('Unexpected local proposal.');
  }
  return {
    status: raw.status,
    decision: raw.decision,
    task: raw.task,
    receipt: raw.receipt,
    proposal: raw.proposal,
    fingerprint: raw.fingerprint,
    persisted: raw.persisted,
  };
}
