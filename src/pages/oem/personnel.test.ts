import type { QuestionnaireResponse } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { describe, expect, test, vi } from 'vitest';
import { OEM_PROJECT_ID } from './ih-review';
import type { PersonnelResult } from './personnel';
import {
  PERSONNEL_CANONICAL,
  PERSONNEL_SOURCE,
  PERSONNEL_WORKER,
  pendingPersonnel,
  loadPersonnelHistory,
  preparePersonnelResponse,
  previewPersonnel,
  savePersonnel,
} from './personnel';

function client(): MockClient {
  const medplum = new MockClient();
  vi.spyOn(medplum, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
  vi.spyOn(medplum, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
  return medplum;
}

describe('synthetic personnel preview', () => {
  const response: QuestionnaireResponse = {
    resourceType: 'QuestionnaireResponse',
    status: 'completed',
    item: [
      { linkId: 'source-evidence', answer: [{ valueReference: { reference: PERSONNEL_SOURCE, display: 'Fixture' } }] },
      {
        linkId: 'fact-kind',
        answer: [{ valueCoding: { system: 'system', code: 'population', display: 'Population' } }],
      },
    ],
  };
  test('prepares only minimal typed answers without trusting form attribution', () => {
    const prepared = preparePersonnelResponse({
      ...response,
      author: { reference: 'Practitioner/spoof' },
      authored: '2000-01-01',
    });
    expect(prepared.author).toBeUndefined();
    expect(prepared.authored).toBeUndefined();
    expect(prepared.questionnaire).toBe(PERSONNEL_CANONICAL);
    expect(prepared.subject?.reference).toBe(PERSONNEL_WORKER);
    expect(prepared.item?.[0].answer?.[0].valueReference).toEqual({ reference: PERSONNEL_SOURCE });
    expect(prepared.item?.[1].answer?.[0].valueCoding).toEqual({ system: 'system', code: 'population' });
  });
  test('rejects foreign Project before calling any Bot', async () => {
    const medplum = client();
    vi.mocked(medplum.getProject).mockReturnValue({ resourceType: 'Project', id: 'foreign' });
    const post = vi.spyOn(medplum, 'post');
    await expect(previewPersonnel(medplum, response)).rejects.toThrow('Army OEM');
    expect(post).not.toHaveBeenCalled();
  });
  test('rejects an unpinned source before calling any Bot', async () => {
    const medplum = client();
    const post = vi.spyOn(medplum, 'post');
    await expect(previewPersonnel(medplum, { ...response, item: [] })).rejects.toThrow('supporting document');
    expect(post).not.toHaveBeenCalled();
  });
  test('refuses a response claiming persistence', async () => {
    const medplum = client();
    vi.spyOn(medplum, 'post').mockResolvedValue({ mode: 'preview', persisted: true });
    await expect(previewPersonnel(medplum, response)).rejects.toThrow('could not be verified');
  });
  function successfulResult(request: { response: QuestionnaireResponse; submissionId: string }): PersonnelResult {
    const at = '2026-10-22T12:00:00.000Z';
    return {
      mode: 'preview',
      persisted: false,
      activated: false,
      clinicalWrites: 0,
      fingerprint: 'a'.repeat(64),
      authority: 'synthetic-clinician-attestation',
      issues: [],
      collection: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            fullUrl: 'urn:uuid:response',
            resource: {
              ...request.response,
              id: 'response',
              authored: at,
              author: { reference: 'Practitioner/clinician' },
              identifier: {
                system: 'https://hiivehealth.com/fhir/identifier/synthetic-dod-personnel-attestation',
                value: request.submissionId,
              },
            },
          },
          {
            fullUrl: 'urn:uuid:fact',
            resource: {
              resourceType: 'Observation',
              id: 'fact',
              status: 'final',
              code: {
                coding: [
                  { system: 'https://hiivehealth.com/fhir/CodeSystem/synthetic-dod-noise-fact', code: 'population' },
                ],
              },
              subject: { reference: PERSONNEL_WORKER },
              performer: [{ reference: 'Practitioner/clinician' }],
              valueCodeableConcept: { coding: [{ code: 'military' }] },
            },
          },
          {
            fullUrl: 'urn:uuid:provenance',
            resource: {
              resourceType: 'Provenance',
              id: 'provenance',
              recorded: at,
              target: [{ reference: 'urn:uuid:fact' }],
              agent: [{ who: { reference: 'Practitioner/clinician' } }],
              entity: [
                { role: 'source', what: { reference: PERSONNEL_SOURCE } },
                { role: 'source', what: { reference: 'urn:uuid:response' } },
              ],
            },
          },
        ],
      },
    };
  }
  const complete: QuestionnaireResponse = {
    ...response,
    item: [
      ...response.item!,
      { linkId: 'population', answer: [{ valueCoding: { system: 'system', code: 'military' } }] },
    ],
  };
  test('accepts a bound attributed no-write collection and posts only preview without time or actor', async () => {
    const medplum = client();
    const post = vi
      .spyOn(medplum, 'post')
      .mockImplementation(
        async (_url, body) =>
          successfulResult(body as { response: QuestionnaireResponse; submissionId: string }) as never
      );
    expect((await previewPersonnel(medplum, complete)).persisted).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
    const payload = post.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['mode', 'patient', 'response', 'submissionId']);
    expect(payload.mode).toBe('preview');
  });
  test.each(['author', 'worker', 'fact', 'lineage', 'submission', 'version'])(
    'rejects mismatched %s in returned artifacts',
    async (mismatch) => {
      const medplum = client();
      vi.spyOn(medplum, 'post').mockImplementation(async (_url, body) => {
        const value = successfulResult(body as { response: QuestionnaireResponse; submissionId: string });
        const submission = value.collection.entry![0].resource as QuestionnaireResponse;
        if (mismatch === 'author') submission.author = { reference: 'Practitioner/other' };
        if (mismatch === 'worker') submission.subject = { reference: 'Patient/other' };
        if (mismatch === 'fact')
          value.collection.entry![1].resource = {
            resourceType: 'Observation',
            id: 'fact',
            status: 'final',
            code: { text: 'wrong' },
          };
        if (mismatch === 'lineage')
          value.collection.entry![2].resource = {
            resourceType: 'Provenance',
            id: 'provenance',
            recorded: '2026-10-22',
            target: [],
            agent: [],
          };
        if (mismatch === 'submission') submission.identifier!.value = 'other';
        if (mismatch === 'version') submission.meta = { versionId: 'fabricated' };
        return value as never;
      });
      await expect(previewPersonnel(medplum, complete)).rejects.toThrow('could not be verified');
    }
  );
  function saveFixture(medplum: MockClient) {
    const pending = pendingPersonnel(medplum, successfulResult({ response: preparePersonnelResponse(complete), submissionId: '22222222-2222-4222-8222-222222222222' }));
    const result = { status: 'completed' as const, activated: false as const, replayed: true, submissionId: pending.submissionId,
      fingerprint: 'b'.repeat(64), receipt: 'Task/receipt/_history/v5', resources: ['QuestionnaireResponse', 'Observation', 'Provenance'].map((type, index) => ({
        step: ['submission', 'fact', 'lineage'][index], reference: `${type}/saved-${index}/_history/v1`,
      })) };
    const collection = structuredClone(pending.collection);
    const response = collection.entry![0].resource as QuestionnaireResponse;
    response.authored = '2026-10-22T13:00:00.000Z';
    response.item?.sort((first, second) => first.linkId.localeCompare(second.linkId));
    const provenance = collection.entry![2].resource!;
    if (provenance.resourceType === 'Provenance') provenance.recorded = response.authored;
    const records = new Map<string, import('@medplum/fhirtypes').Resource>();
    records.set(result.receipt, { resourceType: 'Task', id: 'receipt', meta: { project: OEM_PROJECT_ID, versionId: 'v5' }, status: 'completed', intent: 'order',
      identifier: [{ system: 'https://hiivehealth.com/fhir/identifier/synthetic-personnel-save-receipt', value: pending.submissionId }],
      code: { coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/synthetic-oem-operation', code: 'personnel-save' }] },
      for: { reference: PERSONNEL_WORKER }, requester: { reference: pending.actor }, authoredOn: response.authored,
      input: [{ type: { text: 'Immutable personnel save binding' }, valueString: result.fingerprint },
        { type: { text: 'Frozen server-generated personnel collection' }, valueString: JSON.stringify(collection) }],
      output: result.resources.map(item => ({ type: { text: item.step }, valueReference: { reference: item.reference } })),
    });
    for (const [index, entry] of collection.entry!.entries()) {
      const saved = structuredClone(entry.resource!);
      saved.id = `saved-${index}`;
      saved.meta = { project: OEM_PROJECT_ID, versionId: 'v1', tag: [
        { system: 'https://hiivehealth.com/fhir/CodeSystem/personnel-save-step', code: `${pending.submissionId}:${result.resources[index].step}` },
        { system: 'https://hiivehealth.com/fhir/CodeSystem/personnel-save-fingerprint', code: result.fingerprint },
      ] };
      if (saved.resourceType === 'Provenance') {
        saved.target = [{ reference: result.resources[1].reference }];
        saved.entity![1].what.reference = result.resources[0].reference;
      }
      records.set(result.resources[index].reference, saved);
    }
    const post = vi.spyOn(medplum, 'post').mockResolvedValue(result);
    const read = vi.spyOn(medplum, 'readVersion').mockImplementation(((type: string, id: string, version: string) =>
      Promise.resolve(structuredClone(records.get(`${type}/${id}/_history/${version}`)))) as never);
    return { pending, result, records, post, read };
  }
  test('confirms Save only after exact receipt and all three persisted histories are read', async () => {
    const medplum = client();
    const fixture = saveFixture(medplum);
    expect(await savePersonnel(medplum, fixture.pending)).toEqual(fixture.result);
    expect(fixture.read).toHaveBeenCalledTimes(4);
    expect(fixture.post.mock.calls[0][1]).toEqual({ mode: 'save', patient: PERSONNEL_WORKER,
      submissionId: fixture.pending.submissionId, response: fixture.pending.response });
    expect(fixture.post.mock.calls[0][3]).toEqual({ maxRetries: 0 });
  });
  test('reloads verified saved history without any Save call', async () => {
    const medplum = client();
    const fixture = saveFixture(medplum);
    vi.spyOn(medplum, 'searchResources').mockResolvedValue([fixture.records.get(fixture.result.receipt)] as never);
    const history = await loadPersonnelHistory(medplum);
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0].saved.resources).toEqual(fixture.result.resources);
    expect(history.entries[0].value).toBe('military');
    expect(history.limited).toBe(false);
    expect(fixture.post).not.toHaveBeenCalled();
    expect(fixture.read).toHaveBeenCalledTimes(4);
  });
  test('fails closed on unrelated or duplicate history receipts', async () => {
    const medplum = client();
    const fixture = saveFixture(medplum);
    const receipt = fixture.records.get(fixture.result.receipt)!;
    const search = vi.spyOn(medplum, 'searchResources').mockResolvedValue([receipt, receipt] as never);
    await expect(loadPersonnelHistory(medplum)).rejects.toThrow('search');
    if (receipt.resourceType === 'Task') receipt.for = { reference: 'Patient/other' };
    search.mockResolvedValue([receipt] as never);
    await expect(loadPersonnelHistory(medplum)).rejects.toThrow('scope');
    expect(fixture.post).not.toHaveBeenCalled();
  });
  test.each(['receipt', 'snapshot', 'history', 'content', 'lineage', 'in-progress', 'identity'])(
    'does not confirm Save with a mismatched %s', async mismatch => {
      const medplum = client();
      const fixture = saveFixture(medplum);
      const receipt = fixture.records.get(fixture.result.receipt)!;
      if (receipt.resourceType === 'Task') {
        if (mismatch === 'receipt') receipt.requester = { reference: 'Practitioner/other' };
        if (mismatch === 'snapshot') receipt.input![1].valueString = '{}';
      }
      const fact = fixture.records.get(fixture.result.resources[1].reference)!;
      if (mismatch === 'history') fact.meta!.versionId = 'other';
      if (mismatch === 'content' && fact.resourceType === 'Observation') fact.valueCodeableConcept = { text: 'changed' };
      const lineage = fixture.records.get(fixture.result.resources[2].reference)!;
      if (mismatch === 'lineage' && lineage.resourceType === 'Provenance') lineage.target = [{ reference: 'Observation/unrelated' }];
      if (mismatch === 'in-progress') fixture.post.mockResolvedValue({ ...fixture.result, status: 'in-progress' });
      if (mismatch === 'identity') vi.mocked(medplum.getProfile).mockReturnValue({ resourceType: 'Practitioner', id: 'other' });
      await expect(savePersonnel(medplum, fixture.pending)).rejects.toThrow();
      if (mismatch === 'identity') expect(fixture.post).not.toHaveBeenCalled();
    }
  );
});
