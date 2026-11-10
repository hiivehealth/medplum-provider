import type { Resource } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OEM_PROJECT_ID } from './ih-review';
import { exposureSummary, EXPOSURE_WORKFLOW_BOT_ID, sendExposureWorkflow, type ExposureWorkflowRequest, type ExposureWorkflowResult, type MeasurementAuditEntry } from './exposure-workflow';

const request: ExposureWorkflowRequest = { mode: 'preview', patient: 'Patient/new-worker', exposure: 'Observation/new-exposure/_history/new', asOf: '2026-10-26' };
const preview: ExposureWorkflowResult = { phase: 'advisory', ...request, persisted: false, fingerprint: 'a'.repeat(64),
  sources: [request.exposure, 'DocumentReference/rules/_history/one'], activated: false, externalDispatch: false,
  clinicalCompletionVerified: false, status: 'needs-review', canRecommend: false, rationale: 'Missing enrollment evidence.' };

describe('same-exposure workflow response verification', () => {
  let client: MockClient;
  beforeEach(() => {
    client = new MockClient();
    vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    vi.spyOn(client, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
    vi.spyOn(client, 'post').mockResolvedValue(preview);
  });
  it('uses only the separately scoped Bot with retries disabled', async () => {
    expect(await sendExposureWorkflow(client, request)).toEqual(preview);
    expect(client.post).toHaveBeenCalledExactlyOnceWith(`fhir/R4/Bot/${EXPOSURE_WORKFLOW_BOT_ID}/$execute`, request, 'application/json', { maxRetries: 0 });
  });
  it('exports only the same exposure and its synthetic limitations, never a fixed cohort', () => {
    const completed: ExposureWorkflowResult = { ...preview, phase: 'completion', persisted: true, task: 'Task/new/_history/accepted',
      proposal: 'ServiceRequest/new/_history/draft', report: 'DocumentReference/new/_history/report', attestation: 'Observation/new/_history/attestation',
      performedOn: '2026-10-26', nextPeriodicOn: '2027-10-26' };
    const summary = exposureSummary(completed);
    expect(summary).toMatchObject({ coverage: 'one-selected-exposure-only', exposure: request.exposure, patient: request.patient,
      illustrativeNextPeriodicOn: '2027-10-26', clinicalCompletionVerified: false, complianceAssessed: false, activated: false, externalDispatch: false });
    expect(JSON.stringify(summary)).not.toContain('baa7efea');
    expect(() => exposureSummary(preview)).toThrow();
  });
  it.each(['patient', 'exposure', 'source', 'activated', 'dispatch', 'completion', 'phase', 'fingerprint'])(
    'rejects a mismatched or unsafe response: %s', async scenario => {
      const changed = structuredClone(preview);
      if (scenario === 'patient') changed.patient = 'Patient/foreign';
      if (scenario === 'exposure') changed.exposure = 'Observation/old-exposure/_history/old';
      if (scenario === 'source') changed.sources[0] = 'Observation/old-exposure/_history/old';
      if (scenario === 'activated') Object.assign(changed, { activated: true });
      if (scenario === 'dispatch') Object.assign(changed, { externalDispatch: true });
      if (scenario === 'completion') Object.assign(changed, { clinicalCompletionVerified: true });
      if (scenario === 'phase') changed.phase = 'completion';
      if (scenario === 'fingerprint') changed.fingerprint = '';
      vi.mocked(client.post).mockResolvedValue(changed);
      await expect(sendExposureWorkflow(client, request)).rejects.toThrow();
    });
  it('reads back the enrollment with its worker, episode, actor and evidence binding', async () => {
    const enrollmentRequest: ExposureWorkflowRequest = { ...request, mode: 'enroll', determination: 'enrolled', enrollmentStart: request.asOf,
      enrollmentEvidence: 'DocumentReference/evidence/_history/one', confirmedSave: true, fingerprint: preview.fingerprint };
    const response: ExposureWorkflowResult = { ...preview, phase: 'enrollment', persisted: true, determination: 'enrolled', enrollmentStart: request.asOf,
      enrollmentEvidence: enrollmentRequest.enrollmentEvidence, enrollmentRecord: 'Observation/enrollment/_history/one',
      lineage: 'Provenance/enrollment/_history/one', audit: 'AuditEvent/enrollment/_history/one' };
    const records: Resource[] = [{ resourceType: 'Observation', id: 'enrollment', meta: { project: OEM_PROJECT_ID, versionId: 'one' },
      status: 'final', code: { text: 'Enrollment' }, subject: { reference: request.patient }, focus: [{ reference: 'Observation/new-exposure' }],
      performer: [{ reference: 'Practitioner/clinician' }], valueCodeableConcept: { text: 'enrolled' }, effectivePeriod: { start: request.asOf },
      derivedFrom: [{ reference: enrollmentRequest.enrollmentEvidence }] },
      { resourceType: 'Provenance', id: 'enrollment', meta: { project: OEM_PROJECT_ID, versionId: 'one' }, recorded: '2026-10-26T00:00:00Z', target: [], agent: [] },
      { resourceType: 'AuditEvent', id: 'enrollment', meta: { project: OEM_PROJECT_ID, versionId: 'one' }, type: {}, recorded: '2026-10-26T00:00:00Z', agent: [], source: { observer: {} } }];
    vi.mocked(client.post).mockResolvedValue(response);
    vi.spyOn(client, 'readVersion').mockImplementation(type => Promise.resolve(structuredClone(records.find(resource => resource.resourceType === type)!)) as never);
    expect(await sendExposureWorkflow(client, enrollmentRequest)).toEqual(response);
    records[0] = { ...records[0], subject: { reference: 'Patient/foreign' } } as Resource;
    await expect(sendExposureWorkflow(client, enrollmentRequest)).rejects.toThrow();
  });
  it.each(['valid', 'actor', 'exposure', 'value', 'recorded-time', 'assessed-date', 'lineage-target', 'audit-target', 'project', 'duplicate', 'forged-body', 'coverage'])(
    'independently verifies persisted measurement audit history: %s', async scenario => {
      const recordedAt = '2026-10-26T12:00:00.000Z';
      const entry: MeasurementAuditEntry = {
        record: { resourceType: 'Observation', id: 'measurement', meta: { project: OEM_PROJECT_ID, versionId: 'one', lastUpdated: recordedAt },
          status: 'final', code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-noise-metric', code: 'eight-hour-twa' }] },
          subject: { reference: request.patient }, focus: [{ reference: request.exposure }], performer: [{ reference: 'Practitioner/clinician' }],
          effectiveDateTime: request.asOf, valueQuantity: { value: 0, unit: 'dBA' }, method: { text: 'synthetic-personal-dosimetry' },
          identifier: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-exposure-workflow/measurement', value: 'a9ecb6f0-0ec7-4093-aaf4-72289f69ab35' }],
          extension: [{ url: 'https://hiivehealth.com/fhir/StructureDefinition/measurement-basis', valueString: '8h' },
            { url: 'https://hiivehealth.com/fhir/StructureDefinition/measurement-unit', valueCode: 'dBA' }],
          derivedFrom: [{ reference: 'DocumentReference/evidence/_history/one' }] },
        lineage: { resourceType: 'Provenance', id: 'measurement', meta: { project: OEM_PROJECT_ID, versionId: 'one' }, recorded: recordedAt,
          target: [{ reference: 'Observation/measurement/_history/one' }], agent: [{ who: { reference: 'Practitioner/clinician' } }],
          entity: [request.exposure, 'DocumentReference/evidence/_history/one'].map(reference => ({ role: 'source', what: { reference } })) },
        audit: { resourceType: 'AuditEvent', id: 'measurement', meta: { project: OEM_PROJECT_ID, versionId: 'one' },
          type: {}, source: { observer: {} }, recorded: recordedAt, action: 'C', outcome: '0', agent: [{ who: { reference: 'Practitioner/clinician' }, requestor: true }],
          entity: [request.patient, request.exposure, 'Observation/measurement/_history/one', 'DocumentReference/evidence/_history/one'].map(reference => ({ what: { reference } })) },
      };
      if (scenario === 'actor') entry.lineage.agent[0].who.reference = 'Practitioner/other';
      if (scenario === 'exposure') entry.record.focus![0].reference = 'Observation/other/_history/one';
      if (scenario === 'value') entry.record.valueQuantity!.value = -1;
      if (scenario === 'recorded-time') entry.audit.recorded = '2026-10-25T12:00:00.000Z';
      if (scenario === 'assessed-date') entry.record.effectiveDateTime = '2026-10-27';
      if (scenario === 'lineage-target') entry.lineage.target[0].reference = 'Observation/other/_history/one';
      if (scenario === 'audit-target') entry.audit.entity![2].what!.reference = 'Observation/other/_history/one';
      if (scenario === 'project') entry.record.meta!.project = 'other';
      const actual = structuredClone(entry);
      if (scenario === 'forged-body') entry.record.valueQuantity!.value = 86;
      const response: ExposureWorkflowResult = { ...preview, phase: 'measurement-history', coverage: 'appended-measurements-only',
        entries: scenario === 'duplicate' ? [entry, entry] : [entry] };
      if (scenario === 'coverage') Object.assign(response, { coverage: 'complete-clinical-audit' });
      vi.mocked(client.post).mockResolvedValue(response);
      vi.spyOn(client, 'readVersion').mockImplementation(type => Promise.resolve(structuredClone(
        type === 'Observation' ? actual.record : type === 'Provenance' ? actual.lineage : actual.audit)) as never);
      const reading = sendExposureWorkflow(client, { ...request, mode: 'measurement-history' });
      if (scenario === 'valid') expect(await reading).toEqual(response);
      else await expect(reading).rejects.toThrow();
    });
});