import type { MedplumClient } from '@medplum/core';
import type { Resource } from '@medplum/fhirtypes';
import { parse } from 'csv-parse/browser/esm/sync';
import { scope } from './completion-preview';
import { OEM_PROJECT_ID } from './ih-review';
import { LIFECYCLE_WORKER_ID } from './intake';
import { browserRuleFingerprint, ruleTaskReference } from './rule-review';

export const NATIVE_REPORT_BOT_ID = 'debacf60-927e-4d92-9603-5bd2b45b0e5c';
export const COHORT_REPORT_BOT_ID = 'c6b0f60a-0e14-4cfe-8488-c62ff905a537';
export const COMPLETION_REPORT_BOT_ID = '7ce499ba-7b76-4ba2-92c1-6b115c507a87';
export const REPORT_CLINICIAN = 'Practitioner/eda5634a-f480-4a66-8317-d65b777ae53c';
export const REPORT_SOURCES = [
  `Patient/${LIFECYCLE_WORKER_ID}/_history/4c52b9cd-2038-40ca-aea8-b639f19053e9`,
  'Observation/baa7efea-26cc-44ee-9d9b-b4351aff9112/_history/305afa94-491a-4838-a4d7-e4abf3bc367f',
  'Observation/ae7f38cb-d0c7-4262-a46f-999d6dae1706/_history/7e73b940-06d1-45a5-a8c0-a78f3e68ff3a',
  'DocumentReference/ee9554d3-4d03-483b-89cd-cda0fe3f5bcf/_history/e0b75d32-1426-4966-8805-7f601345ee94',
];
export const REPORT_COLUMNS = ['demo_mode', 'coverage', 'authorization_verified', 'project', 'as_of', 'worker', 'row_kind',
  'obligation_id', 'exposure_history', 'rule_version', 'source_history', 'supporting_references_json', 'classification', 'synthetic_timing',
  'stage', 'due', 'review_required', 'complete_population', 'compliance_assessed', 'clinical_completion_verified', 'historical_reconstruction'];
export const COHORT_WORKERS = [
  { worker: REPORT_SOURCES[0], exposure: REPORT_SOURCES[1], enrollment: REPORT_SOURCES[2] },
  { worker: 'Patient/4be02d71-5c91-4ce5-85a0-710f90f7de9d/_history/050c50be-b976-47e9-8030-11465d3da565',
    exposure: 'Observation/5a23413a-be15-459f-839f-a38a014d98c9/_history/a3ce676e-bdc3-4171-a65e-98f2737a69a9',
    enrollment: 'Observation/88bd99dd-5023-43a0-8b83-90b6d660a0df/_history/c53252fd-fae5-4999-b577-8257ffad7b1e' },
  { worker: 'Patient/f4b01c08-a08a-4730-8429-b22576cbcf4f/_history/8c54d6a5-f102-4dc5-8095-62b7ef3994bb',
    exposure: 'Observation/258fd4ad-84df-4f10-95be-bbc06ebfb04b/_history/a3116e9d-8f65-4568-8aed-ce0f1e1aee49' },
];
export const COHORT_SOURCES = [REPORT_SOURCES[3], ...COHORT_WORKERS.flatMap(worker => [worker.worker, worker.exposure, ...(worker.enrollment ? [worker.enrollment] : [])])];
export const COMPLETION_EXAMPLES = [
  { patient: COHORT_WORKERS[0].worker.split('/').slice(0, 2).join('/'),
    record: 'Observation/b115ef08-5d4e-497e-9dac-48f4f2e8d99d/_history/f6be80ad-9de3-4205-b7d5-53cff3344adb',
    evidence: 'DocumentReference/054e1aa6-6eaa-4776-88ce-92f553a299d8/_history/b2c33455-1e8a-4f19-b895-2caf5aa17de0', kind: 'manual-attestation' },
  { patient: COHORT_WORKERS[1].worker.split('/').slice(0, 2).join('/'),
    record: 'Observation/410f48de-b968-4469-abb5-7d83c5251ace/_history/1da87ad7-d414-4a09-b369-037aa065623e',
    evidence: 'DocumentReference/f64a4e7e-0c1f-455d-82b8-2ac56f62cfa6/_history/53af21ee-2749-4313-ba91-a584c2020d78', kind: 'synthetic-result' },
].map(example => ({ ...example, performedOn: '2026-06-15', illustrativeNextPeriodicOn: '2027-06-15', clinicalCompletionVerified: false }));
export const COMPLETION_SOURCES = [...COHORT_SOURCES, ...COMPLETION_EXAMPLES.flatMap(example => [example.record, example.evidence])];
const WORKER = `Patient/${LIFECYCLE_WORKER_ID}`;
const RULE = 'https://hiivehealth.com/fhir/PlanDefinition/synthetic-noise-503|demo-1';
const COVERAGE = 'supplied-workers-and-obligations-only';
const FALSE_FIELDS = ['authorizationVerified', 'sourceBodiesVerified', 'completePopulation', 'complianceAssessed',
  'clinicalCompletionVerified', 'historicalReconstruction', 'persisted', 'externalDispatch'];

export const NATIVE_HISTORY_BOT_ID = '071345cf-dbcb-44f5-b152-cb403326f397';
export const HISTORY_SOURCES = [REPORT_SOURCES[0], REPORT_SOURCES[1],
  'Task/790e5844-e7f4-446e-ae9a-f6ead2b1a37b/_history/f52a02c7-9f50-4c7d-8185-67a1251bca98',
  'ServiceRequest/7a148912-2637-4044-b55e-690088ff2d03/_history/29a8212b-e1a9-4621-9dac-95e022c8f7df'];
export const HISTORY_REQUESTED = 'Task/790e5844-e7f4-446e-ae9a-f6ead2b1a37b/_history/42fdbec8-c94b-49f4-b1da-8a6ff345c8b9';
export const HISTORY_CHECKPOINTS = ['2026-10-21T01:39:00.858Z', '2026-10-23T18:50:42.985Z'];
export const EVIDENCE_HISTORY_BOT_ID = 'e4623052-26bd-49d1-83de-5e00afa70cff';
export const EVIDENCE_HISTORY_SOURCES = [...HISTORY_SOURCES, REPORT_SOURCES[2], REPORT_SOURCES[3], COMPLETION_EXAMPLES[0].record, COMPLETION_EXAMPLES[0].evidence];
export const EVIDENCE_HISTORY_CHECKPOINTS = [HISTORY_CHECKPOINTS[0], '2026-10-23T20:06:36.878Z'];
export const LINEAGE_HISTORY_BOT_ID = 'd62fce54-6582-4cd3-8feb-d6889f717d70';
export const LINEAGE_HISTORY_SOURCES = [...EVIDENCE_HISTORY_SOURCES,
  'Task/0e61be2d-a868-4ce9-ba76-ae1d5a3bd659/_history/a00fd963-0f3a-4443-b51a-09dae9fbbe99',
  'AuditEvent/cdc5b6c3-ae8f-499a-86d0-a02898983d2c/_history/df6559df-05d6-495f-b2eb-955546f8acd2',
  'Provenance/eccfbeea-a955-4652-8cc2-1ffb1ec3efe4/_history/16b1ecb3-2f7d-4603-8b8a-ba163b5a6523',
  'Task/577011b1-059d-47b4-83d2-832e016fd358/_history/fc5c7ce5-7691-4c32-af2f-1809512822c3',
  'AuditEvent/2ee2a9d9-62cd-443c-8090-bbd6853f0fac/_history/00fd39bf-951e-4523-8b40-4309be9c31af',
  'Provenance/48424259-02cc-4122-9c39-85b9e2e814dd/_history/40ad8392-e4bd-488d-9908-42a524e02022'];
export const LINEAGE_HISTORY_PENDING = ['Task/0e61be2d-a868-4ce9-ba76-ae1d5a3bd659/_history/7c9eb23d-811f-4a07-8faf-47c6ecba04be',
  'Task/577011b1-059d-47b4-83d2-832e016fd358/_history/3413ebee-2d64-44a3-8d52-bd2fe93cbeb1'];
export const LINEAGE_HISTORY_CHECKPOINTS = [HISTORY_CHECKPOINTS[0], '2026-10-23T20:06:37.676Z'];
export const RECORDED_TIME_BOT_ID = 'bdbdcf1c-8c70-453d-ad9e-c18721cd33ba';
export const RULE_HISTORY_BOT_ID = 'b22601ef-7972-4d1e-a1a5-1d7f591584b7';
export const RULE_HISTORY_SOURCES = [...LINEAGE_HISTORY_SOURCES,
  'PlanDefinition/1d9eb8a6-7b7b-4818-a819-601ad3e43768/_history/bd1e5de5-3793-4ff7-81e8-15b64ffad1e1',
  'Task/255a238a-9ee4-48d9-88ed-634f2aeff5cf/_history/678d4577-f174-4d69-a5ba-97009b3c2070'];
export const RULE_HISTORY_FINGERPRINT = '9da0044659c0009c655d5e7e425bd6c0bd553731bff0cff0205360f42fe8afc5';
export const RULE_HISTORY_REVIEWER = 'Practitioner/dde98fc6-97c3-4992-891e-77bf8d20d1f2';
export const RULE_HISTORY_DOCUMENT = 'DocumentReference/771185c7-f0a5-4688-9d07-7f3fcb101e60/_history/b2216804-566a-48e6-9187-c7725779ccfa';
export const MATRIX_HISTORY_BOT_ID = '416a2192-7e77-4c24-92be-425ec077432e';
export const MATRIX_HISTORY_SOURCES = [...RULE_HISTORY_SOURCES, RULE_HISTORY_DOCUMENT];
export const MATRIX_HISTORY_METADATA = [
  { reference: RULE_HISTORY_DOCUMENT, recordedAt: '2026-10-21T16:19:06.803Z', fingerprint: 'cea19b1d3d1f4d44d294c55930f16ec799e4175c140bfa4baa4b91ddc6935d21' },
  { reference: 'DocumentReference/771185c7-f0a5-4688-9d07-7f3fcb101e60/_history/fbe4ee3e-7c80-47ca-bbf1-cdfc16669002', recordedAt: '2026-10-21T16:19:06.120Z', fingerprint: '1fc14759b762df6ee97edb5e0513d76b1226ebfc35a94cca2b750a1f98a5c9d7' },
];
export const MATRIX_PDF_BOT_ID = 'ca2e981d-6b7a-4580-affc-02d9218e1703';
export const MATRIX_PDF_BINDING = {
  mode: 'synthetic-native-matrix-pdf-verification', coverage: 'exact-configured-current-matrix-pdf-bytes-only',
  document: RULE_HISTORY_DOCUMENT,
  binary: 'Binary/a6c0676a-5bdf-4453-b6ce-b74abfcedf92/_history/2376b371-052d-463e-93bd-0fecc8cc67a9',
  documentFingerprint: MATRIX_HISTORY_METADATA[0].fingerprint,
  pdfSha256: 'c60c0406b829ec59122de1966a81b562b9e6eac348550cca2496cf7246309b03',
  byteLength: 4022607, mediaType: 'application/pdf', sourceHeadChecks: 'unchanged-at-read-checks',
  matrixDocumentMetadataVerified: true, matrixAttachmentContentVerified: true, clinicalInterpretationVerified: false,
  ruleApprovalVerified: false, clinicalCompletionVerified: false, complianceAssessed: false, historicalReconstruction: false,
  clinicalWrites: 0, activated: false, externalDispatch: false,
} as const;

export interface VerifiedMatrixPdf {
  inspectedAt: string;
  document: string;
  binary: string;
  checksum: string;
  byteLength: number;
}

export async function inspectNativeMatrixPdf(client: MedplumClient, confirmed: boolean): Promise<VerifiedMatrixPdf> {
  const actor = actorScope(client);
  if (confirmed !== true) throw new Error('Explicit synthetic PDF verification confirmation is required.');
  const raw = await client.post<Record<string, unknown>>(`fhir/R4/Bot/${MATRIX_PDF_BOT_ID}/$execute`,
    { mode: 'verify-pdf', confirmedSynthetic: true }, 'application/json', { maxRetries: 0 });
  const inspectedAt = raw?.inspectedAt;
  if (actorScope(client) !== actor || !raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).sort().join('|') !== [...Object.keys(MATRIX_PDF_BINDING), 'inspectedAt'].sort().join('|') ||
      Object.entries(MATRIX_PDF_BINDING).some(([key, expected]) => raw[key] !== expected) ||
      typeof inspectedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(inspectedAt) ||
      !Number.isFinite(Date.parse(inspectedAt)) || new Date(inspectedAt).toISOString() !== inspectedAt ||
      inspectedAt < '2026-10-25T16:05:56.470Z' || Date.parse(inspectedAt) > Date.now()) {
    throw new Error('The configured Matrix PDF verification could not be verified.');
  }
  return { inspectedAt, document: MATRIX_PDF_BINDING.document, binary: MATRIX_PDF_BINDING.binary,
    checksum: MATRIX_PDF_BINDING.pdfSha256, byteLength: MATRIX_PDF_BINDING.byteLength };
}

export interface NativeHistoryResponse {
  mode: string; coverage: string; requester: string; inspectedAt: string; sources: string[]; headState: string;
  historicalReconstruction: boolean; completeSourceGraph: boolean; clinicalCompletionVerified: boolean; complianceAssessed: boolean;
  persisted: boolean; activated: boolean; externalDispatch: boolean; clinicalWrites: number;
  historyVersions: { reference: string; versions: string[] }[];
  snapshots: { mode: string; coverage: string; projectId: string; asOf: string; authorizationVerified: boolean; sourceBodiesVerified: boolean;
    completeHistory: boolean; historicalReconstruction: boolean; deletedResourcesReconstructed: boolean; clinicalCompletionVerified: boolean;
    complianceAssessed: boolean; persisted: boolean; externalDispatch: boolean; clinicalWrites: number;
    excludedFutureVersions: number; notYetRecorded: string[];
    selected: { reference: string; recordedAt: string; resource: Resource }[] }[];
  requestedAsOf?: string;
  selection?: NativeHistoryResponse['snapshots'][number];
  recordedVersions?: { reference: string; recordedAt: string }[];
  ruleApprovalVerified?: boolean;
  matrixDocumentMetadataVerified?: boolean;
  matrixAttachmentContentVerified?: boolean;
}
export interface VerifiedNativeHistory {
  inspectedAt: string;
  checkpoints: { asOf: string; records: { label: string; status: string; reference?: string; linkable?: boolean }[] }[];
  selected?: VerifiedNativeHistory['checkpoints'][number];
}

export async function inspectNativeHistory(client: MedplumClient, confirmed: boolean): Promise<VerifiedNativeHistory> {
  return inspectConfiguredHistory(client, confirmed, false);
}

export async function inspectNativeEvidenceHistory(client: MedplumClient, confirmed: boolean): Promise<VerifiedNativeHistory> {
  return inspectConfiguredHistory(client, confirmed, true);
}

export async function inspectNativeLineageHistory(client: MedplumClient, confirmed: boolean): Promise<VerifiedNativeHistory> {
  return inspectConfiguredHistory(client, confirmed, true, true);
}

export async function inspectNativeRecordedTime(client: MedplumClient, confirmed: boolean, asOf: string): Promise<VerifiedNativeHistory> {
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(asOf) ||
      !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString() !== asOf) throw new Error('A canonical recorded UTC instant is required.');
  return inspectConfiguredHistory(client, confirmed, true, true, asOf);
}

export async function inspectNativeRuleHistory(client: MedplumClient, confirmed: boolean, asOf: string): Promise<VerifiedNativeHistory> {
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(asOf) ||
      !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString() !== asOf) throw new Error('A canonical recorded UTC instant is required.');
  return inspectConfiguredHistory(client, confirmed, true, true, asOf, true);
}

export async function inspectNativeMatrixHistory(client: MedplumClient, confirmed: boolean, asOf: string): Promise<VerifiedNativeHistory> {
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(asOf) ||
      !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString() !== asOf) throw new Error('A canonical recorded UTC instant is required.');
  return inspectConfiguredHistory(client, confirmed, true, true, asOf, true, true);
}

async function inspectConfiguredHistory(client: MedplumClient, confirmed: boolean, evidence: boolean, lineage = false, asOf?: string, rules = false, matrix = false): Promise<VerifiedNativeHistory> {
  const actor = actorScope(client);
  if (confirmed !== true) throw new Error('Synthetic history confirmation is required.');
  const sources = matrix ? MATRIX_HISTORY_SOURCES : rules ? RULE_HISTORY_SOURCES : lineage ? LINEAGE_HISTORY_SOURCES : evidence ? EVIDENCE_HISTORY_SOURCES : HISTORY_SOURCES;
  const expectedCheckpoints = lineage ? LINEAGE_HISTORY_CHECKPOINTS : evidence ? EVIDENCE_HISTORY_CHECKPOINTS : HISTORY_CHECKPOINTS;
  const labels = ['Worker', 'Exposure', 'Recommendation', 'Local proposal', 'Enrollment', 'Rule source', 'Synthetic attestation', 'Synthetic report',
    'Decision receipt', 'Decision audit', 'Decision provenance', 'Synthetic save receipt', 'Synthetic save audit', 'Synthetic save provenance', 'Rule draft', 'Rule review', 'Matrix metadata'];
  const identity = (reference: string): string => reference.split('/').slice(0, 2).join('/');
  const label = (reference: string): string => labels[sources.findIndex(source => identity(source) === identity(reference))];
  const recordedTime = asOf !== undefined;
  const raw = await client.post<NativeHistoryResponse>(`fhir/R4/Bot/${matrix ? MATRIX_HISTORY_BOT_ID : rules ? RULE_HISTORY_BOT_ID : recordedTime ? RECORDED_TIME_BOT_ID : lineage ? LINEAGE_HISTORY_BOT_ID : evidence ? EVIDENCE_HISTORY_BOT_ID : NATIVE_HISTORY_BOT_ID}/$execute`,
    recordedTime ? { mode: 'as-of', confirmedSynthetic: true, asOf } : { mode: 'history', confirmedSynthetic: true }, 'application/json', { maxRetries: 0 });
  const fail = (): never => { throw new Error('The configured recorded history could not be verified.'); };
  const instant = (value: string): boolean => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
    if (actorScope(client) !== actor || raw?.mode !== (matrix ? 'synthetic-native-matrix-history-inspection' : rules ? 'synthetic-native-rule-history-inspection' : recordedTime ? 'synthetic-native-recorded-time-inspection' : lineage ? 'synthetic-native-lineage-history-inspection' : evidence ? 'synthetic-native-evidence-history-inspection' : 'synthetic-native-history-inspection') ||
      raw.coverage !== (matrix ? 'exact-configured-seventeen-resource-histories-only' : rules ? 'exact-configured-sixteen-resource-histories-only' : lineage ? 'exact-configured-fourteen-resource-histories-only' : evidence ? 'exact-configured-eight-resource-histories-only' : 'exact-configured-four-resource-histories-only') ||
      (rules && raw.ruleApprovalVerified !== false) ||
      (matrix && (raw.matrixDocumentMetadataVerified !== true || raw.matrixAttachmentContentVerified !== false)) ||
      raw.requester !== actor || raw.headState !== 'unchanged-at-read-checks' || !instant(raw.inspectedAt) || raw.inspectedAt < expectedCheckpoints[1] ||
      ['historicalReconstruction', 'completeSourceGraph', 'clinicalCompletionVerified', 'complianceAssessed', 'persisted', 'activated', 'externalDispatch'].some(key => raw[key as keyof NativeHistoryResponse] !== false) ||
      raw.clinicalWrites !== 0 || JSON.stringify(raw.sources) !== JSON.stringify(sources) || !Array.isArray(raw.snapshots) || raw.snapshots.length !== 2 ||
      JSON.stringify(raw.historyVersions) !== JSON.stringify(sources.map((reference, index) => ({ reference: reference.split('/').slice(0, 2).join('/'),
        versions: (matrix && index === 16 ? MATRIX_HISTORY_METADATA.map(record => record.reference) : index === 2 ? [HISTORY_REQUESTED, reference] : lineage && (index === 8 || index === 11) ? [LINEAGE_HISTORY_PENDING[index === 8 ? 0 : 1], reference] : [reference]).sort() })))) fail();
  if (matrix) {
    const expectedTimeline = MATRIX_HISTORY_METADATA.map(({ reference, recordedAt }) => ({ reference, recordedAt })).sort((first, second) => first.reference.localeCompare(second.reference));
    if (JSON.stringify(raw.recordedVersions?.filter(record => identity(record.reference) === identity(RULE_HISTORY_DOCUMENT))) !== JSON.stringify(expectedTimeline)) fail();
    for (const record of [...raw.snapshots.flatMap(snapshot => snapshot.selected), ...(raw.selection?.selected ?? [])].filter(record => identity(record.reference) === identity(RULE_HISTORY_DOCUMENT))) {
      const expected = MATRIX_HISTORY_METADATA.find(value => value.reference === record.reference);
      const resource = record.resource;
      if (!expected || record.recordedAt !== expected.recordedAt || resource?.resourceType !== 'DocumentReference' ||
          resource.subject !== undefined || resource.status !== 'current' || !resource.content?.length ||
          resource.content.some(content => content.attachment.contentType !== 'application/pdf' ||
            (content.attachment.url !== undefined && !/^urn:sha256:[a-f0-9]{64}$/.test(content.attachment.url)))) fail();
      const canonical = JSON.stringify(resource, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ?
        Object.fromEntries(Object.entries(value).sort(([first], [second]) => first.localeCompare(second))) : value);
      if (await sha256(canonical) !== expected!.fingerprint) fail();
    }
  }
  if (rules) {
    const rule = raw.snapshots[1].selected.find(record => record.reference === sources[14])?.resource;
    const review = raw.snapshots[1].selected.find(record => record.reference === sources[15])?.resource;
    const namespace = 'https://hiivehealth.com/fhir';
    if (!rule || rule.resourceType !== 'PlanDefinition' || !review || review.resourceType !== 'Task' ||
        rule.status !== 'draft' || rule.experimental !== true || rule.version !== 'matrix-13-draft-2' ||
        rule.relatedArtifact?.[0].resource !== RULE_HISTORY_DOCUMENT ||
        JSON.stringify(rule.extension?.filter(extension => extension.url === `${namespace}/StructureDefinition/oem-rule-blocker`)
          .map(extension => extension.extension?.find(child => child.url === 'code')?.valueCode).sort()) !==
          JSON.stringify(['baseline-timing', 'enrollment-authority', 'periodic-anchor', 'supplementary-policy', 'termination-policy']) ||
        await browserRuleFingerprint(rule) !== RULE_HISTORY_FINGERPRINT ||
        ruleTaskReference(review) !== sources[15] || review.status !== 'requested' || review.focus?.reference !== sources[14] ||
        review.requester?.reference !== RULE_HISTORY_REVIEWER || review.owner?.reference !== RULE_HISTORY_REVIEWER ||
        review.input?.[0].valueString !== RULE_HISTORY_FINGERPRINT || review.identifier?.length !== 1 ||
        review.identifier[0].system !== `${namespace}/CodeSystem/oem-rule-review` ||
        review.identifier[0].value !== await sha256(`${sources[14]}|${RULE_HISTORY_FINGERPRINT}`)) fail();
  }
  const checkpoints = raw.snapshots.map((snapshot, index) => {
    const expected = (index === 0 ? [sources[0], sources[1], HISTORY_REQUESTED, ...(evidence ? [sources[5]] : [])] : [...sources]).sort();
    const notRecorded = index === 0 ? [sources[3], ...(evidence ? [sources[4], sources[6], sources[7]] : []), ...(lineage ? sources.slice(8) : [])].map(identity).sort() : [];
    if (snapshot?.mode !== 'offline-supplied-history-selection' || snapshot.coverage !== 'supplied-resource-versions-only' || snapshot.projectId !== OEM_PROJECT_ID ||
        snapshot.asOf !== expectedCheckpoints[index] || snapshot.excludedFutureVersions !== (index === 0 ? matrix ? 17 : rules ? 15 : lineage ? 13 : evidence ? 5 : 2 : 0) ||
        JSON.stringify(snapshot.notYetRecorded) !== JSON.stringify(notRecorded) ||
        ['authorizationVerified', 'sourceBodiesVerified', 'completeHistory', 'historicalReconstruction', 'deletedResourcesReconstructed', 'clinicalCompletionVerified', 'complianceAssessed', 'persisted', 'externalDispatch'].some(key => snapshot[key as keyof typeof snapshot] !== false) ||
        snapshot.clinicalWrites !== 0 || JSON.stringify(snapshot.selected?.map(record => record.reference)) !== JSON.stringify(expected)) fail();
    const records = snapshot.selected.map(record => {
      const resource = record.resource; const [type, id, , version] = record.reference.split('/');
      const sourceIndex = sources.findIndex(source => identity(source) === identity(record.reference));
      const technical = lineage && sourceIndex >= 8 && sourceIndex < 14;
      const ruleRecord = rules && sourceIndex >= 14 && sourceIndex < 16;
      const matrixRecord = matrix && sourceIndex === 16;
      if (!resource || resource.resourceType !== type || resource.id !== id || resource.meta?.versionId !== version || resource.meta.project !== OEM_PROJECT_ID ||
          !instant(record.recordedAt) || record.recordedAt !== resource.meta.lastUpdated || record.recordedAt > snapshot.asOf ||
          (!technical && !ruleRecord && !matrixRecord && (resource.resourceType === 'Task' ? resource.for?.reference !== WORKER || resource.status !== (index === 0 ? 'requested' : 'accepted') :
            resource.resourceType === 'ServiceRequest' ? resource.subject?.reference !== WORKER || resource.status !== 'draft' || resource.intent !== 'proposal' :
            resource.resourceType === 'Observation' ? resource.subject?.reference !== WORKER || resource.status !== 'final' :
            evidence && resource.resourceType === 'DocumentReference' ? resource.status !== 'current' ||
              (record.reference === sources[5] ? resource.subject !== undefined && resource.subject.reference !== WORKER : resource.subject?.reference !== WORKER || resource.docStatus !== 'final') : resource.resourceType !== 'Patient'))) fail();
          if (technical) {
            const decision = sourceIndex < 11; const receipt = identity(sources[decision ? 8 : 11]);
            const same = (actual: unknown, expected: unknown): boolean => JSON.stringify(actual) === JSON.stringify(expected);
            if (resource.resourceType === 'Task') {
              const outputs = decision ? [['proposal', sources[3]], ['task', sources[2]], ['audit', sources[9]], ['lineage', sources[10]]] :
                [['attestation', sources[6]], ['audit', sources[12]], ['lineage', sources[13]]];
              if (resource.for?.reference !== WORKER || resource.requester?.reference !== actor || resource.status !== 'completed' ||
                  resource.focus?.reference !== (decision ? HISTORY_REQUESTED : sources[2]) ||
                  !same(resource.output?.map(output => [output.type.text, output.valueReference?.reference]), outputs)) fail();
            } else if (resource.resourceType === 'AuditEvent') {
              const entities = decision ? [WORKER, HISTORY_REQUESTED, sources[2], receipt, sources[3]] : [sources[2], sources[3], sources[7], receipt, sources[6]];
              if (resource.action !== (decision ? 'U' : 'C') || resource.outcome !== '0' || !instant(resource.recorded) || resource.recorded > record.recordedAt ||
                  resource.agent.length !== 1 || resource.agent[0].who?.reference !== actor || resource.agent[0].requestor !== true ||
                  !same(resource.entity?.map(entity => entity.what?.reference), entities)) fail();
            } else if (resource.resourceType === 'Provenance') {
              const expectedEntities = decision ? [HISTORY_REQUESTED, receipt] : [sources[2], sources[3], sources[7], receipt];
              if (!instant(resource.recorded) || resource.recorded > record.recordedAt || resource.agent.length !== 1 || resource.agent[0].who.reference !== actor ||
                  !same(resource.target.map(target => target.reference), decision ? [sources[2], sources[3]] : [sources[6]]) ||
                  !same(resource.entity?.map(entity => entity.what.reference).sort(), expectedEntities.sort())) fail();
            } else fail();
          }
          if (evidence && record.reference === sources[4] && (resource.resourceType !== 'Observation' || resource.focus?.length !== 1 || resource.focus[0].reference !== identity(sources[1]))) fail();
          if (evidence && record.reference === sources[6] && (resource.resourceType !== 'Observation' ||
            !resource.meta?.tag?.some(tag => tag.system === 'https://hiivehealth.com/fhir/CodeSystem/demo-data' && tag.code === 'synthetic-only') ||
            !resource.code.coding?.some(coding => coding.system === 'https://hiivehealth.com/fhir/CodeSystem/oem-simulated-completion' && coding.code === 'audiogram-attestation') ||
            resource.focus?.length !== 1 || resource.focus[0].reference !== sources[2] || resource.basedOn?.length !== 1 || resource.basedOn[0].reference !== sources[3] ||
            resource.derivedFrom?.length !== 1 || resource.derivedFrom[0].reference !== sources[7] || resource.performer?.length !== 1 || resource.performer[0].reference !== actor ||
            resource.effectiveDateTime !== COMPLETION_EXAMPLES[0].performedOn || !resource.issued || !instant(resource.issued) || resource.issued > raw.inspectedAt)) fail();
          if (evidence && record.reference === sources[7] && (resource.resourceType !== 'DocumentReference' ||
            !resource.meta?.tag?.some(tag => tag.system === 'https://hiivehealth.com/fhir/CodeSystem/demo-data' && tag.code === 'synthetic-only') ||
            !resource.type?.coding?.some(coding => coding.system === 'https://hiivehealth.com/fhir/CodeSystem/oem-surveillance-action' && coding.code === 'audiogram') ||
            !resource.context?.related?.some(reference => reference.reference === sources[3]) || resource.context?.period?.start !== COMPLETION_EXAMPLES[0].performedOn ||
            (resource.context?.period?.end !== undefined && resource.context.period.end !== COMPLETION_EXAMPLES[0].performedOn))) fail();
          return { label: label(record.reference),
        status: matrixRecord ? 'Linked metadata (PDF bytes unverified)' : ruleRecord ? sourceIndex === 14 ? 'Draft (unapproved rule)' : 'Requested (rule review)' : technical ? resource.resourceType === 'Task' ? 'Saved (technical receipt)' : 'Recorded (technical)' : resource.resourceType === 'Patient' ? 'Recorded' : 'status' in resource ? String(resource.status) : 'Recorded', reference: record.reference,
        ...(technical || ruleRecord || matrixRecord ? { linkable: false } : {}) };
    });
    return { asOf: snapshot.asOf, records: [...records, ...notRecorded.map(reference => ({ label: label(reference), status: 'Not recorded' }))] };
  });
  let selected: VerifiedNativeHistory['selected'];
  if (recordedTime) {
    const snapshot = raw.selection; const timeline = raw.recordedVersions;
    const expectedReferences = raw.historyVersions.flatMap(history => history.versions).sort();
    if (raw.requestedAsOf !== asOf || !snapshot || snapshot.asOf !== asOf || asOf > raw.inspectedAt || !Array.isArray(timeline) ||
        JSON.stringify(timeline.map(record => record.reference)) !== JSON.stringify(expectedReferences) ||
        timeline.some(record => !instant(record.recordedAt) || record.recordedAt > raw.inspectedAt)) fail();
    const available = sources.map(source => {
      const versions = timeline!.filter(record => identity(record.reference) === identity(source));
      if (new Set(versions.map(record => record.recordedAt)).size !== versions.length ||
          versions.some(record => record.recordedAt > versions.find(record => record.reference === source)!.recordedAt)) fail();
      return versions.filter(record => record.recordedAt <= asOf).sort((first, second) => first.recordedAt.localeCompare(second.recordedAt)).at(-1);
    }).filter((record): record is { reference: string; recordedAt: string } => Boolean(record)).sort((first, second) => first.reference.localeCompare(second.reference));
    const missing = sources.filter(source => !available.some(record => identity(record.reference) === identity(source))).map(identity).sort();
    if (snapshot!.mode !== 'offline-supplied-history-selection' || snapshot!.coverage !== 'supplied-resource-versions-only' || snapshot!.projectId !== OEM_PROJECT_ID ||
        snapshot!.clinicalWrites !== 0 || snapshot!.excludedFutureVersions !== timeline!.filter(record => record.recordedAt > asOf).length ||
        JSON.stringify(snapshot!.notYetRecorded) !== JSON.stringify(missing) ||
        ['authorizationVerified', 'sourceBodiesVerified', 'completeHistory', 'historicalReconstruction', 'deletedResourcesReconstructed', 'clinicalCompletionVerified', 'complianceAssessed', 'persisted', 'externalDispatch'].some(key => snapshot![key as keyof typeof snapshot] !== false) ||
        JSON.stringify(snapshot!.selected?.map(record => record.reference)) !== JSON.stringify(available.map(record => record.reference))) fail();
    const records = snapshot!.selected.map((record, index) => {
      const resource = record.resource; const [type, id, , version] = record.reference.split('/');
      const known = raw.snapshots.flatMap(value => value.selected).find(value => value.reference === record.reference);
      if (!resource || resource.resourceType !== type || resource.id !== id || resource.meta?.project !== OEM_PROJECT_ID || resource.meta.versionId !== version ||
          record.recordedAt !== available[index].recordedAt || resource.meta.lastUpdated !== record.recordedAt) fail();
      if (known) {
        if (known.recordedAt !== record.recordedAt || JSON.stringify(known.resource) !== JSON.stringify(resource)) fail();
      } else {
        const sourceIndex = sources.findIndex(source => identity(source) === identity(record.reference));
        const head = raw.snapshots[1].selected.find(value => value.reference === sources[sourceIndex])!.resource;
        const immutable = (value: Resource): string => {
          const { meta, ...content } = value; const { status, output, ...body } = content as import('@medplum/fhirtypes').Task;
          return JSON.stringify({ ...body, tags: meta?.tag }, (_key, child) => child && typeof child === 'object' && !Array.isArray(child) ?
            Object.fromEntries(Object.entries(child).sort(([first], [second]) => first.localeCompare(second))) : child);
        };
        if (!(matrix && sourceIndex === 16 && record.reference === MATRIX_HISTORY_METADATA[1].reference) &&
          (![8, 11].includes(sourceIndex) || resource.resourceType !== 'Task' || resource.status !== 'in-progress' || resource.output?.length || immutable(resource) !== immutable(head))) fail();
      }
      const sourceIndex = sources.findIndex(source => identity(source) === identity(record.reference));
      const technical = sourceIndex >= 8 && sourceIndex < 14; const ruleRecord = rules && sourceIndex >= 14 && sourceIndex < 16;
      const matrixRecord = matrix && sourceIndex === 16;
      return { label: label(record.reference), reference: record.reference,
        status: matrixRecord ? record.reference === RULE_HISTORY_DOCUMENT ? 'Linked metadata (PDF bytes unverified)' : 'Initial metadata (no attachment)' : ruleRecord ? sourceIndex === 14 ? 'Draft (unapproved rule)' : 'Requested (rule review)' : technical ? resource.resourceType === 'Task' ? resource.status === 'in-progress' ? 'Pending (technical receipt)' : 'Saved (technical receipt)' : 'Recorded (technical)' :
          resource.resourceType === 'Patient' ? 'Recorded' : 'status' in resource ? String(resource.status) : 'Recorded', ...(technical || ruleRecord || matrixRecord ? { linkable: false } : {}) };
    });
    selected = { asOf, records: [...records, ...missing.map(reference => ({ label: label(reference), status: 'Not recorded' }))] };
  }
  for (const reference of lineage ? sources.slice(0, 8) : sources) {
    const [type, id] = reference.split('/'); const head = await client.readResource(type as Resource['resourceType'], id, { cache: 'no-cache', maxRetries: 0 });
    if (`${head.resourceType}/${head.id}/_history/${head.meta?.versionId}` !== reference || head.meta?.project !== OEM_PROJECT_ID) fail();
    if (evidence && JSON.stringify(head) !== JSON.stringify(raw.snapshots[1].selected.find(record => record.reference === reference)?.resource)) fail();
  }
  if (actorScope(client) !== actor) fail();
  return { inspectedAt: raw.inspectedAt, checkpoints, ...(selected ? { selected } : {}) };
}

export interface NativeReportResponse {
  mode: string; coverage: string; requester: string; inspectedAt: string; headState: string; sources: string[];
  persisted: boolean; activated: boolean; externalDispatch: boolean; clinicalWrites: number; clinicalCompletionVerified: boolean;
  completionCoverage: string; sourceDocumentContentVerified: boolean;
  syntheticCompletionExamples?: typeof COMPLETION_EXAMPLES;
  report: { mode: string; coverage: string; projectId: string; asOf: string; suppliedWorkers: number; suppliedObligations: number;
    workersWithNoSuppliedObligations: number; syntheticTimingCounts: Record<string, number>; classificationCounts: { unclassified: number };
    persisted: boolean; activated: boolean; clinicalWrites: number; completePopulation: boolean; complianceAssessed: boolean;
    completionVerified: boolean; historicalReconstruction: boolean;
    workers: { patient: string; obligations: { id: string; exposure: string; rule: string; classification: string;
      source: { document: { reference: string } }; evaluation: { status: string; stage: string; due: string;
        result: { supportingInfo: { reference: string }[] } } }[] }[] };
  export: { mode: string; contentType: string; filename: string; csv: string; manifest: Record<string, unknown> };
}

export interface VerifiedNativeReport {
  actor: string; asOf: string; timing: string; due: string; csv: string; filename: string;
  manifest: Record<string, unknown>; checksum: string;
  cohortRows?: { label: string; timing: string; due: string; exposure: string; enrollment?: string; completion?: typeof COMPLETION_EXAMPLES[number] }[];
}

function actorScope(client: MedplumClient): string {
  const actor = scope(client);
  if (actor !== REPORT_CLINICIAN) throw new Error('The configured reporting clinician is required.');
  return actor;
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function generateNativeReport(client: MedplumClient, confirmed: boolean): Promise<VerifiedNativeReport> {
  const actor = actorScope(client);
  if (confirmed !== true) throw new Error('Explicit synthetic-report confirmation is required.');
  const raw = await client.post<NativeReportResponse>(`fhir/R4/Bot/${NATIVE_REPORT_BOT_ID}/$execute`,
    { mode: 'export', confirmedSynthetic: true }, 'application/json', { maxRetries: 0 });
  const report = raw?.report; const exported = raw?.export; const manifest = exported?.manifest;
  const worker = report?.workers?.[0]; const obligation = worker?.obligations?.[0];
  const fail = (): never => { throw new Error('The scoped synthetic report could not be verified.'); };
  if (actorScope(client) !== actor || raw?.mode !== 'synthetic-report-export' || raw.coverage !== 'exact-configured-worker-and-manifest-only' ||
      raw.requester !== actor || raw.headState !== 'unchanged-at-read-checks' || raw.persisted !== false || raw.activated !== false ||
      raw.externalDispatch !== false || raw.clinicalWrites !== 0 || raw.clinicalCompletionVerified !== false ||
      raw.completionCoverage !== 'not-assessed' || raw.sourceDocumentContentVerified !== false ||
      JSON.stringify(raw.sources) !== JSON.stringify(REPORT_SOURCES) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw.inspectedAt) ||
      !Number.isFinite(Date.parse(raw.inspectedAt)) || new Date(raw.inspectedAt).toISOString() !== raw.inspectedAt ||
      report?.mode !== 'offline-synthetic-report' || report.coverage !== COVERAGE || report.projectId !== OEM_PROJECT_ID || report.asOf !== raw.inspectedAt.slice(0, 10) ||
      report.suppliedWorkers !== 1 || report.suppliedObligations !== 1 || report.workersWithNoSuppliedObligations !== 0 ||
      report.persisted !== false || report.activated !== false || report.clinicalWrites !== 0 || report.completePopulation !== false ||
      report.complianceAssessed !== false || report.completionVerified !== false || report.historicalReconstruction !== false ||
      report.workers?.length !== 1 || worker.patient !== WORKER || worker.obligations?.length !== 1 || obligation.exposure !== REPORT_SOURCES[1] ||
      obligation.rule !== RULE || obligation.source?.document?.reference !== REPORT_SOURCES[3] || obligation.classification !== 'unclassified' ||
      obligation.evaluation?.stage !== 'baseline' || obligation.evaluation.due !== '2026-01-01' ||
      exported?.mode !== 'offline-synthetic-report-export' || exported.contentType !== 'text/csv;charset=utf-8' ||
      exported.filename !== `synthetic-noise-report-${report.asOf}.csv` || typeof exported.csv !== 'string' || exported.csv.length > 1_000_000 ||
      !manifest || manifest.formatVersion !== '1' || manifest.projectId !== OEM_PROJECT_ID || manifest.asOf !== report.asOf || manifest.coverage !== COVERAGE ||
      manifest.rowCount !== 1 || manifest.suppliedWorkers !== 1 || manifest.suppliedObligations !== 1 || manifest.workersWithNoSuppliedObligations !== 0 ||
      JSON.stringify(manifest.workers) !== JSON.stringify([WORKER]) || FALSE_FIELDS.some(key => manifest[key] !== false)) fail();
  const manifestKeys = [...FALSE_FIELDS, 'formatVersion', 'coverage', 'projectId', 'asOf', 'workers', 'suppliedWorkers',
    'suppliedObligations', 'workersWithNoSuppliedObligations', 'syntheticTimingCounts', 'classificationCounts', 'rowCount', 'csvSha256'];
  if (JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(manifestKeys.sort())) fail();
  const timing = report.asOf > '2026-01-01' ? 'overdue' : report.asOf < '2026-01-01' ? 'current' : 'due';
  const counts = { due: 0, overdue: 0, current: 0, 'needs-review': 0, [timing]: 1 };
  if (obligation.evaluation.status !== timing || JSON.stringify(report.syntheticTimingCounts) !== JSON.stringify(counts) ||
      JSON.stringify(manifest.syntheticTimingCounts) !== JSON.stringify(counts) ||
      JSON.stringify(report.classificationCounts) !== JSON.stringify({ unclassified: 1 }) ||
      JSON.stringify(manifest.classificationCounts) !== JSON.stringify({ unclassified: 1 })) fail();
  const obligationId = await sha256(`${OEM_PROJECT_ID}|${WORKER}|${REPORT_SOURCES[1]}|${RULE}`);
  if (obligation.id !== obligationId || await sha256(exported.csv) !== manifest.csvSha256) fail();
  const parsed = parse(exported.csv, { max_record_size: 100_000 }) as string[][];
  if (parsed.length !== 2 || JSON.stringify(parsed[0]) !== JSON.stringify(REPORT_COLUMNS) || parsed[1].length !== REPORT_COLUMNS.length) fail();
  const row = Object.fromEntries(REPORT_COLUMNS.map((column, index) => [column, parsed[1][index]]));
  const expected = { demo_mode: report.mode, coverage: COVERAGE, authorization_verified: 'false', project: OEM_PROJECT_ID,
    as_of: report.asOf, worker: WORKER, row_kind: 'obligation', obligation_id: obligationId, exposure_history: REPORT_SOURCES[1],
    rule_version: RULE, source_history: REPORT_SOURCES[3], classification: 'unclassified', synthetic_timing: timing, stage: 'baseline',
    due: '2026-01-01', review_required: 'false', complete_population: 'false', compliance_assessed: 'false', clinical_completion_verified: 'false', historical_reconstruction: 'false' };
  if (Object.entries(expected).some(([key, value]) => row[key] !== value)) fail();
  const support = obligation.evaluation.result.supportingInfo.map(reference => reference.reference);
  if (support.length !== 4 || !support.includes(REPORT_SOURCES[1]) || !support.includes(REPORT_SOURCES[2]) || !support.includes(REPORT_SOURCES[3]) ||
      support.some(reference => !/^(Observation|DocumentReference)\/[A-Za-z0-9.-]+(?:\/_history\/[A-Za-z0-9.-]+)?$/.test(reference)) ||
      JSON.stringify(JSON.parse(row.supporting_references_json)) !== JSON.stringify(support)) fail();
  for (const reference of REPORT_SOURCES) {
    const [type, id, , version] = reference.split('/');
    const head = await client.readResource(type as Resource['resourceType'], id, { cache: 'no-cache', maxRetries: 0 });
    if (head.meta?.project !== OEM_PROJECT_ID || `${head.resourceType}/${head.id}/_history/${head.meta.versionId}` !== reference || !version) fail();
  }
  if (actorScope(client) !== actor) fail();
  return { actor, asOf: report.asOf, timing, due: '2026-01-01', csv: exported.csv, filename: exported.filename,
    manifest: structuredClone(manifest), checksum: manifest.csvSha256 as string };
}

export async function generateNativeCohortReport(client: MedplumClient, confirmed: boolean): Promise<VerifiedNativeReport> {
  return generateCohortReport(client, confirmed, false);
}

export async function generateNativeCompletionReport(client: MedplumClient, confirmed: boolean): Promise<VerifiedNativeReport> {
  return generateCohortReport(client, confirmed, true);
}

async function generateCohortReport(client: MedplumClient, confirmed: boolean, completionExamples: boolean): Promise<VerifiedNativeReport> {
  const actor = actorScope(client);
  if (confirmed !== true) throw new Error('Explicit synthetic-report confirmation is required.');
  const raw = await client.post<NativeReportResponse>(`fhir/R4/Bot/${completionExamples ? COMPLETION_REPORT_BOT_ID : COHORT_REPORT_BOT_ID}/$execute`,
    { mode: 'export', confirmedSynthetic: true }, 'application/json', { maxRetries: 0 });
  const report = raw?.report; const exported = raw?.export; const manifest = exported?.manifest;
  const fail = (): never => { throw new Error('The three-worker synthetic report could not be verified.'); };
  const workers = COHORT_WORKERS.map(worker => worker.worker.split('/').slice(0, 2).join('/')).sort();
  const sources = completionExamples ? COMPLETION_SOURCES : COHORT_SOURCES;
  if (actorScope(client) !== actor || raw?.mode !== (completionExamples ? 'synthetic-completion-report-export' : 'synthetic-cohort-report-export') ||
      raw.coverage !== (completionExamples ? 'exact-configured-three-workers-and-completion-examples-only' : 'exact-configured-three-workers-and-manifest-only') ||
      raw.requester !== actor || raw.headState !== 'unchanged-at-read-checks' || raw.persisted !== false || raw.activated !== false || raw.externalDispatch !== false ||
      raw.clinicalWrites !== 0 || raw.clinicalCompletionVerified !== false ||
      raw.completionCoverage !== (completionExamples ? 'exact-configured-synthetic-examples-only' : 'not-assessed') || raw.sourceDocumentContentVerified !== false ||
      JSON.stringify(raw.sources) !== JSON.stringify(sources) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw.inspectedAt) ||
      !Number.isFinite(Date.parse(raw.inspectedAt)) || new Date(raw.inspectedAt).toISOString() !== raw.inspectedAt ||
      report?.mode !== 'offline-synthetic-report' || report.coverage !== COVERAGE || report.projectId !== OEM_PROJECT_ID || report.asOf !== raw.inspectedAt.slice(0, 10) ||
      report.suppliedWorkers !== 3 || report.suppliedObligations !== 3 || report.workersWithNoSuppliedObligations !== 0 || report.workers?.length !== 3 ||
      JSON.stringify(report.workers.map(worker => worker.patient)) !== JSON.stringify(workers) ||
      report.persisted !== false || report.activated !== false || report.clinicalWrites !== 0 || report.completePopulation !== false ||
      report.complianceAssessed !== false || report.completionVerified !== false || report.historicalReconstruction !== false ||
      exported?.mode !== 'offline-synthetic-report-export' || exported.contentType !== 'text/csv;charset=utf-8' || exported.filename !== `synthetic-noise-report-${report.asOf}.csv` ||
      typeof exported.csv !== 'string' || exported.csv.length > 1_000_000 || !manifest || manifest.formatVersion !== '1' || manifest.coverage !== COVERAGE ||
      manifest.projectId !== OEM_PROJECT_ID || manifest.asOf !== report.asOf || manifest.rowCount !== 3 || manifest.suppliedWorkers !== 3 ||
      manifest.suppliedObligations !== 3 || manifest.workersWithNoSuppliedObligations !== 0 || JSON.stringify(manifest.workers) !== JSON.stringify(workers) ||
      FALSE_FIELDS.some(key => manifest[key] !== false)) fail();
  const keys = [...FALSE_FIELDS, 'formatVersion', 'coverage', 'projectId', 'asOf', 'workers', 'suppliedWorkers', 'suppliedObligations',
    'workersWithNoSuppliedObligations', 'syntheticTimingCounts', 'classificationCounts', 'rowCount', 'csvSha256', ...(completionExamples ? ['syntheticCompletionExamples'] : [])];
  if (JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(keys.sort()) || await sha256(exported.csv) !== manifest.csvSha256) fail();
  if (completionExamples ? JSON.stringify(raw.syntheticCompletionExamples) !== JSON.stringify(COMPLETION_EXAMPLES) ||
      JSON.stringify(manifest.syntheticCompletionExamples) !== JSON.stringify(COMPLETION_EXAMPLES) || report.asOf < '2026-06-15' : raw.syntheticCompletionExamples !== undefined) fail();
  const periodicDue = completionExamples ? '2027-06-15' : '2026-01-01';
  const timing = report.asOf > periodicDue ? 'overdue' : report.asOf < periodicDue ? 'current' : 'due';
  const counts = { due: 0, overdue: 0, current: 0, 'needs-review': 1, [timing]: 2 };
  if (JSON.stringify(report.syntheticTimingCounts) !== JSON.stringify(counts) || JSON.stringify(manifest.syntheticTimingCounts) !== JSON.stringify(counts) ||
      JSON.stringify(report.classificationCounts) !== JSON.stringify({ unclassified: 3 }) || JSON.stringify(manifest.classificationCounts) !== JSON.stringify({ unclassified: 3 })) fail();
  const parsed = parse(exported.csv, { max_record_size: 100_000 }) as string[][];
  if (parsed.length !== 4 || JSON.stringify(parsed[0]) !== JSON.stringify(REPORT_COLUMNS) || parsed.slice(1).some(row => row.length !== REPORT_COLUMNS.length)) fail();
  const rows = parsed.slice(1).map(row => Object.fromEntries(REPORT_COLUMNS.map((column, index) => [column, row[index]])));
  if (JSON.stringify(rows.map(row => row.worker)) !== JSON.stringify(workers)) fail();
  const heads = new Map<string, Resource>();
  for (const reference of sources) {
    const [type, id] = reference.split('/');
    const head = await client.readResource(type as Resource['resourceType'], id, { cache: 'no-cache', maxRetries: 0 });
    if (head.meta?.project !== OEM_PROJECT_ID || `${head.resourceType}/${head.id}/_history/${head.meta.versionId}` !== reference) fail();
    heads.set(reference, head);
  }
  const cohortRows: NonNullable<VerifiedNativeReport['cohortRows']> = [];
  for (const [index, configured] of COHORT_WORKERS.entries()) {
    const patient = configured.worker.split('/').slice(0, 2).join('/');
    const worker = report.workers.find(candidate => candidate.patient === patient)!;
    const obligation = worker.obligations?.[0]; const row = rows.find(candidate => candidate.worker === patient)!;
    const example = completionExamples ? COMPLETION_EXAMPLES.find(example => example.patient === patient) : undefined;
    const status = configured.enrollment ? timing : 'needs-review'; const due = configured.enrollment ? periodicDue : '';
    const stage = configured.enrollment ? example ? 'periodic' : 'baseline' : '';
    const id = await sha256(`${OEM_PROJECT_ID}|${patient}|${configured.exposure}|${RULE}`);
    if (worker.obligations?.length !== 1 || obligation.id !== id || obligation.exposure !== configured.exposure || obligation.rule !== RULE ||
        obligation.classification !== 'unclassified' || obligation.source?.document?.reference !== REPORT_SOURCES[3] || obligation.evaluation?.status !== status ||
        (obligation.evaluation.stage ?? '') !== stage || (obligation.evaluation.due ?? '') !== due) fail();
    const support = [configured.exposure, REPORT_SOURCES[3]];
    if (configured.enrollment) {
      const enrollment = heads.get(configured.enrollment)!;
      if (enrollment.resourceType !== 'Observation' || enrollment.status !== 'final' || enrollment.subject?.reference !== patient || enrollment.derivedFrom?.length !== 1 ||
          !/^DocumentReference\/[A-Za-z0-9.-]+(?:\/_history\/[A-Za-z0-9.-]+)?$/.test(enrollment.derivedFrom[0].reference ?? '')) fail();
      support.push(configured.enrollment, enrollment.resourceType === 'Observation' ? enrollment.derivedFrom![0].reference! : '');
    }
    if (example) {
      const record = heads.get(example.record)!; const evidence = heads.get(example.evidence)!;
      if (record.resourceType !== 'Observation' || record.status !== 'final' || record.subject?.reference !== patient || record.effectiveDateTime !== example.performedOn ||
          record.derivedFrom?.length !== 1 || ![example.evidence, example.evidence.split('/').slice(0, 2).join('/')].includes(record.derivedFrom[0].reference ?? '') ||
          evidence.resourceType !== 'DocumentReference' || evidence.status !== 'current' || evidence.subject?.reference !== patient) fail();
      support.push(example.evidence, example.record);
    }
    if (JSON.stringify(obligation.evaluation.result.supportingInfo.map(reference => reference.reference)) !== JSON.stringify(support) ||
        JSON.stringify(JSON.parse(row.supporting_references_json)) !== JSON.stringify(support)) fail();
    const expected = { demo_mode: report.mode, coverage: COVERAGE, authorization_verified: 'false', project: OEM_PROJECT_ID, as_of: report.asOf,
      worker: patient, row_kind: 'obligation', obligation_id: id, exposure_history: configured.exposure, rule_version: RULE,
      source_history: REPORT_SOURCES[3], classification: 'unclassified', synthetic_timing: status, stage, due,
      review_required: configured.enrollment ? 'false' : 'true', complete_population: 'false', compliance_assessed: 'false', clinical_completion_verified: 'false', historical_reconstruction: 'false' };
    if (Object.entries(expected).some(([key, value]) => row[key] !== value)) fail();
    cohortRows.push({ label: `Synthetic-${index + 1}`, timing: status, due, exposure: configured.exposure,
      ...(configured.enrollment ? { enrollment: configured.enrollment } : {}), ...(example ? { completion: structuredClone(example) } : {}) });
  }
  if (actorScope(client) !== actor) fail();
  return { actor, asOf: report.asOf, timing: 'mixed', due: '', csv: exported.csv, filename: exported.filename,
    manifest: structuredClone(manifest), checksum: manifest.csvSha256 as string, cohortRows };
}

export function downloadNativeReport(client: MedplumClient, report: VerifiedNativeReport, kind: 'csv' | 'manifest'): void {
  if (actorScope(client) !== report.actor) throw new Error('Report scope changed.');
  const blob = new Blob([kind === 'csv' ? report.csv : JSON.stringify(report.manifest, null, 2)],
    { type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = kind === 'csv' ? report.filename : report.filename.replace(/\.csv$/, '.manifest.json');
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
}
