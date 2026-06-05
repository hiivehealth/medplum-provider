# RBAC Staging Checklist

## Objective

Validate RBAC admin workflows before production rollout.

## Pre-Deploy

- Seed role policies completed (`rbac:seed:apply`).
- Role policy IDs documented.
- Access model composition tested for Practitioner, RelatedPerson, Patient.
- At least one pilot ProjectMembership per profile type.

## Functional Checks

- `/admin/rbac/roles` can create, update, delete roles.
- `/admin/rbac/access-models` generates composed AccessPolicy.
- `/admin/rbac/members` can create and delete membership bindings.
- `/admin/rbac/test` confirms hidden fields behavior.
- `/admin/rbac/bulk-assign` processes CSV assignments and reports row errors.
- `/admin/rbac/templates` clones from selected role templates.
- `/admin/rbac/audit` shows recent RBAC change events.

## Security Checks

- Non-admin account cannot manage RBAC pages.
- Sensitive fields remain hidden for minimum-necessary policies.
- Audit events include action, entity, and timestamp.

## Rollback Plan

1. Identify impacted ProjectMembership IDs.
2. Reassign previous AccessPolicy references.
3. Disable or delete problematic role AccessPolicy.
4. Re-run visibility tests.
5. Confirm corrected state in audit log.
