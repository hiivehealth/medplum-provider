// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Project } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import { RESOURCE_PROFILE_URLS, getDefaultProfileUrl } from './utils';

describe('getDefaultProfileUrl', () => {
  test('falls back to RESOURCE_PROFILE_URLS when project has no override setting', () => {
    const project: Project = { resourceType: 'Project', name: 'Test Project' };
    expect(getDefaultProfileUrl('Patient', project)).toStrictEqual(RESOURCE_PROFILE_URLS.Patient);
  });

  test('falls back to RESOURCE_PROFILE_URLS when project is undefined', () => {
    expect(getDefaultProfileUrl('Patient', undefined)).toStrictEqual(RESOURCE_PROFILE_URLS.Patient);
  });

  test('uses the project setting override when present', () => {
    const overrideUrl = 'https://ehr.example.com/fhir/StructureDefinition/some-other-tenant-patient';
    const project: Project = {
      resourceType: 'Project',
      name: 'Test Project',
      setting: [{ name: 'defaultProfile:Patient', valueString: overrideUrl }],
    };
    expect(getDefaultProfileUrl('Patient', project)).toStrictEqual(overrideUrl);
  });

  test('ignores settings for other resource types', () => {
    const project: Project = {
      resourceType: 'Project',
      name: 'Test Project',
      setting: [{ name: 'defaultProfile:Device', valueString: 'https://ehr.example.com/fhir/StructureDefinition/other-device' }],
    };
    expect(getDefaultProfileUrl('Patient', project)).toStrictEqual(RESOURCE_PROFILE_URLS.Patient);
  });

  test('returns undefined for a resource type with no default and no override', () => {
    const project: Project = { resourceType: 'Project', name: 'Test Project' };
    expect(getDefaultProfileUrl('Observation', project)).toBeUndefined();
  });
});

