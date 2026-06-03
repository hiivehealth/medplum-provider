// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { AccessPolicy, AuditEvent, ProjectMembership } from '@medplum/fhirtypes';

export function isProjectAdmin(membership: ProjectMembership | undefined): boolean {
  return Boolean(membership?.admin);
}

export function isRolePolicy(policy: AccessPolicy): boolean {
  if (policy.name?.startsWith('RBAC:')) {
    return true;
  }

  const tags = policy.meta?.tag || [];
  return tags.some((tag) => tag.code === 'rbac-role');
}

export function getRoleRulesCount(policy: AccessPolicy): number {
  return Array.isArray(policy.resource) ? policy.resource.length : 0;
}

export function mergeRolePolicies(
  policies: AccessPolicy[],
  criteriaOverride?: string
): NonNullable<AccessPolicy['resource']> {
  const merged = policies.flatMap((policy) => policy.resource || []);
  if (!criteriaOverride?.trim()) {
    return merged;
  }

  return merged.map((rule) => ({
    ...rule,
    criteria: criteriaOverride,
  }));
}

export async function logRbacAuditEvent(
  medplum: MedplumClient,
  action: string,
  entityName: string,
  details?: string
): Promise<void> {
  const event: AuditEvent = {
    resourceType: 'AuditEvent',
    type: {
      system: 'http://terminology.hl7.org/CodeSystem/audit-event-type',
      code: 'rest',
      display: 'RESTful Operation',
    },
    action: action as AuditEvent['action'],
    recorded: new Date().toISOString(),
    outcome: '0',
    agent: [
      {
        requestor: true,
      },
    ],
    source: {
      observer: {
        display: 'RBAC Admin UI',
      },
    },
    entity: [
      {
        name: entityName,
        description: details,
      },
    ],
  };

  try {
    await medplum.createResource(event);
  } catch {
    // Best-effort audit logging; do not block primary user flow.
  }
}
