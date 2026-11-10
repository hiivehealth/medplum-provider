import type { MedplumClient } from '@medplum/core';
import type { DocumentReference, Observation, Patient, Task } from '@medplum/fhirtypes';

export const OEM_PROJECT_ID = '33e151fc-3e91-4df9-8093-106107f7e2f1';
export const OEM_REVIEW_BOT_ID = 'd45729ec-20c4-4c3c-84a4-db0579c749c1';
const NS = 'https://hiivehealth.com/fhir';
export const REVIEW_REASONS = [
  { value: 'clinician-record-preferred', label: 'Clinician record preferred' },
  { value: 'source-evidence-insufficient', label: 'Source evidence insufficient' },
  { value: 'duplicate-source-change', label: 'Duplicate source change' },
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number]['value'];

function scope(client: MedplumClient): void {
  if (client.getProject()?.id !== OEM_PROJECT_ID) {
    throw new Error('The Army OEM Synthetic Demo Project is required.');
  }
}

function reference(value: string | undefined, type: string, history = false): string {
  const pattern = new RegExp(`^${type}/[A-Za-z0-9.-]+${history ? '/_history/[A-Za-z0-9.-]+' : ''}$`);
  if (!value || !pattern.test(value)) {
    throw new Error('The review contains an invalid resource reference.');
  }
  return value;
}

export function reviewReference(task: Task): string {
  if (
    task.meta?.project !== OEM_PROJECT_ID ||
    !task.id ||
    !task.meta.versionId ||
    task.intent !== 'proposal' ||
    !['requested', 'completed'].includes(task.status) ||
    task.identifier?.[0]?.system !== `${NS}/identifier/mock-ih-conflict` ||
    task.code?.coding?.[0]?.system !== `${NS}/CodeSystem/oem-ih-review` ||
    !['source-version-reused', 'clinician-amendment-present', 'source-content-changed'].includes(
      task.code.coding[0].code ?? ''
    )
  ) {
    throw new Error('This is not a supported synthetic IH conflict.');
  }
  reference(task.for?.reference, 'Patient');
  reference(task.focus?.reference, 'Observation', true);
  return reference(`Task/${task.id}/_history/${task.meta.versionId}`, 'Task', true);
}

export async function loadReviews(client: MedplumClient, status: 'requested' | 'completed'): Promise<Task[]> {
  scope(client);
  const code = ['source-version-reused', 'clinician-amendment-present', 'source-content-changed']
    .map((value) => `${NS}/CodeSystem/oem-ih-review|${value}`)
    .join(',');
  const tasks = await client.searchResources(
    'Task',
    { code, status, _count: '50', _sort: '-_lastUpdated' },
    { cache: 'no-cache' }
  );
  tasks.forEach(reviewReference);
  return tasks;
}

export interface ReviewDetail {
  task: string;
  patient: Patient;
  exposure: Observation;
  latest: Observation;
  incoming: Observation;
  incomingExposure: Observation;
  evidence: DocumentReference;
  sourceVersion: string;
  stale: boolean;
}

export async function loadReviewDetail(client: MedplumClient, task: Task): Promise<ReviewDetail> {
  scope(client);
  const taskReference = reviewReference(task);
  const focus = reference(task.focus?.reference, 'Observation', true);
  const evidenceReference = reference(task.input?.[3]?.valueReference?.reference, 'DocumentReference', true);
  const patientReference = reference(task.for?.reference, 'Patient');
  const [, exposureId, , exposureVersion] = focus.split('/');
  const [, evidenceId, , evidenceVersion] = evidenceReference.split('/');
  const [patient, exposure, latest, evidence] = await Promise.all([
    client.readResource('Patient', patientReference.split('/')[1], { cache: 'no-cache' }),
    client.readVersion('Observation', exposureId, exposureVersion, { cache: 'no-cache' }),
    client.readResource('Observation', exposureId, { cache: 'no-cache' }),
    client.readVersion('DocumentReference', evidenceId, evidenceVersion, { cache: 'no-cache' }),
  ]);
  if (
    [patient, exposure, latest, evidence].some((resource) => resource.meta?.project !== OEM_PROJECT_ID) ||
    patient.resourceType !== 'Patient' ||
    `Patient/${patient.id}` !== patientReference ||
    !patient.meta?.tag?.some((tag) => tag.system === `${NS}/CodeSystem/demo-data` && tag.code === 'synthetic-only') ||
    exposure.subject?.reference !== patientReference ||
    latest.subject?.reference !== patientReference ||
    evidence.subject?.reference !== patientReference ||
    exposure.id !== exposureId ||
    exposure.meta?.versionId !== exposureVersion ||
    latest.id !== exposureId ||
    !latest.meta?.versionId ||
    evidence.id !== evidenceId ||
    evidence.meta?.versionId !== evidenceVersion ||
    evidence.status !== 'current'
  ) {
    throw new Error('Worker, Project or exact evidence history does not match the conflict.');
  }
  const raw = task.input?.[4]?.valueString;
  if (!raw || raw.length > 32768) {
    throw new Error('Incoming source facts are unavailable.');
  }
  const facts: unknown = JSON.parse(raw);
  if (!facts || typeof facts !== 'object') {
    throw new Error('Incoming source facts are invalid.');
  }
  const incoming = facts as {
    sourceVersion?: string;
    fingerprint?: string;
    exposure?: Observation;
    measurement?: Observation;
  };
  if (
    incoming.exposure?.resourceType !== 'Observation' ||
    incoming.measurement?.resourceType !== 'Observation' ||
    incoming.exposure.subject?.reference !== patientReference ||
    incoming.measurement.subject?.reference !== patientReference ||
    incoming.measurement.focus?.[0]?.reference !== focus ||
    incoming.exposure.derivedFrom?.[0]?.reference !== evidenceReference ||
    incoming.measurement.derivedFrom?.[0]?.reference !== evidenceReference ||
    incoming.sourceVersion !== task.input?.[0]?.valueString ||
    incoming.fingerprint !== task.input?.[1]?.valueString
  ) {
    throw new Error('Incoming facts are not bound to this worker and conflict.');
  }
  return {
    task: taskReference,
    patient,
    exposure,
    latest,
    incoming: incoming.measurement,
    incomingExposure: incoming.exposure,
    evidence,
    sourceVersion: incoming.sourceVersion ?? '',
    stale: latest.meta.versionId !== exposureVersion,
  };
}

export async function keepCurrent(client: MedplumClient, task: Task, reason: ReviewReason): Promise<void> {
  scope(client);
  if (task.status !== 'requested' || !REVIEW_REASONS.some((item) => item.value === reason)) {
    throw new Error('An open conflict and structured reason are required.');
  }
  const result: { status?: string; clinicalWrites?: number } = await client.post(
    `fhir/R4/Bot/${OEM_REVIEW_BOT_ID}/$execute`,
    {
      mode: 'resolve-ih-review',
      task: reviewReference(task),
      decision: 'keep-current',
      reason,
    },
    'application/json'
  );
  if (!['resolved', 'replayed'].includes(result.status ?? '') || result.clinicalWrites !== 0) {
    throw new Error('Review completion was not confirmed. Reload before retrying.');
  }
}
