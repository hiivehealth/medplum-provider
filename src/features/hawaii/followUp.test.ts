import { ReadablePromise } from '@medplum/core';
import type { WithId } from '@medplum/core';
import type { Consent, Encounter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { describe, expect, test, vi } from 'vitest';
import { buildHawaiiFollowUp, getHawaiiFollowUpIdentifier, handleHawaiiDischarge, HAWAII_FOLLOW_UP_SYSTEM } from './followUp';

describe('Hawaii discharge follow-up contract', () => {
  const encounter: WithId<Encounter> = {
    resourceType: 'Encounter', id: 'discharge-1', status: 'finished', class: { code: 'IMP' },
    subject: { reference: 'Patient/allowed' }, serviceProvider: { reference: 'Organization/hospital' },
    period: { end: '2026-10-16T12:00:00Z' },
  };
  const receipt = '2026-10-16T12:00:04Z';

  test('links an assigned native Task to the patient and source event, preserving event and receipt times', () => {
    const task = buildHawaiiFollowUp(encounter, 'allowed', 'Practitioner/clinician', receipt);
    expect(task).toMatchObject({
      resourceType: 'Task', status: 'requested', intent: 'order',
      for: { reference: 'Patient/allowed' }, owner: { reference: 'Practitioner/clinician' },
      focus: { reference: 'Encounter/discharge-1' }, authoredOn: receipt,
      input: [{ valueDateTime: encounter.period?.end }],
    });
  });

  test('uses the same conditional-create identity across duplicate event deliveries', () => {
    const original = buildHawaiiFollowUp(encounter, 'allowed', 'Practitioner/clinician', receipt);
    const replay = buildHawaiiFollowUp(encounter, 'allowed', 'Practitioner/clinician', '2026-10-16T12:00:09Z');
    expect(replay.identifier).toEqual(original.identifier);
    expect(getHawaiiFollowUpIdentifier('discharge-1')).toBe(`${HAWAII_FOLLOW_UP_SYSTEM}|Encounter/discharge-1`);
  });

  test.each([
    { ...encounter, status: 'in-progress' as const },
    { ...encounter, subject: { reference: 'Patient/denied' } },
    { ...encounter, class: { code: 'AMB' } },
    { ...encounter, period: { end: 'invalid' } },
  ])('rejects an unrelated or incomplete event', (event) => {
    expect(() => buildHawaiiFollowUp(event, 'allowed', 'Practitioner/clinician', receipt)).toThrow();
  });

  function client(consentType: 'permit' | 'deny' = 'permit'): MockClient {
    const medplum = new MockClient();
    vi.spyOn(medplum, 'readResource').mockResolvedValue(encounter);
    const consents: WithId<Consent>[] = [{
      resourceType: 'Consent', id: 'consent-1', status: 'active', scope: {}, category: [{}],
      patient: { reference: 'Patient/allowed' }, provision: { type: consentType },
    }];
    vi.spyOn(medplum, 'searchResources').mockReturnValue(new ReadablePromise(Promise.resolve(Object.assign(consents, {
      bundle: { resourceType: 'Bundle' as const, type: 'searchset' as const },
    }))));
    return medplum;
  }

  test('rereads the persisted event and uses native conditional creation without updating an existing task', async () => {
    const medplum = client();
    const completed = { ...buildHawaiiFollowUp(encounter, 'allowed', 'Practitioner/clinician', receipt),
      id: 'existing-task', status: 'completed' as const };
    const create = vi.spyOn(medplum, 'createResourceIfNoneExist').mockResolvedValue(completed);
    const update = vi.spyOn(medplum, 'updateResource');
    const result = await handleHawaiiDischarge(medplum, encounter, { patientId: 'allowed', ownerReference: 'Practitioner/clinician' }, receipt);
    expect(result.status).toBe('completed');
    expect(medplum.readResource).toHaveBeenCalledWith('Encounter', 'discharge-1', { cache: 'no-cache' });
    expect(new URLSearchParams(create.mock.calls[0][1]).get('identifier')).toBe(getHawaiiFollowUpIdentifier('discharge-1'));
    expect(update).not.toHaveBeenCalled();
  });

  test('does not create work after consent denial', async () => {
    const medplum = client('deny');
    const create = vi.spyOn(medplum, 'createResourceIfNoneExist');
    await expect(handleHawaiiDischarge(medplum, encounter, { patientId: 'allowed', ownerReference: 'Practitioner/clinician' }, receipt)).rejects.toThrow('permission');
    expect(create).not.toHaveBeenCalled();
  });

  test('rejects a forged payload when the persisted event belongs to another patient', async () => {
    const medplum = client();
    vi.mocked(medplum.readResource).mockResolvedValue({ ...encounter, subject: { reference: 'Patient/denied' } });
    const create = vi.spyOn(medplum, 'createResourceIfNoneExist');
    await expect(handleHawaiiDischarge(medplum, encounter, { patientId: 'allowed', ownerReference: 'Practitioner/clinician' }, receipt)).rejects.toThrow('patient-bound');
    expect(create).not.toHaveBeenCalled();
  });
});