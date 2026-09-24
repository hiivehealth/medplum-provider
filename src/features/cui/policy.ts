import type { MedplumClient } from '@medplum/core';
import type { Basic } from '@medplum/fhirtypes';

export const CUI_ENABLED_URL = 'https://ehr.hiivehealth.net/fhir/StructureDefinition/cui-banner-enabled';
export const CUI_CONFIGURATION_PROFILE_URL =
  'https://ehr.hiivehealth.net/fhir/StructureDefinition/cui-configuration';

export interface CuiPolicy {
  readonly projectId: string;
  readonly enabled: boolean;
  readonly canManage: boolean;
  readonly configurationId?: string;
}

/** Reads the project-scoped configuration through the authenticated Medplum client. */
export async function resolveCuiPolicy(medplum: MedplumClient, projectId: string): Promise<CuiPolicy> {
  const configuration = await medplum.searchOne(
    'Basic',
    { _profile: CUI_CONFIGURATION_PROFILE_URL },
    { cache: 'no-store' }
  );
  const canManage = medplum.getProjectMembership()?.admin === true;
  if (!configuration) {
    return { projectId, enabled: false, canManage };
  }
  if (
    configuration.meta?.project !== projectId ||
    !configuration.meta?.profile?.includes(CUI_CONFIGURATION_PROFILE_URL)
  ) {
    throw new Error('Invalid CUI project configuration');
  }
  const values = configuration.extension?.filter((extension) => extension.url === CUI_ENABLED_URL) ?? [];
  if (
    values.length > 1 ||
    values.some(
      (extension) =>
        typeof extension.valueBoolean !== 'boolean' ||
        extension.extension ||
        Object.keys(extension).some((key) => key.startsWith('value') && key !== 'valueBoolean')
    )
  ) {
    throw new Error('Invalid CUI project configuration');
  }
  return {
    projectId,
    enabled: values[0]?.valueBoolean === true,
    canManage,
    configurationId: configuration.id,
  };
}

export function setCuiEnabled(project: Basic, enabled: boolean): Basic {
  return {
    ...project,
    extension: [
      ...(project.extension?.filter((e) => e.url !== CUI_ENABLED_URL) ?? []),
      { url: CUI_ENABLED_URL, valueBoolean: enabled },
    ],
  };
}

export function createCuiConfiguration(projectId: string): Basic {
  return {
    resourceType: 'Basic',
    meta: { project: projectId, profile: [CUI_CONFIGURATION_PROFILE_URL] },
    code: { text: 'CUI configuration' },
    extension: [{ url: CUI_ENABLED_URL, valueBoolean: false }],
  };
}
