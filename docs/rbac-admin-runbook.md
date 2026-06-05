# RBAC Admin Runbook

## Purpose

Operational guide for managing AccessPolicy-backed RBAC in the provider admin UI.

## Create Read-Only Role

1. Open `/admin/rbac/templates`.
2. Select a clinical template role.
3. Clone to a new `RBAC:` role name.
4. Open `/admin/rbac/roles` and remove `create`, `update`, `delete` interactions.
5. Save and validate with `/admin/rbac/test`.

## Create Minimum-Necessary Role

1. Open `/admin/rbac/roles`.
2. Create role named `RBAC: <Persona> Minimum Necessary`.
3. Add only required resource rules.
4. Add `hiddenFields` for sensitive data first.
5. Save role and test visibility with sample patient.

## Update Role With Low Risk

1. Clone current role as a new version.
2. Apply changes to clone.
3. Assign pilot users in `/admin/rbac/members`.
4. Validate outcomes and audit logs.
5. Migrate remaining memberships.

## Audit and Compliance Review

1. Open `/admin/rbac/audit`.
2. Confirm create/update/delete events are recorded.
3. Export event IDs and timestamps for compliance packet.
4. Cross-check changed policy IDs in ProjectMembership records.

## Troubleshooting

- Missing access: confirm `ProjectMembership.admin=true` for operator account.
- Failed membership create: verify user email resolves to `User` resource.
- Unexpected visibility: inspect `hiddenFields` on the active AccessPolicy.
- Duplicate role behavior: verify membership references correct AccessPolicy ID.
