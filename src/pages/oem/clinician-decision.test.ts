import { MockClient } from '@medplum/mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DECISION_BOT_ID,
  DECISION_SYSTEM,
  DECISION_TASK_ID,
  loadDecisionTask,
  sendDecision,
  type DecisionInput,
} from './clinician-decision';
import { OEM_PROJECT_ID } from './ih-review';
import { LIFECYCLE_WORKER_ID } from './intake';

const NS = 'https://hiivehealth.com/fhir';
const fingerprint = 'a'.repeat(64);
const input: DecisionInput = {
  task: `Task/${DECISION_TASK_ID}/_history/original`,
  decision: 'accept',
  reason: 'local-proposal-requested',
};
const worker = `Patient/${LIFECYCLE_WORKER_ID}`;
const meta = { project: OEM_PROJECT_ID, versionId: 'saved' };
const response = {
  status: 'recorded',
  decision: 'accept',
  task: `Task/${DECISION_TASK_ID}/_history/saved`,
  receipt: 'Task/receipt/_history/saved',
  proposal: 'ServiceRequest/proposal/_history/saved',
  fingerprint,
  persisted: true,
  activated: false,
  externalDispatch: false,
  completionRecorded: false,
};

describe('native synthetic clinician decision adapter', () => {
  let client: MockClient;
  beforeEach(() => {
    client = new MockClient();
    vi.spyOn(client, 'getProject').mockReturnValue({ resourceType: 'Project', id: OEM_PROJECT_ID });
    vi.spyOn(client, 'getProfile').mockReturnValue({ resourceType: 'Practitioner', id: 'clinician' });
  });

  it('loads only the configured Bot and worker recommendation', async () => {
    const read = vi
      .spyOn(client, 'readResource')
      .mockResolvedValueOnce({ resourceType: 'Bot', id: DECISION_BOT_ID, meta })
      .mockResolvedValueOnce({
        resourceType: 'Task',
        id: DECISION_TASK_ID,
        meta,
        status: 'requested',
        intent: 'proposal',
        for: { reference: worker },
        code: { coding: [{ system: `${NS}/CodeSystem/oem-surveillance-action`, code: 'audiogram' }] },
      });
    expect((await loadDecisionTask(client)).status).toBe('requested');
    expect(read.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['Bot', DECISION_BOT_ID],
      ['Task', DECISION_TASK_ID],
    ]);
  });

  it('previews without actor/time fields, retries or history writes', async () => {
    const post = vi
      .spyOn(client, 'post')
      .mockResolvedValue({
        ...response,
        status: 'preview',
        persisted: false,
        task: input.task,
        receipt: undefined,
        proposal: undefined,
      });
    const history = vi.spyOn(client, 'readVersion');
    expect((await sendDecision(client, input, 'preview')).status).toBe('preview');
    expect(post).toHaveBeenCalledWith(
      `fhir/R4/Bot/${DECISION_BOT_ID}/$execute`,
      { ...input, mode: 'preview' },
      'application/json',
      { maxRetries: 0 }
    );
    expect(history).not.toHaveBeenCalled();
  });

  it('verifies exact receipt, actor and local proposal histories after a confirmed decision', async () => {
    const post = vi.spyOn(client, 'post').mockResolvedValue(response);
    const read = vi
      .spyOn(client, 'readVersion')
      .mockResolvedValueOnce({
        resourceType: 'Task',
        id: DECISION_TASK_ID,
        meta,
        status: 'accepted',
        intent: 'proposal',
        for: { reference: worker },
        owner: { reference: 'Practitioner/clinician' },
        extension: [{ url: `${NS}/StructureDefinition/oem-clinician-decision-fingerprint`, valueString: fingerprint }],
        output: [{ type: { text: 'Local proposal' }, valueReference: { reference: 'ServiceRequest/proposal' } }],
      })
      .mockResolvedValueOnce({
        resourceType: 'Task',
        id: 'receipt',
        meta,
        status: 'completed',
        intent: 'order',
        for: { reference: worker },
        requester: { reference: 'Practitioner/clinician' },
        focus: { reference: input.task },
        code: { coding: [{ system: DECISION_SYSTEM, code: 'receipt' }] },
        input: [
          { type: { text: 'Fingerprint' }, valueString: fingerprint },
          { type: { text: 'Decision' }, valueCode: 'accept' },
          { type: { text: 'Reason' }, valueCode: input.reason },
        ],
        output: ['proposal', 'task', 'audit', 'lineage'].map((name) => ({
          type: { text: name },
          valueReference: {
            reference:
              name === 'proposal'
                ? response.proposal
                : name === 'task'
                  ? response.task
                  : `${name}/evidence/_history/saved`,
          },
        })),
      })
      .mockResolvedValueOnce({
        resourceType: 'ServiceRequest',
        id: 'proposal',
        meta: { ...meta, tag: [{ system: `${NS}/CodeSystem/oem-decision-worker`, code: worker }] },
        status: 'draft',
        intent: 'proposal',
        subject: { reference: worker },
        requester: { reference: 'Practitioner/clinician' },
      });
    expect((await sendDecision(client, input, 'decide', fingerprint)).persisted).toBe(true);
    expect(read.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['Task', DECISION_TASK_ID, 'saved'],
      ['Task', 'receipt', 'saved'],
      ['ServiceRequest', 'proposal', 'saved'],
    ]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each(['foreign-task', 'actor', 'clock', 'invalid-date', 'wrong-reason', 'no-confirmed-preview'])(
    'refuses %s before invocation',
    async (kind) => {
      const changed = { ...input };
      if (kind === 'foreign-task') changed.task = 'Task/foreign/_history/one';
      if (kind === 'actor') Object.assign(changed, { actor: 'Practitioner/foreign' });
      if (kind === 'clock') Object.assign(changed, { at: '2020-01-01' });
      if (kind === 'invalid-date')
        Object.assign(changed, { decision: 'modify', reason: 'timing-adjusted', due: '2026-02-30' });
      if (kind === 'wrong-reason') changed.reason = 'evidence-pending';
      const post = vi.spyOn(client, 'post');
      await expect(
        sendDecision(client, changed, kind === 'no-confirmed-preview' ? 'decide' : 'preview')
      ).rejects.toThrow('exact Task version');
      expect(post).not.toHaveBeenCalled();
    }
  );

  it.each([
    { externalDispatch: true },
    { completionRecorded: true },
    { activated: true },
    { fingerprint: 'b'.repeat(64) },
    { task: 'Task/foreign/_history/saved' },
  ])('refuses unsafe or unbound confirmation %j', async (change) => {
    const post = vi.spyOn(client, 'post').mockResolvedValue({ ...response, ...change });
    await expect(sendDecision(client, input, 'decide', fingerprint)).rejects.toThrow('unconfirmed');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not turn a lost response into an automatic retry', async () => {
    const post = vi.spyOn(client, 'post').mockRejectedValue(new Error('Lost response'));
    await expect(sendDecision(client, input, 'decide', fingerprint)).rejects.toThrow('Lost response');
    expect(post).toHaveBeenCalledTimes(1);
  });
});
