import { deepClone, type MedplumClient } from '@medplum/core';
import type {
  ClinicalImpression,
  DocumentReference,
  Observation,
  Patient,
  Provenance,
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireResponse,
  QuestionnaireResponseItem,
} from '@medplum/fhirtypes';
import { OEM_PROJECT_ID } from './ih-review';

export const INTAKE_BOT_ID = '4dba434f-1549-4a02-93b6-e15bdcefdd90';
export const INTAKE_PREVIEW_BOT_ID = 'd92817e9-c540-410a-b92e-73cd92a78876';
export const INTAKE_QUESTIONNAIRE_ID = '585c94f7-4c99-4af9-b8e0-607e99797a46';
export const INTAKE_QUESTIONNAIRE_VERSION = '039204a6-285e-4cca-8ba4-8e12faa678b5';
export const INTAKE_CANONICAL = 'https://hiivehealth.com/fhir/Questionnaire/synthetic-noise-intake|demo-1';
export const NOISE_PREVIEW_BOT_ID = '58eb84c1-5d92-4e0f-b476-b300c240abca';
export const NOISE_RULE_CANONICAL = 'https://hiivehealth.com/fhir/PlanDefinition/synthetic-noise-503|demo-1';
export const LIFECYCLE_BOT_ID = '15f69821-6267-4911-b255-e7460b395ec3';
export const LIFECYCLE_WORKER_ID = 'f8be7ab5-b799-4345-baba-2ba675122b13';
export const LIFECYCLE_EXPOSURE = 'Observation/baa7efea-26cc-44ee-9d9b-b4351aff9112/_history/305afa94-491a-4838-a4d7-e4abf3bc367f';
export const LIFECYCLE_RECOMMENDATION = 'Task/790e5844-e7f4-446e-ae9a-f6ead2b1a37b/_history/42fdbec8-c94b-49f4-b1da-8a6ff345c8b9';

export interface LifecycleInspection {
  inspectedAt: string;
  activity: 'active' | 'inactive' | 'future';
  headState: 'unchanged-at-read-checks' | 'changed';
  status: string;
  reviewRequired: boolean;
  searchedRecommendations: number;
  recommendations: { reference: string; status: string; reviewRequired: boolean }[];
  proposals?: { reference: string; status: string; reviewRequired: boolean }[];
}

export async function inspectRetainedWork(client: MedplumClient, patient: Patient): Promise<LifecycleInspection> {
  const unavailable = (): Error => new Error('Retained work inspection is unavailable.');
  try {
    scope(client);
    assertWorker(patient);
    const actor = client.getProfile();
    const requester = actor?.resourceType === 'Practitioner' ? `Practitioner/${actor.id}` : '';
    if (patient.id !== LIFECYCLE_WORKER_ID || !requester || !actor?.id) throw unavailable();
    const result = await client.post<{
      mode: string; coverage: string; persisted: boolean; activated: boolean; canGenerateNewWork: boolean;
      inspectedAt: string; requester: string; headState: LifecycleInspection['headState']; changedReferences: string[];
      searchState: string; searchedRecommendations: number;
      inspection: { mode: string; coverage: string; persisted: boolean; activated: boolean; canGenerateNewWork: boolean;
        exposure: string; activityAsOf: string; activity: LifecycleInspection['activity']; disposition: string;
        retained: { reference: string; status: string; reviewRequired: boolean }[]; unverifiedProposalReferences: string[] };
    }>(`fhir/R4/Bot/${LIFECYCLE_BOT_ID}/$execute`, {
      mode: 'collect', patient: `Patient/${LIFECYCLE_WORKER_ID}`, exposure: LIFECYCLE_EXPOSURE,
    }, 'application/json');
    const inspection = result?.inspection;
    const retained = inspection?.retained;
    const recommendations = Array.isArray(retained) ? retained.filter(record => record?.reference?.startsWith('Task/')) : [];
    const proposals = Array.isArray(retained) ? retained.filter(record => record?.reference?.startsWith('ServiceRequest/')) : [];
    const statuses = ['draft', 'requested', 'received', 'accepted', 'rejected', 'ready', 'cancelled', 'in-progress', 'on-hold', 'failed', 'completed', 'entered-in-error'];
    const references = Array.isArray(retained) ? retained.map(record => record?.reference) : [];
    const expectedDisposition = { active: 'rule-evaluation-required', inactive: 'ended-exposure-review', future: 'future-exposure-review' };
    if (result?.mode !== 'inspection-only' || result.coverage !== 'bounded-authorized-search-only' || result.persisted !== false ||
      result.searchState !== 'unchanged-at-search-checks' || !Number.isSafeInteger(result.searchedRecommendations) ||
      result.searchedRecommendations < recommendations.length || result.searchedRecommendations > 100 ||
        result.activated !== false || result.canGenerateNewWork !== false || result.requester !== requester ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result.inspectedAt) ||
        !Number.isFinite(Date.parse(result.inspectedAt)) || new Date(result.inspectedAt).toISOString() !== result.inspectedAt ||
        !['unchanged-at-read-checks', 'changed'].includes(result.headState) || !Array.isArray(result.changedReferences) ||
        new Set(result.changedReferences).size !== result.changedReferences.length ||
        result.changedReferences.some(reference => ![LIFECYCLE_EXPOSURE, ...references].includes(reference)) ||
        (result.headState === 'changed') !== (result.changedReferences.length > 0) ||
        inspection?.mode !== 'inspection-only' || inspection.coverage !== 'supplied-records-only' ||
        inspection.persisted !== false || inspection.activated !== false || inspection.canGenerateNewWork !== false ||
        inspection.exposure !== LIFECYCLE_EXPOSURE || inspection.activityAsOf !== result.inspectedAt.slice(0, 10) ||
        !Object.hasOwn(expectedDisposition, inspection.activity) || inspection.disposition !== expectedDisposition[inspection.activity] ||
        !Array.isArray(inspection.unverifiedProposalReferences) || inspection.unverifiedProposalReferences.length !== 0 ||
        !Array.isArray(retained) || retained.length > 49 ||
        proposals.length > recommendations.filter(record => record.status === 'accepted').length ||
        new Set(references.map(reference => reference?.split('/').slice(0, 2).join('/'))).size !== references.length ||
        retained.some(record => !record || typeof record.reference !== 'string' ||
          !/^(Task|ServiceRequest)\/[A-Za-z0-9.-]+\/_history\/[A-Za-z0-9.-]+$/.test(record.reference) || !statuses.includes(record.status) ||
          (record.reference.startsWith('ServiceRequest/') && record.status !== 'draft') ||
          record.reviewRequired !== (inspection.activity !== 'active' && !['completed', 'cancelled', 'entered-in-error'].includes(record.status)))) throw unavailable();
    scope(client);
    const currentActor = client.getProfile();
    if (`${currentActor?.resourceType}/${currentActor?.id}` !== requester) throw unavailable();
    return { inspectedAt: result.inspectedAt, activity: inspection.activity, headState: result.headState,
      status: recommendations.map(record => record.status).join(', ') || 'none', reviewRequired: retained.some(record => record.reviewRequired),
      searchedRecommendations: result.searchedRecommendations, recommendations: deepClone(recommendations),
      ...(proposals.length ? { proposals: deepClone(proposals) } : {}) };
  } catch {
    throw unavailable();
  }
}

export function exposureTimelineDetails(
  observation: Observation,
  asOf: string
): {
  type: string;
  status: 'Active' | 'Inactive' | 'Future' | 'Unknown';
  source: string;
} {
  const namespace = 'https://hiivehealth.com/fhir';
  const sources: Record<string, string> = {
    'ih-ingested': 'IH-imported',
    'ih-entered': 'IH-entered',
    'clinician-entered': 'Clinician-entered',
    'clinician-modified': 'Clinician-amended',
  };
  const sourceExtensions =
    observation.extension?.filter(
      (extension) => extension.url === `${namespace}/StructureDefinition/exposure-source`
    ) ?? [];
  const statusExtensions =
    observation.extension?.filter(
      (extension) => extension.url === `${namespace}/StructureDefinition/exposure-status`
    ) ?? [];
  const codeOnly = (extension: NonNullable<Observation['extension']>[number]): boolean =>
    Object.keys(extension).every((key) => key === 'url' || key === 'valueCode') &&
    typeof extension.valueCode === 'string';
  const source =
    sourceExtensions.length === 1 &&
    codeOnly(sourceExtensions[0]) &&
    Object.hasOwn(sources, sourceExtensions[0].valueCode!)
      ? sources[sourceExtensions[0].valueCode!]
      : 'Unknown';
  const codes =
    observation.code.coding?.filter((coding) => coding.system === `${namespace}/CodeSystem/oem-stressor`) ?? [];
  const type = codes.length === 1 && codes[0].code === '503' ? 'Noise 503' : 'Unknown';
  const validDate = (value: string | undefined): value is string =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const start = observation.effectivePeriod?.start;
  const end = observation.effectivePeriod?.end;
  let status: 'Active' | 'Inactive' | 'Future' | 'Unknown' = 'Unknown';
  if (
    validDate(asOf) &&
    validDate(start) &&
    (end === undefined || (validDate(end) && end >= start)) &&
    !observation.effectiveDateTime &&
    statusExtensions.length <= 1 &&
    (statusExtensions.length === 0 ||
      (codeOnly(statusExtensions[0]) && ['active', 'inactive'].includes(statusExtensions[0].valueCode!)))
  ) {
    status =
      statusExtensions[0]?.valueCode === 'inactive' || (end !== undefined && end < asOf)
        ? 'Inactive'
        : start > asOf
          ? 'Future'
          : 'Active';
  }
  return { type, status, source };
}

export interface ExposureAmendmentDetails {
  actor: string;
  recorded: string;
  reason: string;
  lineage: string;
  previous: string;
}

export function exposureAmendmentDetails(
  exposure: Observation,
  lineage: Provenance,
  previous: Observation
): ExposureAmendmentDetails | undefined {
  const namespace = 'https://hiivehealth.com/fhir';
  const exact = (resource: Observation | Provenance): string | undefined =>
    resource.meta?.project === OEM_PROJECT_ID &&
    resource.id &&
    resource.meta.versionId &&
    /^[A-Za-z0-9.-]+$/.test(resource.id) &&
    /^[A-Za-z0-9.-]+$/.test(resource.meta.versionId)
      ? `${resource.resourceType}/${resource.id}/_history/${resource.meta.versionId}`
      : undefined;
  const target = exact(exposure);
  const lineageReference = exact(lineage);
  const previousReference = exact(previous);
  const patient = exposure.subject?.reference;
  const reasons: Record<string, string> = {
    'correct-dates': 'Correct dates',
    'correct-worksite': 'Correct worksite',
    'end-exposure': 'End exposure',
  };
  const reasonExtensions =
    exposure.extension?.filter(
      (extension) => extension.url === `${namespace}/StructureDefinition/exposure-amendment-reason`
    ) ?? [];
  const reason = reasonExtensions[0]?.valueCode;
  const revisions = lineage.entity?.filter((entity) => entity.role === 'revision') ?? [];
  const actor = lineage.agent?.[0]?.who?.reference;
  const fingerprint = (record: Observation | Provenance): string | undefined => {
    const extensions = record.extension?.filter(
      (extension) => extension.url === `${namespace}/StructureDefinition/intake-save-fingerprint`
    ) ?? [];
    return extensions.length === 1 &&
      Object.keys(extensions[0]).every((key) => ['url', 'valueString'].includes(key)) &&
      /^[a-f0-9]{64}$/.test(extensions[0].valueString ?? '')
      ? extensions[0].valueString
      : undefined;
  };
  const noise = (record: Observation): boolean =>
    record.status === 'final' &&
    record.code.coding?.filter((coding) => coding.system === `${namespace}/CodeSystem/oem-stressor`).length === 1 &&
    record.code.coding.some(
      (coding) => coding.system === `${namespace}/CodeSystem/oem-stressor` && coding.code === '503'
    ) &&
    !!record.category?.some((category) =>
      category.coding?.some(
        (coding) => coding.system === `${namespace}/CodeSystem/observation-category` && coding.code === 'exposure'
      )
    );
  if (
    !target ||
    !lineageReference ||
    !previousReference ||
    !/^Patient\/[A-Za-z0-9.-]+$/.test(patient ?? '') ||
    previous.subject?.reference !== patient ||
    previous.id !== exposure.id ||
    previousReference === target ||
    !noise(exposure) ||
    !noise(previous) ||
    exposureTimelineDetails(exposure, lineage.recorded?.slice(0, 10) ?? '').source !== 'Clinician-amended' ||
    reasonExtensions.length !== 1 ||
    !reason ||
    !Object.hasOwn(reasons, reason) ||
    Object.keys(reasonExtensions[0]).some((key) => !['url', 'valueCode'].includes(key)) ||
    lineage.target?.filter((reference) => reference.reference === target).length !== 1 ||
    revisions.length !== 1 ||
    revisions[0].what.reference !== previousReference ||
    lineage.agent?.length !== 1 ||
    !/^Practitioner\/[A-Za-z0-9.-]+$/.test(actor ?? '') ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(lineage.recorded) ||
    !Number.isFinite(Date.parse(lineage.recorded)) ||
    new Date(lineage.recorded).toISOString() !== lineage.recorded ||
    lineage.activity?.text !== 'Synthetic structured intake persistence' ||
    !fingerprint(exposure) ||
    fingerprint(exposure) !== fingerprint(lineage)
  ) {
    return undefined;
  }
  return {
    actor: actor!,
    recorded: lineage.recorded,
    reason: reasons[reason],
    lineage: lineageReference,
    previous: previousReference,
  };
}

export async function loadExposureAmendmentDetails(
  client: MedplumClient,
  patient: Patient,
  exposure: Observation
): Promise<ExposureAmendmentDetails> {
  const unavailable = (): Error => new Error('Verified amendment attribution is unavailable.');
  try {
    scope(client);
    assertWorker(patient);
    const selected = deepClone(exposure);
    const worker = `Patient/${patient.id}`;
    if (
      selected.meta?.project !== OEM_PROJECT_ID ||
      selected.subject?.reference !== worker ||
      !/^[A-Za-z0-9.-]+$/.test(selected.id ?? '') ||
      !/^[A-Za-z0-9.-]+$/.test(selected.meta?.versionId ?? '')
    ) {
      throw unavailable();
    }
    const target = `Observation/${selected.id}/_history/${selected.meta!.versionId}`;
    const historical = await client.readVersion('Observation', selected.id!, selected.meta!.versionId!, {
      cache: 'no-cache',
    });
    if (
      historical.resourceType !== 'Observation' ||
      historical.id !== selected.id ||
      historical.meta?.versionId !== selected.meta!.versionId ||
      historical.meta?.project !== OEM_PROJECT_ID ||
      historical.subject?.reference !== worker
    )
      throw unavailable();
    const candidates = await client.searchResources(
      'Provenance',
      {
        target,
        _count: '11',
        _sort: '-_lastUpdated',
      },
      { cache: 'no-cache' }
    );
    if (
      candidates.length >= 11 ||
      candidates.some(
        (record) =>
          record.resourceType !== 'Provenance' ||
          record.meta?.project !== OEM_PROJECT_ID ||
          !/^[A-Za-z0-9.-]+$/.test(record.id ?? '') ||
          !/^[A-Za-z0-9.-]+$/.test(record.meta?.versionId ?? '')
      )
    )
      throw unavailable();
    const matching = candidates.filter((record) => record.target.some((reference) => reference.reference === target));
    if (matching.length !== 1) throw unavailable();
    const candidate = matching[0];
    const lineage = await client.readVersion('Provenance', candidate.id!, candidate.meta!.versionId!, {
      cache: 'no-cache',
    });
    if (
      lineage.resourceType !== 'Provenance' ||
      lineage.id !== candidate.id ||
      lineage.meta?.versionId !== candidate.meta!.versionId ||
      lineage.meta?.project !== OEM_PROJECT_ID ||
      lineage.target?.filter((reference) => reference.reference === target).length !== 1
    )
      throw unavailable();
    const revisions = lineage.entity?.filter((entity) => entity.role === 'revision') ?? [];
    const previousReference = revisions[0]?.what.reference ?? '';
    if (
      revisions.length !== 1 ||
      !/^Observation\/[A-Za-z0-9.-]+\/_history\/[A-Za-z0-9.-]+$/.test(previousReference) ||
      previousReference.split('/')[1] !== selected.id
    )
      throw unavailable();
    const previous = await client.readVersion('Observation', selected.id!, previousReference.split('/')[3], {
      cache: 'no-cache',
    });
    const details = exposureAmendmentDetails(historical, lineage, previous);
    scope(client);
    if (!details) throw unavailable();
    return details;
  } catch {
    throw unavailable();
  }
}

export interface NoiseScenario {
  status: 'due' | 'overdue' | 'current' | 'needs-review';
  rationale: string;
  due?: string;
  stage?: 'baseline' | 'periodic';
  rule: string;
  sources: string[];
}
export type AmendmentReason = 'correct-dates' | 'correct-worksite' | 'end-exposure';
export interface IntakeRequest {
  mode: 'save';
  patient: string;
  response: QuestionnaireResponse;
  submissionId: string;
  at: string;
  exposure?: string;
  amendmentReason?: AmendmentReason;
}
export interface IntakeResult {
  status: 'completed';
  receipt: string;
  resources: { step: string; reference: string }[];
  replayed: boolean;
}

function scope(client: MedplumClient): void {
  if (client.getProject()?.id !== OEM_PROJECT_ID) throw new Error('The Army OEM Synthetic Demo Project is required.');
}

export async function previewNoiseScenario(
  client: MedplumClient,
  patient: Patient,
  exposure: Observation,
  asOf: string,
  enrollment?: Observation,
  completion?: Observation
): Promise<NoiseScenario> {
  scope(client);
  assertWorker(patient);
  const patientReference = `Patient/${patient.id}`;
  const reference = (record: Observation): string => {
    if (
      !record.id ||
      !record.meta?.versionId ||
      record.meta.project !== OEM_PROJECT_ID ||
      record.subject?.reference !== patientReference ||
      record.status !== 'final'
    )
      throw new Error('A verified worker observation version is required.');
    return `Observation/${record.id}/_history/${record.meta.versionId}`;
  };
  const exposureReference = reference(exposure);
  if (
    !exposure.code.coding?.some(
      (coding) => coding.system === 'https://hiivehealth.com/fhir/CodeSystem/oem-stressor' && coding.code === '503'
    ) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    !Number.isFinite(Date.parse(asOf)) ||
    new Date(asOf).toISOString().slice(0, 10) !== asOf
  )
    throw new Error('A Noise exposure and valid evaluation date are required.');
  const enrollmentReference = enrollment ? reference(enrollment) : undefined;
  if (
    enrollment &&
    (!enrollment.code.coding?.some(
      (coding) => coding.system === 'https://hiivehealth.com/fhir/CodeSystem/oem-enrollment' && coding.code === '503'
    ) ||
      enrollment.focus?.length !== 1 ||
      enrollment.focus[0].reference !== `Observation/${exposure.id}`)
  )
    throw new Error('Enrollment must match the selected exposure.');
  const completionReference = completion ? reference(completion) : undefined;
  if (
    completion &&
    (!enrollment ||
      !exposure.effectivePeriod?.start ||
      !enrollment.effectivePeriod?.start ||
      !completion.code.coding?.some(
        (coding) =>
          coding.system === 'https://hiivehealth.com/fhir/CodeSystem/oem-surveillance-action' &&
          coding.code === 'audiogram'
      ) ||
      completion.focus?.length !== 1 ||
      completion.focus[0].reference !== `Observation/${exposure.id}` ||
      completion.derivedFrom?.length !== 1 ||
      !completion.extension?.some(
        (item) =>
          item.url === 'https://hiivehealth.com/fhir/StructureDefinition/oem-rule' &&
          item.valueCanonical === NOISE_RULE_CANONICAL
      ) ||
      !completion.extension?.some(
        (item) =>
          item.url === 'https://hiivehealth.com/fhir/StructureDefinition/oem-completion-kind' &&
          ['synthetic-result', 'manual-attestation'].includes(item.valueCode ?? '')
      ) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(completion.effectiveDateTime ?? '') ||
      !Number.isFinite(Date.parse(completion.effectiveDateTime!)) ||
      new Date(completion.effectiveDateTime!).toISOString().slice(0, 10) !== completion.effectiveDateTime ||
      completion.effectiveDateTime! > asOf ||
      completion.effectiveDateTime! < exposure.effectivePeriod.start ||
      completion.effectiveDateTime! < enrollment.effectivePeriod.start)
  )
    throw new Error('Completion must match the dated worker, exposure, enrollment and synthetic rule.');
  const result = await client.post<{
    mode: string;
    persisted: boolean;
    evaluation: {
      status: NoiseScenario['status'];
      rationale: string;
      due?: string;
      stage?: NoiseScenario['stage'];
      result: ClinicalImpression;
    };
  }>(
    `fhir/R4/Bot/${NOISE_PREVIEW_BOT_ID}/$execute`,
    {
      mode: 'preview',
      patient: patientReference,
      exposure: exposureReference,
      asOf,
      ...(enrollmentReference ? { enrollment: enrollmentReference } : {}),
      ...(completionReference ? { completion: completionReference } : {}),
    },
    'application/json'
  );
  scope(client);
  const evaluation = result?.evaluation;
  const impression = evaluation?.result;
  const rule = impression?.extension?.find(
    (item) => item.url === 'https://hiivehealth.com/fhir/StructureDefinition/oem-rule'
  )?.valueCanonical;
  const sources = impression?.supportingInfo?.map((source) => source.reference ?? '') ?? [];
  if (
    result?.mode !== 'preview' ||
    result.persisted !== false ||
    !evaluation ||
    !['due', 'overdue', 'current', 'needs-review'].includes(evaluation.status) ||
    typeof evaluation.rationale !== 'string' ||
    !evaluation.rationale.trim() ||
    impression?.resourceType !== 'ClinicalImpression' ||
    impression.subject?.reference !== patientReference ||
    impression.date !== asOf ||
    rule !== NOISE_RULE_CANONICAL ||
    !sources.includes(exposureReference) ||
    (evaluation.stage !== undefined && !['baseline', 'periodic'].includes(evaluation.stage)) ||
    (evaluation.due !== undefined &&
      (typeof evaluation.due !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(evaluation.due) ||
        !Number.isFinite(Date.parse(evaluation.due)) ||
        new Date(evaluation.due).toISOString().slice(0, 10) !== evaluation.due)) ||
    (!enrollment && evaluation.status !== 'needs-review') ||
    (enrollmentReference && !sources.includes(enrollmentReference)) ||
    (completionReference && !sources.includes(completionReference)) ||
    (completion && evaluation.status !== 'needs-review' && evaluation.stage !== 'periodic') ||
    !sources.every((source) =>
      /^(Observation|DocumentReference)\/[A-Za-z0-9.-]+(?:\/_history\/[A-Za-z0-9.-]+)?$/.test(source)
    ) ||
    !sources.some((source) => source.startsWith('DocumentReference/'))
  )
    throw new Error('The read-only advisory response could not be verified.');
  return {
    status: evaluation.status,
    rationale: evaluation.rationale,
    due: evaluation.due,
    stage: evaluation.stage,
    rule,
    sources,
  };
}

export function assertWorker(patient: Patient): void {
  if (
    !patient.id ||
    patient.meta?.project !== OEM_PROJECT_ID ||
    !patient.meta.tag?.some(
      (tag) => tag.system === 'https://hiivehealth.com/fhir/CodeSystem/demo-data' && tag.code === 'synthetic-only'
    )
  ) {
    throw new Error('A worker in the synthetic OEM Project is required.');
  }
}

export async function loadIntake(client: MedplumClient): Promise<{ questionnaire: Questionnaire; workers: Patient[] }> {
  scope(client);
  const bot = await client.readResource('Bot', INTAKE_BOT_ID, { cache: 'no-cache' });
  if (bot.id !== INTAKE_BOT_ID || bot.meta?.project !== OEM_PROJECT_ID)
    throw new Error('Intake access is unavailable.');
  const [questionnaire, workers] = await Promise.all([
    client.readVersion('Questionnaire', INTAKE_QUESTIONNAIRE_ID, INTAKE_QUESTIONNAIRE_VERSION, { cache: 'no-cache' }),
    client.searchResources(
      'Patient',
      { _tag: 'https://hiivehealth.com/fhir/CodeSystem/demo-data|synthetic-only', _count: '50' },
      { cache: 'no-cache' }
    ),
  ]);
  if (
    questionnaire.meta?.project !== OEM_PROJECT_ID ||
    questionnaire.id !== INTAKE_QUESTIONNAIRE_ID ||
    questionnaire.meta.versionId !== INTAKE_QUESTIONNAIRE_VERSION ||
    `${questionnaire.url}|${questionnaire.version}` !== INTAKE_CANONICAL ||
    questionnaire.status !== 'draft' ||
    !questionnaire.experimental ||
    !questionnaire.item?.length
  )
    throw new Error('The pinned synthetic intake definition is unavailable.');
  workers.forEach(assertWorker);
  return { questionnaire, workers };
}

export async function loadIntakeEvidence(client: MedplumClient, patient: Patient): Promise<DocumentReference[]> {
  scope(client);
  assertWorker(patient);
  const documents = await client.searchResources(
    'DocumentReference',
    { subject: `Patient/${patient.id}`, status: 'current', _count: '50' },
    { cache: 'no-cache' }
  );
  if (
    documents.some(
      (document) =>
        !document.id ||
        !document.meta?.versionId ||
        document.meta.project !== OEM_PROJECT_ID ||
        document.subject?.reference !== `Patient/${patient.id}` ||
        document.status !== 'current' ||
        document.docStatus === 'entered-in-error'
    )
  ) {
    throw new Error('Worker-linked evidence could not be verified.');
  }
  return documents;
}

export async function loadIntakeExposures(client: MedplumClient, patient: Patient): Promise<Observation[]> {
  scope(client);
  assertWorker(patient);
  const observations = await client.searchResources(
    'Observation',
    {
      subject: `Patient/${patient.id}`,
      code: 'https://hiivehealth.com/fhir/CodeSystem/oem-stressor|503',
      _count: '50',
      _sort: '-_lastUpdated',
    },
    { cache: 'no-cache' }
  );
  if (
    observations.some(
      (observation) =>
        observation.meta?.project !== OEM_PROJECT_ID || observation.subject?.reference !== `Patient/${patient.id}`
    )
  ) {
    throw new Error('Exposure records belong to another worker or Project.');
  }
  return observations.filter(
    (observation) =>
      observation.id &&
      observation.meta?.versionId &&
      observation.status === 'final' &&
      observation.code.coding?.some(
        (coding) => coding.system === 'https://hiivehealth.com/fhir/CodeSystem/oem-stressor' && coding.code === '503'
      ) &&
      observation.category?.some((category) =>
        category.coding?.some(
          (coding) =>
            coding.system === 'https://hiivehealth.com/fhir/CodeSystem/observation-category' &&
            coding.code === 'exposure'
        )
      )
  );
}

export async function loadIntakeAssessments(
  client: MedplumClient,
  patient: Patient
): Promise<{
  measurements: Observation[];
  enrollments: Observation[];
  unverified: { kind: 'measurement' | 'enrollment'; reference: string; reason: string }[];
  limited: { measurement: boolean; enrollment: boolean };
}> {
  scope(client);
  assertWorker(patient);
  const namespace = 'https://hiivehealth.com/fhir';
  const subject = `Patient/${patient.id}`;
  const [measurements, enrollments] = await Promise.all([
    client.searchResources(
      'Observation',
      {
        subject,
        code: `${namespace}/CodeSystem/oem-noise-metric|eight-hour-twa,${namespace}/CodeSystem/oem-noise-metric|peak`,
        _count: '50',
        _sort: '-_lastUpdated',
      },
      { cache: 'no-cache' }
    ),
    client.searchResources(
      'Observation',
      {
        subject,
        code: `${namespace}/CodeSystem/oem-enrollment|503`,
        _count: '50',
        _sort: '-_lastUpdated',
      },
      { cache: 'no-cache' }
    ),
  ]);
  const verifyLink = workerSourceVerifier(client, patient);
  const verified = { measurement: [] as Observation[], enrollment: [] as Observation[] };
  const unverified: { kind: 'measurement' | 'enrollment'; reference: string; reason: string }[] = [];
  for (const [kind, records] of [
    ['measurement', measurements],
    ['enrollment', enrollments],
  ] as const) {
    for (const record of records) {
      const coding = record.code.coding?.find(
        (item) =>
          item.system === `${namespace}/CodeSystem/${kind === 'measurement' ? 'oem-noise-metric' : 'oem-enrollment'}`
      );
      if (
        !record.id ||
        !record.meta?.versionId ||
        record.meta.project !== OEM_PROJECT_ID ||
        record.subject?.reference !== subject ||
        record.status !== 'final' ||
        !coding?.code ||
        !(kind === 'measurement' ? ['eight-hour-twa', 'peak'] : ['503']).includes(coding.code) ||
        record.focus?.length !== 1 ||
        !record.derivedFrom?.length
      )
        throw new Error('Assessment record could not be verified.');
      try {
        if (kind === 'measurement') measurementResult(record);
        else if (!['enrolled', 'not-enrolled', 'needs-review'].includes(record.valueCodeableConcept?.text ?? ''))
          throw new Error('Enrollment determination could not be verified.');
        await Promise.all([
          verifyLink(record.focus[0].reference, 'Observation'),
          ...record.derivedFrom.map((evidence) => verifyLink(evidence.reference, 'DocumentReference')),
        ]);
        verified[kind].push(record);
      } catch (failure) {
        unverified.push({
          kind,
          reference: `Observation/${record.id}/_history/${record.meta.versionId}`,
          reason:
            failure instanceof SourceReviewError
              ? failure.message
              : 'The recorded measurement or enrollment value is unsupported or inconsistent.',
        });
      }
    }
  }
  return {
    measurements: verified.measurement,
    enrollments: verified.enrollment,
    unverified,
    limited: { measurement: measurements.length >= 50, enrollment: enrollments.length >= 50 },
  };
}

class SourceReviewError extends Error {}

function workerSourceVerifier(client: MedplumClient, patient: Patient) {
  const namespace = 'https://hiivehealth.com/fhir';
  const subject = `Patient/${patient.id}`;
  const linked = new Map<string, Promise<Observation | DocumentReference>>();
  const verifyLink = async (
    reference: string | undefined,
    type: 'Observation' | 'DocumentReference'
  ): Promise<void> => {
    const match = /^(Observation|DocumentReference)\/([A-Za-z0-9.-]+)(?:\/_history\/([A-Za-z0-9.-]+))?$/.exec(
      reference ?? ''
    );
    if (!match || match[1] !== type)
      throw new SourceReviewError('A linked exposure or evidence reference is missing or malformed.');
    let resource = linked.get(reference!);
    if (!resource) {
      try {
        resource = match[3]
          ? client.readVersion(type, match[2], match[3], { cache: 'no-cache' })
          : client.readResource(type, match[2], { cache: 'no-cache' });
      } catch {
        throw new SourceReviewError(
          'A linked source could not be read. It may be unavailable or access may be denied.'
        );
      }
      linked.set(reference!, resource);
    }
    const record = await resource.catch(() => {
      throw new SourceReviewError('A linked source could not be read. It may be unavailable or access may be denied.');
    });
    if (
      record.resourceType !== type ||
      record.id !== match[2] ||
      record.meta?.project !== OEM_PROJECT_ID ||
      record.subject?.reference !== subject
    ) {
      throw new SourceReviewError('A linked source does not match the required resource, worker or Project.');
    }
    if (!record.meta.versionId || (match[3] && record.meta.versionId !== match[3])) {
      throw new SourceReviewError('A linked source does not match the required recorded version.');
    }
    if (
      record.resourceType === 'DocumentReference'
        ? record.status !== 'current' || record.docStatus === 'entered-in-error'
        : record.status !== 'final' ||
          !record.code.coding?.some(
            (coding) => coding.system === `${namespace}/CodeSystem/oem-stressor` && coding.code === '503'
          )
    ) {
      throw new SourceReviewError('A linked source has an unsupported status or exposure type.');
    }
  };
  return verifyLink;
}

export async function loadNoiseCompletions(
  client: MedplumClient,
  patient: Patient
): Promise<{
  records: Observation[];
  unverified: string[];
  limited: boolean;
}> {
  scope(client);
  assertWorker(patient);
  const records = await client.searchResources(
    'Observation',
    {
      subject: `Patient/${patient.id}`,
      code: 'https://hiivehealth.com/fhir/CodeSystem/oem-surveillance-action|audiogram',
      _count: '50',
      _sort: '-_lastUpdated',
    },
    { cache: 'no-cache' }
  );
  const verifyLink = workerSourceVerifier(client, patient);
  const verified: Observation[] = [];
  const unverified: string[] = [];
  for (const record of records) {
    if (
      !record.id ||
      !record.meta?.versionId ||
      record.meta.project !== OEM_PROJECT_ID ||
      record.subject?.reference !== `Patient/${patient.id}` ||
      record.status !== 'final' ||
      !record.code.coding?.some(
        (coding) =>
          coding.system === 'https://hiivehealth.com/fhir/CodeSystem/oem-surveillance-action' &&
          coding.code === 'audiogram'
      )
    )
      throw new Error('Completion record could not be verified.');
    try {
      if (
        record.focus?.length !== 1 ||
        !/^Observation\/[A-Za-z0-9.-]+$/.test(record.focus[0].reference ?? '') ||
        record.derivedFrom?.length !== 1 ||
        !record.extension?.some(
          (item) =>
            item.url === 'https://hiivehealth.com/fhir/StructureDefinition/oem-rule' &&
            item.valueCanonical === NOISE_RULE_CANONICAL
        ) ||
        !record.extension?.some(
          (item) =>
            item.url === 'https://hiivehealth.com/fhir/StructureDefinition/oem-completion-kind' &&
            ['synthetic-result', 'manual-attestation'].includes(item.valueCode ?? '')
        ) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(record.effectiveDateTime ?? '') ||
        !Number.isFinite(Date.parse(record.effectiveDateTime!)) ||
        new Date(record.effectiveDateTime!).toISOString().slice(0, 10) !== record.effectiveDateTime
      )
        throw new Error('Completion facts could not be verified.');
      await Promise.all([
        verifyLink(record.focus[0].reference, 'Observation'),
        verifyLink(record.derivedFrom[0].reference, 'DocumentReference'),
      ]);
      verified.push(record);
    } catch {
      unverified.push(`Observation/${record.id}/_history/${record.meta.versionId}`);
    }
  }
  return { records: verified, unverified, limited: records.length >= 50 };
}

export function measurementResult(record: Observation): string {
  const quantity = record.valueQuantity;
  const unknown = record.dataAbsentReason?.coding?.some(
    (coding) =>
      coding.system === 'http://terminology.hl7.org/CodeSystem/data-absent-reason' && coding.code === 'unknown'
  );
  if (unknown && !quantity) return 'Unknown';
  const metric = record.code.coding?.find(
    (coding) => coding.system === 'https://hiivehealth.com/fhir/CodeSystem/oem-noise-metric'
  )?.code;
  if (
    record.dataAbsentReason ||
    !quantity ||
    typeof quantity.value !== 'number' ||
    !Number.isFinite(quantity.value) ||
    quantity.value < 0 ||
    !(metric === 'eight-hour-twa' ? ['dBA'] : metric === 'peak' ? ['dBA', 'dBC', 'dB'] : []).includes(
      quantity.unit ?? ''
    )
  )
    throw new Error('Measurement value or unit could not be verified.');
  return `${quantity.value} ${quantity.unit}`;
}

const MEASUREMENT_DETAILS = ['metric', 'unit', 'basis', 'method', 'assessed', 'measurement-evidence'];
const KNOWN_ASSESSMENT_DETAILS = 'record-known-assessment-details';

export function measurementFormDefinition(questionnaire: Questionnaire, availability?: string): Questionnaire {
  const result = deepClone(questionnaire);
  const measurement = result.item?.find((item) => item.linkId === 'measurement');
  if (!measurement?.item?.some((item) => item.linkId === 'availability')) return result;
  measurement.item = measurement.item.filter((item) => item.linkId !== KNOWN_ASSESSMENT_DETAILS).flatMap((item) => {
    if (item.linkId === 'availability') return [item, {
      linkId: KNOWN_ASSESSMENT_DETAILS, text: 'Record known assessment details', type: 'boolean' as const,
      enableWhen: [{ question: 'availability', operator: '=' as const,
        answerCoding: { system: 'https://hiivehealth.com/fhir/CodeSystem/synthetic-oem-intake', code: 'unknown' } }],
    }];
    if (!MEASUREMENT_DETAILS.includes(item.linkId)) return [item];
    return [{ ...item, required: availability === 'measured', enableBehavior: 'any' as const, enableWhen: [
      { question: 'availability', operator: '=' as const,
        answerCoding: { system: 'https://hiivehealth.com/fhir/CodeSystem/synthetic-oem-intake', code: 'measured' } },
      ...(availability === 'unknown'
        ? [{ question: KNOWN_ASSESSMENT_DETAILS, operator: '=' as const, answerBoolean: true }]
        : []),
    ] }];
  });
  return result;
}

export function prepareIntake(
  questionnaire: Questionnaire,
  response: QuestionnaireResponse,
  patient: Patient,
  evidence: DocumentReference[],
  amendment?: { exposure: string; reason: AmendmentReason }
): IntakeRequest {
  assertWorker(patient);
  if (
    `${questionnaire.url}|${questionnaire.version}` !== INTAKE_CANONICAL ||
    (response.subject?.reference && response.subject.reference !== `Patient/${patient.id}`)
  )
    throw new Error('The intake belongs to another worker or definition.');
  const raw = new Map<string, QuestionnaireResponseItem>();
  const collect = (items: QuestionnaireResponseItem[]): void => {
    for (const item of items) {
      if (raw.has(item.linkId)) throw new Error('Repeated intake answer.');
      raw.set(item.linkId, item);
      collect(item.item ?? []);
    }
  };
  collect(response.item ?? []);
  const known = new Set<string>();
  const normalize = (definitions: QuestionnaireItem[]): QuestionnaireResponseItem[] =>
    definitions.flatMap<QuestionnaireResponseItem>((definition) => {
      known.add(definition.linkId);
      if (definition.type === 'group') return [{ linkId: definition.linkId, item: normalize(definition.item ?? []) }];
      const conditions = definition.enableWhen?.map((condition) => {
        const answer = raw.get(condition.question)?.answer?.[0];
        const selected = answer?.valueCoding?.code ?? answer?.valueBoolean;
        const expected = condition.answerCoding?.code ?? condition.answerBoolean;
        return condition.operator === '=' ? selected === expected : selected !== undefined && selected !== expected;
      });
      const enabled = !conditions?.length || (definition.enableBehavior === 'any' ? conditions.some(Boolean) : conditions.every(Boolean));
      if (definition.linkId === KNOWN_ASSESSMENT_DETAILS) {
        const answers = raw.get(definition.linkId)?.answer;
        if (answers?.length && (answers.length !== 1 || typeof answers[0].valueBoolean !== 'boolean' || Object.keys(answers[0]).length !== 1))
          throw new Error('Select a supported assessment-details option.');
        return [];
      }
      if (!enabled) return [];
      const answers = raw.get(definition.linkId)?.answer;
      if (!answers?.length) {
        const measured = raw.get('availability')?.answer?.[0]?.valueCoding?.code === 'measured';
        if (definition.required || (measured && MEASUREMENT_DETAILS.includes(definition.linkId)))
          throw new Error(`Complete ${definition.text ?? definition.linkId}.`);
        return [];
      }
      if (answers.length !== 1) throw new Error('Exactly one answer is required.');
      const answer = answers[0];
      if (definition.type === 'reference') {
        const reference = answer.valueReference?.reference;
        const document = evidence.find(
          (candidate) =>
            candidate.meta?.project === OEM_PROJECT_ID &&
            candidate.subject?.reference === `Patient/${patient.id}` &&
            candidate.status === 'current' &&
            candidate.docStatus !== 'entered-in-error' &&
            candidate.id &&
            candidate.meta.versionId &&
            (reference === `DocumentReference/${candidate.id}` ||
              reference === `DocumentReference/${candidate.id}/_history/${candidate.meta.versionId}`)
        );
        if (!document) throw new Error('Select verified evidence for this worker.');
        return [
          {
            linkId: definition.linkId,
            answer: [
              {
                valueReference: { reference: `DocumentReference/${document.id}/_history/${document.meta!.versionId}` },
              },
            ],
          },
        ];
      }
      if (definition.type === 'choice') {
        const coding = answer.valueCoding;
        if (
          !coding ||
          !definition.answerOption?.some(
            (option) => option.valueCoding?.system === coding.system && option.valueCoding?.code === coding.code
          )
        )
          throw new Error('Select a supported intake choice.');
        return [{ linkId: definition.linkId, answer: [{ valueCoding: { system: coding.system, code: coding.code } }] }];
      }
      if (definition.type === 'date') {
        const date = answer.valueDate;
        if (
          !date ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date
        )
          throw new Error('A valid date is required.');
        return [{ linkId: definition.linkId, answer: [{ valueDate: date }] }];
      }
      if (
        definition.type === 'decimal' &&
        typeof answer.valueDecimal === 'number' &&
        Number.isFinite(answer.valueDecimal) &&
        answer.valueDecimal >= 0
      ) {
        return [{ linkId: definition.linkId, answer: [{ valueDecimal: answer.valueDecimal }] }];
      }
      throw new Error('An intake answer has the wrong type.');
    });
  const item = normalize(measurementFormDefinition(questionnaire, raw.get('availability')?.answer?.[0]?.valueCoding?.code).item ?? []);
  const originalDetails = questionnaire.item?.find((definition) => definition.linkId === 'measurement')?.item;
  const measurement = item.find((definition) => definition.linkId === 'measurement')?.item;
  if (raw.get('availability')?.answer?.[0]?.valueCoding?.code === 'unknown' &&
      originalDetails?.some((definition) => definition.linkId === 'metric' && definition.required) &&
      MEASUREMENT_DETAILS.some((linkId) => !measurement?.some((answer) => answer.linkId === linkId))) {
    throw new Error('Simplified unknown assessments require the updated intake service. No submission was sent.');
  }
  if ([...raw.keys()].some((key) => !known.has(key))) throw new Error('Unknown intake answer.');
  if (
    amendment &&
    (!/^Observation\/[A-Za-z0-9.-]+\/_history\/[A-Za-z0-9.-]+$/.test(amendment.exposure) ||
      !['correct-dates', 'correct-worksite', 'end-exposure'].includes(amendment.reason))
  )
    throw new Error('An exact exposure version and structured amendment reason are required.');
  return {
    mode: 'save',
    patient: `Patient/${patient.id}`,
    submissionId: crypto.randomUUID(),
    at: new Date().toISOString(),
    response: {
      resourceType: 'QuestionnaireResponse',
      questionnaire: INTAKE_CANONICAL,
      status: 'completed',
      subject: { reference: `Patient/${patient.id}` },
      item,
    },
    ...(amendment ? { exposure: amendment.exposure, amendmentReason: amendment.reason } : {}),
  };
}

export async function previewIntake(client: MedplumClient, request: IntakeRequest): Promise<string> {
  scope(client);
  const result: { mode?: string; persisted?: boolean; state?: string } = await client.post(
    `fhir/R4/Bot/${INTAKE_PREVIEW_BOT_ID}/$execute`,
    { ...request, mode: 'preview' },
    'application/json'
  );
  if (
    result.mode !== 'preview' ||
    result.persisted !== false ||
    !['active', 'inactive', 'future'].includes(result.state ?? '')
  )
    throw new Error('Intake preview was not confirmed.');
  return result.state!;
}

export async function saveIntake(client: MedplumClient, request: IntakeRequest): Promise<IntakeResult> {
  scope(client);
  const result = await client.post<IntakeResult>(`fhir/R4/Bot/${INTAKE_BOT_ID}/$execute`, request, 'application/json', {
    maxRetries: 0,
  });
  if (
    result.status !== 'completed' ||
    typeof result.replayed !== 'boolean' ||
    !/^Task\/[A-Za-z0-9.-]+\/_history\/[A-Za-z0-9.-]+$/.test(result.receipt) ||
    !Array.isArray(result.resources) ||
    !['submission', 'exposure', 'lineage'].every((step) =>
      result.resources.some((resource) => resource.step === step)
    ) ||
    result.resources.some(
      (resource) =>
        !/^(QuestionnaireResponse|Observation|Provenance)\/[A-Za-z0-9.-]+\/_history\/[A-Za-z0-9.-]+$/.test(
          resource.reference
        )
    )
  ) {
    throw new Error('Save completion is uncertain. Inspect the submission receipt before another save.');
  }
  return result;
}
