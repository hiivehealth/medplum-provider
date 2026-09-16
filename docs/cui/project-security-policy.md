# ARM-11 — CUI project security policy on stock Medplum

## Architecture

All implementation code and installation artifacts live in **medplum-provider**.
Medplum source and Docker image require no modifications. This replaces the earlier
Project extension, custom `/auth/cui-banner` endpoint, and companion backend patch.

- A non-clinical, profiled **Basic** resource holds one project's `cuiBanner.enabled`.
- Stock **AccessPolicy** rules enforce direct FHIR read/update permissions.
- The Provider's profile-driven editor reads and updates that resource using the
  signed-in user's token and an `If-Match` version precondition.
- A small Node service exposes **GET `/api/cui-banner`** on the application's origin.
  It validates the caller with Medplum `/auth/me`, selects the caller's project from
  that verified response, and reads only that project's configured Basic resource.
- Each project has a separate, non-admin service client whose AccessPolicy grants
  only `read` on that exact resource. Its credentials stay on the server.
- The service returns `{ projectId, configurationId, enabled, canManage }` with
  `Cache-Control: no-store`. Ordinary members receive the display decision, never
  the protected resource. The visible classification is necessarily inferable.

No Bot executes, no custom AuditEvent is created, and status resolution does not
write FHIR resources. Stock Medplum's existing authentication and resource-access
logging/auditing still applies, as does normal audit behavior for deliberate updates.
The actual banner and patient/admin shell integrations remain later tickets.

## Configuration resource and profile

Profile: `https://medplum.com/fhir/StructureDefinition/cui-configuration`

Boolean extension: `https://medplum.com/fhir/StructureDefinition/cui-banner-enabled`

```json
{
  "resourceType": "Basic",
  "meta": {
    "profile": ["https://medplum.com/fhir/StructureDefinition/cui-configuration"]
  },
  "code": {
    "coding": [{
      "system": "https://medplum.com/fhir/CodeSystem/project-configuration",
      "code": "cui-banner"
    }]
  },
  "extension": [{
    "url": "https://medplum.com/fhir/StructureDefinition/cui-banner-enabled",
    "valueBoolean": false
  }]
}
```

Absence of the extension means **false**. Missing deployment mapping, an inaccessible
or deleted provisioned resource, malformed/duplicate values, or an upstream failure
is an error, never an inferred off decision. The service checks resource ID, owning
project, and profile. It does not accept a project/resource ID or upstream URL from
query parameters, request bodies, cookies, or browser storage.

The resource ID mapping and reader credentials are deployment metadata; the customer
policy value is stored only in Medplum. Never put enabled flags in environment variables.
Only the one mapped resource per project is authoritative; creating another Basic
with the same code cannot change the display decision.

## Roles and AccessPolicy composition

A security administrator is a membership assigned an operator-designated AccessPolicy
that grants `read` and `update` on the exact configuration ID. This logical security
role does **not** require Medplum's broad `ProjectMembership.admin` privilege.
The service's private project mapping lists the allowed manager AccessPolicy IDs.
It checks Medplum's resolved `accessPolicy.basedOn`, effective read/update rules,
and a real read with the caller token before returning `canManage: true`.
Actual saves always go directly to Medplum, which enforces permissions independently
of the UI and the service. Operators can manage the resource through their existing
platform-level FHIR access; this service does not provide a cross-project override.

The [manager template](../../config/cui/security-administrator.json) is an **additive
CUI grant**, not a replacement for clinical permissions. Preserve existing clinical
rules when assigning it. The configuration has no Patient subject or clinical data.

### Critical stock-policy behavior

Medplum policies are grants, not deny lists. An additional restrictive Basic rule does
**not** override an existing `resourceType: "*"` grant. Every ordinary member, patient,
client, bot, and ordinary administrator must have explicit effective policies that
exclude the configuration, with no broader grant through another assigned policy.
A member with no AccessPolicy can inherit legacy wildcard access: do not leave such
memberships in a configured project.

For users who need other Basic resources, preserve those grants with an ID exclusion:

```json
{ "resourceType": "Basic", "criteria": "Basic?_id:not=CONFIGURATION_ID" }
```

This only works after removing any overlapping wildcard/Basic grants. Split wildcard
clinical permissions into explicit resource-type grants during a reviewed migration;
do not remove or widen clinical access merely to add this feature. Protect the role
policies, reader ClientApplication/secret, and membership assignments from ordinary
members. Review all assigned policies and project default policies, including those
used by future registrations. The scaffolder does not rewrite an existing tenant's
permissions automatically.

**Trust boundary:** stock Medplum project administrators manage memberships and can
reassign permissions. This implementation retains that platform trust model; it does
not claim that an adversarial project administrator cannot promote themselves. Give
routine users the narrow security role instead of broad project-admin status. If the
security owner requires isolation from membership-managing administrators, a separately
controlled configuration service/project is needed; this same-project design does not
meet that stronger threat model. The previous implementation also retained Medplum's
identity-management and credential-recovery trust boundary.

## Installation

### Fresh project

Use an operator token in a terminal, never in a frontend environment file. Create a
fresh Medplum project. If `$init` creates a default OAuth ClientApplication membership,
assign that membership an empty AccessPolicy first; it must not retain wildcard access.
The provisioner allows at most that one restricted, non-admin client and refuses
projects with human memberships or other existing grants.

```sh
# MEDPLUM_BASE_URL points to the stock API. MEDPLUM_ACCESS_TOKEN is an operator token.
npm run cui:provision -- PROJECT_UUID /private/path/cui-service.local
```

The tool installs both profiles, creates the configuration with no extension (off),
creates manager and reader policies, and creates the narrow reader client. It writes
credentials to a new mode-0600 file and never prints its secret. It does not assign
human roles. Provisioning is not transactional: on failure, inspect the newly created
resources before retrying; the output file is reserved and never overwritten.

Then assign reviewed clinical policies to all human memberships and additionally assign
the generated manager AccessPolicy only to designated security administrators.

### Existing project

1. Review effective policies, default policies, bots/clients, and membership administration.
   Establish explicit clinical grants and protect policy/credential administration first.
2. Install schema definitions with `npm run cui:install-profiles -- PROJECT_UUID`.
3. As an operator, create one profiled Basic configuration **without enabling it**.
4. Exclude its ID from all non-manager grants. Create the exact-resource manager grant
   and a separate read-only service-client grant. Preserve clinical permissions.
5. Create a non-admin ClientApplication with the reader grant and securely build the
   service mapping from [service.example.json](../../config/cui/service.example.json).
6. Assign the manager grant to the designated memberships and test direct API access
   for members, ordinary admins, bots, clients, and cross-project users before rollout.
7. Enable the setting only after these checks pass.

If migrating the earlier custom-backend implementation, copy each existing Project
extension's explicit boolean into the new Basic configuration before changing the
application's resolver. Do not silently reset enabled projects to off. Remove the old
endpoint dependency only after verifying parity; clean up the old extension separately.
No existing project's data or roles are migrated by this code change.

## Running and deploying the service

Node 24 (or the package's supported Node 22 version) and this repository's npm dependencies
are required. Install with `npm install --include=dev` (the repository currently keeps its
Medplum SDK dependencies in devDependencies).

```sh
CUI_SERVICE_CONFIG=/private/path/cui-service.local npm run cui:service
# Separately, run Provider against the same Medplum API:
MEDPLUM_BASE_URL=http://localhost:8103/ npm run dev
```

The service binds only to `127.0.0.1:8105`. Vite dev and preview proxy `/api/cui-banner`
to it. `CUI_SERVICE_PORT` can change the service port, but update the reverse proxy
accordingly. The private config accepts HTTPS upstreams and loopback HTTP for local
work. Never use a super-admin client as the reader; the service rejects admin readers.
No service setting or credential uses the `MEDPLUM_` frontend-exposed environment prefix.
Local `.local` files/directories are gitignored and denied by Vite's file server.
Keep production credentials outside the public web root and rotate through your secret
management process.

Production requires a **running server process**, not just the static Vite build.
Route `/api/cui-banner` to the service through the same-origin HTTPS reverse proxy,
forwarding Authorization and preserving no-store/error responses. Keep SPA fallback
routing after the API rule. Put standard rate limits at that proxy and use a process
supervisor. A Vercel-only static deployment using the existing `vercel.json` is not
sufficient: configure an API rewrite to the separately deployed service before rollout.
Patient and admin apps can each use the same-origin proxy to this same service later.

## Verification

```sh
npm test -- src/cui src/pages/settings/CuiPolicyPage.test.tsx
npm run cui:test-service
npm run build
```

Focused tests cover authentication, project changes, stale responses, default off,
profile-driven saves, optimistic concurrency, malformed configuration, upstream errors,
project isolation, read-only service behavior, and restricted management decisions.

For live checks, sign in as a designated security administrator, toggle in
**Project Security**, save, reload, and verify both states. As an ordinary member and
ordinary project administrator, verify the menu is absent and direct navigation to
`/Settings/Security` is denied. Also test direct Basic GET/search/history/PUT/PATCH/delete
and a stale If-Match write; UI visibility alone does not verify authorization.

### Repeatable local integration test

`scripts/verify-cui-policy.mjs` accepts a private JSON file containing
`medplumBaseUrl`, `serviceBaseUrl`, `projectId`, a `security` account (`email`,
`password`), and a `members` array of unauthorized accounts with the same fields.
Use a disposable test project: the test intentionally updates the configuration,
then restores its initial extensions in a `finally` block. Both URLs must be loopback.
It also tests direct FHIR batch and transaction denial and checks that denied writes
leave the resource version unchanged.

```sh
CUI_TEST_CONFIG=/private/path/cui-test.local npm run cui:test-live
```

### Local verification environment

The isolated demo uses the existing **unmodified** Docker image reporting
`5.1.9-ace72bb`, with a separate database `medplum_cui_stock_demo` and Redis DB 12.
The new Medplum source checkout is version 5.1.37; it was inspected but not changed
or built. Repeat the integration checks against the exact production image before
rollout. No existing development project's configuration or memberships were changed.
