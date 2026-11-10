import { MantineProvider } from '@mantine/core';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createHash, webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { parse } from 'csv-parse/browser/esm/sync';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeEvidenceHistory, NativeHistory, NativeLineageHistory, NativeRecordedTime, NativeRuleHistory, NativeMatrixHistory, NativeMatrixPdf, NativeReport } from './NativeReport';
import * as ruleReviewValidation from './rule-review';
import { inspectNativeMatrixPdf, MATRIX_PDF_BOT_ID, MATRIX_PDF_BINDING } from './native-report';
import { downloadNativeReport, generateNativeReport, generateNativeCohortReport, generateNativeCompletionReport, COMPLETION_EXAMPLES, COMPLETION_SOURCES, COMPLETION_REPORT_BOT_ID, COHORT_REPORT_BOT_ID, COHORT_SOURCES, COHORT_WORKERS, NATIVE_REPORT_BOT_ID, REPORT_CLINICIAN, REPORT_COLUMNS, REPORT_SOURCES, type NativeReportResponse } from './native-report';
import { OEM_PROJECT_ID } from './ih-review';
import { LIFECYCLE_WORKER_ID } from './intake';
import { inspectNativeHistory, inspectNativeEvidenceHistory, HISTORY_SOURCES, HISTORY_REQUESTED, HISTORY_CHECKPOINTS, NATIVE_HISTORY_BOT_ID,
  EVIDENCE_HISTORY_BOT_ID, EVIDENCE_HISTORY_SOURCES, EVIDENCE_HISTORY_CHECKPOINTS, inspectNativeLineageHistory,
  LINEAGE_HISTORY_BOT_ID, LINEAGE_HISTORY_SOURCES, LINEAGE_HISTORY_PENDING, LINEAGE_HISTORY_CHECKPOINTS, inspectNativeRecordedTime, RECORDED_TIME_BOT_ID,
  inspectNativeRuleHistory, RULE_HISTORY_BOT_ID, RULE_HISTORY_SOURCES, RULE_HISTORY_FINGERPRINT, RULE_HISTORY_REVIEWER, RULE_HISTORY_DOCUMENT,
  inspectNativeMatrixHistory, MATRIX_HISTORY_BOT_ID, MATRIX_HISTORY_SOURCES, MATRIX_HISTORY_METADATA, type NativeHistoryResponse } from './native-report';

const worker = `Patient/${LIFECYCLE_WORKER_ID}`;
const rule = 'https://hiivehealth.com/fhir/PlanDefinition/synthetic-noise-503|demo-1';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

describe('strict native Matrix PDF verification', () => {
  function pdfClient() {
    const client = new MockClient();
    vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    vi.spyOn(client, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: REPORT_CLINICIAN.split('/')[1] });
    vi.spyOn(client, 'post').mockResolvedValue({ ...MATRIX_PDF_BINDING, inspectedAt: new Date().toISOString() });
    vi.spyOn(client, 'readResource').mockRejectedValue(new Error('No direct PDF resource reads permitted'));
    vi.spyOn(client, 'download').mockRejectedValue(new Error('No browser attachment downloads permitted'));
    return client;
  }

  it('accepts only the exact published result with one no-retry service request and no direct reads', async () => {
    const client = pdfClient(); const result = await inspectNativeMatrixPdf(client, true);
    expect(client.post).toHaveBeenCalledExactlyOnceWith(`fhir/R4/Bot/${MATRIX_PDF_BOT_ID}/$execute`,
      { mode: 'verify-pdf', confirmedSynthetic: true }, 'application/json', { maxRetries: 0 });
    expect(result).toMatchObject({ document: MATRIX_PDF_BINDING.document, binary: MATRIX_PDF_BINDING.binary,
      checksum: MATRIX_PDF_BINDING.pdfSha256, byteLength: MATRIX_PDF_BINDING.byteLength });
    expect(client.readResource).not.toHaveBeenCalled(); expect(client.download).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/https:|attachment|clinicalInterpretationVerified/);
  });

  it.each(['mode', 'coverage', 'document', 'binary', 'documentFingerprint', 'pdfSha256', 'byteLength', 'mediaType',
    'sourceHeadChecks', 'matrixDocumentMetadataVerified', 'matrixAttachmentContentVerified', 'clinicalInterpretationVerified',
    'ruleApprovalVerified', 'clinicalCompletionVerified', 'complianceAssessed', 'historicalReconstruction', 'clinicalWrites',
    'activated', 'externalDispatch', 'extra', 'missing', 'old-time', 'future-time', 'invalid-time'])('refuses %s response drift', async change => {
    const client = pdfClient(); const raw: Record<string, unknown> = { ...MATRIX_PDF_BINDING, inspectedAt: new Date().toISOString() };
    if (change === 'extra') raw.url = 'https://foreign.invalid/file';
    else if (change === 'missing') delete raw.binary;
    else if (change === 'old-time') raw.inspectedAt = '2026-10-24T00:00:00.000Z';
    else if (change === 'future-time') raw.inspectedAt = '2099-01-01T00:00:00.000Z';
    else if (change === 'invalid-time') raw.inspectedAt = '2026-02-30T00:00:00.000Z';
    else raw[change] = typeof raw[change] === 'boolean' ? !raw[change] : typeof raw[change] === 'number' ? Number(raw[change]) + 1 : 'altered';
    vi.mocked(client.post).mockResolvedValue(raw);
    await expect(inspectNativeMatrixPdf(client, true)).rejects.toThrow();
    expect(client.post).toHaveBeenCalledTimes(1); expect(client.readResource).not.toHaveBeenCalled(); expect(client.download).not.toHaveBeenCalled();
  });

  it.each(['unconfirmed', 'project', 'actor'])('refuses %s before requests', async change => {
    const client = pdfClient();
    if (change === 'project') vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: 'other' });
    if (change === 'actor') vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other' });
    await expect(inspectNativeMatrixPdf(client, change !== 'unconfirmed')).rejects.toThrow();
    expect(client.post).not.toHaveBeenCalled();
  });

  it('refuses a late result after actor scope changes', async () => {
    const client = pdfClient(); let resolve!: (value: unknown) => void;
    vi.mocked(client.post).mockImplementation(() => new Promise(value => { resolve = value; }));
    const pending = inspectNativeMatrixPdf(client, true);
    vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other' });
    resolve({ ...MATRIX_PDF_BINDING, inspectedAt: new Date().toISOString() });
    await expect(pending).rejects.toThrow();
  });

  const mountPdf = (client: MockClient) => render(<MantineProvider><MedplumProvider medplum={client}><NativeMatrixPdf /></MedplumProvider></MantineProvider>);

  it('requires its own confirmation, renders safe plain bindings and dismisses without automatic reads', async () => {
    const client = pdfClient(); const mounted = mountPdf(client);
    expect(screen.getByRole('button', { name: 'Verify Matrix PDF bytes' })).toBeDisabled();
    expect(client.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('I confirm synthetic PDF verification'));
    const button = screen.getByRole('button', { name: 'Verify Matrix PDF bytes' });
    fireEvent.click(button); fireEvent.click(button);
    await screen.findByText('PDF bytes: verified. Clinical interpretation and rule approval: unverified.');
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(screen.getByText('4,022,607 bytes - application/pdf')).toBeDefined();
    expect(screen.getByLabelText('Verified Matrix document').getAttribute('data-reference')).toBe(MATRIX_PDF_BINDING.document);
    expect(screen.getByLabelText('Verified Matrix Binary').getAttribute('data-reference')).toBe(MATRIX_PDF_BINDING.binary);
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss PDF verification' }));
    expect(screen.getByRole('button', { name: 'Verify Matrix PDF bytes' })).toBeDisabled();
    expect(screen.getByLabelText('I confirm synthetic PDF verification')).not.toBeChecked();
    mounted.unmount(); mountPdf(client);
    expect(screen.getByRole('button', { name: 'Verify Matrix PDF bytes' })).toBeDisabled();
    expect(client.post).toHaveBeenCalledTimes(1);
  });

  it('fails closed without exposing errors and requires fresh confirmation before an explicit retry', async () => {
    const client = pdfClient(); vi.mocked(client.post).mockRejectedValueOnce(new Error('private signed-url-secret'));
    mountPdf(client); fireEvent.click(screen.getByLabelText('I confirm synthetic PDF verification'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify Matrix PDF bytes' }));
    await screen.findByText('PDF verification unavailable');
    expect(screen.queryByText(/private signed-url-secret/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Verify Matrix PDF bytes' })).toBeDisabled();
    expect(client.post).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('I confirm synthetic PDF verification'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify Matrix PDF bytes' }));
    await screen.findByText('PDF bytes: verified. Clinical interpretation and rule approval: unverified.');
    expect(client.post).toHaveBeenCalledTimes(2);
  });

  it.each(['actor', 'project'])('removes controls and ignores late results after %s changes', async change => {
    const client = pdfClient(); let resolve!: (value: unknown) => void;
    vi.mocked(client.post).mockImplementation(() => new Promise(value => { resolve = value; }));
    mountPdf(client); fireEvent.click(screen.getByLabelText('I confirm synthetic PDF verification'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify Matrix PDF bytes' }));
    await act(async () => {
      if (change === 'actor') vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other' });
      else vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: 'other' });
      client.dispatchEvent({ type: 'change' });
    });
    await act(async () => resolve({ ...MATRIX_PDF_BINDING, inspectedAt: new Date().toISOString() }));
    expect(screen.queryByRole('region', { name: 'Matrix PDF verification' })).toBeNull();
    expect(screen.queryByText(/PDF bytes: verified/)).toBeNull();
  });
});

function response(): NativeReportResponse {
  const counts = { due: 0, overdue: 1, current: 0, 'needs-review': 0 }; const classification = { unclassified: 1 };
  const supportingInfo = [REPORT_SOURCES[1], REPORT_SOURCES[3], REPORT_SOURCES[2], 'DocumentReference/report-evidence/_history/one'].map(reference => ({ reference }));
  const id = hash(`${OEM_PROJECT_ID}|${worker}|${REPORT_SOURCES[1]}|${rule}`);
  const fields: Record<string, string> = { demo_mode: 'offline-synthetic-report', coverage: 'supplied-workers-and-obligations-only',
    authorization_verified: 'false', project: OEM_PROJECT_ID, as_of: '2026-10-24', worker, row_kind: 'obligation', obligation_id: id,
    exposure_history: REPORT_SOURCES[1], rule_version: rule, source_history: REPORT_SOURCES[3],
    supporting_references_json: JSON.stringify(supportingInfo.map(reference => reference.reference)), classification: 'unclassified',
    synthetic_timing: 'overdue', stage: 'baseline', due: '2026-01-01', review_required: 'false', complete_population: 'false',
    compliance_assessed: 'false', clinical_completion_verified: 'false', historical_reconstruction: 'false' };
  const csv = [REPORT_COLUMNS, REPORT_COLUMNS.map(column => fields[column])].map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
  return { mode: 'synthetic-report-export', coverage: 'exact-configured-worker-and-manifest-only', requester: REPORT_CLINICIAN,
    inspectedAt: '2026-10-24T00:49:52.436Z', headState: 'unchanged-at-read-checks', sources: [...REPORT_SOURCES],
    persisted: false, activated: false, externalDispatch: false, clinicalWrites: 0, clinicalCompletionVerified: false,
    completionCoverage: 'not-assessed', sourceDocumentContentVerified: false,
    report: { mode: 'offline-synthetic-report', coverage: 'supplied-workers-and-obligations-only', projectId: OEM_PROJECT_ID, asOf: '2026-10-24',
      suppliedWorkers: 1, suppliedObligations: 1, workersWithNoSuppliedObligations: 0, syntheticTimingCounts: counts, classificationCounts: classification,
      persisted: false, activated: false, clinicalWrites: 0, completePopulation: false, complianceAssessed: false, completionVerified: false, historicalReconstruction: false,
      workers: [{ patient: worker, obligations: [{ id, exposure: REPORT_SOURCES[1], rule, classification: 'unclassified',
        source: { document: { reference: REPORT_SOURCES[3] } }, evaluation: { status: 'overdue', stage: 'baseline', due: '2026-01-01', result: { supportingInfo } } }] }] },
    export: { mode: 'offline-synthetic-report-export', contentType: 'text/csv;charset=utf-8', filename: 'synthetic-noise-report-2026-10-24.csv', csv,
      manifest: { formatVersion: '1', coverage: 'supplied-workers-and-obligations-only', projectId: OEM_PROJECT_ID, asOf: '2026-10-24',
        authorizationVerified: false, sourceBodiesVerified: false, completePopulation: false, complianceAssessed: false,
        clinicalCompletionVerified: false, historicalReconstruction: false, persisted: false, externalDispatch: false,
        workers: [worker], suppliedWorkers: 1, suppliedObligations: 1, workersWithNoSuppliedObligations: 0,
        syntheticTimingCounts: counts, classificationCounts: classification, rowCount: 1, csvSha256: hash(csv) } } };
}

function cohortResponse(): NativeReportResponse {
  const raw = response(); const template = structuredClone(raw.report.workers[0].obligations[0]);
  raw.mode = 'synthetic-cohort-report-export'; raw.coverage = 'exact-configured-three-workers-and-manifest-only'; raw.sources = [...COHORT_SOURCES];
  raw.report.suppliedWorkers = 3; raw.report.suppliedObligations = 3; raw.report.classificationCounts = { unclassified: 3 };
  raw.report.syntheticTimingCounts = { due: 0, overdue: 2, current: 0, 'needs-review': 1 };
  raw.report.workers = COHORT_WORKERS.map((configured, index) => {
    const patient = configured.worker.split('/').slice(0, 2).join('/'); const obligation = structuredClone(template);
    obligation.exposure = configured.exposure; obligation.id = hash(`${OEM_PROJECT_ID}|${patient}|${configured.exposure}|${rule}`);
    obligation.evaluation = { status: configured.enrollment ? 'overdue' : 'needs-review', stage: configured.enrollment ? 'baseline' : '',
      due: configured.enrollment ? '2026-01-01' : '', result: { supportingInfo: [configured.exposure, REPORT_SOURCES[3],
        ...(configured.enrollment ? [configured.enrollment, `DocumentReference/cohort-enrollment-${index + 1}/_history/one`] : [])].map(reference => ({ reference })) } };
    return { patient, obligations: [obligation] };
  }).sort((first, second) => first.patient.localeCompare(second.patient));
  const base = (parse(response().export.csv, { columns: true }) as Record<string, string>[])[0];
  const rows: Record<string, string>[] = raw.report.workers.map(worker => {
    const obligation = worker.obligations[0];
    return { ...base, worker: worker.patient, obligation_id: obligation.id, exposure_history: obligation.exposure,
      supporting_references_json: JSON.stringify(obligation.evaluation.result.supportingInfo.map(reference => reference.reference)),
      synthetic_timing: obligation.evaluation.status, stage: obligation.evaluation.stage, due: obligation.evaluation.due,
      review_required: obligation.evaluation.status === 'needs-review' ? 'true' : 'false' };
  });
  raw.export.csv = [REPORT_COLUMNS, ...rows.map(row => REPORT_COLUMNS.map(column => row[column]))]
    .map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
  Object.assign(raw.export.manifest, { workers: raw.report.workers.map(worker => worker.patient), suppliedWorkers: 3, suppliedObligations: 3,
    syntheticTimingCounts: raw.report.syntheticTimingCounts, classificationCounts: raw.report.classificationCounts, rowCount: 3, csvSha256: hash(raw.export.csv) });
  return raw;
}

function completionResponse(): NativeReportResponse {
  const raw = cohortResponse(); raw.mode = 'synthetic-completion-report-export'; raw.coverage = 'exact-configured-three-workers-and-completion-examples-only';
  raw.completionCoverage = 'exact-configured-synthetic-examples-only'; raw.sources = [...COMPLETION_SOURCES];
  raw.syntheticCompletionExamples = structuredClone(COMPLETION_EXAMPLES);
  raw.report.syntheticTimingCounts = { due: 0, overdue: 0, current: 2, 'needs-review': 1 };
  const rows = parse(raw.export.csv, { columns: true }) as Record<string, string>[];
  for (const example of COMPLETION_EXAMPLES) {
    const evaluation = raw.report.workers.find(worker => worker.patient === example.patient)!.obligations[0].evaluation;
    evaluation.status = 'current'; evaluation.stage = 'periodic'; evaluation.due = example.illustrativeNextPeriodicOn;
    evaluation.result.supportingInfo.push({ reference: example.evidence }, { reference: example.record });
    const row = rows.find(row => row.worker === example.patient)!;
    Object.assign(row, { synthetic_timing: 'current', stage: 'periodic', due: example.illustrativeNextPeriodicOn,
      supporting_references_json: JSON.stringify(evaluation.result.supportingInfo.map(reference => reference.reference)) });
  }
  raw.export.csv = [REPORT_COLUMNS, ...rows.map(row => REPORT_COLUMNS.map(column => row[column]))]
    .map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
  Object.assign(raw.export.manifest, { syntheticTimingCounts: raw.report.syntheticTimingCounts, syntheticCompletionExamples: structuredClone(COMPLETION_EXAMPLES), csvSha256: hash(raw.export.csv) });
  return raw;
}

function historyResponse(): NativeHistoryResponse {
  const record = (reference: string, checkpoint: number) => {
    const [type, id, , versionId] = reference.split('/'); const lastUpdated = HISTORY_CHECKPOINTS[checkpoint];
    const resource = { resourceType: type, id, meta: { project: OEM_PROJECT_ID, versionId, lastUpdated },
      ...(type === 'Task' ? { status: checkpoint === 0 ? 'requested' : 'accepted', intent: 'proposal', for: { reference: worker } } :
        type === 'Observation' ? { status: 'final', code: {}, subject: { reference: worker } } :
        type === 'ServiceRequest' ? { status: 'draft', intent: 'proposal', subject: { reference: worker } } : {}) } as import('@medplum/fhirtypes').Resource;
    return { reference, recordedAt: lastUpdated, resource };
  };
  return { mode: 'synthetic-native-history-inspection', coverage: 'exact-configured-four-resource-histories-only', requester: REPORT_CLINICIAN,
    inspectedAt: '2026-10-24T12:00:00.000Z', headState: 'unchanged-at-read-checks', sources: [...HISTORY_SOURCES],
    historicalReconstruction: false, completeSourceGraph: false, clinicalCompletionVerified: false, complianceAssessed: false,
    persisted: false, activated: false, externalDispatch: false, clinicalWrites: 0,
    historyVersions: HISTORY_SOURCES.map((reference, index) => ({ reference: reference.split('/').slice(0, 2).join('/'), versions: (index === 2 ? [HISTORY_REQUESTED, reference] : [reference]).sort() })),
    snapshots: HISTORY_CHECKPOINTS.map((asOf, index) => ({ mode: 'offline-supplied-history-selection', coverage: 'supplied-resource-versions-only',
      projectId: OEM_PROJECT_ID, asOf, authorizationVerified: false, sourceBodiesVerified: false, completeHistory: false,
      historicalReconstruction: false, deletedResourcesReconstructed: false, clinicalCompletionVerified: false, complianceAssessed: false,
      persisted: false, externalDispatch: false, clinicalWrites: 0, excludedFutureVersions: index === 0 ? 2 : 0,
      notYetRecorded: index === 0 ? [HISTORY_SOURCES[3].split('/').slice(0, 2).join('/')] : [],
      selected: (index === 0 ? [HISTORY_SOURCES[0], HISTORY_SOURCES[1], HISTORY_REQUESTED] : [...HISTORY_SOURCES]).sort().map(reference => record(reference, index)) })) };
}

describe('fixed native history validation', () => {
  function historyClient() {
    const client = new MockClient();
    vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    vi.spyOn(client, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: REPORT_CLINICIAN.split('/')[1] });
    vi.spyOn(client, 'readResource').mockImplementation(((type: string, id: string) => {
      const reference = HISTORY_SOURCES.find(value => value.startsWith(`${type}/${id}/`))!;
      return Promise.resolve({ resourceType: type, id, meta: { project: OEM_PROJECT_ID, versionId: reference.split('/')[3] } });
    }) as typeof client.readResource);
    vi.spyOn(client, 'post').mockResolvedValue(historyResponse()); return client;
  }

  it('verifies fixed checkpoints/statuses/links and current heads with one no-retry request', async () => {
    const client = historyClient(); const result = await inspectNativeHistory(client, true);
    expect(client.post).toHaveBeenCalledWith(`fhir/R4/Bot/${NATIVE_HISTORY_BOT_ID}/$execute`, { mode: 'history', confirmedSynthetic: true }, 'application/json', { maxRetries: 0 });
    expect(client.readResource).toHaveBeenCalledTimes(4);
    expect(result.checkpoints[0].records.find(record => record.label === 'Recommendation')).toMatchObject({ status: 'requested', reference: HISTORY_REQUESTED });
    expect(result.checkpoints[0].records.find(record => record.label === 'Local proposal')).toEqual({ label: 'Local proposal', status: 'Not recorded' });
    expect(result.checkpoints[1].records.find(record => record.label === 'Recommendation')?.status).toBe('accepted');
  });

  function evidenceResponse(): NativeHistoryResponse {
    const raw = historyResponse(); const sources = EVIDENCE_HISTORY_SOURCES;
    raw.mode = 'synthetic-native-evidence-history-inspection'; raw.coverage = 'exact-configured-eight-resource-histories-only'; raw.sources = [...sources];
    raw.historyVersions = sources.map((reference, index) => ({ reference: reference.split('/').slice(0, 2).join('/'), versions: (index === 2 ? [HISTORY_REQUESTED, reference] : [reference]).sort() }));
    for (const [index, snapshot] of raw.snapshots.entries()) {
      snapshot.asOf = EVIDENCE_HISTORY_CHECKPOINTS[index]; snapshot.excludedFutureVersions = index === 0 ? 5 : 0;
      snapshot.notYetRecorded = index === 0 ? [sources[3], sources[4], sources[6], sources[7]].map(reference => reference.split('/').slice(0, 2).join('/')).sort() : [];
      for (const sourceIndex of index === 0 ? [5] : [4, 5, 6, 7]) {
        const reference = sources[sourceIndex]; const [type, id, , versionId] = reference.split('/');
        const recordedAt = sourceIndex === 5 ? EVIDENCE_HISTORY_CHECKPOINTS[0] : EVIDENCE_HISTORY_CHECKPOINTS[1];
        const resource = { resourceType: type, id, meta: { project: OEM_PROJECT_ID, versionId, lastUpdated: recordedAt,
          tag: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/demo-data', code: 'synthetic-only' }] },
          status: type === 'Observation' ? 'final' : 'current', ...(sourceIndex === 5 ? {} : { subject: { reference: worker } }),
          ...(sourceIndex === 4 ? { code: {}, focus: [{ reference: sources[1].split('/').slice(0, 2).join('/') }] } : {}),
          ...(sourceIndex === 6 ? { code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-simulated-completion', code: 'audiogram-attestation' }] },
            effectiveDateTime: '2026-06-15', issued: recordedAt, performer: [{ reference: REPORT_CLINICIAN }], focus: [{ reference: sources[2] }],
            basedOn: [{ reference: sources[3] }], derivedFrom: [{ reference: sources[7] }] } : {}),
          ...(sourceIndex === 7 ? { docStatus: 'final', type: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-surveillance-action', code: 'audiogram' }] },
            context: { period: { start: '2026-06-15' }, related: [{ reference: sources[3] }] } } : {}),
        } as import('@medplum/fhirtypes').Resource;
        snapshot.selected.push({ reference, recordedAt, resource });
      }
      snapshot.selected.sort((first, second) => first.reference.localeCompare(second.reference));
    }
    return raw;
  }

  function evidenceClient(raw = evidenceResponse()) {
    const client = historyClient(); vi.mocked(client.post).mockResolvedValue(raw);
    vi.mocked(client.readResource).mockImplementation(((type: string, id: string) => Promise.resolve(structuredClone(raw.snapshots[1].selected.find(record => record.resource.resourceType === type && record.resource.id === id)!.resource))) as typeof client.readResource);
    return client;
  }

  function lineageResponse(): NativeHistoryResponse {
    const raw = evidenceResponse(); const sources = LINEAGE_HISTORY_SOURCES;
    const identity = (reference: string) => reference.split('/').slice(0, 2).join('/');
    raw.mode = 'synthetic-native-lineage-history-inspection'; raw.coverage = 'exact-configured-fourteen-resource-histories-only'; raw.sources = [...sources];
    raw.historyVersions = sources.map((reference, index) => ({ reference: identity(reference), versions: (index === 2 ? [HISTORY_REQUESTED, reference] :
      index === 8 || index === 11 ? [LINEAGE_HISTORY_PENDING[index === 8 ? 0 : 1], reference] : [reference]).sort() }));
    raw.snapshots[0].excludedFutureVersions = 13; raw.snapshots[0].notYetRecorded.push(...sources.slice(8).map(identity)); raw.snapshots[0].notYetRecorded.sort();
    raw.snapshots[1].asOf = LINEAGE_HISTORY_CHECKPOINTS[1];
    for (const [offset, reference] of sources.slice(8).entries()) {
      const sourceIndex = offset + 8; const decision = sourceIndex < 11; const receipt = identity(sources[decision ? 8 : 11]);
      const [type, id, , versionId] = reference.split('/'); const recordedAt = LINEAGE_HISTORY_CHECKPOINTS[1];
      const outputs = decision ? [['proposal', sources[3]], ['task', sources[2]], ['audit', sources[9]], ['lineage', sources[10]]] :
        [['attestation', sources[6]], ['audit', sources[12]], ['lineage', sources[13]]];
      const entities = decision ? [worker, HISTORY_REQUESTED, sources[2], receipt, sources[3]] : [sources[2], sources[3], sources[7], receipt, sources[6]];
      const resource = { resourceType: type, id, meta: { project: OEM_PROJECT_ID, versionId, lastUpdated: recordedAt },
        ...(type === 'Task' ? { status: 'completed', intent: 'order', for: { reference: worker }, requester: { reference: REPORT_CLINICIAN },
          focus: { reference: decision ? HISTORY_REQUESTED : sources[2] }, output: outputs.map(([text, reference]) => ({ type: { text }, valueReference: { reference } })) } :
          type === 'AuditEvent' ? { recorded: recordedAt, action: decision ? 'U' : 'C', outcome: '0', agent: [{ who: { reference: REPORT_CLINICIAN }, requestor: true }],
            entity: entities.map(reference => ({ what: { reference } })) } : { recorded: recordedAt, agent: [{ who: { reference: REPORT_CLINICIAN } }],
            target: (decision ? [sources[2], sources[3]] : [sources[6]]).map(reference => ({ reference })),
            entity: (decision ? [HISTORY_REQUESTED, receipt] : [sources[2], sources[3], sources[7], receipt]).map(reference => ({ role: 'source', what: { reference } })) }),
      } as import('@medplum/fhirtypes').Resource;
      raw.snapshots[1].selected.push({ reference, recordedAt, resource });
    }
    raw.snapshots[1].selected.sort((first, second) => first.reference.localeCompare(second.reference)); return raw;
  }

  it('separately validates fourteen technical histories with no direct human technical reads or widened older contracts', async () => {
    const client = evidenceClient(lineageResponse()); const result = await inspectNativeLineageHistory(client, true);
    expect(client.post).toHaveBeenCalledWith(`fhir/R4/Bot/${LINEAGE_HISTORY_BOT_ID}/$execute`, { mode: 'history', confirmedSynthetic: true }, 'application/json', { maxRetries: 0 });
    expect(client.readResource).toHaveBeenCalledTimes(8); expect(result.checkpoints[0].records).toHaveLength(14);
    expect(result.checkpoints[0].records.filter(record => record.status === 'Not recorded')).toHaveLength(10);
    expect(result.checkpoints[1].records.find(record => record.label === 'Decision receipt')).toMatchObject({ status: 'Saved (technical receipt)', linkable: false, reference: LINEAGE_HISTORY_SOURCES[8] });
    await expect(inspectNativeHistory(client, true)).rejects.toThrow(); await expect(inspectNativeEvidenceHistory(client, true)).rejects.toThrow();
  });

  it.each(['eight-response', 'unconfirmed', 'wrong-actor', 'wrong-project', 'receipt-worker', 'receipt-actor', 'receipt-focus', 'receipt-output',
    'audit-actor', 'audit-entity', 'audit-action', 'lineage-actor', 'lineage-target', 'lineage-source', 'extra-lineage-source', 'missing-version', 'missing-record', 'future-record', 'clinical-claim', 'head-body-change'])('refuses technical history: %s', async scenario => {
    const raw = lineageResponse(); const client = evidenceClient(raw);
    const record = (index: number) => raw.snapshots[1].selected.find(record => record.reference === LINEAGE_HISTORY_SOURCES[index])!;
    if (scenario === 'eight-response') vi.mocked(client.post).mockResolvedValue(evidenceResponse());
    if (scenario === 'wrong-actor') vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'foreign' });
    if (scenario === 'wrong-project') record(8).resource.meta!.project = 'foreign';
    if (scenario === 'receipt-worker') Object.assign(record(8).resource, { for: { reference: 'Patient/foreign' } });
    if (scenario === 'receipt-actor') Object.assign(record(11).resource, { requester: { reference: 'Practitioner/foreign' } });
    if (scenario === 'receipt-focus') Object.assign(record(8).resource, { focus: { reference: HISTORY_SOURCES[2] } });
    if (scenario === 'receipt-output') Object.assign(record(11).resource, { output: [] });
    if (scenario === 'audit-actor') Object.assign(record(9).resource, { agent: [{ who: { reference: 'Practitioner/foreign' }, requestor: true }] });
    if (scenario === 'audit-entity') Object.assign(record(12).resource, { entity: [{ what: { reference: 'Task/foreign' } }] });
    if (scenario === 'audit-action') Object.assign(record(9).resource, { action: 'C' });
    if (scenario === 'lineage-actor') Object.assign(record(13).resource, { agent: [{ who: { reference: 'Practitioner/foreign' } }] });
    if (scenario === 'lineage-target') Object.assign(record(10).resource, { target: [{ reference: 'Task/foreign' }] });
    if (scenario === 'lineage-source') Object.assign(record(13).resource, { entity: [] });
    if (scenario === 'extra-lineage-source' && record(13).resource.resourceType === 'Provenance') {
      const resource = record(13).resource; if (resource.resourceType === 'Provenance') resource.entity!.push({ role: 'source', what: { reference: REPORT_SOURCES[0] } });
    }
    if (scenario === 'missing-version') raw.historyVersions[8].versions.pop();
    if (scenario === 'missing-record') raw.snapshots[1].selected.pop();
    if (scenario === 'future-record') record(8).recordedAt = '2099-01-01T00:00:00.000Z';
    if (scenario === 'clinical-claim') raw.clinicalCompletionVerified = true;
    if (scenario === 'head-body-change') { const original = vi.mocked(client.readResource).getMockImplementation()!;
      vi.mocked(client.readResource).mockImplementation((async (...args: Parameters<typeof client.readResource>) => ({ ...await original(...args), active: false })) as typeof client.readResource); }
    await expect(inspectNativeLineageHistory(client, scenario !== 'unconfirmed')).rejects.toThrow();
  });

  it('keeps technical confirmation independent and displays technical references without direct-read links', async () => {
    const client = evidenceClient(lineageResponse());
    render(<MantineProvider><MedplumProvider medplum={client}><NativeHistory /><NativeEvidenceHistory /><NativeLineageHistory /></MedplumProvider></MantineProvider>);
    expect(client.post).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this is synthetic technical history' }));
    expect(screen.getByRole('button', { name: 'Inspect recorded history' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Inspect synthetic evidence history' })).toBeDisabled();
    const inspect = screen.getByRole('button', { name: 'Inspect synthetic technical history' }); fireEvent.click(inspect); fireEvent.click(inspect);
    expect(await screen.findAllByRole('cell', { name: 'Not recorded' })).toHaveLength(10);
    fireEvent.click(screen.getByRole('tab', { name: 'After synthetic save' }));
    expect(await screen.findByLabelText('Decision receipt reference')).toHaveAttribute('data-reference', LINEAGE_HISTORY_SOURCES[8]);
    expect(screen.queryByRole('link', { name: 'View decision receipt history' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(15); expect(screen.getAllByText('Saved (technical receipt)')).toHaveLength(2);
    expect(screen.getByText('Saved technical receipts are not clinical completion.')).toBeInTheDocument(); expect(client.post).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss technical history' }));
    expect(screen.getByRole('checkbox', { name: 'I confirm this is synthetic technical history' })).not.toBeChecked(); expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  function recordedResponse(asOf = HISTORY_CHECKPOINTS[0]): NativeHistoryResponse {
    const raw = lineageResponse(); raw.mode = 'synthetic-native-recorded-time-inspection'; raw.requestedAsOf = asOf;
    for (const first of raw.snapshots[0].selected) {
      const final = raw.snapshots[1].selected.find(record => record.reference === first.reference);
      if (final) { final.recordedAt = first.recordedAt; final.resource = structuredClone(first.resource); }
    }
    const versions = [...new Map(raw.snapshots.flatMap(snapshot => snapshot.selected).map(record => [record.reference, structuredClone(record)])).values()];
    for (const [index, reference] of LINEAGE_HISTORY_PENDING.entries()) {
      const head = raw.snapshots[1].selected.find(record => record.reference === LINEAGE_HISTORY_SOURCES[index === 0 ? 8 : 11])!;
      const pending = structuredClone(head); pending.reference = reference; pending.recordedAt = new Date(Date.parse(head.recordedAt) - 1).toISOString();
      pending.resource.meta!.versionId = reference.split('/')[3]; pending.resource.meta!.lastUpdated = pending.recordedAt;
      if (pending.resource.resourceType === 'Task') { pending.resource.status = 'in-progress'; delete pending.resource.output; }
      versions.push(pending);
    }
    raw.recordedVersions = versions.map(({ reference, recordedAt }) => ({ reference, recordedAt })).sort((first, second) => first.reference.localeCompare(second.reference));
    const selected = raw.sources.map(source => versions.filter(record => record.reference.split('/')[1] === source.split('/')[1] && record.recordedAt <= asOf)
      .sort((first, second) => first.recordedAt.localeCompare(second.recordedAt)).at(-1)).filter((record): record is typeof versions[number] => Boolean(record))
      .sort((first, second) => first.reference.localeCompare(second.reference));
    raw.selection = { ...structuredClone(raw.snapshots[1]), asOf, selected, excludedFutureVersions: versions.filter(record => record.recordedAt > asOf).length,
      notYetRecorded: raw.sources.filter(source => !selected.some(record => record.reference.split('/')[1] === source.split('/')[1])).map(source => source.split('/').slice(0, 2).join('/')).sort() };
    return raw;
  }

  function ruleResponse(asOf = HISTORY_CHECKPOINTS[0]): NativeHistoryResponse {
    const raw = recordedResponse(asOf); const namespace = 'https://hiivehealth.com/fhir';
    raw.mode = 'synthetic-native-rule-history-inspection'; raw.coverage = 'exact-configured-sixteen-resource-histories-only';
    raw.ruleApprovalVerified = false; raw.sources = [...RULE_HISTORY_SOURCES];
    const records = RULE_HISTORY_SOURCES.slice(14).map((reference, index) => {
      const [type, id, , versionId] = reference.split('/'); const recordedAt = `2026-10-23T17:50:0${index}.000Z`;
      const resource = { resourceType: type, id, meta: { project: OEM_PROJECT_ID, versionId, lastUpdated: recordedAt },
        ...(index === 0 ? { status: 'draft', experimental: true, version: 'matrix-13-draft-2', relatedArtifact: [{ type: 'derived-from', resource: RULE_HISTORY_DOCUMENT }],
          extension: ['baseline-timing', 'periodic-anchor', 'termination-policy', 'enrollment-authority', 'supplementary-policy'].map(code =>
            ({ url: `${namespace}/StructureDefinition/oem-rule-blocker`, extension: [{ url: 'code', valueCode: code }] })) } :
          { status: 'requested', intent: 'proposal', focus: { reference: RULE_HISTORY_SOURCES[14] },
            requester: { reference: RULE_HISTORY_REVIEWER }, owner: { reference: RULE_HISTORY_REVIEWER }, authoredOn: recordedAt,
            code: { coding: [{ system: `${namespace}/CodeSystem/oem-rule-review`, code: 'noise-503' }] },
            input: [{ type: { text: 'Rule fingerprint' }, valueString: RULE_HISTORY_FINGERPRINT }],
            identifier: [{ system: `${namespace}/CodeSystem/oem-rule-review`, value: hash(`${RULE_HISTORY_SOURCES[14]}|${RULE_HISTORY_FINGERPRINT}`) }] }) } as import('@medplum/fhirtypes').Resource;
      return { reference, recordedAt, resource };
    });
    for (const record of records) {
      raw.historyVersions.push({ reference: record.reference.split('/').slice(0, 2).join('/'), versions: [record.reference] });
      raw.recordedVersions!.push({ reference: record.reference, recordedAt: record.recordedAt });
      raw.snapshots[0].notYetRecorded.push(record.reference.split('/').slice(0, 2).join('/')); raw.snapshots[0].excludedFutureVersions++;
      raw.snapshots[1].selected.push(structuredClone(record));
      if (record.recordedAt <= asOf) raw.selection!.selected.push(structuredClone(record));
      else { raw.selection!.notYetRecorded.push(record.reference.split('/').slice(0, 2).join('/')); raw.selection!.excludedFutureVersions++; }
    }
    raw.snapshots[0].notYetRecorded.sort(); raw.snapshots[1].selected.sort((first, second) => first.reference.localeCompare(second.reference));
    raw.selection!.notYetRecorded.sort(); raw.selection!.selected.sort((first, second) => first.reference.localeCompare(second.reference));
    raw.recordedVersions!.sort((first, second) => first.reference.localeCompare(second.reference));
    return raw;
  }

  function matrixRecord(index: number) {
    const binding = MATRIX_HISTORY_METADATA[index]; const [, id, , versionId] = binding.reference.split('/');
    return { reference: binding.reference, recordedAt: binding.recordedAt,
      resource: { resourceType: 'DocumentReference' as const, id, meta: { project: OEM_PROJECT_ID, versionId, lastUpdated: binding.recordedAt }, status: 'current' as const,
        content: [{ attachment: { contentType: 'application/pdf', title: 'Synthetic Matrix metadata',
          ...(index === 0 ? { url: `urn:sha256:${hash('Binary/synthetic-matrix')}` } : {}) } }] } };
  }

  function matrixResponse(asOf = HISTORY_CHECKPOINTS[0]): NativeHistoryResponse {
    const raw = ruleResponse(asOf); const records = MATRIX_HISTORY_METADATA.map((_value, index) => matrixRecord(index));
    raw.mode = 'synthetic-native-matrix-history-inspection'; raw.coverage = 'exact-configured-seventeen-resource-histories-only';
    raw.matrixDocumentMetadataVerified = true; raw.matrixAttachmentContentVerified = false; raw.sources = [...MATRIX_HISTORY_SOURCES];
    raw.historyVersions.push({ reference: RULE_HISTORY_DOCUMENT.split('/').slice(0, 2).join('/'), versions: records.map(record => record.reference).sort() });
    raw.recordedVersions!.push(...records.map(({ reference, recordedAt }) => ({ reference, recordedAt })));
    raw.recordedVersions!.sort((first, second) => first.reference.localeCompare(second.reference));
    raw.snapshots[0].notYetRecorded.push(RULE_HISTORY_DOCUMENT.split('/').slice(0, 2).join('/')); raw.snapshots[0].notYetRecorded.sort(); raw.snapshots[0].excludedFutureVersions += 2;
    raw.snapshots[1].selected.push(records[0]); raw.snapshots[1].selected.sort((first, second) => first.reference.localeCompare(second.reference));
    const selected = records.filter(record => record.recordedAt <= asOf).sort((first, second) => first.recordedAt.localeCompare(second.recordedAt)).at(-1);
    if (selected) raw.selection!.selected.push(structuredClone(selected));
    else raw.selection!.notYetRecorded.push(RULE_HISTORY_DOCUMENT.split('/').slice(0, 2).join('/'));
    raw.selection!.excludedFutureVersions += records.filter(record => record.recordedAt > asOf).length;
    raw.selection!.selected.sort((first, second) => first.reference.localeCompare(second.reference)); raw.selection!.notYetRecorded.sort();
    return raw;
  }

  function mockMatrixFixtureDigests(): void {
    if (vi.isMockFunction(crypto.subtle.digest)) vi.mocked(crypto.subtle.digest).mockRestore();
    const original = crypto.subtle.digest.bind(crypto.subtle);
    const canonical = (value: unknown): string => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child) ?
      Object.fromEntries(Object.entries(child).sort(([first], [second]) => first.localeCompare(second))) : child);
    const fixturePins = new Map(MATRIX_HISTORY_METADATA.map((binding, index) => [canonical(matrixRecord(index).resource), binding.fingerprint]));
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
      const pin = fixturePins.get(Buffer.from(data as Uint8Array).toString('utf8'));
      return pin ? Uint8Array.from(Buffer.from(pin, 'hex')).buffer : original(algorithm, data);
    });
    vi.spyOn(ruleReviewValidation, 'browserRuleFingerprint').mockResolvedValue(RULE_HISTORY_FINGERPRINT);
  }

  afterEach(() => {
    if (vi.isMockFunction(crypto.subtle.digest)) vi.mocked(crypto.subtle.digest).mockRestore();
  });

  it.each(['2000-01-01T00:00:00.000Z', HISTORY_CHECKPOINTS[0], MATRIX_HISTORY_METADATA[1].recordedAt, MATRIX_HISTORY_METADATA[0].recordedAt, LINEAGE_HISTORY_CHECKPOINTS[1]])('verifies seventeen-source Matrix metadata at %s without human document reads', async asOf => {
    mockMatrixFixtureDigests(); const raw = matrixResponse(asOf); const client = evidenceClient(raw);
    const result = await inspectNativeMatrixHistory(client, true, asOf);
    expect(client.post).toHaveBeenCalledWith(`fhir/R4/Bot/${MATRIX_HISTORY_BOT_ID}/$execute`, { mode: 'as-of', confirmedSynthetic: true, asOf }, 'application/json', { maxRetries: 0 });
    expect(client.readResource).toHaveBeenCalledTimes(8); expect(result.selected?.records).toHaveLength(17);
    const row = result.selected?.records.find(record => record.label === 'Matrix metadata');
    const binding = MATRIX_HISTORY_METADATA.filter(record => record.recordedAt <= asOf).sort((first, second) => first.recordedAt.localeCompare(second.recordedAt)).at(-1);
    expect(row).toMatchObject(binding ? { reference: binding.reference, linkable: false } : { status: 'Not recorded' });
    await expect(inspectNativeRuleHistory(client, true, asOf)).rejects.toThrow();
  });

  it.each(['old-service', 'extra-source', 'metadata-claim', 'content-claim', 'altered-current', 'altered-initial', 'signed-url', 'wrong-timestamp', 'missing-version', 'wrong-future-count'])('refuses invalid Matrix metadata: %s', async scenario => {
    mockMatrixFixtureDigests(); const asOf = MATRIX_HISTORY_METADATA[1].recordedAt; const raw = matrixResponse(asOf);
    const current = raw.snapshots[1].selected.find(record => record.reference === RULE_HISTORY_DOCUMENT)!.resource;
    const initial = raw.selection!.selected.find(record => record.reference === MATRIX_HISTORY_METADATA[1].reference)!.resource;
    if (current.resourceType !== 'DocumentReference' || initial.resourceType !== 'DocumentReference') throw new Error('Missing Matrix fixture');
    if (scenario === 'old-service') raw.mode = 'synthetic-native-rule-history-inspection';
    if (scenario === 'extra-source') raw.sources.push('Binary/foreign');
    if (scenario === 'metadata-claim') raw.matrixDocumentMetadataVerified = false;
    if (scenario === 'content-claim') raw.matrixAttachmentContentVerified = true;
    if (scenario === 'altered-current') current.content[0].attachment.title = 'Changed';
    if (scenario === 'altered-initial') initial.content[0].attachment.title = 'Changed';
    if (scenario === 'signed-url') current.content[0].attachment.url = 'https://storage.ehr.hiivehealth.net/binary/foreign?secret=redacted';
    if (scenario === 'wrong-timestamp') raw.recordedVersions!.find(record => record.reference === MATRIX_HISTORY_METADATA[1].reference)!.recordedAt = HISTORY_CHECKPOINTS[0];
    if (scenario === 'missing-version') raw.historyVersions[16].versions.pop();
    if (scenario === 'wrong-future-count') raw.selection!.excludedFutureVersions++;
    await expect(inspectNativeMatrixHistory(evidenceClient(raw), true, asOf)).rejects.toThrow();
  });

  it('requires separate Matrix confirmation and never links document metadata', async () => {
    mockMatrixFixtureDigests(); const client = evidenceClient(matrixResponse());
    vi.mocked(client.post).mockImplementation((async (_url: string, input: { asOf: string }) => matrixResponse(input.asOf)) as typeof client.post);
    render(<MantineProvider><MedplumProvider medplum={client}><NativeRuleHistory /><NativeMatrixHistory /></MedplumProvider></MantineProvider>);
    expect(client.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Matrix-history instant (UTC)'), { target: { value: MATRIX_HISTORY_METADATA[1].recordedAt.slice(0, -1) } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this is synthetic Matrix history' }));
    expect(screen.getByRole('button', { name: 'Inspect rule history' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Matrix history' }));
    expect(await screen.findByText('Initial metadata (no attachment)')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View matrix metadata history' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Matrix metadata reference')).toHaveAttribute('data-reference', MATRIX_HISTORY_METADATA[1].reference);
    fireEvent.change(screen.getByLabelText('Matrix-history instant (UTC)'), { target: { value: MATRIX_HISTORY_METADATA[0].recordedAt.slice(0, -1) } });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'I confirm this is synthetic Matrix history' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this is synthetic Matrix history' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Matrix history' }));
    expect(await screen.findByText('Linked metadata (PDF bytes unverified)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Matrix history' }));
    expect(screen.getByRole('checkbox', { name: 'I confirm this is synthetic Matrix history' })).not.toBeChecked();
  });

  it('rejects unconfirmed or noncanonical Matrix instants before requests', async () => {
    const client = evidenceClient(matrixResponse());
    await expect(inspectNativeMatrixHistory(client, false, HISTORY_CHECKPOINTS[0])).rejects.toThrow();
    await expect(inspectNativeMatrixHistory(client, true, '2026-10-21')).rejects.toThrow(); expect(client.post).not.toHaveBeenCalled();
  });

  it.each(['2000-01-01T00:00:00.000Z', HISTORY_CHECKPOINTS[0], '2026-10-23T17:50:00.000Z', '2026-10-23T17:50:01.000Z', LINEAGE_HISTORY_CHECKPOINTS[1]])('validates sixteen-source rule history at %s without human rule reads', async asOf => {
    vi.spyOn(ruleReviewValidation, 'browserRuleFingerprint').mockResolvedValue(RULE_HISTORY_FINGERPRINT);
    const raw = ruleResponse(asOf); const client = evidenceClient(raw); const result = await inspectNativeRuleHistory(client, true, asOf);
    expect(client.post).toHaveBeenCalledWith(`fhir/R4/Bot/${RULE_HISTORY_BOT_ID}/$execute`, { mode: 'as-of', confirmedSynthetic: true, asOf }, 'application/json', { maxRetries: 0 });
    expect(result.selected?.records).toHaveLength(16); expect(client.readResource).toHaveBeenCalledTimes(8);
    for (const [index, label] of ['Rule draft', 'Rule review'].entries()) {
      const present = raw.recordedVersions!.find(record => record.reference === RULE_HISTORY_SOURCES[14 + index])!.recordedAt <= asOf;
      expect(result.selected?.records.find(record => record.label === label)).toMatchObject(present ?
        { reference: RULE_HISTORY_SOURCES[14 + index], linkable: false, status: index === 0 ? 'Draft (unapproved rule)' : 'Requested (rule review)' } : { status: 'Not recorded' });
    }
    await expect(inspectNativeRecordedTime(client, true, asOf)).rejects.toThrow();
  });

  it.each(['old-service', 'approval-claim', 'active-rule', 'missing-blocker', 'wrong-document', 'fingerprint', 'completed-review', 'wrong-focus',
    'wrong-owner', 'wrong-input', 'wrong-identifier', 'patient-review', 'review-output', 'missing-timestamp', 'missing-row', 'changed-selection', 'future-count'])('refuses invalid sixteen-source rule evidence: %s', async scenario => {
    const fingerprint = vi.spyOn(ruleReviewValidation, 'browserRuleFingerprint').mockResolvedValue(RULE_HISTORY_FINGERPRINT);
    const raw = ruleResponse(LINEAGE_HISTORY_CHECKPOINTS[1]); const client = evidenceClient(raw);
    const rule = raw.snapshots[1].selected.find(record => record.reference === RULE_HISTORY_SOURCES[14])!.resource;
    const review = raw.snapshots[1].selected.find(record => record.reference === RULE_HISTORY_SOURCES[15])!.resource;
    if (rule.resourceType !== 'PlanDefinition' || review.resourceType !== 'Task') throw new Error('Missing rule fixture');
    if (scenario === 'old-service') raw.mode = 'synthetic-native-recorded-time-inspection';
    if (scenario === 'approval-claim') raw.ruleApprovalVerified = true;
    if (scenario === 'active-rule') rule.status = 'active';
    if (scenario === 'missing-blocker') rule.extension!.pop();
    if (scenario === 'wrong-document') rule.relatedArtifact![0].resource = REPORT_SOURCES[3];
    if (scenario === 'fingerprint') fingerprint.mockResolvedValue('0'.repeat(64));
    if (scenario === 'completed-review') review.status = 'completed';
    if (scenario === 'wrong-focus') review.focus = { reference: RULE_HISTORY_SOURCES[14].replace('bd1e5de5', 'foreign') };
    if (scenario === 'wrong-owner') review.owner = { reference: REPORT_CLINICIAN };
    if (scenario === 'wrong-input') review.input![0].valueString = '0'.repeat(64);
    if (scenario === 'wrong-identifier') review.identifier![0].value = '0'.repeat(64);
    if (scenario === 'patient-review') review.for = { reference: worker };
    if (scenario === 'review-output') review.output = [{ type: { text: 'approval' }, valueBoolean: true }];
    if (scenario === 'missing-timestamp') raw.recordedVersions!.pop();
    if (scenario === 'missing-row') raw.snapshots[1].selected.pop();
    if (scenario === 'changed-selection') Object.assign(raw.selection!.selected.find(record => record.reference === RULE_HISTORY_SOURCES[14])!.resource, { status: 'active' });
    if (scenario === 'future-count') raw.selection!.excludedFutureVersions++;
    await expect(inspectNativeRuleHistory(client, true, LINEAGE_HISTORY_CHECKPOINTS[1])).rejects.toThrow();
  });

  it('requires independent rule confirmation, clears results on time change and never links rule resources', async () => {
    vi.spyOn(ruleReviewValidation, 'browserRuleFingerprint').mockResolvedValue(RULE_HISTORY_FINGERPRINT);
    const client = evidenceClient(ruleResponse());
    vi.mocked(client.post).mockImplementation((async (_url: string, input: { asOf: string }) => ruleResponse(input.asOf)) as typeof client.post);
    render(<MantineProvider><MedplumProvider medplum={client}><NativeRecordedTime /><NativeRuleHistory /></MedplumProvider></MantineProvider>);
    expect(client.post).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this is synthetic rule history' }));
    expect(screen.getByRole('button', { name: 'Inspect selected recorded time' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect rule history' })); fireEvent.click(screen.getByRole('button', { name: 'Inspect rule history' }));
    expect(await screen.findAllByRole('cell', { name: 'Not recorded' })).toHaveLength(12); expect(client.post).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Rule-history instant (UTC)'), { target: { value: LINEAGE_HISTORY_CHECKPOINTS[1].slice(0, -1) } });
    const fresh = screen.getByRole('checkbox', { name: 'I confirm this is synthetic rule history' }); expect(fresh).not.toBeChecked(); expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(fresh); fireEvent.click(screen.getByRole('button', { name: 'Inspect rule history' }));
    expect(await screen.findByText('Draft (unapproved rule)')).toBeInTheDocument(); expect(screen.getByText('Requested (rule review)')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View rule draft history' })).not.toBeInTheDocument(); expect(screen.getByLabelText('Rule draft reference')).toHaveAttribute('data-reference', RULE_HISTORY_SOURCES[14]);
    expect(screen.getByText('Rule approval: unverified. Referenced Matrix document: not inspected.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss rule history' }));
    expect(screen.getByRole('checkbox', { name: 'I confirm this is synthetic rule history' })).not.toBeChecked(); expect(client.post).toHaveBeenCalledTimes(2);
  });

  it('refuses unconfirmed or noncanonical rule instants without sending requests', async () => {
    const client = evidenceClient(ruleResponse()); await expect(inspectNativeRuleHistory(client, false, HISTORY_CHECKPOINTS[0])).rejects.toThrow();
    await expect(inspectNativeRuleHistory(client, true, '2026-10-23')).rejects.toThrow(); expect(client.post).not.toHaveBeenCalled();
  });

  it.each(['2000-01-01T00:00:00.000Z', HISTORY_CHECKPOINTS[0], '2026-10-23T20:06:37.675Z', LINEAGE_HISTORY_CHECKPOINTS[1]])('verifies selected recorded instant %s without broadening fixed adapters', async asOf => {
    const client = evidenceClient(recordedResponse(asOf)); const result = await inspectNativeRecordedTime(client, true, asOf);
    expect(client.post).toHaveBeenCalledWith(`fhir/R4/Bot/${RECORDED_TIME_BOT_ID}/$execute`, { mode: 'as-of', confirmedSynthetic: true, asOf }, 'application/json', { maxRetries: 0 });
    expect(result.selected?.asOf).toBe(asOf); expect(result.selected?.records).toHaveLength(14); expect(client.readResource).toHaveBeenCalledTimes(8);
    if (asOf.startsWith('2000')) expect(result.selected?.records.every(record => record.status === 'Not recorded')).toBe(true);
    if (asOf.endsWith('37.675Z')) expect(result.selected?.records.filter(record => record.status === 'Pending (technical receipt)')).toHaveLength(2);
    await expect(inspectNativeLineageHistory(client, true)).rejects.toThrow();
  });

  it.each(['fixed-response', 'wrong-instant', 'future', 'missing-timestamp', 'duplicate-timestamp', 'missing-selection', 'future-body',
    'changed-body', 'pending-output', 'pending-actor', 'false-claim', 'missing-row', 'wrong-missing', 'wrong-future-count'])('refuses recorded-time evidence: %s', async scenario => {
    const asOf = '2026-10-23T20:06:37.675Z'; const raw = recordedResponse(asOf); const client = evidenceClient(raw);
    if (scenario === 'fixed-response') raw.mode = 'synthetic-native-lineage-history-inspection';
    if (scenario === 'wrong-instant') raw.requestedAsOf = HISTORY_CHECKPOINTS[0];
    if (scenario === 'future') raw.inspectedAt = HISTORY_CHECKPOINTS[0];
    if (scenario === 'missing-timestamp') raw.recordedVersions!.pop();
    if (scenario === 'duplicate-timestamp') raw.recordedVersions![0].reference = raw.recordedVersions![1].reference;
    if (scenario === 'missing-selection') delete raw.selection;
    if (scenario === 'future-body') raw.selection!.selected.push(structuredClone(raw.snapshots[1].selected[0]));
    if (scenario === 'changed-body') raw.selection!.selected[0].resource.meta!.project = 'foreign';
    const pending = raw.selection?.selected.find(record => record.reference === LINEAGE_HISTORY_PENDING[0])?.resource;
    if (scenario === 'pending-output') Object.assign(pending!, { output: [{ type: { text: 'audit' }, valueReference: { reference: LINEAGE_HISTORY_SOURCES[9] } }] });
    if (scenario === 'pending-actor') Object.assign(pending!, { requester: { reference: 'Practitioner/foreign' } });
    if (scenario === 'false-claim') raw.selection!.clinicalCompletionVerified = true;
    if (scenario === 'missing-row') raw.selection!.selected.pop();
    if (scenario === 'wrong-missing') raw.selection!.notYetRecorded = [];
    if (scenario === 'wrong-future-count') raw.selection!.excludedFutureVersions = 0;
    await expect(inspectNativeRecordedTime(client, true, asOf)).rejects.toThrow();
  });

  it('requires canonical time and confirmation before sending a selectable request', async () => {
    const client = evidenceClient(recordedResponse());
    await expect(inspectNativeRecordedTime(client, false, HISTORY_CHECKPOINTS[0])).rejects.toThrow();
    await expect(inspectNativeRecordedTime(client, true, '2026-10-21')).rejects.toThrow(); expect(client.post).not.toHaveBeenCalled();
  });

  it('clears selected history and confirmation on a new UTC instant without auto-reading or confirming fixed history', async () => {
    const client = evidenceClient(recordedResponse());
    vi.mocked(client.post).mockImplementation((async (_url: string, input: { asOf: string }) => recordedResponse(input.asOf)) as typeof client.post);
    render(<MantineProvider><MedplumProvider medplum={client}><NativeLineageHistory /><NativeRecordedTime /></MedplumProvider></MantineProvider>);
    expect(client.post).not.toHaveBeenCalled(); const confirm = screen.getByRole('checkbox', { name: 'I confirm this is synthetic recorded-time inspection' });
    fireEvent.click(confirm); expect(screen.getByRole('button', { name: 'Inspect synthetic technical history' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect selected recorded time' }));
    expect(await screen.findAllByRole('cell', { name: 'Not recorded' })).toHaveLength(10);
    fireEvent.change(screen.getByLabelText('Recorded instant (UTC)'), { target: { value: '2026-10-23T20:06:37.675' } });
    const freshConfirm = screen.getByRole('checkbox', { name: 'I confirm this is synthetic recorded-time inspection' });
    expect(freshConfirm).not.toBeChecked(); expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(client.post).toHaveBeenCalledTimes(1);
    fireEvent.click(freshConfirm); fireEvent.click(screen.getByRole('button', { name: 'Inspect selected recorded time' }));
    expect(await screen.findAllByText('Pending (technical receipt)')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss selected history' }));
    expect(screen.getByRole('checkbox', { name: 'I confirm this is synthetic recorded-time inspection' })).not.toBeChecked();
    expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(client.post).toHaveBeenCalledTimes(2);
  });

  it('separately validates eight histories and exact bound synthetic evidence without broadening the four-source API', async () => {
    const client = evidenceClient(); const result = await inspectNativeEvidenceHistory(client, true);
    expect(client.post).toHaveBeenCalledWith(`fhir/R4/Bot/${EVIDENCE_HISTORY_BOT_ID}/$execute`, { mode: 'history', confirmedSynthetic: true }, 'application/json', { maxRetries: 0 });
    expect(client.readResource).toHaveBeenCalledTimes(8); expect(result.checkpoints[0].records).toHaveLength(8);
    expect(result.checkpoints[0].records.filter(record => record.status === 'Not recorded')).toHaveLength(4);
    expect(result.checkpoints[1].records.find(record => record.label === 'Synthetic attestation')).toMatchObject({ reference: EVIDENCE_HISTORY_SOURCES[6], status: 'final' });
    await expect(inspectNativeHistory(client, true)).rejects.toThrow();
  });

  it('keeps evidence confirmation independent and displays eight exact records before/after synthetic attestation', async () => {
    const client = evidenceClient();
    render(<MantineProvider><MedplumProvider medplum={client}><NativeHistory /><NativeEvidenceHistory /></MedplumProvider></MantineProvider>);
    expect(client.post).not.toHaveBeenCalled();
    const inspect = screen.getByRole('button', { name: 'Inspect synthetic evidence history' }); expect(inspect).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this is synthetic evidence history' }));
    expect(screen.getByRole('button', { name: 'Inspect recorded history' })).toBeDisabled();
    fireEvent.click(inspect); fireEvent.click(inspect);
    expect(await screen.findAllByRole('cell', { name: 'Not recorded' })).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'View rule source history' })).toHaveAttribute('href', `/${EVIDENCE_HISTORY_SOURCES[5]}`);
    fireEvent.click(screen.getByRole('tab', { name: 'After synthetic attestation' }));
    expect(await screen.findByRole('link', { name: 'View synthetic attestation history' })).toHaveAttribute('href', `/${EVIDENCE_HISTORY_SOURCES[6]}`);
    expect(screen.getByRole('link', { name: 'View synthetic report history' })).toHaveAttribute('href', `/${EVIDENCE_HISTORY_SOURCES[7]}`);
    expect(screen.getAllByRole('row')).toHaveLength(9); expect(client.post).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss evidence history' }));
    expect(inspect).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Inspect synthetic evidence history' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'I confirm this is synthetic evidence history' })).not.toBeChecked();
    expect(client.post).toHaveBeenCalledTimes(1);
  });

  it('ignores a late evidence response after remount and never displays a malformed response', async () => {
    const client = evidenceClient(); let resolve: (value: NativeHistoryResponse) => void = () => {};
    vi.mocked(client.post).mockReturnValue(new Promise(value => { resolve = value; }));
    const view = (key: string) => <MantineProvider><MedplumProvider medplum={client}><NativeEvidenceHistory key={key} /></MedplumProvider></MantineProvider>;
    const mounted = render(view('original'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this is synthetic evidence history' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect synthetic evidence history' }));
    mounted.rerender(view('new-scope')); await act(async () => { resolve(evidenceResponse()); });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'I confirm this is synthetic evidence history' })).not.toBeChecked();
    vi.mocked(client.post).mockResolvedValue({});
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this is synthetic evidence history' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect synthetic evidence history' }));
    expect(await screen.findByText('History unavailable')).toBeInTheDocument(); expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it.each(['four-source-response', 'unconfirmed', 'wrong-worker', 'wrong-enrollment', 'wrong-clinician', 'wrong-task', 'wrong-proposal', 'wrong-report',
    'unlabelled', 'wrong-report-date', 'partial', 'invented-checkpoint', 'future-issued', 'head-body-change', 'clinical-claim'])('refuses extended evidence: %s', async scenario => {
    const raw = evidenceResponse(); const client = evidenceClient(raw);
    const enrollment = raw.snapshots[1].selected.find(record => record.reference === EVIDENCE_HISTORY_SOURCES[4])!.resource;
    const attestation = raw.snapshots[1].selected.find(record => record.reference === EVIDENCE_HISTORY_SOURCES[6])!.resource;
    const report = raw.snapshots[1].selected.find(record => record.reference === EVIDENCE_HISTORY_SOURCES[7])!.resource;
    if (scenario === 'four-source-response') vi.mocked(client.post).mockResolvedValue(historyResponse());
    if (scenario === 'wrong-worker') Object.assign(report, { subject: { reference: 'Patient/foreign' } });
    if (scenario === 'wrong-enrollment') Object.assign(enrollment, { focus: [{ reference: 'Observation/foreign' }] });
    if (scenario === 'wrong-clinician') Object.assign(attestation, { performer: [{ reference: 'Practitioner/foreign' }] });
    if (scenario === 'wrong-task') Object.assign(attestation, { focus: [{ reference: 'Task/foreign' }] });
    if (scenario === 'wrong-proposal') Object.assign(attestation, { basedOn: [{ reference: 'ServiceRequest/foreign' }] });
    if (scenario === 'wrong-report') Object.assign(attestation, { derivedFrom: [{ reference: 'DocumentReference/foreign' }] });
    if (scenario === 'unlabelled') attestation.meta!.tag = [];
    if (scenario === 'wrong-report-date' && report.resourceType === 'DocumentReference') report.context!.period!.start = '2026-06-14';
    if (scenario === 'partial') raw.snapshots[1].selected.pop();
    if (scenario === 'invented-checkpoint') raw.snapshots[1].asOf = HISTORY_CHECKPOINTS[1];
    if (scenario === 'future-issued') Object.assign(attestation, { issued: '2099-01-01T00:00:00.000Z' });
    if (scenario === 'clinical-claim') raw.clinicalCompletionVerified = true;
    if (scenario === 'head-body-change') { const original = vi.mocked(client.readResource).getMockImplementation()!;
      vi.mocked(client.readResource).mockImplementation((async (...args: Parameters<typeof client.readResource>) => ({ ...await original(...args), active: false })) as typeof client.readResource); }
    await expect(inspectNativeEvidenceHistory(client, scenario !== 'unconfirmed')).rejects.toThrow();
  });

  it('requires confirmation and exact clinician before submission', async () => {
    const client = historyClient(); await expect(inspectNativeHistory(client, false)).rejects.toThrow();
    vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other' });
    await expect(inspectNativeHistory(client, true)).rejects.toThrow(); expect(client.post).not.toHaveBeenCalled();
  });

  it('shows confirmed before/after exact links, suppresses rapid clicks and dismisses without another read', async () => {
    const client = historyClient();
    render(<MantineProvider><MedplumProvider medplum={client}><NativeHistory /></MedplumProvider></MantineProvider>);
    const inspect = screen.getByRole('button', { name: 'Inspect recorded history' }); expect(inspect).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this is a synthetic history' }));
    fireEvent.click(inspect); fireEvent.click(inspect);
    expect(await screen.findByRole('cell', { name: 'requested' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View recommendation history' })).toHaveAttribute('href', `/${HISTORY_REQUESTED}`);
    expect(screen.getByRole('cell', { name: 'Not recorded' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'After acceptance' }));
    expect(await screen.findByRole('cell', { name: 'accepted' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View local proposal history' })).toHaveAttribute('href', `/${HISTORY_SOURCES[3]}`);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss history' }));
    expect(screen.getByRole('button', { name: 'Inspect recorded history' })).toBeDisabled(); expect(client.post).toHaveBeenCalledTimes(1);
  });

  it('refuses malformed history without displaying a table or performing head reads', async () => {
    const client = historyClient(); vi.mocked(client.post).mockResolvedValue({});
    render(<MantineProvider><MedplumProvider medplum={client}><NativeHistory /></MedplumProvider></MantineProvider>);
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this is a synthetic history' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect recorded history' }));
    expect(await screen.findByText('History unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(client.readResource).not.toHaveBeenCalled();
  });

  it('ignores a late history response after scope remount and requires a fresh confirmation', async () => {
    const client = historyClient(); let resolve: (value: NativeHistoryResponse) => void = () => {};
    vi.mocked(client.post).mockReturnValue(new Promise(value => { resolve = value; }));
    const view = (key: string) => <MantineProvider><MedplumProvider medplum={client}><NativeHistory key={key} /></MedplumProvider></MantineProvider>;
    const mounted = render(view('original'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this is a synthetic history' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect recorded history' }));
    mounted.rerender(view('new-scope'));
    await act(async () => { resolve(historyResponse()); });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'I confirm this is a synthetic history' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Inspect recorded history' })).toBeDisabled();
  });

  it.each(['wrong-source', 'wrong-checkpoint', 'wrong-version', 'wrong-worker', 'future-version', 'wrong-status', 'completion-claim', 'partial',
    'wrong-project', 'future-body', 'wrong-manifest', 'changed-head', 'changed-actor'])('refuses %s', async scenario => {
    const client = historyClient(); const raw = historyResponse();
    if (scenario === 'wrong-source') raw.sources[0] = 'Patient/other/_history/one';
    if (scenario === 'wrong-checkpoint') raw.snapshots[0].asOf = HISTORY_CHECKPOINTS[1];
    if (scenario === 'wrong-version') raw.snapshots[0].selected[0].resource.meta!.versionId = 'changed';
    if (scenario === 'wrong-worker') Object.assign(raw.snapshots[0].selected[0].resource, { subject: { reference: 'Patient/other' } });
    if (scenario === 'future-version') raw.snapshots[0].selected[0].recordedAt = HISTORY_CHECKPOINTS[1];
    if (scenario === 'wrong-status') Object.assign(raw.snapshots[1].selected.find(record => record.resource.resourceType === 'Task')!.resource, { status: 'completed' });
    if (scenario === 'completion-claim') raw.clinicalCompletionVerified = true;
    if (scenario === 'partial') raw.snapshots[1].selected.pop();
    if (scenario === 'wrong-project') raw.snapshots[0].projectId = 'foreign';
    if (scenario === 'future-body') raw.snapshots[0].selected.push(raw.snapshots[1].selected.find(record => record.resource.resourceType === 'ServiceRequest')!);
    if (scenario === 'wrong-manifest') raw.historyVersions[2].versions.pop();
    if (scenario === 'changed-head') vi.mocked(client.readResource).mockResolvedValue({ resourceType: 'Patient', id: LIFECYCLE_WORKER_ID, meta: { project: OEM_PROJECT_ID, versionId: 'changed' } });
    vi.mocked(client.post).mockImplementation(async () => {
      if (scenario === 'changed-actor') vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other' });
      return raw;
    });
    await expect(inspectNativeHistory(client, true)).rejects.toThrow();
  });
});

describe('scoped native report validation and local downloads', () => {
  let client: MockClient;
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('TextEncoder', TextEncoder);
    client = new MockClient();
    vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    vi.spyOn(client, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: REPORT_CLINICIAN.split('/')[1] });
    vi.spyOn(client, 'readResource').mockImplementation(((type: string, id: string) => {
      const reference = [...REPORT_SOURCES, ...COMPLETION_SOURCES].find(value => value.startsWith(`${type}/${id}/`));
      if (!reference) throw new Error('Out-of-manifest client read');
      const enrollmentIndex = COHORT_WORKERS.findIndex(worker => worker.enrollment === reference);
      const example = COMPLETION_EXAMPLES.find(example => [example.record, example.evidence].includes(reference));
      return Promise.resolve({ resourceType: type, id, meta: { project: OEM_PROJECT_ID, versionId: reference.split('/')[3] },
        ...(enrollmentIndex >= 0 ? { status: 'final', subject: { reference: COHORT_WORKERS[enrollmentIndex].worker.split('/').slice(0, 2).join('/') },
          derivedFrom: [{ reference: `DocumentReference/cohort-enrollment-${enrollmentIndex + 1}/_history/one` }] } : {}),
        ...(example ? { status: type === 'Observation' ? 'final' : 'current', subject: { reference: example.patient },
          ...(type === 'Observation' ? { effectiveDateTime: example.performedOn, derivedFrom: [{ reference: example.evidence }] } : {}) } : {}) });
    }) as typeof client.readResource);
  });
  afterEach(() => vi.unstubAllGlobals());
  const mount = () => render(<MantineProvider><MedplumProvider medplum={client}><NativeReport /></MedplumProvider></MantineProvider>);

  it('verifies two illustrative examples, three workers and 13 heads with clinical completion unverified', async () => {
    const post = vi.spyOn(client, 'post').mockResolvedValue(completionResponse());
    const report = await generateNativeCompletionReport(client, true);
    expect(report.cohortRows!.filter(row => row.completion)).toHaveLength(2);
    expect(report.cohortRows!.slice(0, 2).map(row => row.due)).toEqual(['2027-06-15', '2027-06-15']);
    expect(report.cohortRows![2]).toMatchObject({ timing: 'needs-review', due: '' });
    expect(report.cohortRows![2].completion).toBeUndefined(); expect(client.readResource).toHaveBeenCalledTimes(13);
    expect(report.manifest).toMatchObject({ clinicalCompletionVerified: false, syntheticCompletionExamples: COMPLETION_EXAMPLES });
    expect(post).toHaveBeenCalledExactlyOnceWith(`fhir/R4/Bot/${COMPLETION_REPORT_BOT_ID}/$execute`, { mode: 'export', confirmedSynthetic: true }, 'application/json', { maxRetries: 0 });
    await expect(generateNativeCompletionReport(client, false)).rejects.toThrow('confirmation'); expect(post).toHaveBeenCalledTimes(1);
  });

  it.each(['old-envelope', 'drop-worker', 'extra-example', 'example-date', 'example-clinical', 'example-record', 'manifest-example', 'counts',
    'csv-date', 'csv-clinical', 'drop-lineage', 'invent-review-due', 'missing-source', 'head', 'actor'])('refuses unsafe completion report: %s', async scenario => {
    const raw = completionResponse(); const example = raw.syntheticCompletionExamples![0];
    if (scenario === 'old-envelope') raw.mode = 'synthetic-cohort-report-export';
    if (scenario === 'drop-worker') raw.report.workers.pop();
    if (scenario === 'extra-example') raw.syntheticCompletionExamples!.push(structuredClone(example));
    if (scenario === 'example-date') example.illustrativeNextPeriodicOn = '2027-12-31';
    if (scenario === 'example-clinical') example.clinicalCompletionVerified = true;
    if (scenario === 'example-record') example.record = 'Observation/other/_history/one';
    if (scenario === 'manifest-example') raw.export.manifest.syntheticCompletionExamples = [];
    if (scenario === 'counts') raw.export.manifest.syntheticTimingCounts = { current: 3 };
    if (scenario === 'csv-date') raw.export.csv = raw.export.csv.replace('2027-06-15', '2027-12-31');
    if (scenario === 'csv-clinical') raw.export.csv = raw.export.csv.replace('"false","false","false","false"', '"false","false","true","false"');
    if (scenario === 'drop-lineage') raw.report.workers.find(worker => worker.patient === example.patient)!.obligations[0].evaluation.result.supportingInfo.pop();
    if (scenario === 'invent-review-due') raw.report.workers.find(worker => worker.patient === COHORT_WORKERS[2].worker.split('/').slice(0, 2).join('/'))!.obligations[0].evaluation.due = '2027-06-15';
    if (scenario === 'missing-source') raw.sources.pop();
    if (scenario === 'head') vi.mocked(client.readResource).mockResolvedValue({ resourceType: 'Observation', id: 'other', status: 'final', code: { text: 'Wrong exact head' }, meta: { project: OEM_PROJECT_ID, versionId: 'changed' } });
    if (scenario === 'actor') vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other' });
    raw.export.manifest.csvSha256 = hash(raw.export.csv); vi.spyOn(client, 'post').mockResolvedValue(raw);
    await expect(generateNativeCompletionReport(client, true)).rejects.toThrow();
  });

  it('requires fresh confirmation for Examples and displays illustrative dates and exact evidence links', async () => {
    const post = vi.spyOn(client, 'post').mockResolvedValue(completionResponse()); mount();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('radio', { name: 'Examples' }));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Generate synthetic report' }));
    await screen.findByText('Synthetic-1 - current - Illustrative periodic due 2027-06-15');
    expect(screen.getAllByText('Synthetic example performed 2026-06-15. Clinical completion unverified.')).toHaveLength(2);
    expect(screen.getByText('Synthetic-3 - needs-review - No configured enrollment')).toBeInTheDocument();
    for (const [index, example] of COMPLETION_EXAMPLES.entries()) {
      expect(screen.getByRole('link', { name: `View Synthetic-${index + 1} example` })).toHaveAttribute('href', `/${example.record}`);
      expect(screen.getByRole('link', { name: `View Synthetic-${index + 1} evidence` })).toHaveAttribute('href', `/${example.evidence}`);
    }
    expect(post).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('radio', { name: 'Three workers' }));
    expect(screen.queryByRole('button', { name: 'Download synthetic CSV' })).not.toBeInTheDocument(); expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('validates all three exact worker rows, missing enrollment and nine heads without completion claims', async () => {
    const post = vi.spyOn(client, 'post').mockResolvedValue(cohortResponse());
    const report = await generateNativeCohortReport(client, true);
    expect(report.cohortRows).toHaveLength(3); expect(report.cohortRows![2]).toMatchObject({ label: 'Synthetic-3', timing: 'needs-review', due: '' });
    expect(report.cohortRows![2].enrollment).toBeUndefined(); expect(client.readResource).toHaveBeenCalledTimes(9);
    expect(report.checksum).toBe(hash(report.csv));
    expect(post).toHaveBeenCalledExactlyOnceWith(`fhir/R4/Bot/${COHORT_REPORT_BOT_ID}/$execute`, { mode: 'export', confirmedSynthetic: true }, 'application/json', { maxRetries: 0 });
    await expect(generateNativeCohortReport(client, false)).rejects.toThrow('confirmation'); expect(post).toHaveBeenCalledTimes(1);
  });

  it.each(['drop-worker', 'duplicate-worker', 'foreign-worker', 'hide-review', 'invent-due', 'csv-worker', 'csv-extra-row', 'formula', 'counts', 'hash', 'extra-manifest', 'support', 'completion', 'source', 'head', 'actor'])('refuses unsafe cohort response: %s', async scenario => {
    const raw = cohortResponse(); const missing = raw.report.workers.find(worker => worker.patient === COHORT_WORKERS[2].worker.split('/').slice(0, 2).join('/'))!;
    if (scenario === 'drop-worker') raw.report.workers.pop();
    if (scenario === 'duplicate-worker') raw.report.workers[1].patient = raw.report.workers[0].patient;
    if (scenario === 'foreign-worker') raw.report.workers[0].patient = 'Patient/other';
    if (scenario === 'hide-review') missing.obligations[0].evaluation.status = 'current';
    if (scenario === 'invent-due') missing.obligations[0].evaluation.due = '2027-01-01';
    if (scenario === 'csv-worker') raw.export.csv = raw.export.csv.replaceAll(raw.report.workers[0].patient, 'Patient/other');
    if (scenario === 'csv-extra-row') raw.export.csv += raw.export.csv.split('\r\n')[1] + '\r\n';
    if (scenario === 'formula') raw.export.csv = raw.export.csv.replace('"baseline"', '"=1+1"');
    if (scenario === 'counts') raw.export.manifest.suppliedObligations = 2;
    if (scenario === 'extra-manifest') raw.export.manifest.narrative = 'Not permitted';
    if (scenario === 'support') missing.obligations[0].evaluation.result.supportingInfo.push({ reference: 'DocumentReference/other' });
    if (scenario === 'completion') raw.clinicalCompletionVerified = true;
    if (scenario === 'source') raw.sources.pop();
    if (scenario === 'head') vi.mocked(client.readResource).mockResolvedValue({ resourceType: 'Patient', id: 'other', meta: { project: OEM_PROJECT_ID, versionId: 'changed' } });
    if (scenario === 'actor') vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other' });
    raw.export.manifest.csvSha256 = scenario === 'hash' ? '0'.repeat(64) : hash(raw.export.csv);
    vi.spyOn(client, 'post').mockResolvedValue(raw);
    await expect(generateNativeCohortReport(client, true)).rejects.toThrow();
  });

  it('requires fresh confirmation when changing report scope and shows the retained missing-enrollment worker', async () => {
    const post = vi.spyOn(client, 'post').mockResolvedValue(cohortResponse()); mount();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('radio', { name: 'Three workers' }));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Generate synthetic report' }));
    await screen.findByText(/3 supplied workers - 3 supplied obligations/);
    expect(screen.getByText('Synthetic-3 - needs-review - No configured enrollment')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View Synthetic-3 enrollment' })).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('radio', { name: 'Selected worker' }));
    expect(screen.queryByRole('button', { name: 'Download synthetic CSV' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('sends only the confirmed export envelope and verifies CSV/manifest plus current exact source heads', async () => {
    const post = vi.spyOn(client, 'post').mockResolvedValue(response());
    const result = await generateNativeReport(client, true);
    expect(result).toMatchObject({ actor: REPORT_CLINICIAN, asOf: '2026-10-24', due: '2026-01-01', timing: 'overdue' });
    expect(result.checksum).toBe(hash(result.csv)); expect(client.readResource).toHaveBeenCalledTimes(4);
    expect(post).toHaveBeenCalledExactlyOnceWith(`fhir/R4/Bot/${NATIVE_REPORT_BOT_ID}/$execute`, { mode: 'export', confirmedSynthetic: true }, 'application/json', { maxRetries: 0 });
    await expect(generateNativeReport(client, false)).rejects.toThrow('confirmation'); expect(post).toHaveBeenCalledTimes(1);
  });

  it.each(['worker', 'csv-worker', 'csv-extra-row', 'csv-header', 'csv-formula', 'hash', 'clinical', 'source', 'counts', 'manifest', 'as-of', 'evidence', 'oversize', 'completion'])('refuses unsafe native export: %s', async scenario => {
    const raw = response();
    if (scenario === 'worker') raw.report.workers[0].patient = 'Patient/other';
    if (scenario === 'csv-worker') raw.export.csv = raw.export.csv.replaceAll(worker, 'Patient/other');
    if (scenario === 'csv-extra-row') raw.export.csv += raw.export.csv.split('\r\n')[1] + '\r\n';
    if (scenario === 'csv-header') raw.export.csv = raw.export.csv.replace('demo_mode', 'unknown-column');
    if (scenario === 'csv-formula') raw.export.csv = raw.export.csv.replace('"baseline"', '"=1+1"');
    if (scenario === 'clinical') raw.clinicalCompletionVerified = true;
    if (scenario === 'source') raw.sources[0] = 'Patient/other/_history/one';
    if (scenario === 'counts') raw.report.syntheticTimingCounts.overdue = 5;
    if (scenario === 'manifest') raw.export.manifest.sourceNarrative = 'Unexpected data';
    if (scenario === 'as-of') raw.report.asOf = '2000-01-01';
    if (scenario === 'evidence') raw.report.workers[0].obligations[0].evaluation.result.supportingInfo[3].reference = 'Patient/other';
    if (scenario === 'oversize') raw.export.csv = 'x'.repeat(1_000_001);
    if (scenario === 'completion') raw.completionCoverage = 'verified';
    raw.export.manifest.csvSha256 = scenario === 'hash' ? '0'.repeat(64) : hash(raw.export.csv);
    const post = vi.spyOn(client, 'post').mockResolvedValue(raw);
    await expect(generateNativeReport(client, true)).rejects.toThrow(); expect(post).toHaveBeenCalledTimes(1);
  });

  it.each(['project', 'actor', 'head', 'source-project'])('refuses changed client or source scope: %s', async scenario => {
    const post = vi.spyOn(client, 'post').mockResolvedValue(response());
    if (scenario === 'project') vi.mocked(client.getProject).mockReturnValue({ resourceType: 'Project', id: 'other' });
    if (scenario === 'actor') vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other' });
    if (scenario === 'head' || scenario === 'source-project') vi.mocked(client.readResource).mockResolvedValue({ resourceType: 'Patient', id: LIFECYCLE_WORKER_ID,
      meta: { project: scenario === 'source-project' ? 'other' : OEM_PROJECT_ID, versionId: 'changed' } });
    await expect(generateNativeReport(client, true)).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(['project', 'actor'].includes(scenario) ? 0 : 1);
  });

  it('requires confirmation, blocks rapid duplicate requests and downloads only local validated CSV/manifest', async () => {
    const post = vi.spyOn(client, 'post').mockResolvedValue(response()); const filenames: string[] = [];
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:synthetic-report') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filenames.push(this.download); });
    mount(); const button = screen.getByRole('button', { name: 'Generate synthetic report' }); expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(button); fireEvent.click(button);
    await screen.findByRole('button', { name: 'Download synthetic CSV' }); expect(post).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/1 supplied worker - 1 supplied obligation/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View report exposure' })).toHaveAttribute('href', `/${REPORT_SOURCES[1]}`);
    fireEvent.click(screen.getByRole('button', { name: 'Download synthetic CSV' })); fireEvent.click(screen.getByRole('button', { name: 'Download report manifest' }));
    expect(filenames).toEqual(['synthetic-noise-report-2026-10-24.csv', 'synthetic-noise-report-2026-10-24.manifest.json']); expect(post).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss report' })); expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'Download synthetic CSV' })).not.toBeInTheDocument();
  });

  it('does not retry errors or display private transport details', async () => {
    const post = vi.spyOn(client, 'post').mockRejectedValue(new Error('Private transport body'));
    mount(); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Generate synthetic report' }));
    await screen.findByText('Report unavailable'); expect(screen.queryByText('Private transport body')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download synthetic CSV' })).not.toBeInTheDocument(); expect(post).toHaveBeenCalledTimes(1);
  });

  it('refuses local download after actor scope changes', async () => {
    vi.spyOn(client, 'post').mockResolvedValue(response()); const result = await generateNativeReport(client, true);
    vi.mocked(client.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other' });
    expect(() => downloadNativeReport(client, result, 'csv')).toThrow('clinician');
  });
});
