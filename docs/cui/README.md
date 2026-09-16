# ARM-10 — CUI classification standard

Version: 0.2 • Status: Draft for security-owner review • Prepared: 2026-09-15

This document is the proposed visual, accessibility, and project-policy specification
for ARM-10. The supplied ticket establishes the requirements below; the specific
colors, dimensions, persistence model, and unresolved-state behavior are proposals
until approved. No security-owner approval has been supplied. ARM-10 is not complete
until the approval record is filled in.

## ARM-11 superseding decisions

The [implemented ARM-11 contract](project-security-policy.md) uses a profiled,
project-scoped `Basic` configuration resource and stock Medplum AccessPolicies.
An absent boolean means **false**. Authenticated shells receive a derived display
decision from a read-only service maintained in the Provider repository.
No Medplum source changes or custom Medplum endpoints are required. The earlier
Project-extension implementation has been replaced. Visual approval remains pending.

## 1. Purpose and scope

Display exactly **CUI** as a persistent, non-dismissible classification landmark
above navigation and content in authenticated provider, patient, and UBIX admin
shells when the active project's policy is enabled. The component contract is
`<CuiBanner />`: no label, dismissal callback, policy, or application-state props.
Policy resolution and authentication gating belong to each application shell.

The banner is a shell control, not a clinical resource, patient attribute, alert,
notification, consent, or acknowledgement. Rendering it must not write resources,
create AuditEvents, change clinical permissions, or alter clinical workflows.
Existing server auditing of configuration updates must not be suppressed; this
feature introduces no additional render-triggered audit behavior.

## 2. Visual and accessibility standard

All values in this table require security-owner approval as one versioned standard.

| Property | Proposed value |
| --- | --- |
| Exact visible label | `CUI` (uppercase, no punctuation or additional text) |
| Background token | `--cui-background: #006400` |
| Foreground token | `--cui-foreground: #FFFFFF` |
| Height token | `--cui-height: 32px` at every breakpoint |
| Typography | Shared system sans-serif; 16px, weight 700, line-height 1 |
| Width | 100% of shell, including the area above side navigation |
| Alignment | Centered horizontally and vertically |
| Wrapping | None; no truncation, ellipsis, animation, or transition |
| Landmark | `<aside aria-label="CUI">CUI</aside>` |
| Stacking token | `--cui-z-index: 102` within the shell stacking context |
| Position | Normal shell layout in a persistent, non-scrolling top row |
| Focus/announcement | No tabindex, autofocus, interactive descendants, or live region |
| Dismissal | None: no button, shortcut, cookie, storage flag, preference, or route exception |

Accessible name is exactly `CUI`. Do not add tooltip text, hidden explanatory text,
`role="alert"`, or notification/toast primitives. The component remains mounted
across authenticated client-side route changes and does not repeatedly announce.

The chosen colors have **7.439241111579327:1** contrast, above the 4.5:1 normal-text
AA threshold in [WCAG 2.2 contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
See [calculation evidence](contrast.json). This verifies the color pair, not whole-app
accessibility. ARM-16 must verify keyboard, screen-reader, zoom, and responsive behavior.
Dark mode must retain the approved tokens. Respect OS forced-color accessibility
settings; do not disable user-agent accessibility overrides.

### Layout and stacking contract

Reserve exactly 32 CSS pixels before rendering an enabled authenticated shell.
Keep the shell's top row outside the scrollable content region so CUI remains visible
while pages scroll. Navigation, sticky headers, drawers, and content must start below
that row. Do not animate the row or unmount it for route loading or errors.

Ordinary navigation must stack below the banner. Modal focus traps and dialogs retain
their normal behavior; their content and overlays must reserve the banner strip so
it stays visible without placing interactive banner content in a modal focus trap.
Adapters must inspect their actual stacking contexts: a numeric z-index alone does
not establish ordering across contexts. Fullscreen views must include the banner row.
A fixed-position implementation is acceptable only with the exact shared offset
reserved by every relevant shell layer.

Use the same 32px height at 320px, 390px, 768px, and 1440px widths. Verify 200% text
resize and browser zoom/reflow without clipping CUI. If an app's font metrics cannot
meet this, revise the shared standard through review rather than locally shrinking text.

### Published visual references

- [Desktop reference — 1440 × 900](desktop.svg)
- [Mobile reference — 390 × 844](mobile.svg)

These are illustrative shell diagrams, not screenshots of an implemented application.
Annotations are outside the banner. The banner itself contains only `CUI`.

## 3. Project security policy

Logical policy: `cuiBanner.enabled`, one boolean per Medplum Project. All three apps
resolve the same authoritative value for the active project. No environment variable,
user setting, browser/session flag, route parameter, or local storage value is authoritative.

### Proposed persistence contract for ARM-11

Use one profiled `Basic` configuration resource per project, identified by a dedicated
configuration code and a stable project-local identifier, with a required boolean
extension representing `cuiBanner.enabled`. This is non-clinical configuration and
must contain no patient subject or clinical data. Keep it outside linked/shared
clinical projects. Resolve against the authenticated project's compartment.

ARM-11 must publish the organization-owned canonical profile, code system, identifier
system, and extension URL; those namespace values are not yet available here. The
profile must require exactly one boolean, and implementation must enforce one policy
resource per project server-side (a profile alone does not enforce uniqueness).
Do not silently pick the first resource if duplicates exist. Do not silently coerce
strings, absent values, or malformed resources into a boolean.

This choice separates configuration permissions from broad access to the Project
resource or clinical records. It is a proposed contract, not a deployed profile or
AccessPolicy. Server enforcement and policy composition must be proven in ARM-11.

### Authority and role definition

`Project Security Administrator` is an explicit project-scoped capability represented
by a server-assigned AccessPolicy on the user's `ProjectMembership.accessPolicy`
(or its supported composed-policy equivalent). It is not a self-editable user label,
FHIR practitioner role, client feature flag, or implied clinical administrator privilege.
Designated platform operators provision this capability using the existing trusted
administrative process. Security administrators cannot self-assign broader roles.

| Actor | Read active-project configuration | Change enabled value | Provision/delete/reassign policy |
| --- | --- | --- | --- |
| Authenticated project member, including patient | Yes | No | No |
| Project security administrator | Yes | Yes, own project only | No |
| Designated platform operator | Yes, explicitly authorized projects | Yes | Controlled provisioning only |
| Unauthenticated user | No | No | No |

The sole customer control is **Show CUI banner on authenticated pages [On / Off]**.
AccessPolicy must scope access to this configuration resource, preserve its identity,
profile, project, and code, and restrict updates to the boolean. Read-only users must
not write through PUT, PATCH, batch, transaction, conditional create, or delete.
Existing broad/wildcard policies and administrator bypass behavior require explicit
review; merely adding a restrictive rule does not establish effective denial. Role
assignment and AccessPolicy editing must also prevent privilege escalation. These
permissions must neither grant nor remove clinical access.

### Applicability and bootstrap decisions proposed for approval

Customer applicability is explicitly selected by the security owner for each project;
it must not be inferred from patient data or the application name. Provision every
project with an explicit boolean before rollout. No implicit default is proposed:
missing, invalid, duplicate, or unreadable policy means **unresolved**, not `false`.

| State | Proposed shell behavior |
| --- | --- |
| Unauthenticated / authentication flow | No banner, no CUI configuration fetch |
| Authenticated, initial policy unresolved | Bootstrap loading/error view; no clinical shell yet; no guessed classification |
| Authenticated, enabled | Mount banner and navigation/content together with reserved row |
| Authenticated, disabled | Mount shell with no banner and no reserved banner gap |
| Enabled, route loading/empty/error/denied | Keep banner and row; replace only routed content |
| Same-project refresh fails | Retain last authoritative in-memory state; show policy refresh failure outside banner |
| Project switch | Clear previous project's state and resolve new project before mounting its shell |
| Logout | Clear project state and remove banner |

Holding initial shell bootstrap does not change any API authorization decision. This
availability tradeoff and whether an unresolved bootstrap needs a different display
require explicit owner approval before ARM-11/13 implementation.

Proposed policy freshness: refetch on project switch, window focus, and at most every
60 seconds while an authenticated app is active. Apply confirmed changes to the whole
shell atomically; a deliberate project policy update may change layout, ordinary route
transitions may not. No browser persistence of policy. Network outages prevent a
bounded propagation guarantee; retain the last confirmed state for the same project.
The 60-second bound and outage behavior require approval.

## 4. Integration findings and handoff

Provider uses `@medplum/react` AppShell with `layoutVersion="v2"` in `src/App.tsx`.
The local upstream implementation places `props.children` inside `AppShell.Main` and
its route ErrorBoundary/Suspense. Consequently **first child alone does not place CUI
above navigation or outside the route error boundary**. ARM-12/13 need a dedicated
structural shell slot or equivalent layout adapter, including navigation offsets.
Do not reuse its dismissible announcement mechanism.

| Ticket | Implementation responsibility |
| --- | --- |
| ARM-11 | Profile/namespaces, provisioning, effective AccessPolicy, role mapping, bootstrap resolver, toggle, refresh semantics |
| ARM-12 | Shared no-props component and tokens, persistent structural shell integration contract |
| ARM-13 | Provider: loaded profile + resolved enabled policy; integrate above navigation and route boundary |
| ARM-14 | Patient: authenticated branch; supplied after-Header mount point must be reconciled with above-navigation visual order |
| ARM-15 | UBIX admin: shell before AppRoutes; preserve all authentication/recovery exclusions |
| ARM-16 | Cross-app route, policy, permissions, accessibility, modal, scroll, and responsive evidence |

Patient and UBIX admin mount points are supplied by the parent ticket and have not
been verified against their repositories in this work. Their shell adapters must be
reviewed before assuming the provider layout solution applies.

Local source references used in preparing this proposal:

- `src/App.tsx` (this repository)
- `../medplum/packages/react/src/AppShell/AppShell.tsx`
- `../medplum/packages/docs/docs/access/access-policies.md`
- `../medplum/packages/fhirtypes/dist/ProjectMembership.d.ts`

## 5. Verification and approval record

ARM-10 evidence prepared:

- [x] Exact label, semantic landmark, accessible name, and no-dismissal rule specified.
- [x] Proposed shared colors, dimensions, stacking, and responsive contract documented.
- [x] Color contrast calculated and desktop/mobile references published in this folder.
- [x] Project-only policy and authorized updater capability defined as a proposal.
- [ ] Security owner approves specification version and all proposed decisions.
- [ ] Customer/project applicability and initial values recorded by security owner.

Downstream verification must cover enabled/disabled settings in every app; direct
routes and navigation; logged-out auth/OAuth/MFA/recovery; authenticated loading,
empty, denied, and error views; scrolling, modals, desktop/mobile and zoom; storage
and keyboard attempts; cross-project isolation; unauthorized writes and role changes;
policy refresh failures; and absence of clinical writes or render-triggered AuditEvents.

| Approval item | Owner / decision / evidence |
| --- | --- |
| Security owner identity | Pending |
| Exact CUI label, colors, 32px height, typography | Pending |
| Landmark, accessible name, stacking and references | Pending |
| Customer/project applicability and initial values | Pending; include project identifiers |
| Configuration model, canonical namespace owner, updater role | Pending |
| Unresolved policy, outage behavior, 60-second propagation | Pending |
| Approved document version, date, approval link | Pending |

Any change to approved values requires a new specification version and renewed review.
Do not mark ARM-10 approved or complete based solely on this draft.
