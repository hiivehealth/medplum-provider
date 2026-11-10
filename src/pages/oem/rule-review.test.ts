import type { DocumentReference, PlanDefinition, Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { describe, expect, it, vi } from 'vitest';
import { OEM_PROJECT_ID } from './ih-review';
import {
  browserRuleFingerprint,
  loadRuleReviewDetail,
  loadRuleReviews,
  OEM_RULE_BOT_ID,
  ruleTaskReference,
  submitRuleReview,
} from './rule-review';

const NS = 'https://hiivehealth.com/fhir';
async function fixture() {
  const rule: PlanDefinition & { id: string } = {
    resourceType: 'PlanDefinition',
    id: 'rule',
    meta: { project: OEM_PROJECT_ID, versionId: 'r1' },
    status: 'draft',
    experimental: true,
    version: 'matrix-13-draft-1',
    url: `${NS}/PlanDefinition/noise-503-matrix-13`,
    relatedArtifact: [{ type: 'derived-from', resource: 'DocumentReference/source/_history/d1' }],
    extension: [
      {
        url: `${NS}/StructureDefinition/oem-source-sha256`,
        valueString: 'c60c0406b829ec59122de1966a81b562b9e6eac348550cca2496cf7246309b03',
      },
      {
        url: `${NS}/StructureDefinition/oem-rule-blocker`,
        extension: [
          { url: 'code', valueCode: 'baseline-timing' },
          { url: 'description', valueString: 'Timing needs policy review' },
        ],
      },
    ],
  };
  const task: Task & { id: string } = {
    resourceType: 'Task',
    id: 'review',
    meta: { project: OEM_PROJECT_ID, versionId: 't1' },
    status: 'requested',
    intent: 'proposal',
    code: { coding: [{ system: `${NS}/CodeSystem/oem-rule-review`, code: 'noise-503' }] },
    focus: { reference: 'PlanDefinition/rule/_history/r1' },
    input: [{ type: { text: 'Rule fingerprint' }, valueString: await browserRuleFingerprint(rule) }],
  };
  const source: DocumentReference & { id: string } = {
    resourceType: 'DocumentReference',
    id: 'source',
    status: 'current',
    meta: {
      project: OEM_PROJECT_ID,
      versionId: 'd1',
      tag: [{ system: `${NS}/CodeSystem/oem-policy-document`, code: 'noise-503' }],
    },
    content: [{ attachment: { title: 'Adopted Matrix' } }],
  };
  const client = new MockClient();
  vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
  vi.spyOn(client, 'readResource').mockResolvedValueOnce(rule).mockResolvedValueOnce(task);
  vi.spyOn(client, 'readVersion').mockResolvedValueOnce(rule).mockResolvedValueOnce(source);
  return { client, rule, task, source };
}

describe('admin rule-review adapter', () => {
  it('refuses another Project without querying or invoking', async () => {
    const client = new MockClient();
    const read = vi.spyOn(client, 'readResource');
    await expect(loadRuleReviews(client, 'requested')).rejects.toThrow('Project is required');
    expect(read).not.toHaveBeenCalled();
  });
  it('requires exact Bot access before loading the bounded review queue', async () => {
    const { client, task } = await fixture();
    vi.mocked(client.readResource)
      .mockReset()
      .mockResolvedValue({ resourceType: 'Bot', id: OEM_RULE_BOT_ID, meta: { project: OEM_PROJECT_ID } });
    const search = vi
      .spyOn(client, 'searchResources')
      .mockResolvedValue(
        Object.assign([task], { bundle: { resourceType: 'Bundle' as const, type: 'searchset' as const } })
      );
    expect(await loadRuleReviews(client, 'requested')).toHaveLength(1);
    expect(search).toHaveBeenCalledWith('Task', expect.objectContaining({ _count: '50', status: 'requested' }), {
      cache: 'no-cache',
    });
    vi.mocked(client.readResource).mockRejectedValue(new Error('Forbidden'));
    search.mockClear();
    await expect(loadRuleReviews(client, 'requested')).rejects.toThrow();
    expect(search).not.toHaveBeenCalled();
  });
  it('loads exact draft/source histories and preserves unresolved requirements', async () => {
    const { client, task } = await fixture();
    const detail = await loadRuleReviewDetail(client, task);
    expect(detail).toMatchObject({
      stale: false,
      approvalBlocked: true,
      blockers: [{ code: 'baseline-timing', description: 'Timing needs policy review' }],
    });
    expect(client.readVersion).toHaveBeenCalledWith('DocumentReference', 'source', 'd1', { cache: 'no-cache' });
  });
  it.each(['fingerprint', 'foreign-source', 'patient-source', 'untagged-source', 'wrong-history'])(
    'refuses %s evidence',
    async (kind) => {
      const { client, task, rule, source } = await fixture();
      if (kind === 'fingerprint') rule.title = 'Changed body';
      if (kind === 'foreign-source') source.meta!.project = 'other';
      if (kind === 'patient-source') source.subject = { reference: 'Patient/worker' };
      if (kind === 'untagged-source') source.meta!.tag = [];
      if (kind === 'wrong-history') source.meta!.versionId = 'different';
      await expect(loadRuleReviewDetail(client, task)).rejects.toThrow();
    }
  );
  it.each(['rule', 'task'])('marks changed current %s read-only', async (kind) => {
    const { client, task, rule } = await fixture();
    vi.mocked(client.readResource)
      .mockReset()
      .mockResolvedValueOnce(kind === 'rule' ? { ...rule, meta: { ...rule.meta, versionId: 'r2' } } : rule)
      .mockResolvedValueOnce(kind === 'task' ? { ...task, meta: { ...task.meta, versionId: 't2' } } : task);
    expect((await loadRuleReviewDetail(client, task)).stale).toBe(true);
  });
  it('blocks unresolved approval before posting', async () => {
    const { client, task } = await fixture();
    const post = vi.spyOn(client, 'post');
    await expect(submitRuleReview(client, task, 'approve', 'source-contract-verified')).rejects.toThrow(
      'policy requirements'
    );
    expect(post).not.toHaveBeenCalled();
  });
  it('submits only exact Task and structured change request, with no actor or activation', async () => {
    const { client, task } = await fixture();
    const post = vi.spyOn(client, 'post').mockResolvedValue({
      status: 'recorded',
      task: 'Task/review/_history/t2',
      decision: 'request-changes',
      activated: false,
      clinicalWrites: 0,
    });
    expect(await submitRuleReview(client, task, 'request-changes', 'timing-unresolved')).toBe(
      'Task/review/_history/t2'
    );
    expect(post).toHaveBeenCalledWith(
      `fhir/R4/Bot/${OEM_RULE_BOT_ID}/$execute`,
      {
        mode: 'review-noise-rule',
        task: ruleTaskReference(task),
        decision: 'request-changes',
        reason: 'timing-unresolved',
      },
      'application/json',
      { maxRetries: 0 }
    );
  });
  it.each(['activated', 'clinical-writes', 'wrong-task', 'wrong-decision', 'unversioned'])(
    'refuses malformed completion: %s',
    async (kind) => {
      const { client, task } = await fixture();
      const result = {
        status: 'recorded',
        task: 'Task/review/_history/t2',
        decision: 'request-changes',
        activated: false,
        clinicalWrites: 0,
      };
      if (kind === 'activated') result.activated = true;
      if (kind === 'clinical-writes') result.clinicalWrites = 1;
      if (kind === 'wrong-task') result.task = 'Task/other/_history/t2';
      if (kind === 'wrong-decision') result.decision = 'approve';
      if (kind === 'unversioned') result.task = 'Task/review';
      vi.spyOn(client, 'post').mockResolvedValue(result);
      await expect(submitRuleReview(client, task, 'request-changes', 'timing-unresolved')).rejects.toThrow();
    }
  );
});
