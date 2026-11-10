import type { MedplumClient } from '@medplum/core';
import type { Bundle, DocumentReference, Patient, Questionnaire, QuestionnaireResponse, Resource } from '@medplum/fhirtypes';
import { OEM_PROJECT_ID } from './ih-review';
import { assertWorker } from './intake';

export const PERSONNEL_BOT = 'f164d473-0d95-486e-9743-140ced50ae57';
export const PERSONNEL_SAVE_BOT = '910708cd-76af-4be7-9b5f-ea686f1a1e87';
export const PERSONNEL_PENDING_KEY = 'army-oem-personnel-save-v1';
export const PERSONNEL_FORM =
  'Questionnaire/df64a397-e8d7-474c-bc6b-e201f5bb41d4/_history/42b5a4c3-87f4-42aa-b32c-955b0595bd58';
export const PERSONNEL_WORKER = 'Patient/f8be7ab5-b799-4345-baba-2ba675122b13';
export const PERSONNEL_SOURCE =
  'DocumentReference/0ee63f09-9938-4c62-abec-4556a9e2c80a/_history/ecf8293a-c8ec-43d5-9b95-b7e5ab8c07f0';
export const PERSONNEL_CANONICAL =
  'https://hiivehealth.com/fhir/Questionnaire/synthetic-dod-personnel-attestation|draft-1';

function identity(client: MedplumClient): string {
  const profile = client.getProfile();
  if (client.getProject()?.id !== OEM_PROJECT_ID || profile?.resourceType !== 'Practitioner' || !profile.id) {
    throw new Error('A clinician in Army OEM Synthetic Demo is required.');
  }
  return `Practitioner/${profile.id}`;
}

export interface PersonnelContext {
  questionnaire: Questionnaire;
  patient: Patient;
  source: DocumentReference;
}

export async function loadPersonnelPreview(client: MedplumClient): Promise<PersonnelContext> {
  const actor = identity(client);
  const bot = await client.readResource('Bot', PERSONNEL_BOT, { cache: 'no-cache' });
  if (bot.id !== PERSONNEL_BOT || bot.meta?.project !== OEM_PROJECT_ID || bot.runAsUser !== false) {
    throw new Error('Personnel preview access could not be verified.');
  }
  const questionnaire = await client.readVersion(
    'Questionnaire',
    PERSONNEL_FORM.split('/')[1],
    PERSONNEL_FORM.split('/')[3],
    { cache: 'no-cache' }
  );
  const patient = await client.readResource('Patient', PERSONNEL_WORKER.split('/')[1], { cache: 'no-cache' });
  const source = await client.readResource('DocumentReference', PERSONNEL_SOURCE.split('/')[1], { cache: 'no-cache' });
  assertWorker(patient);
  if (
    actor !== identity(client) ||
    `Patient/${patient.id}` !== PERSONNEL_WORKER ||
    `Questionnaire/${questionnaire.id}/_history/${questionnaire.meta?.versionId}` !== PERSONNEL_FORM ||
    questionnaire.meta?.project !== OEM_PROJECT_ID ||
    `${questionnaire.url}|${questionnaire.version}` !== PERSONNEL_CANONICAL ||
    questionnaire.status !== 'draft' ||
    questionnaire.experimental !== true ||
    `DocumentReference/${source.id}/_history/${source.meta?.versionId}` !== PERSONNEL_SOURCE ||
    source.meta?.project !== OEM_PROJECT_ID ||
    source.subject?.reference !== PERSONNEL_WORKER ||
    source.status !== 'current' ||
    source.docStatus !== 'final' ||
    !source.meta.tag?.some(
      (tag) => tag.system === 'https://hiivehealth.com/fhir/CodeSystem/demo-data' && tag.code === 'synthetic-only'
    )
  ) {
    throw new Error('The pinned synthetic worker, form or source could not be verified.');
  }
  return { questionnaire, patient, source };
}

export function personnelForm(context: PersonnelContext): Questionnaire {
  return {
    ...context.questionnaire,
    item: context.questionnaire.item?.map((item) => ({
      ...item,
      ...(item.type === 'reference'
        ? {
            type: 'choice' as const,
            answerOption: [
              {
                valueReference: {
                  reference: PERSONNEL_SOURCE,
                  display: 'Synthetic personnel preview fixture (not official evidence)',
                },
              },
            ],
          }
        : {}),
      ...(item.answerOption
        ? {
            answerOption: item.answerOption.map((option) =>
              option.valueCoding
                ? {
                    ...option,
                    valueCoding: { ...option.valueCoding, display: option.valueCoding.code?.replaceAll('-', ' ') },
                  }
                : option
            ),
          }
        : {}),
    })),
  };
}

export function preparePersonnelResponse(response: QuestionnaireResponse): QuestionnaireResponse {
  return {
    resourceType: 'QuestionnaireResponse',
    status: 'completed',
    questionnaire: PERSONNEL_CANONICAL,
    subject: { reference: PERSONNEL_WORKER },
    item: response.item
      ?.filter((item) => item.answer?.length)
      .map((item) => {
        if (item.answer?.length !== 1) throw new Error('One answer per personnel fact field is required.');
        const answer = item.answer[0];
        return {
          linkId: item.linkId,
          answer: [
            answer.valueCoding
              ? { valueCoding: { system: answer.valueCoding.system, code: answer.valueCoding.code } }
              : answer.valueReference
                ? { valueReference: { reference: answer.valueReference.reference } }
                : { valueDate: answer.valueDate },
          ],
        };
      }),
  };
}

export interface PersonnelResult {
  mode: 'preview';
  persisted: false;
  activated: false;
  clinicalWrites: 0;
  fingerprint: string;
  authority: 'synthetic-clinician-attestation';
  collection: Bundle;
  issues: string[];
}

export async function previewPersonnel(
  client: MedplumClient,
  response: QuestionnaireResponse
): Promise<PersonnelResult> {
  const actor = identity(client);
  const prepared = preparePersonnelResponse(response);
  const source = prepared.item?.find((item) => item.linkId === 'source-evidence')?.answer?.[0].valueReference
    ?.reference;
  if (source !== PERSONNEL_SOURCE) throw new Error('The pinned synthetic supporting document is required.');
  const submissionId = crypto.randomUUID();
  const result = await client.post<PersonnelResult>(
    `fhir/R4/Bot/${PERSONNEL_BOT}/$execute`,
    {
      mode: 'preview',
      patient: PERSONNEL_WORKER,
      submissionId,
      response: prepared,
    },
    'application/json',
    { maxRetries: 0 }
  );
  const entries = result?.collection?.entry ?? [];
  const submissionEntry = entries.find((entry) => entry.resource?.resourceType === 'QuestionnaireResponse');
  const submission = submissionEntry?.resource as QuestionnaireResponse | undefined;
  const fact = entries.find((entry) => entry.resource?.resourceType === 'Observation');
  const provenance = entries.find((entry) => entry.resource?.resourceType === 'Provenance')?.resource;
  const answer = (linkId: string) => prepared.item?.find((item) => item.linkId === linkId)?.answer?.[0];
  const kind = answer('fact-kind')?.valueCoding?.code;
  const factCodes = 'https://hiivehealth.com/fhir/CodeSystem/synthetic-dod-noise-fact';
  if (
    identity(client) !== actor ||
    result?.mode !== 'preview' ||
    result.persisted !== false ||
    result.activated !== false ||
    result.clinicalWrites !== 0 ||
    result.authority !== 'synthetic-clinician-attestation' ||
    !/^[a-f0-9]{64}$/.test(result.fingerprint ?? '') ||
    result.collection.type !== 'collection' ||
    entries.length !== 3 ||
    entries.some(
      (entry) =>
        entry.request ||
        entry.resource?.meta?.versionId ||
        !entry.resource?.id ||
        entry.fullUrl !== `urn:uuid:${entry.resource.id}`
    ) ||
    submission?.subject?.reference !== PERSONNEL_WORKER ||
    submission.author?.reference !== actor ||
    submission.questionnaire !== PERSONNEL_CANONICAL ||
    submission.identifier?.value !== submissionId ||
    submission.identifier.system !== 'https://hiivehealth.com/fhir/identifier/synthetic-dod-personnel-attestation' ||
    JSON.stringify(submission.item) !== JSON.stringify(prepared.item) ||
    !Number.isFinite(Date.parse(submission.authored ?? '')) ||
    fact?.resource?.resourceType !== 'Observation' ||
    fact.resource.subject?.reference !== PERSONNEL_WORKER ||
    fact.resource.performer?.length !== 1 ||
    fact.resource.status !== 'final' ||
    fact.resource.code.coding?.length !== 1 ||
    fact.resource.code.coding[0].system !== factCodes ||
    fact.resource.code.coding[0].code !== kind ||
    (kind === 'population'
      ? fact.resource.valueCodeableConcept?.coding?.[0]?.code !== answer('population')?.valueCoding?.code
      : fact.resource.effectiveDateTime !== answer('event-on')?.valueDate ||
        fact.resource.component?.length !== 1 ||
        fact.resource.component[0].valueCodeableConcept?.coding?.[0]?.code !==
          answer('event-state')?.valueCoding?.code) ||
    fact.resource.performer[0].reference !== actor ||
    provenance?.resourceType !== 'Provenance' ||
    provenance.recorded !== submission.authored ||
    provenance.target?.length !== 1 ||
    provenance.target[0].reference !== fact.fullUrl ||
    provenance.agent?.length !== 1 ||
    provenance.agent[0].who.reference !== actor ||
    provenance.entity?.length !== 2 ||
    provenance.entity.some((entity) => entity.role !== 'source') ||
    !provenance.entity.some((entity) => entity.what.reference === PERSONNEL_SOURCE) ||
    !provenance.entity.some((entity) => entity.what.reference === submissionEntry?.fullUrl) ||
    !Array.isArray(result.issues) ||
    result.issues.some((issue) => typeof issue !== 'string')
  ) {
    throw new Error('The no-write personnel preview response could not be verified.');
  }
  return result;
}

export interface PersonnelPending {
  version: 1;
  project: string;
  actor: string;
  submissionId: string;
  response: QuestionnaireResponse;
  collection: Bundle;
}

export interface PersonnelSaved {
  status: 'completed';
  submissionId: string;
  fingerprint: string;
  receipt: string;
  resources: { step: string; reference: string }[];
  replayed: boolean;
  activated: false;
}

export async function personnelCanSave(client: MedplumClient): Promise<boolean> {
  const actor = identity(client);
  try {
    const bot = await client.readResource('Bot', PERSONNEL_SAVE_BOT, { cache: 'no-cache' });
    return identity(client) === actor && bot.id === PERSONNEL_SAVE_BOT && bot.meta?.project === OEM_PROJECT_ID && bot.runAsUser === false;
  } catch {
    return false;
  }
}

export function pendingPersonnel(client: MedplumClient, preview: PersonnelResult): PersonnelPending {
  const actor = identity(client);
  const response = preview.collection.entry?.[0].resource;
  if (response?.resourceType !== 'QuestionnaireResponse' || response.author?.reference !== actor ||
      response.subject?.reference !== PERSONNEL_WORKER || preview.persisted !== false || preview.activated !== false ||
      !/^[a-f0-9-]{36}$/i.test(response.identifier?.value ?? '')) throw new Error('A verified personnel preview is required.');
  return { version: 1, project: OEM_PROJECT_ID, actor, submissionId: response.identifier!.value!,
    response: preparePersonnelResponse(response), collection: structuredClone(preview.collection) };
}

export function assertPersonnelPending(client: MedplumClient, pending: PersonnelPending): void {
  if (pending.version !== 1 || pending.project !== OEM_PROJECT_ID || pending.actor !== identity(client) ||
      !/^[a-f0-9-]{36}$/i.test(pending.submissionId) || pending.response?.subject?.reference !== PERSONNEL_WORKER ||
      pending.response.questionnaire !== PERSONNEL_CANONICAL || pending.collection?.entry?.length !== 3 ||
      pending.response.item?.find(item => item.linkId === 'source-evidence')?.answer?.[0].valueReference?.reference !== PERSONNEL_SOURCE) {
    throw new Error('The pending save does not match this clinician, worker, Project, form and source.');
  }
}

function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(record).filter(([key, child]) => child !== undefined &&
      !(key === 'display' && typeof record.reference === 'string')).sort(([first], [second]) => first.localeCompare(second))
      .map(([key, child]) => [key, comparable(child)]));
  }
  return value;
}

function equal(first: unknown, second: unknown): boolean {
  return JSON.stringify(comparable(first)) === JSON.stringify(comparable(second));
}

export async function savePersonnel(client: MedplumClient, pending: PersonnelPending): Promise<PersonnelSaved> {
  assertPersonnelPending(client, pending);
  const result = await client.post<PersonnelSaved>(`fhir/R4/Bot/${PERSONNEL_SAVE_BOT}/$execute`, {
    mode: 'save', patient: PERSONNEL_WORKER, submissionId: pending.submissionId, response: pending.response,
  }, 'application/json', { maxRetries: 0 });
  return readbackPersonnel(client, pending, result);
}

async function readbackPersonnel(client: MedplumClient, pending: PersonnelPending, result: PersonnelSaved): Promise<PersonnelSaved> {
  assertPersonnelPending(client, pending);
  const types = ['QuestionnaireResponse', 'Observation', 'Provenance'];
  if (result?.status !== 'completed' || result.activated !== false || result.submissionId !== pending.submissionId ||
      !/^[a-f0-9]{64}$/.test(result.fingerprint ?? '') || typeof result.replayed !== 'boolean' || result.resources?.length !== 3 ||
      result.resources.some((item, index) => item.step !== ['submission', 'fact', 'lineage'][index] ||
        !new RegExp(`^${types[index]}/[A-Za-z0-9.-]+/_history/[A-Za-z0-9.-]+$`).test(item.reference)) ||
      !/^Task\/[A-Za-z0-9.-]+\/_history\/[A-Za-z0-9.-]+$/.test(result.receipt ?? '')) {
    throw new Error('Save is not independently confirmed. Retain the same submission for retry or review.');
  }
  const read = async (reference: string): Promise<Resource> => {
    const [type, id, , version] = reference.split('/');
    const resource = await client.readVersion(type as Resource['resourceType'], id, version, { cache: 'no-cache' });
    if (resource.meta?.project !== OEM_PROJECT_ID || `${resource.resourceType}/${resource.id}/_history/${resource.meta.versionId}` !== reference) {
      throw new Error('Saved personnel history could not be verified.');
    }
    return resource;
  };
  const receipt = await read(result.receipt);
  if (receipt.resourceType !== 'Task' || receipt.status !== 'completed' || receipt.intent !== 'order' ||
      receipt.for?.reference !== PERSONNEL_WORKER || receipt.requester?.reference !== pending.actor ||
      !equal(receipt.identifier, [{ system: 'https://hiivehealth.com/fhir/identifier/synthetic-personnel-save-receipt', value: pending.submissionId }]) ||
      !equal(receipt.code, { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/synthetic-oem-operation', code: 'personnel-save' }] }) ||
      receipt.input?.length !== 2 || receipt.input[0].valueString !== result.fingerprint ||
      !equal(receipt.output?.map(output => ({ step: output.type.text, reference: output.valueReference?.reference })), result.resources) ||
      !receipt.authoredOn || !Number.isFinite(Date.parse(receipt.authoredOn))) throw new Error('The saved personnel receipt could not be verified.');
  const expected = structuredClone(pending.collection);
  const response = expected.entry![0].resource;
  const provenance = expected.entry![2].resource;
  if (response?.resourceType !== 'QuestionnaireResponse' || provenance?.resourceType !== 'Provenance') throw new Error('Invalid pending personnel collection.');
  response.authored = receipt.authoredOn;
  response.item?.sort((first, second) => first.linkId.localeCompare(second.linkId));
  provenance.recorded = receipt.authoredOn;
  if (!equal(JSON.parse(receipt.input[1].valueString ?? ''), expected)) throw new Error('Saved personnel content differs from the confirmed preview.');
  const replacements = new Map(expected.entry!.map((entry, index) => [entry.fullUrl!, result.resources[index].reference]));
  const rewrite = (value: unknown): unknown => {
    if (typeof value === 'string') return replacements.get(value) ?? value;
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]));
    return value;
  };
  const body = (resource: Resource) => { const { id, meta, ...rest } = resource; return rest; };
  for (const [index, item] of result.resources.entries()) {
    const actual = await read(item.reference);
    const wanted = expected.entry![index].resource!;
    if (!equal(body(actual), rewrite(body(wanted))) || wanted.meta?.profile?.some(profile => !actual.meta?.profile?.includes(profile)) ||
        wanted.meta?.tag?.some(tag => !actual.meta?.tag?.some(value => equal(value, tag))) ||
        !actual.meta?.tag?.some(tag => tag.system === 'https://hiivehealth.com/fhir/CodeSystem/personnel-save-step' && tag.code === `${pending.submissionId}:${item.step}`) ||
        !actual.meta?.tag?.some(tag => tag.system === 'https://hiivehealth.com/fhir/CodeSystem/personnel-save-fingerprint' && tag.code === result.fingerprint)) {
      throw new Error('Saved personnel artifacts or provenance differ from the confirmed preview.');
    }
  }
  assertPersonnelPending(client, pending);
  return result;
}

export interface PersonnelHistory {
  entries: { saved: PersonnelSaved; recorded: string; actor: string; kind: string; value: string }[];
  limited: boolean;
}

export async function loadPersonnelHistory(client: MedplumClient): Promise<PersonnelHistory> {
  const actor = identity(client);
  const receipts = await client.searchResources('Task', {
    patient: PERSONNEL_WORKER,
    code: 'https://hiivehealth.com/fhir/CodeSystem/synthetic-oem-operation|personnel-save',
    status: 'completed', _count: '11', _sort: '-_lastUpdated',
  }, { cache: 'no-cache' });
  if (receipts.length > 11 || new Set(receipts.map(receipt => receipt.id)).size !== receipts.length) throw new Error('Personnel receipt search could not be verified.');
  const entries: PersonnelHistory['entries'] = [];
  for (const receipt of receipts.slice(0, 10)) {
    if (receipt.meta?.project !== OEM_PROJECT_ID || receipt.for?.reference !== PERSONNEL_WORKER || receipt.requester?.reference !== actor ||
        !receipt.id || !receipt.meta.versionId) throw new Error('Personnel history scope could not be verified.');
    const collection = JSON.parse(receipt.input?.[1].valueString ?? '') as Bundle;
    const response = collection.entry?.[0].resource;
    const fact = collection.entry?.[1].resource;
    if (response?.resourceType !== 'QuestionnaireResponse' || response.author?.reference !== actor ||
        fact?.resourceType !== 'Observation' || !response.identifier?.value) throw new Error('Personnel history content could not be verified.');
    const pending: PersonnelPending = { version: 1, project: OEM_PROJECT_ID, actor, submissionId: response.identifier.value,
      response: preparePersonnelResponse(response), collection };
    const result: PersonnelSaved = { status: 'completed', activated: false, replayed: true, submissionId: pending.submissionId,
      fingerprint: receipt.input?.[0].valueString ?? '', receipt: `Task/${receipt.id}/_history/${receipt.meta.versionId}`,
      resources: (receipt.output ?? []).map(output => ({ step: output.type.text ?? '', reference: output.valueReference?.reference ?? '' })) };
    await readbackPersonnel(client, pending, result);
    entries.push({ saved: result, actor, recorded: receipt.authoredOn!, kind: fact.code.coding?.[0]?.code ?? '',
      value: fact.valueCodeableConcept?.coding?.[0]?.code ?? `${fact.effectiveDateTime} (${fact.component?.[0]?.valueCodeableConcept?.coding?.[0]?.code})` });
  }
  if (identity(client) !== actor) throw new Error('Personnel history identity changed.');
  return { entries, limited: receipts.length > 10 };
}
