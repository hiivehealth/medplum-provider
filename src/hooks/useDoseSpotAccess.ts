// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { showNotification } from '@mantine/notifications';
import { isOk, normalizeErrorString } from '@medplum/core';
import type { PractitionerRole } from '@medplum/fhirtypes';
import { useMedplum, useSearchResources } from '@medplum/react';
import { useEffect, useMemo } from 'react';
import { DOSESPOT_PRACTITIONER_ROLE_TYPE_SYSTEM, hasDoseSpotIdentifier } from '../components/utils';
import { OEM_PROJECT_ID } from '../pages/oem/ih-review';

export interface DoseSpotAccess {
  /** True if the user is already enrolled (has a DoseSpot identifier on membership). */
  enrolled: boolean;
  /** True if either enrolled or authorized (show DoseSpot UI). */
  hasAccess: boolean;
  /** True if selfEnroll should be passed to useDoseSpotIFrame. */
  needsSelfEnroll: boolean;
  /** True while the PractitionerRole check is loading. */
  loading: boolean;
}

/**
 * Hook that determines DoseSpot access for the current user.
 *
 * Checks two things:
 * 1. Whether the user already has a DoseSpot identifier (already enrolled)
 * 2. Whether the user has a PractitionerRole authorizing DoseSpot enrollment
 *
 * @returns Access flags that control UI visibility and self-enrollment behavior.
 */
export function useDoseSpotAccess(): DoseSpotAccess {
  const medplum = useMedplum();
  const membership = medplum.getProjectMembership();
  const profile = medplum.getProfile();
  const integrationEnabled = ![OEM_PROJECT_ID, '8588313a-c8c6-4e07-8c1d-e684ed25e522'].includes(
    medplum.getProject()?.id ?? ''
  );
  const enrolled = integrationEnabled && hasDoseSpotIdentifier(membership);
  const practitionerId = profile?.resourceType === 'Practitioner' ? profile.id : undefined;

  const [roles, rolesLoading, rolesOutcome] = useSearchResources(
    'PractitionerRole',
    { practitioner: `Practitioner/${practitionerId}`, active: 'true', _count: '10' },
    { enabled: integrationEnabled && !enrolled && !!practitionerId }
  );

  useEffect(() => {
    if (integrationEnabled && rolesOutcome && !isOk(rolesOutcome)) {
      showNotification({
        title: 'DoseSpot Access Check Failed',
        message: normalizeErrorString(rolesOutcome),
        color: 'red',
      });
    }
  }, [integrationEnabled, rolesOutcome]);

  const authorized = useMemo(() => !!roles && hasDoseSpotPractitionerRole(roles), [roles]);
  const hasAccess = integrationEnabled && (enrolled || authorized);

  return {
    enrolled,
    hasAccess,
    needsSelfEnroll: integrationEnabled && !enrolled && authorized,
    loading: integrationEnabled && rolesLoading,
  };
}

function hasDoseSpotPractitionerRole(roles: PractitionerRole[]): boolean {
  return roles.some((role) =>
    role.code?.some((cc) => cc.coding?.some((c) => c.system === DOSESPOT_PRACTITIONER_ROLE_TYPE_SYSTEM))
  );
}
