// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { ProjectMembership, Reference } from '@medplum/fhirtypes';

const ROSTER_GROUP_PARAM = 'roster_group';

export interface RosterMembership {
  groupReference: Reference;
}

/**
 * Determines whether the current membership is a Nevada HIE payer roster member.
 *
 * Payer roster users are assigned a parameterized AccessPolicy with a
 * `roster_group` parameter pointing to their payer roster Group.
 *
 * @param membership - The current project membership.
 * @returns The roster membership if found, otherwise undefined.
 */
export function getRosterMembership(membership: ProjectMembership | undefined): RosterMembership | undefined {
  const access = membership?.access;
  if (!access) {
    return undefined;
  }

  for (const entry of access) {
    const param = entry.parameter?.find((p) => p.name === ROSTER_GROUP_PARAM);
    if (param?.valueReference) {
      return { groupReference: param.valueReference };
    }
  }

  return undefined;
}

export function isPayerRosterMember(membership: ProjectMembership | undefined): boolean {
  return getRosterMembership(membership) !== undefined;
}
