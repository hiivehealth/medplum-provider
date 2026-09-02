import type { BotEvent, MedplumClient } from '@medplum/core';
import type { ProjectMembership } from '@medplum/fhirtypes';
import { describe, expect, test, vi } from 'vitest';
import { handler } from './nevadaBreakGlassCleanup';

describe('Nevada Break-Glass cleanup Bot', () => {
  test('removes expired patient and expiration parameters', async () => {
    const membership: ProjectMembership = {
      resourceType: 'ProjectMembership',
      id: 'membership-1',
      access: [
        { policy: { reference: 'AccessPolicy/policy-1' }, parameter: [{ name: 'patient', valueReference: { reference: 'Patient/patient-1' } }] },
        {
          policy: { reference: 'AccessPolicy/policy-2' },
          parameter: [
            { name: 'patient', valueReference: { reference: 'Patient/patient-1' } },
            { name: 'break_glass_expires_at', valueString: '2026-08-27T12:00:00.000Z' },
          ],
        },
      ],
    };
    const updateResource = vi.fn().mockResolvedValue(membership);
    const medplum = { updateResource } as unknown as MedplumClient;
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-27T13:00:00.000Z'));

    await handler(medplum, { input: membership } as BotEvent<ProjectMembership>);

    expect(updateResource).toHaveBeenCalledWith(
      expect.objectContaining({
        access: [{ policy: { reference: 'AccessPolicy/policy-1' }, parameter: [{ name: 'patient', valueReference: { reference: 'Patient/patient-1' } }] }],
      })
    );
    now.mockRestore();
  });

  test('does not update memberships without expired grants', async () => {
    const updateResource = vi.fn();
    const medplum = { updateResource } as unknown as MedplumClient;
    await handler(medplum, { input: { resourceType: 'ProjectMembership', id: 'membership-1', access: [] } } as BotEvent<ProjectMembership>);
    expect(updateResource).not.toHaveBeenCalled();
  });
});