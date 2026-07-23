// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Practitioner, ProjectMembership, Reference } from '@medplum/fhirtypes';

const ROSTER_GROUP_PARAM = 'roster_group';
const ROSTER_GROUP_EXTENSION = 'https://hiivehealth.com/fhir/StructureDefinition/nevada-roster-group';

export interface RosterMembership {
  groupReference: Reference;
}

function extensionToRosterMembership(profile: Practitioner | undefined): RosterMembership | undefined {
  const groupReference = profile?.extension?.find((e) => e.url === ROSTER_GROUP_EXTENSION)?.valueReference;
  if (groupReference) {
    return { groupReference };
  }
  return undefined;
}

/**
 * Determines whether the current membership is a Nevada HIE payer roster member.
 *
 * Payer roster users are assigned a parameterized AccessPolicy with a
 * `roster_group` parameter pointing to their payer roster Group. The roster
 * group is also stored on the Practitioner profile as an extension so it is
 * available in the browser session details.
 *
 * @param membership - The current project membership.
 * @param profile - The current user profile (Practitioner for payer users).
 * @returns The roster membership if found, otherwise undefined.
 */
export function getRosterMembership(
  membership: ProjectMembership | undefined,
  profile?: Practitioner
): RosterMembership | undefined {
  const access = membership?.access;
  if (access) {
    for (const entry of access) {
      const param = entry.parameter?.find((p) => p.name === ROSTER_GROUP_PARAM);
      if (param?.valueReference) {
        return { groupReference: param.valueReference };
      }
    }
  }

  return extensionToRosterMembership(profile);
}

export function isPayerRosterMember(
  membership: ProjectMembership | undefined,
  profile?: Practitioner
): boolean {
  return getRosterMembership(membership, profile) !== undefined;
}
