import type {
  DocumentReference,
  Observation,
  Patient,
  Provenance,
  Questionnaire,
  QuestionnaireResponse,
} from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { describe, expect, it, vi } from 'vitest';
import { OEM_PROJECT_ID } from './ih-review';
import {
  exposureAmendmentDetails,
  exposureTimelineDetails,
  inspectRetainedWork,
  LIFECYCLE_BOT_ID,
  LIFECYCLE_EXPOSURE,
  LIFECYCLE_RECOMMENDATION,
  LIFECYCLE_WORKER_ID,
  INTAKE_CANONICAL,
  loadExposureAmendmentDetails,
  loadIntake,
  loadIntakeAssessments,
  loadNoiseCompletions,
  measurementResult,
  NOISE_PREVIEW_BOT_ID,
  NOISE_RULE_CANONICAL,
  prepareIntake,
  previewIntake,
  previewNoiseScenario,
  saveIntake,
} from './intake';

describe('exposure timeline presentation', () => {
  const namespace = 'https://hiivehealth.com/fhir';
  const episode: Observation = {
    resourceType: 'Observation',
    status: 'final',
    code: { coding: [{ system: `${namespace}/CodeSystem/oem-stressor`, code: '503' }] },
    effectivePeriod: { start: '2026-01-01' },
  };
  const detail = (changes: Partial<Observation>, at = '2026-10-22') =>
    exposureTimelineDetails({ ...episode, ...changes }, at);
  it.each([
    ['ih-ingested', 'IH-imported'],
    ['ih-entered', 'IH-entered'],
    ['clinician-entered', 'Clinician-entered'],
    ['clinician-modified', 'Clinician-amended'],
  ])('maps stored %s without guessing original lineage', (code, label) => {
    expect(
      detail({ extension: [{ url: `${namespace}/StructureDefinition/exposure-source`, valueCode: code }] })
    ).toEqual({
      type: 'Noise 503',
      status: 'Active',
      source: label,
    });
  });
  it.each([
    [{ start: '2026-01-01' }, 'Active'],
    [{ start: '2026-01-01', end: '2026-10-22' }, 'Active'],
    [{ start: '2026-01-01', end: '2026-10-23' }, 'Active'],
    [{ start: '2026-01-01', end: '2026-10-21' }, 'Inactive'],
    [{ start: '2026-10-23' }, 'Future'],
    [{ start: '2026-02-30' }, 'Unknown'],
    [{ start: '2026-01-01', end: '2025-12-31' }, 'Unknown'],
    [{ start: '2026-01-01', end: '' }, 'Unknown'],
    [{ end: '2026-10-21' }, 'Unknown'],
    [undefined, 'Unknown'],
  ] as const)('handles activity for %j as %s', (period, expected) => {
    expect(detail({ effectivePeriod: period }).status).toBe(expected);
  });
  it('honors explicit inactivation but refuses unsupported or duplicate status metadata', () => {
    const inactive = { url: `${namespace}/StructureDefinition/exposure-status`, valueCode: 'inactive' };
    expect(detail({ extension: [inactive] }).status).toBe('Inactive');
    expect(detail({ extension: [inactive, inactive] }).status).toBe('Unknown');
    expect(detail({ extension: [{ ...inactive, valueCode: 'unrecognized' }] }).status).toBe('Unknown');
    expect(detail({ extension: [{ url: inactive.url, valueString: 'active' }] }).status).toBe('Unknown');
    expect(detail({ extension: [inactive], effectivePeriod: { start: 'invalid' } }).status).toBe('Unknown');
  });
  it('keeps missing, duplicate, unsupported or malformed source Unknown', () => {
    const source = { url: `${namespace}/StructureDefinition/exposure-source`, valueCode: 'ih-ingested' };
    for (const extension of [
      [],
      [source, source],
      [{ ...source, valueCode: 'other' }],
      [{ url: source.url, valueString: 'ih-ingested' }],
    ]) {
      expect(detail({ extension }).source).toBe('Unknown');
    }
  });
  it('does not infer type, confuse record finality with activity, mutate data or accept an invalid clock', () => {
    const before = structuredClone(episode);
    expect(detail({ code: {} }).type).toBe('Unknown');
    expect(detail({ effectivePeriod: undefined }).status).toBe('Unknown');
    expect(detail({}, '2026-02-30').status).toBe('Unknown');
    expect(detail({ effectiveDateTime: '2026-01-01' }).status).toBe('Unknown');
    expect(exposureTimelineDetails(episode, '2026-10-22').status).not.toBe('final');
    expect(episode).toEqual(before);
  });
});

describe('bounded read-only lifecycle collection', () => {
  const worker: Patient = { ...patient, id: LIFECYCLE_WORKER_ID };
  const reply = () => ({ mode: 'inspection-only', coverage: 'bounded-authorized-search-only', persisted: false, activated: false,
    searchState: 'unchanged-at-search-checks', searchedRecommendations: 1,
    canGenerateNewWork: false, requester: 'Practitioner/clinician', inspectedAt: '2026-10-22T12:00:00.000Z',
    headState: 'unchanged-at-read-checks', changedReferences: [] as string[], inspection: { mode: 'inspection-only',
      coverage: 'supplied-records-only', persisted: false, activated: false, canGenerateNewWork: false,
      exposure: LIFECYCLE_EXPOSURE, activityAsOf: '2026-10-22', activity: 'active', disposition: 'rule-evaluation-required',
        retained: [{ reference: LIFECYCLE_RECOMMENDATION, status: 'requested', reviewRequired: false }], unverifiedProposalReferences: [] as string[] } });
      it('sends only the published worker and exposure without actor/time/record selections and returns presentation facts', async () => {
    const mock = client();
    vi.spyOn(mock, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
    const post = vi.spyOn(mock, 'post').mockResolvedValue(reply());
    expect(await inspectRetainedWork(mock, worker)).toEqual({ inspectedAt: '2026-10-22T12:00:00.000Z',
      activity: 'active', headState: 'unchanged-at-read-checks', status: 'requested', reviewRequired: false,
      searchedRecommendations: 1, recommendations: reply().inspection.retained });
    expect(post).toHaveBeenCalledWith(`fhir/R4/Bot/${LIFECYCLE_BOT_ID}/$execute`, { mode: 'collect',
      patient: `Patient/${LIFECYCLE_WORKER_ID}`, exposure: LIFECYCLE_EXPOSURE }, 'application/json');
  });
  it.each(['persisted', 'activated', 'new-work', 'actor', 'foreign-record', 'date', 'head', 'status', 'partial', 'transport'])(
    'refuses an unverified lifecycle response: %s', async scenario => {
      const mock = client();
      vi.spyOn(mock, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
      const result = reply();
      if (scenario === 'persisted') result.persisted = true;
      if (scenario === 'activated') result.activated = true;
      if (scenario === 'new-work') result.inspection.canGenerateNewWork = true;
      if (scenario === 'actor') result.requester = 'Practitioner/other';
      if (scenario === 'foreign-record') result.inspection.retained[0].reference = 'ServiceRequest/foreign/_history/one';
      if (scenario === 'date') result.inspectedAt = '2026-02-30T12:00:00.000Z';
      if (scenario === 'head') result.changedReferences = [LIFECYCLE_EXPOSURE];
      if (scenario === 'status') result.inspection.retained[0].status = 'unrecognized';
      if (scenario === 'partial') result.inspection.unverifiedProposalReferences = ['ServiceRequest/unverified'];
      const post = vi.spyOn(mock, 'post').mockResolvedValue(result);
      if (scenario === 'transport') post.mockRejectedValue(new Error('private response details'));
      await expect(inspectRetainedWork(mock, worker)).rejects.toThrow(/^Retained work inspection is unavailable\.$/);
    }
  );
  it('separates a verified linked local draft from the searched recommendation count without writes', async () => {
    const mock = client();
    vi.spyOn(mock, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
    const result = reply();
    result.inspection.retained[0].status = 'accepted';
    const proposal = { reference: 'ServiceRequest/local-proposal/_history/one', status: 'draft', reviewRequired: false };
    result.inspection.retained.push(proposal);
    const post = vi.spyOn(mock, 'post').mockResolvedValue(result);
    expect(await inspectRetainedWork(mock, worker)).toMatchObject({ status: 'accepted', searchedRecommendations: 1,
      recommendations: [result.inspection.retained[0]], proposals: [proposal] });
    expect(post).toHaveBeenCalledTimes(1);
    for (const status of ['active', 'completed', 'requested']) {
      proposal.status = status;
      await expect(inspectRetainedWork(mock, worker)).rejects.toThrow('Retained work inspection is unavailable.');
    }
    proposal.status = 'draft';
    result.inspection.retained.shift();
    await expect(inspectRetainedWork(mock, worker)).rejects.toThrow('Retained work inspection is unavailable.');
  });
  it('refuses another worker without a request', async () => {
    const mock = client();
    const post = vi.spyOn(mock, 'post');
    await expect(inspectRetainedWork(mock, patient)).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  it('retains multiple and completed recommendation statuses and accepts an empty visible result without a completeness claim', async () => {
    const mock = client();
    vi.spyOn(mock, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
    const result = reply();
    result.searchedRecommendations = 2;
    result.inspection.retained.push({ reference: 'Task/other-cycle/_history/one', status: 'completed', reviewRequired: false });
    const post = vi.spyOn(mock, 'post').mockResolvedValue(result);
    expect((await inspectRetainedWork(mock, worker)).recommendations.map(record => record.status)).toEqual(['requested', 'completed']);
    result.inspection.retained = [];
    result.searchedRecommendations = 0;
    post.mockResolvedValue(result);
    expect(await inspectRetainedWork(mock, worker)).toMatchObject({ status: 'none', recommendations: [], searchedRecommendations: 0 });
  });

  it.each(['duplicate', 'count', 'search-state', 'off-manifest-change'])(
    'refuses invalid collection envelope: %s', async scenario => {
      const mock = client();
      vi.spyOn(mock, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
      const result = reply();
      if (scenario === 'duplicate') {
        result.inspection.retained.push({ ...result.inspection.retained[0] });
        result.searchedRecommendations = 2;
      }
      if (scenario === 'count') result.searchedRecommendations = 101;
      if (scenario === 'search-state') result.searchState = 'atomic-complete';
      if (scenario === 'off-manifest-change') { result.headState = 'changed'; result.changedReferences = ['Task/other/_history/one']; }
      vi.spyOn(mock, 'post').mockResolvedValue(result);
      await expect(inspectRetainedWork(mock, worker)).rejects.toThrow(/^Retained work inspection is unavailable\.$/);
    }
  );
});

describe('exact exposure amendment attribution', () => {
  function lineage() {
    const namespace = 'https://hiivehealth.com/fhir';
    const previous: Observation = {
      resourceType: 'Observation',
      id: 'episode',
      meta: { project: OEM_PROJECT_ID, versionId: 'before' },
      status: 'final',
      subject: { reference: 'Patient/worker' },
      category: [{ coding: [{ system: `${namespace}/CodeSystem/observation-category`, code: 'exposure' }] }],
      code: { coding: [{ system: `${namespace}/CodeSystem/oem-stressor`, code: '503' }] },
      effectivePeriod: { start: '2026-01-01' },
    };
    const exposure: Observation = {
      ...structuredClone(previous),
      meta: { project: OEM_PROJECT_ID, versionId: 'after' },
      extension: [
        { url: `${namespace}/StructureDefinition/exposure-source`, valueCode: 'clinician-modified' },
        { url: `${namespace}/StructureDefinition/exposure-amendment-reason`, valueCode: 'correct-worksite' },
        { url: `${namespace}/StructureDefinition/intake-save-fingerprint`, valueString: 'a'.repeat(64) },
      ],
    };
    const provenance: Provenance = {
      resourceType: 'Provenance',
      id: 'lineage',
      meta: { project: OEM_PROJECT_ID, versionId: 'one' },
      target: [{ reference: 'Observation/episode/_history/after' }],
      recorded: '2026-10-20T12:00:00.000Z',
      activity: { text: 'Synthetic structured intake persistence' },
      extension: [{ url: `${namespace}/StructureDefinition/intake-save-fingerprint`, valueString: 'a'.repeat(64) }],
      agent: [{ who: { reference: 'Practitioner/clinician' } }],
      entity: [{ role: 'revision', what: { reference: 'Observation/episode/_history/before' } }],
    };
    return { exposure, provenance, previous };
  }

  it('returns who, saved action time and reason only for matching exact lineage', () => {
    const input = lineage();
    const before = structuredClone(input);
    expect(exposureAmendmentDetails(input.exposure, input.provenance, input.previous)).toEqual({
      actor: 'Practitioner/clinician',
      recorded: '2026-10-20T12:00:00.000Z',
      reason: 'Correct worksite',
      lineage: 'Provenance/lineage/_history/one',
      previous: 'Observation/episode/_history/before',
    });
    expect(input).toEqual(before);
  });

  it('loads only pinned exposure, lineage and prior histories with a bounded target search', async () => {
    const input = lineage();
    const mock = client();
    const reads = vi
      .spyOn(mock, 'readVersion')
      .mockResolvedValueOnce({ ...input.exposure, id: input.exposure.id! })
      .mockResolvedValueOnce({ ...input.provenance, id: input.provenance.id! })
      .mockResolvedValueOnce({ ...input.previous, id: input.previous.id! });
    const search = vi.spyOn(mock, 'searchResources').mockResolvedValue(
      Object.assign([{ ...input.provenance, id: input.provenance.id! }], {
        bundle: { resourceType: 'Bundle' as const, type: 'searchset' as const },
      })
    );
    expect(await loadExposureAmendmentDetails(mock, patient, input.exposure)).toEqual(
      exposureAmendmentDetails(input.exposure, input.provenance, input.previous)
    );
    expect(reads.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['Observation', 'episode', 'after'],
      ['Provenance', 'lineage', 'one'],
      ['Observation', 'episode', 'before'],
    ]);
    expect(search).toHaveBeenCalledWith(
      'Provenance',
      {
        target: 'Observation/episode/_history/after',
        _count: '11',
        _sort: '-_lastUpdated',
      },
      { cache: 'no-cache' }
    );
  });

  it.each(['denied', 'duplicate', 'limit', 'wrong-version', 'foreign-lineage', 'wrong-prior', 'foreign-worker'])(
    'does not return attribution or raw error details for %s',
    async (scenario) => {
      const input = lineage();
      const mock = client();
      if (scenario === 'foreign-worker') input.exposure.subject = { reference: 'Patient/private-foreign-worker' };
      if (scenario === 'foreign-lineage') input.provenance.meta!.project = 'private-foreign-project';
      if (scenario === 'wrong-prior') input.previous.meta!.versionId = 'another';
      const reads = vi
        .spyOn(mock, 'readVersion')
        .mockResolvedValueOnce({
          ...input.exposure,
          id: input.exposure.id!,
          meta: { ...input.exposure.meta, versionId: scenario === 'wrong-version' ? 'another' : 'after' },
        })
        .mockResolvedValueOnce({ ...input.provenance, id: input.provenance.id! })
        .mockResolvedValueOnce({ ...input.previous, id: input.previous.id! });
      const records = [{ ...input.provenance, id: input.provenance.id! }];
      const found =
        scenario === 'limit'
          ? Array.from({ length: 11 }, () => records[0])
          : scenario === 'duplicate'
            ? [...records, ...records]
            : records;
      const search = vi
        .spyOn(mock, 'searchResources')
        .mockResolvedValue(
          Object.assign(found, { bundle: { resourceType: 'Bundle' as const, type: 'searchset' as const } })
        );
      if (scenario === 'denied') search.mockRejectedValue(new Error('private transport error'));
      await expect(loadExposureAmendmentDetails(mock, patient, input.exposure)).rejects.toThrow(
        /^Verified amendment attribution is unavailable\.$/
      );
      if (scenario === 'foreign-worker') expect(reads).not.toHaveBeenCalled();
    }
  );

  it.each([
    'foreign-worker',
    'foreign-project',
    'wrong-target',
    'wrong-prior',
    'missing-actor',
    'missing-reason',
    'wrong-time',
    'duplicate-reason',
    'unsupported-reason',
    'duplicate-source',
    'duplicate-agent',
    'duplicate-target',
    'duplicate-revision',
    'current-only-prior',
    'same-version',
    'wrong-activity',
    'missing-fingerprint',
    'different-fingerprint',
    'duplicate-fingerprint',
    'malformed-fingerprint',
    'wrong-category',
    'missing-version',
  ])('returns no partial attribution for %s', (scenario) => {
    const input = lineage();
    if (scenario === 'foreign-worker') input.previous.subject = { reference: 'Patient/foreign' };
    if (scenario === 'foreign-project') input.provenance.meta!.project = 'other';
    if (scenario === 'wrong-target') input.provenance.target[0].reference = 'Observation/other/_history/after';
    if (scenario === 'wrong-prior') input.provenance.entity![0].what.reference = 'Observation/episode/_history/another';
    if (scenario === 'missing-actor') input.provenance.agent = [];
    if (scenario === 'missing-reason') input.exposure.extension!.splice(1, 1);
    if (scenario === 'wrong-time') input.provenance.recorded = '2026-02-30T12:00:00.000Z';
    if (scenario === 'duplicate-reason') input.exposure.extension!.push(structuredClone(input.exposure.extension![1]));
    if (scenario === 'unsupported-reason') input.exposure.extension![1].valueCode = 'unreviewed';
    if (scenario === 'duplicate-source') input.exposure.extension!.push(structuredClone(input.exposure.extension![0]));
    if (scenario === 'duplicate-agent') input.provenance.agent.push(structuredClone(input.provenance.agent[0]));
    if (scenario === 'duplicate-target') input.provenance.target.push(structuredClone(input.provenance.target[0]));
    if (scenario === 'duplicate-revision') input.provenance.entity!.push(structuredClone(input.provenance.entity![0]));
    if (scenario === 'current-only-prior') input.provenance.entity![0].what.reference = 'Observation/episode';
    if (scenario === 'same-version') input.previous.meta!.versionId = 'after';
    if (scenario === 'wrong-activity')
      input.provenance.activity = { text: 'Synthetic exposure amendment: end-exposure' };
    if (scenario === 'missing-fingerprint') input.provenance.extension = [];
    if (scenario === 'different-fingerprint') input.provenance.extension![0].valueString = 'b'.repeat(64);
    if (scenario === 'duplicate-fingerprint') input.provenance.extension!.push(structuredClone(input.provenance.extension![0]));
    if (scenario === 'malformed-fingerprint') input.provenance.extension![0].valueString = 'not-a-fingerprint';
    if (scenario === 'wrong-category') input.previous.category = [];
    if (scenario === 'missing-version') input.provenance.meta!.versionId = undefined;
    expect(exposureAmendmentDetails(input.exposure, input.provenance, input.previous)).toBeUndefined();
  });

  it.each(['correct-dates', 'end-exposure'])(
    'uses the stored %s reason and action time, not names or lastUpdated',
    (reason) => {
      const input = lineage();
      input.exposure.extension![1].valueCode = reason;
      input.provenance.meta!.lastUpdated = '2026-10-22T22:00:00Z';
      input.provenance.agent[0].who.display = 'Unverified display name';
      const result = exposureAmendmentDetails(input.exposure, input.provenance, input.previous)!;
      expect(result.actor).toBe('Practitioner/clinician');
      expect(result.recorded).toBe('2026-10-20T12:00:00.000Z');
      expect(result.reason).toBe(reason === 'correct-dates' ? 'Correct dates' : 'End exposure');
    }
  );

  it('does not follow a prior-version link from a foreign exact Provenance response', async () => {
    const input = lineage();
    const mock = client();
    vi.spyOn(mock, 'searchResources').mockResolvedValue(
      Object.assign([{ ...input.provenance, id: input.provenance.id! }], {
        bundle: { resourceType: 'Bundle' as const, type: 'searchset' as const },
      })
    );
    const reads = vi
      .spyOn(mock, 'readVersion')
      .mockResolvedValueOnce({ ...input.exposure, id: input.exposure.id! })
      .mockResolvedValueOnce({
        ...input.provenance,
        id: input.provenance.id!,
        meta: { ...input.provenance.meta, project: 'foreign' },
      });
    await expect(loadExposureAmendmentDetails(mock, patient, input.exposure)).rejects.toThrow(
      /^Verified amendment attribution is unavailable\.$/
    );
    expect(reads).toHaveBeenCalledTimes(2);
  });
});

const patient: Patient = {
  resourceType: 'Patient',
  id: 'worker',
  meta: {
    project: OEM_PROJECT_ID,
    tag: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/demo-data', code: 'synthetic-only' }],
  },
};
const evidence: DocumentReference = {
  resourceType: 'DocumentReference',
  id: 'evidence',
  meta: { project: OEM_PROJECT_ID, versionId: 'v1' },
  status: 'current',
  subject: { reference: 'Patient/worker' },
  content: [],
};
const measurement: Observation & { id: string } = {
  resourceType: 'Observation',
  id: 'measurement',
  meta: { project: OEM_PROJECT_ID, versionId: 'v2' },
  status: 'final',
  subject: { reference: 'Patient/worker' },
  code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-noise-metric', code: 'eight-hour-twa' }] },
  focus: [{ reference: 'Observation/exposure/_history/v1' }],
  derivedFrom: [{ reference: 'DocumentReference/evidence/_history/v1' }],
  valueQuantity: { value: 0, unit: 'dBA' },
};
const questionnaire: Questionnaire = {
  resourceType: 'Questionnaire',
  status: 'draft',
  url: INTAKE_CANONICAL.split('|')[0],
  version: 'demo-1',
  item: [
    {
      linkId: 'group',
      type: 'group',
      item: [
        { linkId: 'date', type: 'date', required: true },
        { linkId: 'value', type: 'decimal', required: true },
        { linkId: 'evidence', type: 'reference', required: true },
      ],
    },
  ],
};
const response: QuestionnaireResponse = {
  resourceType: 'QuestionnaireResponse',
  status: 'in-progress',
  author: { reference: 'Practitioner/untrusted' },
  item: [
    {
      linkId: 'group',
      item: [
        { linkId: 'date', answer: [{ valueDate: '2026-01-01' }] },
        { linkId: 'value', answer: [{ valueDecimal: 0 }] },
        {
          linkId: 'evidence',
          answer: [{ valueReference: { reference: 'DocumentReference/evidence', display: 'Evidence' } }],
        },
      ],
    },
  ],
};
function client(): MockClient {
  const result = new MockClient();
  vi.spyOn(result, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
  return result;
}

function observationResults(records: (Observation & { id: string })[]) {
  return Object.assign(records, { bundle: { resourceType: 'Bundle' as const, type: 'searchset' as const } });
}

describe('OEM intake adapter', () => {
  it('previews only the exact selected scenario and rejects a foreign advisory response', async () => {
    const medplum = client();
    const exposure: Observation = {
      resourceType: 'Observation',
      id: 'exposure',
      meta: { project: OEM_PROJECT_ID, versionId: 'v1' },
      status: 'final',
      subject: { reference: 'Patient/worker' },
      code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-stressor', code: '503' }] },
    };
    const output = {
      mode: 'preview',
      persisted: false,
      evaluation: {
        status: 'needs-review',
        rationale: 'Enrollment is missing.',
        result: {
          resourceType: 'ClinicalImpression',
          subject: { reference: 'Patient/worker' },
          date: '2026-10-21',
          supportingInfo: [
            { reference: 'Observation/exposure/_history/v1' },
            { reference: 'DocumentReference/rule-source' },
          ],
          extension: [
            { url: 'https://hiivehealth.com/fhir/StructureDefinition/oem-rule', valueCanonical: NOISE_RULE_CANONICAL },
          ],
        },
      },
    };
    const post = vi.spyOn(medplum, 'post').mockResolvedValue(output);
    expect((await previewNoiseScenario(medplum, patient, exposure, '2026-10-21')).status).toBe('needs-review');
    expect(post).toHaveBeenCalledWith(
      `fhir/R4/Bot/${NOISE_PREVIEW_BOT_ID}/$execute`,
      {
        mode: 'preview',
        patient: 'Patient/worker',
        exposure: 'Observation/exposure/_history/v1',
        asOf: '2026-10-21',
      },
      'application/json'
    );
    output.evaluation.result.subject.reference = 'Patient/other';
    await expect(previewNoiseScenario(medplum, patient, exposure, '2026-10-21')).rejects.toThrow(
      'could not be verified'
    );
    output.evaluation.result.subject.reference = 'Patient/worker';
    output.persisted = true;
    await expect(previewNoiseScenario(medplum, patient, exposure, '2026-10-21')).rejects.toThrow(
      'could not be verified'
    );
    output.persisted = false;
    output.evaluation.result.extension[0].valueCanonical = 'https://other.example/rule|v2';
    await expect(previewNoiseScenario(medplum, patient, exposure, '2026-10-21')).rejects.toThrow(
      'could not be verified'
    );
    output.evaluation.result.extension[0].valueCanonical = NOISE_RULE_CANONICAL;
    output.evaluation.result.supportingInfo = [];
    await expect(previewNoiseScenario(medplum, patient, exposure, '2026-10-21')).rejects.toThrow(
      'could not be verified'
    );
  });
  it('binds an optional enrollment version and never exposes an executable proposal', async () => {
    const medplum = client();
    const exposure: Observation = {
      resourceType: 'Observation',
      id: 'exposure',
      status: 'final',
      meta: { project: OEM_PROJECT_ID, versionId: 'v1' },
      subject: { reference: 'Patient/worker' },
      code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-stressor', code: '503' }] },
    };
    const enrollment: Observation = {
      ...exposure,
      id: 'enrollment',
      meta: { project: OEM_PROJECT_ID, versionId: 'v2' },
      code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-enrollment', code: '503' }] },
      focus: [{ reference: 'Observation/exposure' }],
    };
    const post = vi.spyOn(medplum, 'post').mockResolvedValue({
      mode: 'preview',
      persisted: false,
      proposal: { transaction: { resourceType: 'Bundle', type: 'transaction', entry: [] } },
      evaluation: {
        status: 'overdue',
        stage: 'baseline',
        due: '2026-01-01',
        rationale: 'Synthetic baseline scenario.',
        result: {
          resourceType: 'ClinicalImpression',
          subject: { reference: 'Patient/worker' },
          date: '2026-10-21',
          supportingInfo: [
            { reference: 'Observation/exposure/_history/v1' },
            { reference: 'DocumentReference/rule-source' },
            { reference: 'Observation/enrollment/_history/v2' },
          ],
          extension: [
            { url: 'https://hiivehealth.com/fhir/StructureDefinition/oem-rule', valueCanonical: NOISE_RULE_CANONICAL },
          ],
        },
      },
    });
    const result = await previewNoiseScenario(medplum, patient, exposure, '2026-10-21', enrollment);
    expect(post).toHaveBeenCalledWith(
      `fhir/R4/Bot/${NOISE_PREVIEW_BOT_ID}/$execute`,
      {
        mode: 'preview',
        patient: 'Patient/worker',
        exposure: 'Observation/exposure/_history/v1',
        enrollment: 'Observation/enrollment/_history/v2',
        asOf: '2026-10-21',
      },
      'application/json'
    );
    expect(result.status).toBe('overdue');
    expect(result).not.toHaveProperty('proposal');
    expect(result).not.toHaveProperty('transaction');
    await expect(
      previewNoiseScenario(medplum, patient, exposure, '2026-10-21', {
        ...enrollment,
        focus: [{ reference: 'Observation/other' }],
      })
    ).rejects.toThrow('match the selected exposure');
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('binds qualifying completion history and refuses future or wrong-rule completions before execution', async () => {
    const medplum = client();
    const exposure: Observation = {
      resourceType: 'Observation',
      id: 'exposure',
      status: 'final',
      meta: { project: OEM_PROJECT_ID, versionId: 'v1' },
      subject: { reference: 'Patient/worker' },
      effectivePeriod: { start: '2026-01-01' },
      code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-stressor', code: '503' }] },
    };
    const enrollment: Observation = {
      ...exposure,
      id: 'enrollment',
      code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-enrollment', code: '503' }] },
      focus: [{ reference: 'Observation/exposure' }],
    };
    const completion: Observation = {
      ...exposure,
      id: 'completed',
      effectiveDateTime: '2026-06-15',
      code: {
        coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-surveillance-action', code: 'audiogram' }],
      },
      focus: enrollment.focus,
      derivedFrom: [{ reference: 'DocumentReference/evidence/_history/v1' }],
      extension: [
        { url: 'https://hiivehealth.com/fhir/StructureDefinition/oem-rule', valueCanonical: NOISE_RULE_CANONICAL },
        { url: 'https://hiivehealth.com/fhir/StructureDefinition/oem-completion-kind', valueCode: 'synthetic-result' },
      ],
    };
    const post = vi.spyOn(medplum, 'post').mockResolvedValue({
      mode: 'preview',
      persisted: false,
      evaluation: {
        status: 'current',
        stage: 'periodic',
        due: '2027-06-15',
        rationale: 'Synthetic periodic scenario.',
        result: {
          resourceType: 'ClinicalImpression',
          subject: exposure.subject,
          date: '2026-10-21',
          extension: [
            {
              url: 'https://hiivehealth.com/fhir/StructureDefinition/oem-rule',
              valueCanonical: NOISE_RULE_CANONICAL,
            },
          ],
          supportingInfo: [
            'Observation/exposure/_history/v1',
            'Observation/enrollment/_history/v1',
            'Observation/completed/_history/v1',
            'DocumentReference/evidence/_history/v1',
          ].map((reference) => ({ reference })),
        },
      },
    });
    expect((await previewNoiseScenario(medplum, patient, exposure, '2026-10-21', enrollment, completion)).stage).toBe(
      'periodic'
    );
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/$execute'),
      expect.objectContaining({ completion: 'Observation/completed/_history/v1' }),
      'application/json'
    );
    await expect(
      previewNoiseScenario(medplum, patient, exposure, '2026-10-21', enrollment, {
        ...completion,
        effectiveDateTime: '2027-01-01',
      })
    ).rejects.toThrow('Completion must match');
    await expect(
      previewNoiseScenario(medplum, patient, exposure, '2026-10-21', enrollment, { ...completion, extension: [] })
    ).rejects.toThrow('Completion must match');
    expect(post).toHaveBeenCalledTimes(1);
  });
  it.each(['valid', 'foreign-evidence', 'wrong-version', 'wrong-rule', 'foreign-worker'])(
    'verifies completion sources: %s',
    async (scenario) => {
      const medplum = client();
      const record = {
        ...structuredClone(measurement),
        code: {
          coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-surveillance-action', code: 'audiogram' }],
        },
        focus: [{ reference: 'Observation/exposure' }],
        effectiveDateTime: '2026-06-15',
        extension: [
          {
            url: 'https://hiivehealth.com/fhir/StructureDefinition/oem-rule',
            valueCanonical: scenario === 'wrong-rule' ? 'other|v1' : NOISE_RULE_CANONICAL,
          },
          {
            url: 'https://hiivehealth.com/fhir/StructureDefinition/oem-completion-kind',
            valueCode: 'synthetic-result',
          },
        ],
      };
      if (scenario === 'foreign-worker') record.subject = { reference: 'Patient/other' };
      vi.spyOn(medplum, 'searchResources').mockResolvedValue(observationResults([record]));
      vi.spyOn(medplum, 'readResource').mockResolvedValue({
        resourceType: 'Observation',
        id: 'exposure',
        meta: { project: OEM_PROJECT_ID, versionId: 'v1' },
        status: 'final',
        subject: { reference: 'Patient/worker' },
        code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-stressor', code: '503' }] },
      });
      vi.spyOn(medplum, 'readVersion').mockResolvedValue({
        ...evidence,
        id: 'evidence',
        meta: { project: OEM_PROJECT_ID, versionId: scenario === 'wrong-version' ? 'v9' : 'v1' },
        subject: { reference: scenario === 'foreign-evidence' ? 'Patient/other' : 'Patient/worker' },
      });
      if (scenario === 'foreign-worker')
        await expect(loadNoiseCompletions(medplum, patient)).rejects.toThrow('Completion record');
      else {
        const result = await loadNoiseCompletions(medplum, patient);
        expect(result.records).toHaveLength(scenario === 'valid' ? 1 : 0);
        expect(result.unverified).toHaveLength(scenario === 'valid' ? 0 : 1);
      }
    }
  );
  it('loads worker-scoped assessments and verifies exact linked exposure and evidence histories', async () => {
    const medplum = client();
    const search = vi
      .spyOn(medplum, 'searchResources')
      .mockResolvedValueOnce(observationResults([measurement]))
      .mockResolvedValueOnce(observationResults([]));
    const read = vi
      .spyOn(medplum, 'readVersion')
      .mockResolvedValueOnce({
        resourceType: 'Observation',
        id: 'exposure',
        meta: { project: OEM_PROJECT_ID, versionId: 'v1' },
        status: 'final',
        subject: { reference: 'Patient/worker' },
        code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-stressor', code: '503' }] },
      })
      .mockResolvedValueOnce({ ...evidence, id: 'evidence' });
    const result = await loadIntakeAssessments(medplum, patient);
    expect(result.measurements[0].valueQuantity?.value).toBe(0);
    expect(result.enrollments).toHaveLength(0);
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenNthCalledWith(1, 'Observation', expect.objectContaining({ subject: 'Patient/worker' }), {
      cache: 'no-cache',
    });
    expect(search).toHaveBeenNthCalledWith(2, 'Observation', expect.objectContaining({ subject: 'Patient/worker' }), {
      cache: 'no-cache',
    });
    expect(read).toHaveBeenCalledWith('Observation', 'exposure', 'v1', { cache: 'no-cache' });
    expect(read).toHaveBeenCalledWith('DocumentReference', 'evidence', 'v1', { cache: 'no-cache' });
  });
  it('rejects foreign assessment results before resolving linked resources', async () => {
    const medplum = client();
    vi.spyOn(medplum, 'searchResources')
      .mockResolvedValueOnce(
        observationResults([
          {
            resourceType: 'Observation',
            id: 'foreign',
            meta: { project: OEM_PROJECT_ID, versionId: 'v1' },
            status: 'final',
            subject: { reference: 'Patient/other' },
            code: {},
          },
        ])
      )
      .mockResolvedValueOnce(observationResults([]));
    const read = vi.spyOn(medplum, 'readVersion');
    await expect(loadIntakeAssessments(medplum, patient)).rejects.toThrow('could not be verified');
    expect(read).not.toHaveBeenCalled();
  });
  it.each(['foreign-project', 'foreign-worker', 'wrong-version'])(
    'rejects %s linked assessment evidence',
    async (scenario) => {
      const medplum = client();
      vi.spyOn(medplum, 'searchResources')
        .mockResolvedValueOnce(observationResults([measurement]))
        .mockResolvedValueOnce(observationResults([]));
      const document = { ...structuredClone(evidence), id: 'evidence' };
      if (scenario === 'foreign-project') document.meta!.project = 'other';
      if (scenario === 'foreign-worker') document.subject = { reference: 'Patient/other' };
      if (scenario === 'wrong-version') document.meta!.versionId = 'v9';
      vi.spyOn(medplum, 'readVersion')
        .mockResolvedValueOnce({
          resourceType: 'Observation',
          id: 'exposure',
          meta: { project: OEM_PROJECT_ID, versionId: 'v1' },
          status: 'final',
          subject: { reference: 'Patient/worker' },
          code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-stressor', code: '503' }] },
        })
        .mockResolvedValueOnce(document);
      const result = await loadIntakeAssessments(medplum, patient);
      expect(result.measurements).toHaveLength(0);
      expect(result.unverified).toEqual([
        {
          kind: 'measurement',
          reference: 'Observation/measurement/_history/v2',
          reason:
            scenario === 'wrong-version'
              ? 'A linked source does not match the required recorded version.'
              : 'A linked source does not match the required resource, worker or Project.',
        },
      ]);
      expect(JSON.stringify(result.unverified)).not.toContain('Patient/other');
    }
  );
  it.each([
    ['denied', 'A linked source could not be read. It may be unavailable or access may be denied.'],
    ['malformed', 'A linked exposure or evidence reference is missing or malformed.'],
    ['invalid-value', 'The recorded measurement or enrollment value is unsupported or inconsistent.'],
    ['source-status', 'A linked source has an unsupported status or exposure type.'],
  ])('reports a safe source-review reason for %s', async (scenario, reason) => {
    const medplum = client();
    const record = structuredClone(measurement);
    if (scenario === 'malformed') record.derivedFrom = [{ reference: 'https://foreign.invalid/private' }];
    if (scenario === 'invalid-value') record.valueQuantity = { value: 88, unit: 'dBC' };
    vi.spyOn(medplum, 'searchResources')
      .mockResolvedValueOnce(observationResults([record]))
      .mockResolvedValueOnce(observationResults([]));
    const read = vi.spyOn(medplum, 'readVersion').mockResolvedValueOnce({
      resourceType: 'Observation',
      id: 'exposure',
      meta: { project: OEM_PROJECT_ID, versionId: 'v1' },
      subject: { reference: 'Patient/worker' },
      status: 'final',
      code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-stressor', code: '503' }] },
    });
    if (scenario === 'denied') read.mockRejectedValueOnce(new Error('Private detail sentinel: Patient/other'));
    else read.mockResolvedValueOnce({ ...evidence, id: 'evidence', status: 'superseded' });
    const result = await loadIntakeAssessments(medplum, patient);
    expect(result.measurements).toHaveLength(0);
    expect(result.unverified).toEqual([
      { kind: 'measurement', reference: 'Observation/measurement/_history/v2', reason },
    ]);
    expect(JSON.stringify(result.unverified)).not.toMatch(/Private detail sentinel|Patient\/other|foreign\.invalid/);
    if (scenario === 'invalid-value') expect(read).not.toHaveBeenCalled();
  });
  it('keeps zero distinct from unknown and rejects contradictory or incompatible measurements', () => {
    expect(measurementResult(measurement)).toBe('0 dBA');
    const unknown = structuredClone(measurement);
    delete unknown.valueQuantity;
    unknown.dataAbsentReason = {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/data-absent-reason', code: 'unknown' }],
    };
    expect(measurementResult(unknown)).toBe('Unknown');
    unknown.valueQuantity = { value: 0, unit: 'dBA' };
    expect(() => measurementResult(unknown)).toThrow('could not be verified');
    expect(() => measurementResult({ ...measurement, valueQuantity: { value: 88, unit: 'dBC' } })).toThrow(
      'could not be verified'
    );
  });
  it('normalizes native form metadata, preserves zero and pins selected worker evidence', () => {
    const request = prepareIntake(questionnaire, response, patient, [evidence]);
    expect(request.response.author).toBeUndefined();
    expect(request.response.status).toBe('completed');
    expect(request.response.questionnaire).toBe(INTAKE_CANONICAL);
    expect(request.response.item?.[0].item?.[1].answer).toEqual([{ valueDecimal: 0 }]);
    expect(request.response.item?.[0].item?.[2].answer).toEqual([
      { valueReference: { reference: 'DocumentReference/evidence/_history/v1' } },
    ]);
    expect(request.submissionId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it.each(['foreign-worker', 'foreign-project', 'wrong-version'])('rejects %s evidence', (scenario) => {
    const document = structuredClone(evidence);
    if (scenario === 'foreign-worker') document.subject = { reference: 'Patient/other' };
    if (scenario === 'foreign-project') document.meta!.project = 'other';
    const input = structuredClone(response);
    if (scenario === 'wrong-version')
      input.item![0].item![2].answer = [{ valueReference: { reference: 'DocumentReference/evidence/_history/old' } }];
    expect(() => prepareIntake(questionnaire, input, patient, [document])).toThrow('verified evidence');
  });
  it('refuses malformed dates and repeated answers', () => {
    const input = structuredClone(response);
    input.item![0].item![0].answer = [{ valueDate: '2026-02-30' }];
    expect(() => prepareIntake(questionnaire, input, patient, [evidence])).toThrow('valid date');
    input.item![0].item!.push(input.item![0].item![0]);
    expect(() => prepareIntake(questionnaire, input, patient, [evidence])).toThrow('Repeated');
  });
  it('removes disabled measured values instead of turning unknown into zero', () => {
    const definition = structuredClone(questionnaire);
    definition.item![0].item!.unshift({
      linkId: 'availability',
      type: 'choice',
      required: true,
      answerOption: [{ valueCoding: { system: 'codes', code: 'unknown' } }],
    });
    definition.item![0].item![2].enableWhen = [
      { question: 'availability', operator: '=', answerCoding: { system: 'codes', code: 'measured' } },
    ];
    const input = structuredClone(response);
    input.item![0].item!.unshift({
      linkId: 'availability',
      answer: [{ valueCoding: { system: 'codes', code: 'unknown' } }],
    });
    const request = prepareIntake(definition, input, patient, [evidence]);
    expect(request.response.item![0].item?.find((item) => item.linkId === 'value')).toBeUndefined();
  });
  it('binds amendments to an exact original exposure and structured reason', () => {
    const request = prepareIntake(questionnaire, response, patient, [evidence], {
      exposure: 'Observation/exposure/_history/v7',
      reason: 'correct-dates',
    });
    expect(request.exposure).toBe('Observation/exposure/_history/v7');
    expect(request.amendmentReason).toBe('correct-dates');
    expect(() =>
      prepareIntake(questionnaire, response, patient, [evidence], {
        exposure: 'Observation/exposure',
        reason: 'correct-dates',
      })
    ).toThrow('exact exposure');
  });
  it('refuses a different Project before any query or mutation', async () => {
    const medplum = client();
    vi.mocked(medplum.getProject).mockReturnValue({ resourceType: 'Project', id: 'other' });
    const read = vi.spyOn(medplum, 'readResource');
    const search = vi.spyOn(medplum, 'searchResources');
    const post = vi.spyOn(medplum, 'post');
    await expect(loadIntake(medplum)).rejects.toThrow('Project');
    await expect(loadIntakeAssessments(medplum, patient)).rejects.toThrow('Project');
    await expect(saveIntake(medplum, prepareIntake(questionnaire, response, patient, [evidence]))).rejects.toThrow(
      'Project'
    );
    expect(read).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
  it('previews without persistence and submits the identical fixed request through the Bot only', async () => {
    const medplum = client();
    const request = prepareIntake(questionnaire, response, patient, [evidence]);
    const post = vi
      .spyOn(medplum, 'post')
      .mockResolvedValueOnce({ mode: 'preview', persisted: false, state: 'active' })
      .mockResolvedValueOnce({
        status: 'completed',
        replayed: false,
        receipt: 'Task/receipt/_history/v1',
        resources: [
          { step: 'submission', reference: 'QuestionnaireResponse/submission/_history/v1' },
          { step: 'exposure', reference: 'Observation/exposure/_history/v1' },
          { step: 'lineage', reference: 'Provenance/lineage/_history/v1' },
        ],
      });
    const update = vi.spyOn(medplum, 'updateResource');
    expect(await previewIntake(medplum, request)).toBe('active');
    expect((await saveIntake(medplum, request)).status).toBe('completed');
    expect(post.mock.calls[0][1]).toEqual({ ...request, mode: 'preview' });
    expect(post.mock.calls[1][1]).toBe(request);
    expect(post.mock.calls[1][3]).toEqual({ maxRetries: 0 });
    expect(update).not.toHaveBeenCalled();
  });
  it('treats in-progress receipts as uncertain, not completed', async () => {
    const medplum = client();
    vi.spyOn(medplum, 'post').mockResolvedValue({ status: 'in-progress', receipt: 'Task/receipt' });
    await expect(saveIntake(medplum, prepareIntake(questionnaire, response, patient, [evidence]))).rejects.toThrow(
      'uncertain'
    );
  });
});
