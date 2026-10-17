import type { Project } from '@medplum/fhirtypes';

export interface HawaiiDemoConfig {
  enabled: boolean;
}

export function getHawaiiDemoConfig(
  project: Project | undefined,
  configuredProjectId: string | undefined = import.meta.env.MEDPLUM_HAWAII_PROJECT_ID
): HawaiiDemoConfig {
  const enabled = project?.setting?.find((setting) => setting.name === 'hawaiiCqieDemo')?.valueBoolean === true ||
    (Boolean(configuredProjectId) && project?.id === configuredProjectId);
  if (!enabled) {
    return { enabled: false };
  }
  return { enabled: true };
}