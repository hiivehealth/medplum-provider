import type { DocumentReference, Observation, Patient, Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { describe, expect, it, vi } from 'vitest';
import {
  keepCurrent,
  loadReviewDetail,
  loadReviews,
  OEM_PROJECT_ID,
  OEM_REVIEW_BOT_ID,
  reviewReference,
} from './ih-review';

const task: Task & { id: string } = {
  resourceType: 'Task',
  id: 'review',
  meta: { project: OEM_PROJECT_ID, versionId: 'v1' },
  status: 'requested',
  intent: 'proposal',
  identifier: [{ system: 'https://hiivehealth.com/fhir/identifier/mock-ih-conflict', value: 'fingerprint' }],
  code: {
    coding: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/oem-ih-review', code: 'source-content-changed' }],
  },
  for: { reference: 'Patient/worker' },
  focus: { reference: 'Observation/exposure/_history/v1' },
};

describe('isolated OEM review client', () => {
  it('queries only conflict codes in the configured Project', async () => {
    const client = new MockClient();
    vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    const search = vi.spyOn(client, 'searchResources').mockResolvedValue(
      Object.assign([task], {
        bundle: { resourceType: 'Bundle' as const, type: 'searchset' as const, entry: [{ resource: task }] },
      })
    );
    const reviews = await loadReviews(client, 'requested');
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toEqual(task);
    expect(search.mock.calls[0][1]).toMatchObject({ status: 'requested', _count: '50' });
    expect(search.mock.calls[0][1]).toHaveProperty('code', expect.stringContaining('oem-ih-review'));
  });
  it('refuses another Project before searching or submitting', async () => {
    const client = new MockClient();
    const search = vi.spyOn(client, 'searchResources');
    const post = vi.spyOn(client, 'post');
    await expect(loadReviews(client, 'requested')).rejects.toThrow('Project is required');
    await expect(keepCurrent(client, task, 'clinician-record-preferred')).rejects.toThrow('Project is required');
    expect(search).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
  it('sends only the exact Task and structured decision to the published Bot', async () => {
    const client = new MockClient();
    vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    const post = vi.spyOn(client, 'post').mockResolvedValue({ status: 'resolved', clinicalWrites: 0 });
    const update = vi.spyOn(client, 'updateResource');
    await keepCurrent(client, task, 'clinician-record-preferred');
    expect(post).toHaveBeenCalledWith(
      `fhir/R4/Bot/${OEM_REVIEW_BOT_ID}/$execute`,
      {
        mode: 'resolve-ih-review',
        task: 'Task/review/_history/v1',
        decision: 'keep-current',
        reason: 'clinician-record-preferred',
      },
      'application/json'
    );
    expect(update).not.toHaveBeenCalled();
  });
  it.each(['project', 'version', 'code', 'reference'])('rejects malformed %s conflicts', (mutation) => {
    const changed = structuredClone(task);
    if (mutation === 'project') {
      changed.meta!.project = 'other';
    }
    if (mutation === 'version') {
      delete changed.meta!.versionId;
    }
    if (mutation === 'code') {
      changed.code!.coding![0].code = 'import-source';
    }
    if (mutation === 'reference') {
      changed.focus!.reference = 'https://external.example/Observation/foreign';
    }
    expect(() => reviewReference(changed)).toThrow();
  });
  it.each(['valid', 'stale', 'foreign-project', 'wrong-worker', 'wrong-history', 'incoming-worker'])(
    'checks exact worker-linked source detail: %s',
    async (mutation) => {
      const client = new MockClient();
      vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
      const patient: Patient & { id: string } = {
        resourceType: 'Patient',
        id: 'worker',
        meta: {
          project: OEM_PROJECT_ID,
          versionId: 'v1',
          tag: [{ system: 'https://hiivehealth.com/fhir/CodeSystem/demo-data', code: 'synthetic-only' }],
        },
      };
      const exposure: Observation & { id: string } = {
        resourceType: 'Observation',
        id: 'exposure',
        status: 'final',
        code: { text: 'Noise' },
        subject: { reference: 'Patient/worker' },
        meta: { project: OEM_PROJECT_ID, versionId: 'v1' },
      };
      const evidence: DocumentReference & { id: string } = {
        resourceType: 'DocumentReference',
        id: 'evidence',
        status: 'current',
        subject: { reference: 'Patient/worker' },
        meta: { project: OEM_PROJECT_ID, versionId: 'v1' },
        content: [{ attachment: { title: 'Synthetic evidence' } }],
      };
      const derivedFrom = [{ reference: 'DocumentReference/evidence/_history/v1' }];
      const incoming = {
        sourceVersion: 'v2',
        fingerprint: 'incoming',
        exposure: { ...exposure, derivedFrom },
        measurement: { ...exposure, derivedFrom, focus: [{ reference: task.focus!.reference }] },
      };
      if (mutation === 'foreign-project') {
        evidence.meta!.project = 'other';
      }
      if (mutation === 'wrong-worker') {
        evidence.subject!.reference = 'Patient/other';
      }
      if (mutation === 'wrong-history') {
        evidence.meta!.versionId = 'different';
      }
      if (mutation === 'incoming-worker') {
        incoming.measurement = { ...incoming.measurement, subject: { reference: 'Patient/other' } };
      }
      const conflict: Task = {
        ...task,
        input: [
          { type: { text: 'Version' }, valueString: 'v2' },
          { type: { text: 'Fingerprint' }, valueString: 'incoming' },
          { type: { text: 'Previous fingerprint' }, valueString: 'previous' },
          { type: { text: 'Evidence' }, valueReference: derivedFrom[0] },
          { type: { text: 'Facts' }, valueString: JSON.stringify(incoming) },
        ],
      };
      vi.spyOn(client, 'readResource')
        .mockResolvedValueOnce(patient)
        .mockResolvedValueOnce({
          ...exposure,
          meta: { ...exposure.meta, versionId: mutation === 'stale' ? 'v2' : 'v1' },
        });
      vi.spyOn(client, 'readVersion').mockResolvedValueOnce(exposure).mockResolvedValueOnce(evidence);
      if (mutation === 'valid' || mutation === 'stale') {
        const result = await loadReviewDetail(client, conflict);
        expect(result.stale).toBe(mutation === 'stale');
        expect(result.evidence.meta?.versionId).toBe('v1');
      } else {
        await expect(loadReviewDetail(client, conflict)).rejects.toThrow();
      }
    }
  );
});
