// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { Resource, Task } from '@medplum/fhirtypes';

export const A01_QUESTIONNAIRE_URL = 'https://ehr.hiivehealth.net/fhir/Questionnaire/a01-sore-throat';
export const A01_DOCUMENT_IDENTIFIER_SYSTEM = 'https://ehr.hiivehealth.net/fhir/NamingSystem/adtmc-a01-document';
export const A01_DOCUMENTS = [
  { key: 'a01-sore-throat-hoarseness', title: 'A-1 Sore Throat/Hoarseness' },
  { key: 'policy-guide', title: 'Policy Guide' },
  { key: 'obtain-a-throat-culture', title: 'Obtain a Throat Culture' },
  { key: 'perform-an-heent-exam', title: 'Perform an HEENT Exam' },
  { key: 'care-for-common-throat-infections', title: 'Care for Common Throat Infections' },
] as const;

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

export function isAdtmcTask(task: Task): boolean {
  return (
    task.code?.text?.includes('ADTMC') === true ||
    task.extension?.some(
      (extension) => extension.url === 'https://ehr.hiivehealth.net/fhir/StructureDefinition/adtmc-algorithm-id'
    ) === true
  );
}