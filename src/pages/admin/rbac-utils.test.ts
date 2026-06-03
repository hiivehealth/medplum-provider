// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AccessPolicy } from '@medplum/fhirtypes';
import { describe, expect, it } from 'vitest';
import { isRolePolicy, mergeRolePolicies } from './rbac-utils';

describe('rbac-utils', () => {
  it('detects role policy from RBAC name prefix', () => {
    const policy: AccessPolicy = {
      resourceType: 'AccessPolicy',
      name: 'RBAC: Clinical Provider',
      resource: [],
    };

    expect(isRolePolicy(policy)).toBe(true);
  });

  it('detects role policy from tag code', () => {
    const policy: AccessPolicy = {
      resourceType: 'AccessPolicy',
      resource: [],
      meta: {
        tag: [{ code: 'rbac-role' }],
      },
    };

    expect(isRolePolicy(policy)).toBe(true);
  });

  it('merges rules and applies criteria override', () => {
    const merged = mergeRolePolicies(
      [
        {
          resourceType: 'AccessPolicy',
          resource: [{ resourceType: 'Patient', interaction: ['read'] }],
        },
        {
          resourceType: 'AccessPolicy',
          resource: [{ resourceType: 'Task', interaction: ['search'] }],
        },
      ],
      'Patient?_id=123'
    );

    expect(merged).toHaveLength(2);
    expect(merged[0].criteria).toBe('Patient?_id=123');
    expect(merged[1].criteria).toBe('Patient?_id=123');
  });
});
