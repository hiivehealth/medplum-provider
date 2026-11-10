import { deepEquals, type MedplumClient } from '@medplum/core';
import type { AuditEvent, Observation, Provenance, Resource, Task } from '@medplum/fhirtypes';
import { OEM_PROJECT_ID } from './ih-review';
import type { DecisionInput } from './clinician-decision';

export const EXPOSURE_WORKFLOW_BOT_ID: string = '21db5c01-8803-4570-add5-3fa2bbacadbc';

export interface ExposureWorkflowRequest {
  mode: 'preview' | 'recommend' | 'decision-preview' | 'decide' | 'completion-preview' | 'complete' | 'enrollment-preview' | 'enroll' | 'measurement-preview' | 'measure' | 'measurement-history';
  patient: string;
  exposure: string;
  enrollment?: string;
  asOf: string;
  task?: string;
  decision?: DecisionInput['decision'];
  reason?: DecisionInput['reason'];
  due?: string;
  performedOn?: string;
  fingerprint?: string;
  confirmedSave?: true;
  determination?: 'enrolled' | 'not-enrolled' | 'needs-review';
  enrollmentStart?: string;
  enrollmentEvidence?: string;
  submissionId?: string;
  measurement?: {
    metric: 'eight-hour-twa' | 'peak'; value: number; unit: 'dBA' | 'dBC' | 'dB';
    basis: '8h' | 'peak'; method: 'synthetic-personal-dosimetry' | 'synthetic-area-assessment';
    assessedOn: string; evidence: string;
  };
}

export interface MeasurementAuditEntry { record: Observation; lineage: Provenance; audit: AuditEvent; }

export interface ExposureWorkflowResult {
  phase: 'advisory' | 'recommendation' | 'decision' | 'completion' | 'enrollment' | 'measurement' | 'measurement-history';
  patient: string;
  exposure: string;
  enrollment?: string;
  sources: string[];
  persisted: boolean;
  activated: false;
  externalDispatch: false;
  clinicalCompletionVerified: false;
  fingerprint: string;
  status?: string;
  rationale?: string;
  due?: string;
  stage?: string;
  canRecommend?: boolean;
  decision?: DecisionInput['decision'];
  task?: string;
  proposal?: string;
  report?: string;
  receipt?: string;
  attestation?: string;
  audit?: string;
  lineage?: string;
  performedOn?: string;
  nextPeriodicOn?: string;
  enrollmentRecord?: string;
  determination?: ExposureWorkflowRequest['determination'];
  enrollmentStart?: string;
  enrollmentEvidence?: string;
  measurement?: ExposureWorkflowRequest['measurement'];
  measurementRecord?: string;
  recordedAt?: string;
  entries?: MeasurementAuditEntry[];
  coverage?: 'appended-measurements-only';
}

function actorScope(client: MedplumClient): string {
  const profile = client.getProfile();
  if (client.getProject()?.id !== OEM_PROJECT_ID || profile?.resourceType !== 'Practitioner' || !profile.id) {
    throw new Error('The authenticated OEM clinician is required');
  }
  return `Practitioner/${profile.id}`;
}

function exact(reference: string | undefined, type: string): boolean {
  return new RegExp(`^${type}/[A-Za-z0-9.-]+/_history/[A-Za-z0-9.-]+$`).test(reference ?? '');
}

export async function verifyExposureWorkflowResult(client: MedplumClient, request: ExposureWorkflowRequest,
  raw: ExposureWorkflowResult): Promise<ExposureWorkflowResult> {
  const actor = actorScope(client);
  const fail = (): never => { throw new Error('The same-exposure workflow result could not be verified'); };
  const phase = { preview: 'advisory', recommend: 'recommendation', 'decision-preview': 'decision', decide: 'decision',
    'completion-preview': 'completion', complete: 'completion', 'enrollment-preview': 'enrollment', enroll: 'enrollment',
    'measurement-preview': 'measurement', measure: 'measurement', 'measurement-history': 'measurement-history' }[request.mode];
  const writing = ['recommend', 'decide', 'complete', 'enroll', 'measure'].includes(request.mode);
  if (!raw || raw.phase !== phase || raw.patient !== request.patient || raw.exposure !== request.exposure || raw.enrollment !== request.enrollment ||
      raw.activated !== false || raw.externalDispatch !== false || raw.clinicalCompletionVerified !== false ||
      !/^[a-f0-9]{64}$/.test(raw.fingerprint) || !Array.isArray(raw.sources) ||
      raw.sources.length !== (request.enrollment ? 3 : 2) || raw.sources[0] !== request.exposure ||
      (request.enrollment && raw.sources[1] !== request.enrollment) || !exact(raw.sources.at(-1), 'DocumentReference') ||
      (writing && (!raw.persisted || raw.fingerprint !== request.fingerprint)) ||
      (request.mode !== 'completion-preview' && !writing && raw.persisted)) fail();
  if (request.mode === 'preview' && (!['due', 'overdue', 'current', 'needs-review'].includes(raw.status ?? '') ||
      typeof raw.canRecommend !== 'boolean' || !raw.rationale ||
      (raw.canRecommend && (!['due', 'overdue'].includes(raw.status!) || !/^\d{4}-\d{2}-\d{2}$/.test(raw.due ?? ''))))) fail();
  if (phase === 'decision' && (raw.decision !== request.decision || !exact(raw.task, 'Task') ||
      raw.task!.split('/')[1] !== request.task?.split('/')[1])) fail();
  if (phase === 'completion' && (raw.task !== request.task || raw.performedOn !== request.performedOn ||
      !/^\d{4}-\d{2}-\d{2}$/.test(raw.nextPeriodicOn ?? ''))) fail();
  const read = async (reference: string | undefined, type: Resource['resourceType']): Promise<Resource> => {
    if (!exact(reference, type)) return fail();
    const [, id, , version] = reference!.split('/');
    const resource = await client.readVersion(type, id, version, { cache: 'no-cache', maxRetries: 0 });
    if (resource.meta?.project !== OEM_PROJECT_ID || `${resource.resourceType}/${resource.id}/_history/${resource.meta.versionId}` !== reference) fail();
    return resource;
  };
  const verifyMeasurement = async (reference: string, lineageReference: string, auditReference: string): Promise<MeasurementAuditEntry> => {
    const record = await read(reference, 'Observation');
    const lineage = await read(lineageReference, 'Provenance');
    const audit = await read(auditReference, 'AuditEvent');
    if (record.resourceType !== 'Observation' || lineage.resourceType !== 'Provenance' || audit.resourceType !== 'AuditEvent') return fail();
    const metric = record.code.coding?.find(code => code.system === 'https://hiivehealth.com/fhir/CodeSystem/oem-noise-metric')?.code;
    const basis = record.extension?.filter(extension => extension.url === 'https://hiivehealth.com/fhir/StructureDefinition/measurement-basis');
    const unit = record.extension?.filter(extension => extension.url === 'https://hiivehealth.com/fhir/StructureDefinition/measurement-unit');
    const sourceExposure = record.focus?.[0]?.reference;
    const evidence = record.derivedFrom?.[0]?.reference;
    const recordedAt = record.meta?.lastUpdated;
    if (record.status !== 'final' || record.subject?.reference !== request.patient || record.focus?.length !== 1 ||
        !exact(sourceExposure, 'Observation') || sourceExposure!.split('/').slice(0, 2).join('/') !== request.exposure.split('/').slice(0, 2).join('/') ||
        record.performer?.length !== 1 || record.performer[0].reference !== actor || record.derivedFrom?.length !== 1 || !exact(evidence, 'DocumentReference') ||
        record.identifier?.length !== 1 || record.identifier[0].system !== 'https://hiivehealth.com/fhir/CodeSystem/oem-exposure-workflow/measurement' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(record.identifier[0].value ?? '') ||
        typeof record.valueQuantity?.value !== 'number' || !Number.isFinite(record.valueQuantity.value) || record.valueQuantity.value < 0 || record.dataAbsentReason ||
        basis?.length !== 1 || unit?.length !== 1 || unit[0].valueCode !== record.valueQuantity.unit ||
        !['synthetic-personal-dosimetry', 'synthetic-area-assessment'].includes(record.method?.text ?? '') ||
        !['eight-hour-twa', 'peak'].includes(metric ?? '') ||
        (metric === 'eight-hour-twa' ? basis[0].valueString !== '8h' || unit[0].valueCode !== 'dBA'
          : basis[0].valueString !== 'peak' || !['dBA', 'dBC', 'dB'].includes(unit[0].valueCode ?? '')) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(record.effectiveDateTime ?? '') || !Number.isFinite(Date.parse(record.effectiveDateTime!)) ||
        new Date(record.effectiveDateTime!).toISOString().slice(0, 10) !== record.effectiveDateTime || record.effectiveDateTime! > request.asOf ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(recordedAt ?? '') || !Number.isFinite(Date.parse(recordedAt!)) ||
        new Date(recordedAt!).toISOString() !== recordedAt || recordedAt!.slice(0, 10) > request.asOf ||
        lineage.recorded !== recordedAt || lineage.target?.length !== 1 || lineage.target[0].reference !== reference ||
        lineage.agent?.length !== 1 || lineage.agent[0].who.reference !== actor ||
        !deepEquals(lineage.entity?.map(entity => ({ role: entity.role, reference: entity.what.reference })),
          [sourceExposure, evidence].map(source => ({ role: 'source', reference: source }))) ||
        audit.action !== 'C' || audit.outcome !== '0' || audit.recorded !== recordedAt || audit.agent?.length !== 1 ||
        audit.agent[0].who?.reference !== actor || audit.agent[0].requestor !== true ||
        !deepEquals(audit.entity?.map(entity => entity.what?.reference), [request.patient, sourceExposure, reference, evidence])) return fail();
    if (request.mode === 'measure' && (sourceExposure !== request.exposure || record.identifier[0].value !== request.submissionId ||
        raw.recordedAt !== recordedAt || !deepEquals(request.measurement, { metric, value: record.valueQuantity.value, unit: record.valueQuantity.unit,
          basis: basis[0].valueString, method: record.method?.text, assessedOn: record.effectiveDateTime, evidence }))) return fail();
    return { record, lineage, audit };
  };
  if (phase === 'measurement') {
    if (request.enrollment || !request.measurement || !deepEquals(raw.measurement, request.measurement)) fail();
    if (raw.persisted) await verifyMeasurement(raw.measurementRecord!, raw.lineage!, raw.audit!);
  }
  if (phase === 'measurement-history') {
    if (request.enrollment || raw.coverage !== 'appended-measurements-only' || !Array.isArray(raw.entries) || raw.entries.length > 50 ||
        new Set(raw.entries.map(entry => entry?.record?.id)).size !== raw.entries.length) fail();
    for (const entry of raw.entries!) {
      const reference = (record: Resource) => `${record.resourceType}/${record.id}/_history/${record.meta?.versionId}`;
      const actual = await verifyMeasurement(reference(entry.record), reference(entry.lineage), reference(entry.audit));
      if (!deepEquals(actual, entry)) fail();
    }
  }
  if (phase === 'enrollment') {
    if (raw.determination !== request.determination || raw.enrollmentStart !== request.enrollmentStart || raw.enrollmentEvidence !== request.enrollmentEvidence) fail();
    if (raw.persisted) {
      const record = await read(raw.enrollmentRecord, 'Observation');
      if (record.resourceType !== 'Observation' || record.status !== 'final' || record.subject?.reference !== request.patient ||
          record.focus?.[0]?.reference !== request.exposure.split('/').slice(0, 2).join('/') || record.valueCodeableConcept?.text !== request.determination ||
          record.performer?.[0]?.reference !== actor || record.derivedFrom?.[0]?.reference !== request.enrollmentEvidence ||
          record.effectivePeriod?.start !== request.enrollmentStart) fail();
    }
  }
  if (raw.persisted && phase !== 'enrollment' && phase !== 'measurement') {
    const task = await read(raw.task, 'Task') as Task;
    if (task.for?.reference !== request.patient || task.reasonReference?.reference !== request.exposure.split('/').slice(0, 2).join('/') ||
        task.intent !== 'proposal' || !task.code?.coding?.some(code => code.system === 'https://hiivehealth.com/fhir/CodeSystem/oem-surveillance-action' && code.code === 'audiogram') ||
        JSON.stringify(task.input?.filter(item => item.type.text === 'Exact workflow source').map(item => item.valueReference?.reference)) !== JSON.stringify(raw.sources)) fail();
    const expectedStatus = phase === 'recommendation' ? 'requested' : phase === 'completion' || request.decision === 'accept' ? 'accepted'
      : request.decision === 'dismiss' ? 'rejected' : 'requested';
    if (task.status !== expectedStatus || (phase !== 'recommendation' && task.owner?.reference !== actor)) fail();
    if (phase !== 'recommendation') {
      const receipt = await read(raw.receipt, 'Task') as Task;
      if (receipt.for?.reference !== request.patient || receipt.requester?.reference !== actor || receipt.status !== 'completed' ||
          receipt.focus?.reference !== request.task) fail();
    }
    if (phase === 'completion' || (phase === 'decision' && request.decision === 'accept')) {
      const proposal = await read(raw.proposal, 'ServiceRequest');
      if (proposal.resourceType !== 'ServiceRequest' || proposal.status !== 'draft' || proposal.intent !== 'proposal' ||
          proposal.subject.reference !== request.patient || proposal.requester?.reference !== actor ||
          task.output?.find(output => output.type.text === 'Local proposal')?.valueReference?.reference !== raw.proposal?.split('/').slice(0, 2).join('/')) fail();
    }
    if (phase === 'completion') {
      const attestation = await read(raw.attestation, 'Observation');
      const report = await read(raw.report, 'DocumentReference');
      if (attestation.resourceType !== 'Observation' || attestation.subject?.reference !== request.patient || attestation.status !== 'final' ||
          attestation.focus?.[0]?.reference !== raw.task || attestation.basedOn?.[0]?.reference !== raw.proposal ||
          attestation.derivedFrom?.[0]?.reference !== raw.report || attestation.performer?.[0]?.reference !== actor ||
          attestation.effectiveDateTime !== raw.performedOn || report.resourceType !== 'DocumentReference' || report.status !== 'current' ||
          report.subject?.reference !== request.patient || !report.context?.related?.some(reference => reference.reference === raw.proposal)) fail();
      await read(raw.lineage, 'Provenance'); await read(raw.audit, 'AuditEvent');
    }
  }
  if (raw.persisted && ['recommendation', 'enrollment'].includes(phase)) {
    await read(raw.lineage, 'Provenance'); await read(raw.audit, 'AuditEvent');
  }
  if (actorScope(client) !== actor) fail();
  return structuredClone(raw);
}

export async function sendExposureWorkflow(client: MedplumClient, request: ExposureWorkflowRequest): Promise<ExposureWorkflowResult> {
  const actor = actorScope(client);
  if (!/^[a-f0-9-]{36}$/i.test(EXPOSURE_WORKFLOW_BOT_ID)) throw new Error('The same-exposure workflow service has not been configured');
  if (!/^Patient\/[A-Za-z0-9.-]+$/.test(request.patient) || !exact(request.exposure, 'Observation') ||
      (request.enrollment && !exact(request.enrollment, 'Observation'))) throw new Error('An exact worker and exposure scope are required');
  const raw = await client.post<ExposureWorkflowResult>(`fhir/R4/Bot/${EXPOSURE_WORKFLOW_BOT_ID}/$execute`,
    request, 'application/json', { maxRetries: 0 });
  if (actorScope(client) !== actor) throw new Error('The clinician scope changed');
  return verifyExposureWorkflowResult(client, request, raw);
}

export function exposureSummary(result: ExposureWorkflowResult) {
  if (result.phase !== 'completion' || !result.persisted || !result.attestation || !result.report || !result.task || !result.proposal ||
      result.activated !== false || result.externalDispatch !== false || result.clinicalCompletionVerified !== false) {
    throw new Error('A verified saved synthetic follow-up is required');
  }
  return { mode: 'synthetic-same-exposure-summary', coverage: 'one-selected-exposure-only',
    patient: result.patient, exposure: result.exposure, enrollment: result.enrollment,
    recommendation: result.task, draftOrder: result.proposal, report: result.report, attestation: result.attestation,
    performedOn: result.performedOn, illustrativeNextPeriodicOn: result.nextPeriodicOn, sources: result.sources,
    receipt: result.receipt, lineage: result.lineage, audit: result.audit,
    clinicalCompletionVerified: false, complianceAssessed: false, completePopulation: false, activated: false, externalDispatch: false,
    limitations: ['Synthetic attestation only; no measured hearing thresholds or verified examination.',
      'Illustrative 12-calendar-month policy; clinical approval pending.', 'Not an activated, signed or delivered order.'] };
}