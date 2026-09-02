import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Bundle, ProjectMembership } from '@medplum/fhirtypes';
import { BREAK_GLASS_EXPIRATION_PARAMETER } from '../utils/breakGlass';

/**
 * Removes expired Break-Glass patient parameters from a provider membership.
 * Invoke this handler from a scheduled native Medplum Bot job with memberships as input.
 */
export async function handler(
  medplum: MedplumClient,
  event: BotEvent<ProjectMembership | undefined>
): Promise<ProjectMembership | Bundle | undefined> {
  const memberships = event.input
    ? [event.input]
    : ((await medplum.searchResources('ProjectMembership', { active: 'true', _count: '1000' })) as ProjectMembership[]);
  const updated: ProjectMembership[] = [];

  for (const membership of memberships) {
    if (!membership.id) {
      continue;
    }
    const access = (membership.access ?? [])
      .map((entry) => {
        const expires = entry.parameter?.some((parameter) => {
          const expiration = parameter.valueString;
          return (
            parameter.name === BREAK_GLASS_EXPIRATION_PARAMETER &&
            expiration !== undefined &&
            Date.parse(expiration) <= Date.now()
          );
        });
        return expires
          ? {
              ...entry,
              parameter: entry.parameter?.filter(
                (parameter) => parameter.name !== 'patient' && parameter.name !== BREAK_GLASS_EXPIRATION_PARAMETER
              ),
            }
          : entry;
      })
      .filter((entry) => entry.parameter === undefined || entry.parameter.length > 0);
    if (JSON.stringify(access) !== JSON.stringify(membership.access ?? [])) {
      updated.push(await medplum.updateResource({ ...membership, access }));
    }
  }

  if (event.input) {
    return updated[0];
  }
  return updated.length > 0
    ? { resourceType: 'Bundle', type: 'batch', entry: updated.map((resource) => ({ resource })) }
    : undefined;
}