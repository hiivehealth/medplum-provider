// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { ProjectMembership, Reference } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import { getRosterMembership, isPayerRosterMember } from './roster';

describe('roster utilities', () => {
  const groupRef: Reference = { reference: 'Group/roster-1', display: 'Silver State Plan Roster' };

  function membershipWithRoster(): ProjectMembership {
    return {
      resourceType: 'ProjectMembership',
      id: 'membership-1',
      project: { reference: 'Project/project-1' },
      profile: { reference: 'Practitioner/practitioner-1' },
      access: [
        {
          policy: { reference: 'AccessPolicy/payer-roster' },
          parameter: [{ name: 'roster_group', valueReference: groupRef }],
        },
      ],
    } as ProjectMembership;
  }

  test('getRosterMembership returns group reference when roster parameter present', () => {
    const result = getRosterMembership(membershipWithRoster());
    expect(result?.groupReference).toEqual(groupRef);
  });

  test('getRosterMembership returns undefined when no access entries', () => {
    const membership: ProjectMembership = {
      resourceType: 'ProjectMembership',
      id: 'membership-2',
      project: { reference: 'Project/project-1' },
      profile: { reference: 'Practitioner/practitioner-1' },
    } as ProjectMembership;
    expect(getRosterMembership(membership)).toBeUndefined();
  });

  test('getRosterMembership returns undefined when roster parameter absent', () => {
    const membership: ProjectMembership = {
      resourceType: 'ProjectMembership',
      id: 'membership-3',
      project: { reference: 'Project/project-1' },
      profile: { reference: 'Practitioner/practitioner-1' },
      access: [
        {
          policy: { reference: 'AccessPolicy/provider' },
          parameter: [{ name: 'other_param', valueString: 'x' }],
        },
      ],
    } as ProjectMembership;
    expect(getRosterMembership(membership)).toBeUndefined();
  });

  test('isPayerRosterMember returns true for roster membership', () => {
    expect(isPayerRosterMember(membershipWithRoster())).toBe(true);
  });

  test('isPayerRosterMember returns false for undefined membership', () => {
    expect(isPayerRosterMember(undefined)).toBe(false);
  });
});
