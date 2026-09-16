import type { MedplumClient } from '@medplum/core';
import type { Project } from '@medplum/fhirtypes';

export const CUI_ENABLED_URL = 'https://medplum.com/fhir/StructureDefinition/cui-banner-enabled';
export const CUI_PROJECT_PROFILE_URL = 'https://medplum.com/fhir/StructureDefinition/cui-project';

export interface CuiPolicy {
  readonly projectId: string;
  readonly enabled: boolean;
  readonly canManage: boolean;
}

/** All applications consume this server-derived decision, never the protected extension directly. */
export async function resolveCuiPolicy(medplum: MedplumClient, projectId: string): Promise<CuiPolicy> {
  const result = (await medplum.get('auth/cui-banner', { cache: 'no-store' })) as Partial<CuiPolicy>;
  if (result?.projectId !== projectId || typeof result.enabled !== 'boolean' || typeof result.canManage !== 'boolean') {
    throw new Error('Invalid CUI project policy response');
  }
  return result as CuiPolicy;
}

export function setCuiEnabled(project: Project, enabled: boolean): Project {
  return {
    ...project,
    extension: [
      ...(project.extension?.filter((e) => e.url !== CUI_ENABLED_URL) ?? []),
      { url: CUI_ENABLED_URL, valueBoolean: enabled },
    ],
  };
}
