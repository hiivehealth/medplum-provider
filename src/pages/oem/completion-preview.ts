import type { MedplumClient } from '@medplum/core';
import type { Observation, Provenance } from '@medplum/fhirtypes';
import { OEM_PROJECT_ID } from './ih-review';
import { LIFECYCLE_WORKER_ID } from './intake';

export const COMPLETION_PREVIEW_BOT_ID = 'c0ce6818-1d5e-4e38-a086-80a1a218b6aa';
export const COMPLETION_TASK = 'Task/790e5844-e7f4-446e-ae9a-f6ead2b1a37b/_history/f52a02c7-9f50-4c7d-8185-67a1251bca98';
export const COMPLETION_PROPOSAL = 'ServiceRequest/7a148912-2637-4044-b55e-690088ff2d03/_history/29a8212b-e1a9-4621-9dac-95e022c8f7df';
export const COMPLETION_REPORT = 'DocumentReference/054e1aa6-6eaa-4776-88ce-92f553a299d8/_history/b2c33455-1e8a-4f19-b895-2caf5aa17de0';
const WORKER = `Patient/${LIFECYCLE_WORKER_ID}`;
const NS = 'https://hiivehealth.com/fhir';

export interface CompletionPreviewResult {
  performedOn: string;
  nextPeriodicOn: string;
  inspectedAt: string;
  report: string;
}

export interface NativePreview {
  mode: string;
  coverage: string;
  persisted: boolean;
  activated: boolean;
  externalDispatch: boolean;
  clinicalCompletionVerified: boolean;
  requester: string;
  inspectedAt: string;
  headState: string;
  task: string;
  proposal: string;
  report: string;
  plan: {
    mode: string;
    coverage: string;
    persisted: boolean;
    activated: boolean;
    externalDispatch: boolean;
    clinicalCompletionVerified: boolean;
    transaction?: unknown;
    completion: { patient: { reference: string }; action: string; ruleVersion: string; kind: string; performedOn: string; evidence: { reference: string } };
    attestation: Observation;
    lineage: Provenance;
    evaluation: { due: string; stage: string };
  };
}

export function scope(client: MedplumClient): string {
  const actor = client.getProfile();
  if (client.getProject()?.id !== OEM_PROJECT_ID || actor?.resourceType !== 'Practitioner' || !actor.id) {
    throw new Error('The authenticated OEM clinician is required.');
  }
  return `Practitioner/${actor.id}`;
}

export async function previewSimulatedCompletion(client: MedplumClient, confirmedSimulation: boolean): Promise<CompletionPreviewResult> {
  const actor = scope(client);
  if (confirmedSimulation !== true) throw new Error('Explicit synthetic-example confirmation is required.');
  const raw = await client.post<NativePreview>(`fhir/R4/Bot/${COMPLETION_PREVIEW_BOT_ID}/$execute`,
    { mode: 'preview', confirmedSimulation: true }, 'application/json', { maxRetries: 0 });
  return validateCompletionPreview(client, actor, raw);
}

export function validateCompletionPreview(client: MedplumClient, actor: string, raw: NativePreview): CompletionPreviewResult {
  const plan = raw?.plan;
  const attestation = plan?.attestation;
  const lineage = plan?.lineage;
  if (scope(client) !== actor || !raw || raw.mode !== 'preview' || raw.coverage !== 'exact-configured-manifest-only' ||
      raw.persisted !== false || raw.activated !== false || raw.externalDispatch !== false || raw.clinicalCompletionVerified !== false ||
      raw.requester !== actor || raw.headState !== 'unchanged-at-read-checks' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw.inspectedAt) ||
      !Number.isFinite(Date.parse(raw.inspectedAt)) || new Date(raw.inspectedAt).toISOString() !== raw.inspectedAt ||
      raw.task !== COMPLETION_TASK || raw.proposal !== COMPLETION_PROPOSAL || raw.report !== COMPLETION_REPORT ||
      plan?.mode !== 'offline-simulated-completion' || plan.coverage !== 'supplied-records-only' || plan.persisted !== false ||
      plan.activated !== false || plan.externalDispatch !== false || plan.clinicalCompletionVerified !== false || plan.transaction !== undefined ||
      plan.completion?.patient?.reference !== WORKER || plan.completion.action !== 'audiogram' || plan.completion.ruleVersion !== 'demo-1' ||
      plan.completion.kind !== 'manual-attestation' || plan.completion.performedOn !== '2026-06-15' ||
      plan.completion.evidence?.reference !== COMPLETION_REPORT || plan.evaluation?.due !== '2027-06-15' || plan.evaluation.stage !== 'periodic' ||
      attestation?.resourceType !== 'Observation' || !/^oem-simulated-[a-f0-9]{40}$/.test(attestation.id ?? '') || attestation.meta?.versionId ||
      attestation.status !== 'final' || attestation.subject?.reference !== WORKER || attestation.issued !== raw.inspectedAt ||
      attestation.effectiveDateTime !== '2026-06-15' || attestation.performer?.length !== 1 || attestation.performer[0].reference !== actor ||
      attestation.basedOn?.length !== 1 || attestation.basedOn[0].reference !== COMPLETION_PROPOSAL ||
      attestation.focus?.length !== 1 || attestation.focus[0].reference !== COMPLETION_TASK ||
      attestation.derivedFrom?.length !== 1 || attestation.derivedFrom[0].reference !== COMPLETION_REPORT ||
      !attestation.code.coding?.some(code => code.system === `${NS}/CodeSystem/oem-simulated-completion` && code.code === 'audiogram-attestation') ||
      !attestation.meta?.tag?.some(tag => tag.system === `${NS}/CodeSystem/demo-data` && tag.code === 'synthetic-only') ||
      lineage?.resourceType !== 'Provenance' || lineage.recorded !== raw.inspectedAt || lineage.target?.length !== 1 ||
      lineage.target[0].reference !== `Observation/${attestation.id}` || lineage.agent?.length !== 1 || lineage.agent[0].who.reference !== actor ||
      lineage.entity?.length !== 3 || lineage.entity.some((entity, index) => entity.role !== 'source' ||
        entity.what.reference !== [COMPLETION_TASK, COMPLETION_PROPOSAL, COMPLETION_REPORT][index])) {
    throw new Error('The simulated completion preview could not be verified.');
  }
  return { performedOn: plan.completion.performedOn, nextPeriodicOn: plan.evaluation.due, inspectedAt: raw.inspectedAt, report: raw.report };
}