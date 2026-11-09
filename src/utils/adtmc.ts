import type { MedplumClient } from '@medplum/core';
import type { Resource } from '@medplum/fhirtypes';

const ARMY_SECURITY = { system: 'https://ehr.hiivehealth.net/fhir/CodeSystem/workflow-access', code: 'army' };

export function hasArmySecurity(resource: Resource | undefined): boolean {
  return resource?.meta?.security?.some((coding) => coding.system === ARMY_SECURITY.system && coding.code === ARMY_SECURITY.code) === true;
}

export function withArmySecurity<T extends Resource>(resource: T): T {
  return hasArmySecurity(resource) ? resource : {
    ...resource,
    meta: { ...resource.meta, security: [...(resource.meta?.security ?? []), ARMY_SECURITY] },
  };
}

export function hasArmyAccess(medplum: MedplumClient, expectedProjectId?: string): boolean {
  try {
    const project = medplum.getProject();
    const features: readonly string[] = Array.isArray(project?.features) ? project.features : [];
    const membership = medplum.getProjectMembership();
    const profile = medplum.getProfile();
    const active: unknown = membership?.active;
    return !!(
      project?.id &&
      (!expectedProjectId || project.id === expectedProjectId) &&
      features.includes('army') &&
      membership && (active === undefined || active === true) &&
      membership.project.reference === `Project/${project.id}` &&
      profile?.id &&
      membership.profile.reference === `${profile.resourceType}/${profile.id}`
    );
  } catch {
    return false;
  }
}