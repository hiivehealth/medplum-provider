import type { MedplumClient } from '@medplum/core';
import type { Basic } from '@medplum/fhirtypes';

export const CUI_ENABLED_URL = 'https://ehr.hiivehealth.net/fhir/StructureDefinition/cui-banner-enabled';
export const CUI_CONFIGURATION_PROFILE_URL =
  'https://ehr.hiivehealth.net/fhir/StructureDefinition/cui-configuration';

export interface CuiPolicy {
  readonly projectId: string;
  readonly enabled: boolean;
  readonly canManage: boolean;
  readonly configurationId: string;
}

/** All applications consume this server-derived decision, never the protected extension directly. */
export async function resolveCuiPolicy(medplum: MedplumClient, projectId: string): Promise<CuiPolicy> {
  if (!medplum.getAccessToken()) throw new Error('Authentication required');
  await medplum.refreshIfExpired();
  const token = medplum.getAccessToken();
  if (!token) throw new Error('Authentication required');
  const response = await fetch('/api/cui-banner', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Unable to resolve CUI project policy');
  const result = (await response.json()) as Partial<CuiPolicy>;
  if (
    result?.projectId !== projectId ||
    typeof result.enabled !== 'boolean' ||
    typeof result.canManage !== 'boolean' ||
    typeof result.configurationId !== 'string' ||
    !/^[A-Za-z0-9.-]{1,64}$/.test(result.configurationId)
  ) {
    throw new Error('Invalid CUI project policy response');
  }
  return result as CuiPolicy;
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
