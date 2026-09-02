import type { BotEvent, MedplumClient } from '@medplum/core';
import type { AuditEvent, ProjectMembership } from '@medplum/fhirtypes';
import { describe, expect, test, vi } from 'vitest';
import { handler } from './nevadaBreakGlassAccess';

describe('Nevada Break-Glass activation Bot', () => {
  const audit: AuditEvent = {
    resourceType: 'AuditEvent',
    action: 'R',
    outcome: '0',
    outcomeDesc: 'Emergency evaluation',
    subtype: [{ code: 'emergency-access' }],
    agent: [{ requestor: true, who: { reference: 'Practitioner/provider-1' } }],
    entity: [{ what: { reference: 'Patient/patient-1' } }],
    meta: { author: { reference: 'Practitioner/provider-1' } },
  };

  test('adds a patient and expiration parameter to an existing restricted-policy membership', async () => {
    const membership: ProjectMembership = {
      resourceType: 'ProjectMembership',
      id: 'membership-1',
      project: { reference: 'Project/project-1' },
      user: { reference: 'User/user-1' },
      profile: { reference: 'Practitioner/provider-1' },
      access: [{ policy: { reference: 'AccessPolicy/27a0a676-34a9-4347-b958-b6588e1c2415' }, parameter: [] }],
    };
    const updateResource = vi.fn().mockResolvedValue(membership);
    const createResource = vi.fn().mockResolvedValue({ resourceType: 'Provenance', id: 'provenance-1' });
    const medplum = {
      searchResources: vi.fn((resourceType: string) => {
        if (resourceType === 'Consent') return Promise.resolve([]);
        if (resourceType === 'AccessPolicy') {
          return Promise.resolve([{ resourceType: 'AccessPolicy', id: '27a0a676-34a9-4347-b958-b6588e1c2415' }]);
        }
        return Promise.resolve([membership]);
      }),
      updateResource,
      createResource,
    } as unknown as MedplumClient;
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-27T13:00:00.000Z'));

    await handler(medplum, { input: audit } as BotEvent<AuditEvent>);

    expect(updateResource).toHaveBeenCalledWith(
      expect.objectContaining({
        access: [
          expect.objectContaining({
            parameter: expect.arrayContaining([
              { name: 'patient', valueReference: { reference: 'Patient/patient-1' } },
              { name: 'break_glass_expires_at', valueString: '2026-08-27T14:00:00.000Z' },
            ]),
          }),
        ],
      })
    );
    expect(updateResource).toHaveBeenCalledWith(
      expect.objectContaining({
        extension: [
          {
            url: 'https://hiivehealth.com/fhir/StructureDefinition/break-glass-expiration',
            valueDateTime: '2026-08-27T14:00:00.000Z',
          },
        ],
      })
    );
    expect(createResource).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Provenance' }));
    now.mockRestore();
  });

  test('rejects providers that still have only the broad policy', async () => {
    const medplum = {
      searchResources: vi.fn((resourceType: string) =>
        Promise.resolve(
          resourceType === 'Consent'
            ? []
            : [
                {
                  resourceType: 'ProjectMembership',
                  id: 'membership-1',
                  profile: { reference: 'Practitioner/provider-1' },
                  accessPolicy: { reference: 'AccessPolicy/05fa99c3-6400-4d8c-af38-8b00b890315d' },
                },
              ]
        )
      ),
    } as unknown as MedplumClient;

    await expect(handler(medplum, { input: audit } as BotEvent<AuditEvent>)).rejects.toThrow(
      'Provider is not assigned to the restricted Break-Glass policy.'
    );
  });

  test('rejects an event authored by a different practitioner', async () => {
    const medplum = {
      searchResources: vi.fn((resourceType: string) => Promise.resolve(resourceType === 'Consent' ? [] : [])),
    } as unknown as MedplumClient;
    const forged = { ...audit, meta: { author: { reference: 'Practitioner/other-provider' } } };

    await expect(handler(medplum, { input: forged } as BotEvent<AuditEvent>)).rejects.toThrow(
      'Break-Glass request author does not match the requesting Practitioner.'
    );
  });
});