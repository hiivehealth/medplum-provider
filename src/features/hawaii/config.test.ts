import type { Project } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import { getHawaiiDemoConfig } from './config';

describe('Hawaii demo configuration', () => {
  const project: Project = {
    resourceType: 'Project',
    setting: [
      { name: 'hawaiiCqieDemo', valueBoolean: true },
    ],
  };

  test('is disabled unless the current project explicitly enables it', () => {
    expect(getHawaiiDemoConfig(undefined)).toEqual({ enabled: false });
    expect(getHawaiiDemoConfig({ resourceType: 'Project' })).toEqual({ enabled: false });
    expect(getHawaiiDemoConfig({ ...project, setting: [{ name: 'hawaiiCqieDemo', valueString: 'true' }] }))
      .toEqual({ enabled: false });
  });

  test('enables the configured project without inheriting Nevada bot ids', () => {
    expect(getHawaiiDemoConfig(project)).toEqual({ enabled: true });
  });

  test('supports older session responses only for an explicitly configured project id', () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    expect(getHawaiiDemoConfig({ resourceType: 'Project', id: projectId }, projectId)).toEqual({ enabled: true });
    expect(getHawaiiDemoConfig({ resourceType: 'Project', id: 'another-project' }, projectId)).toEqual({ enabled: false });
    expect(getHawaiiDemoConfig(undefined, projectId)).toEqual({ enabled: false });
    expect(getHawaiiDemoConfig({ resourceType: 'Project', id: projectId }, '')).toEqual({ enabled: false });
  });
});