# ARM-11 — Project security policy

## Implementation and repository boundaries

This change implements `cuiBanner.enabled` as a boolean extension on `Project`,
with no extension meaning **false**. The provider includes an authenticated status
provider and a profile-driven Project editor at `/Settings/Security`. Banner rendering
remains the responsibility of ARM-12 through ARM-15.

Server enforcement lives in the adjacent Medplum source repository under
`packages/server`. A portable [companion patch](../../config/cui/medplum-server.patch)
is included for review and application to the corresponding backend checkout.
The stock Docker image does **not** include these changes. Deploy the patched server
before installing profiles and releasing the provider change. Do not ship a UI-only
implementation or enable this on a stock backend.

Only the provider and upstream Medplum repositories were available locally. Patient
and UBIX admin can consume the same endpoint and reuse `src/cui/policy.ts` and
`src/cui/CuiPolicyProvider.tsx`; their shell mounting remains unimplemented here.
The endpoint is application-independent: it always derives project identity from the
validated server authentication context, not a route/query/body project identifier.

## Stored configuration

Canonical extension:
`https://medplum.com/fhir/StructureDefinition/cui-banner-enabled`

```json
{
  "resourceType": "Project",
  "extension": [
    {
      "url": "https://medplum.com/fhir/StructureDefinition/cui-banner-enabled",
      "valueBoolean": true
    }
  ]
}
```

The extension has cardinality 0..1. Missing means false; an explicit boolean false
also disables it. Duplicate extensions, non-booleans, or mixed extension values are
invalid. Server validation applies even to platform operators. Configuration is on
Project, never UserConfiguration, a patient resource, environment variable, or browser
storage. Existing server auditing of Project updates remains unchanged.

[Profile bundle](../../config/cui/profiles.json) contains the extension and a Project
profile with full snapshots for Medplum's profile-driven editor. It must be installed
in each target project. The default checkbox is off when the extension is absent;
loading the editor does not write a default. Saving uses `If-Match` to prevent silent
lost updates. Missing profiles and backend errors show an explicit error rather than
silently falling back to unprofiled editing.

## Authorization

The explicit capability is an operator-managed AccessPolicy extension:
`https://medplum.com/fhir/StructureDefinition/cui-banner-security-administrator`,
with `valueBoolean: true`. A project security administrator is an existing project
administrator whose own-project AccessPolicy grants that capability. Platform operators
use Medplum's existing super-admin mechanism. No existing user is automatically promoted.

The server reads the original assigned AccessPolicy, before parameter substitution;
the marker cannot be supplied by membership parameters, a profile, or browser state.
It recognizes assignments through `ProjectMembership.accessPolicy` or `access[].policy`.
The referenced policy must belong to that same project. Existing effective access-policy
checks still apply to the requested FHIR interaction.

- Ordinary members cannot directly read or update Project configuration.
- Ordinary project administrators can still edit their existing Project fields, but
  cannot read or explicitly write the CUI extension. Omission in an unrelated Project
  update preserves the hidden extension instead of deleting it.
- Security administrators can read and set the extension on their own project.
- Only platform operators can create/change/delete a capability-bearing AccessPolicy,
  or grant/reassign the capability through membership changes. Project admin status
  alone does not grant the CUI capability.
- The repository applies these checks to reads, history, PUT, PATCH, batch, and
  transaction writes, in addition to the existing project boundaries.

The server still trusts existing platform/system repositories and the existing
project-admin identity-management model. This change does not redesign credential
recovery, user impersonation, or platform operator authorization.

### Protected configuration versus display decision

All authenticated shells must know whether to display CUI. Therefore ordinary members
receive a **derived display decision**, but cannot read the protected Project extension
through FHIR or edit it. A user can necessarily infer enabled status from a visible
banner. “Cannot read the setting” is implemented as denial/redaction of the protected
configuration, not secrecy of the visibly observable classification state.

## Shared authenticated status API

`GET /auth/cui-banner` (authenticated; `Cache-Control: no-store`):

```json
{ "projectId": "active-project-uuid", "enabled": false, "canManage": false }
```

No caller-controlled project ID or application selector is needed. Missing configuration
returns false. Invalid explicit configuration or transport/server failures do not return
false; they surface as errors. An unauthenticated request returns 401.

Provider's `useCuiPolicy()` returns `unauthenticated`, `loading`, `ready`, or `error`.
It never fetches without an authenticated profile, rejects responses for another
project, discards late responses on identity changes, and clears state on logout.
It refetches on window focus, manual refresh, and every 60 seconds while mounted.
Errors after a successful read retain `lastKnown` for that same identity so future
shell integrations can preserve a visible classification while reporting a refresh
failure. Initial errors have no guessed policy. No banner or clinical-route blocking
is introduced by this ticket.

## Deployment

1. Merge the backend companion change. The local `/Users/alakh/medplum` checkout already
   contains it. For a clean matching checkout, use `git apply --check` followed by
   `git apply` with `config/cui/medplum-server.patch`; do not apply it twice. The patch
   was prepared against upstream Medplum 5.1.10 source. Review/adapt it against UBIX's
   backend version before release.
2. Build and deploy that server through the existing backend deployment process.
3. Install profiles into each target project with an existing platform-operator token:

   ```sh
   # Supply the token securely through your shell environment; do not commit it.
   export MEDPLUM_BASE_URL=http://localhost:8103/
   npm run cui:install-profiles -- <target-project-uuid>
   ```

   The installer requires `MEDPLUM_ACCESS_TOKEN`, checks operator status and the patched
   endpoint before writing, refuses duplicate schemas, and updates existing schemas
   with optimistic concurrency. It changes schema metadata only, not customer policy
   values or role assignments.
4. An operator assigns the capability to selected existing project administrators.
   [Role template](../../config/cui/security-administrator.json) is an **additive
   capability only**; never replace a user's clinical AccessPolicy with this empty
   resource-rule template. Preserve all existing access rules and compartments.
   For a member currently relying on legacy unrestricted access (no policy references),
   preserve that baseline explicitly before adding a policy reference, because Medplum
   otherwise switches from legacy wildcard access to the assigned rules.
   A safe alternative is an operator-created copy of that member's existing policy,
   with the marker added and the original rules retained, assigned only to that member.
   Do not add the marker to a shared policy unless every assigned member is intended
   to receive this role. Clinical authorization equivalence must be checked at assignment.
5. Authorized users open **Quick Links → Project Security**, edit the CUI boolean in
   the profile-driven Project editor, and save. Other members have no menu item, and
   direct navigation shows permission denied without fetching the Project.
6. Provider, patient, and admin shell integrations consume the same status API.
   Do not read the Project extension directly in ordinary authenticated shells.

## Verification

Tests cover default false, authorized on/off, direct configuration denial/redaction,
ordinary edits preserving the setting, history redaction, PATCH/batch/transaction
protection, protected capability management, cross-project isolation, malformed policy,
unauthenticated status requests, platform operators, and optimistic concurrency.
Client tests cover no unauthenticated requests, identity changes, late responses,
refresh failures, and the real profile-driven boolean editor.

Useful commands:

```sh
# Provider
npm run build
npm test -- src/cui src/pages/settings/CuiPolicyPage.test.tsx

# Backend checkout (requires its seeded, isolated medplum_test database)
npm run build --workspace=@medplum/server
npm test --workspace=@medplum/server -- --runInBand --runTestsByPath \
  src/auth/cui-banner.test.ts src/auth/me.test.ts src/fhir/accesspolicy.test.ts
```

Live Docker deployment, actual customer role assignment, and patient/UBIX admin shell
integration are separate rollout steps. No live customer's policy or roles were changed.

### Local verification result

- Provider: 15 focused tests passed; production build passed.
- Backend: 76 tests passed across CUI policy, auth/me, and existing AccessPolicy suites;
  4 existing tests skipped. Server build and lint passed.
- Backend tests used a newly created `medplum_test` database and the existing test Redis
  logical databases. The development `medplum` database was not used for testing.
- The companion patch passed a reverse-application check against the modified source.
