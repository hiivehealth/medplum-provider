// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Project, ResourceType } from '@medplum/fhirtypes';

export const RESOURCE_PROFILE_URLS: Partial<Record<ResourceType, string>> = {
  Patient: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient',
  ServiceRequest: 'http://medplum.com/StructureDefinition/medplum-provider-lab-procedure-servicerequest',
  Device: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-implantable-device',
};

/** Project.setting name prefix for a tenant-specific default profile override, e.g. "defaultProfile:Patient". */
const DEFAULT_PROFILE_SETTING_PREFIX = 'defaultProfile:';

/**
 * Resolves the default profile URL for a resource type, preferring a per-tenant override from
 * the current Medplum Project's settings (Project.setting, name `defaultProfile:<ResourceType>`)
 * over the hardcoded RESOURCE_PROFILE_URLS fallback.
 * @param resourceType - The resource type to resolve a default profile for.
 * @param project - The current Medplum Project, if available.
 * @returns The profile URL to use, or undefined if none is configured.
 */
export function getDefaultProfileUrl(resourceType: ResourceType, project: Project | undefined): string | undefined {
  const settingName = `${DEFAULT_PROFILE_SETTING_PREFIX}${resourceType}`;
  const override = project?.setting?.find((s) => s.name === settingName)?.valueString;
  return override ?? RESOURCE_PROFILE_URLS[resourceType];
}
