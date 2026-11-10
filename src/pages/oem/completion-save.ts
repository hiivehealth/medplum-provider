import type { MedplumClient } from '@medplum/core';
import type { AuditEvent, Observation, Provenance, Resource, Task } from '@medplum/fhirtypes';
import { COMPLETION_TASK, COMPLETION_PROPOSAL, COMPLETION_REPORT, scope, validateCompletionPreview, type NativePreview } from './completion-preview';
import { OEM_PROJECT_ID } from './ih-review';
import { LIFECYCLE_WORKER_ID } from './intake';

export const COMPLETION_SAVE_BOT_ID = 'd9af955e-eeba-489f-a4cc-13b8e088e1dc';
const NS = 'https://hiivehealth.com/fhir';
const MARKER = `${NS}/CodeSystem/oem-synthetic-completion-save`;
export interface SavedSyntheticCompletion {
  mode: 'save';
  status: 'recorded' | 'replayed';
  fingerprint: string;
  persisted: true;
  syntheticAttestationRecorded: true;
  clinicalCompletionVerified: false;
  activated: false;
  externalDispatch: false;
  task: string;
  proposal: string;
  report: string;
  requester: string;
  recordedAt: string;
  performedOn: string;
  nextPeriodicOn: string;
  receipt: string;
  attestation: string;
  audit: string;
  lineage: string;
}

async function verifySaved(client: MedplumClient, raw: SavedSyntheticCompletion, fingerprint: string, actor: string): Promise<SavedSyntheticCompletion> {
  const fail = () => { throw new Error('The saved synthetic attestation could not be verified.'); };
  if (!raw || raw.mode !== 'save' || !['recorded', 'replayed'].includes(raw.status) || raw.fingerprint !== fingerprint ||
      raw.persisted !== true || raw.syntheticAttestationRecorded !== true || raw.clinicalCompletionVerified !== false || raw.activated !== false ||
      raw.externalDispatch !== false || raw.task !== COMPLETION_TASK || raw.proposal !== COMPLETION_PROPOSAL || raw.report !== COMPLETION_REPORT ||
      raw.requester !== actor || raw.performedOn !== '2026-06-15' || raw.nextPeriodicOn !== '2027-06-15' ||
      !Number.isFinite(Date.parse(raw.recordedAt)) || new Date(raw.recordedAt).toISOString() !== raw.recordedAt) fail();
  const references = [raw.receipt, raw.attestation, raw.audit, raw.lineage];
  const types = ['Task', 'Observation', 'AuditEvent', 'Provenance'];
  const resources: Resource[] = [];
  for (let index = 0; index < references.length; index++) {
    const reference = references[index];
    if (!new RegExp(`^${types[index]}/[A-Za-z0-9.-]+/_history/[A-Za-z0-9.-]+$`).test(reference)) fail();
    const [type, id, , version] = reference.split('/');
    const resource = await client.readVersion(type as Resource['resourceType'], id, version, { cache: 'no-cache', maxRetries: 0 });
    const current = await client.readResource(type as Resource['resourceType'], id, { cache: 'no-cache', maxRetries: 0 });
    if ([resource, current].some(value => value.meta?.project !== OEM_PROJECT_ID || `${value.resourceType}/${value.id}/_history/${value.meta.versionId}` !== reference)) fail();
    resources.push(resource);
  }
  const [receipt, attestation, audit, lineage] = resources as [Task, Observation, AuditEvent, Provenance];
  const slot = receipt.identifier?.[0]?.value;
  const actorReference = actor;
  const worker = `Patient/${LIFECYCLE_WORKER_ID}`;
  const receiptIdentity = raw.receipt.split('/').slice(0, 2).join('/');
  if (!slot || !/^[a-f0-9]{40}$/.test(slot) || receipt.identifier?.length !== 1 || receipt.identifier[0].system !== MARKER ||
      resources.some(resource => !resource.meta?.tag?.some(tag => tag.system === MARKER && tag.code === slot) ||
        !resource.meta.tag.some(tag => tag.system === `${NS}/CodeSystem/demo-data` && tag.code === 'synthetic-only')) ||
      receipt.status !== 'completed' || receipt.intent !== 'order' || receipt.for?.reference !== worker || receipt.requester?.reference !== actorReference ||
      receipt.focus?.reference !== COMPLETION_TASK || receipt.authoredOn !== raw.recordedAt || receipt.input?.length !== 1 || receipt.input[0].valueString !== fingerprint ||
      receipt.code?.coding?.[0]?.system !== MARKER || receipt.code.coding[0].code !== 'technical-receipt' ||
      receipt.output?.length !== 3 || receipt.output.some((output, index) => output.type.text !== ['attestation', 'audit', 'lineage'][index] ||
        output.valueReference?.reference !== references[index + 1]) ||
      attestation.status !== 'final' || attestation.subject?.reference !== worker || attestation.effectiveDateTime !== '2026-06-15' || attestation.issued !== raw.recordedAt ||
      attestation.performer?.length !== 1 || attestation.performer[0].reference !== actor || attestation.basedOn?.length !== 1 || attestation.basedOn[0].reference !== COMPLETION_PROPOSAL ||
      attestation.focus?.length !== 1 || attestation.focus[0].reference !== COMPLETION_TASK || attestation.derivedFrom?.length !== 1 || attestation.derivedFrom[0].reference !== COMPLETION_REPORT ||
      !attestation.code.coding?.some(code => code.system === `${NS}/CodeSystem/oem-simulated-completion` && code.code === 'audiogram-attestation') ||
      audit.action !== 'C' || audit.recorded !== raw.recordedAt || audit.agent.length !== 1 || audit.agent[0].who?.reference !== actor || audit.agent[0].requestor !== true ||
      audit.entity?.length !== 5 || audit.entity.some((entity, index) => entity.what?.reference !== [COMPLETION_TASK, COMPLETION_PROPOSAL, COMPLETION_REPORT, receiptIdentity, raw.attestation][index]) ||
      lineage.recorded !== raw.recordedAt || lineage.target.length !== 1 || lineage.target[0].reference !== raw.attestation ||
      lineage.agent.length !== 1 || lineage.agent[0].who.reference !== actor || lineage.entity?.length !== 4 ||
      lineage.entity.some((entity, index) => entity.role !== 'source' || entity.what.reference !== [COMPLETION_TASK, COMPLETION_PROPOSAL, COMPLETION_REPORT, receiptIdentity][index])) fail();
  for (const reference of [COMPLETION_TASK, COMPLETION_PROPOSAL]) {
    const [type, id] = reference.split('/');
    const current = await client.readResource(type as Resource['resourceType'], id, { cache: 'no-cache', maxRetries: 0 });
    if (current.meta?.project !== OEM_PROJECT_ID || `${current.resourceType}/${current.id}/_history/${current.meta.versionId}` !== reference) fail();
  }
  if (scope(client) !== actor) fail();
  return raw;
}

export async function inspectSyntheticCompletion(client: MedplumClient, confirmedSimulation: boolean) {
  const actor = scope(client);
  if (confirmedSimulation !== true) throw new Error('Explicit synthetic confirmation is required.');
  const raw = await client.post<NativePreview & { fingerprint: string; saved: boolean; recorded?: SavedSyntheticCompletion }>(
    `fhir/R4/Bot/${COMPLETION_SAVE_BOT_ID}/$execute`, { mode: 'preview', confirmedSimulation: true }, 'application/json', { maxRetries: 0 });
  const preview = validateCompletionPreview(client, actor, raw);
  if (!/^[a-f0-9]{64}$/.test(raw.fingerprint) || typeof raw.saved !== 'boolean' || (!raw.saved && raw.recorded !== undefined)) {
    throw new Error('The synthetic save preview could not be verified.');
  }
  return { preview, fingerprint: raw.fingerprint, recorded: raw.saved ? await verifySaved(client, raw.recorded!, raw.fingerprint, actor) : undefined };
}

export async function saveSyntheticCompletion(client: MedplumClient, fingerprint: string, confirmedSave: boolean): Promise<SavedSyntheticCompletion> {
  const actor = scope(client);
  if (confirmedSave !== true || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Explicit confirmation of the exact synthetic save is required.');
  const raw = await client.post<SavedSyntheticCompletion>(`fhir/R4/Bot/${COMPLETION_SAVE_BOT_ID}/$execute`,
    { mode: 'save', confirmedSimulation: true, confirmedSave: true, fingerprint }, 'application/json', { maxRetries: 0 });
  if (scope(client) !== actor) throw new Error('The clinician scope changed.');
  return verifySaved(client, raw, fingerprint, actor);
}