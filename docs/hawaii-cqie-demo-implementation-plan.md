# Hawaii CQIE Provider Portal Demo Implementation Plan

## Decision and Branch

Build an HHIE-oriented provider experience by selectively reusing the Nevada HIE workflows, not by presenting a new EHR or replacing HHIE's existing Community Health Record (CHR).

- Repository: `hiivehealth/medplum-provider`.
- Feature branch: `feature/hawaii-cqie-demo`.
- Base: fetched `origin/main`, commit `a18371193aa93d0179fc73f10c133fcc7d66a2c5` (`Prefer grade codes in Army demographics`).
- Isolated worktree: `/Users/paulwinterling/github/Demos/medplum-provider-hawaii-cqie`.
- Reuse reference: `feature/nevadahie`, commit `6b02f44b03f8da41630694c90b17e17b49964799`.
- Existing `feature/cui` worktree and its uncommitted Army changes remain untouched. Do not merge that worktree into this demo.
- Implementation now includes project-scoped Hawaii discovery, conservative consent-gated clinical review, and audit review, plus synthetic bundle generation and a GET-only backend verifier.
- After explicit approval, a separate Hawaii project, 20 synthetic resources, clinician/reviewer roles, and a read-only fixture-verifier client were provisioned on the existing Medplum backend. Existing tenants were not changed. After a separately approved frontend handover, port `5172` now serves this Hawaii worktree.
- Confirmed scope: no Smile integration will be built or demonstrated. Smile's proposed role belongs only in the joint architecture narrative.

## Inputs and Interpretation

This plan uses both attached PDFs: the five-page **Hiive Health + Smile Digital Health Teaming Brief, RFI No. SHPDA2604**, and the four-page **Hiive Health and Smile Digital Health** CQIE presentation, together with Jesse's meeting request.

The detailed brief supplies the RFI mapping and prime/subcontractor boundaries. The presentation supplies the four-function narrative: clinical aggregation, longitudinal records, real-time event notifications, and interoperability with claims/social service integration. Neither attachment is the complete solicitation; validate section references and commitments against the current procurement documents before using them in a formal response.

The CEO's relative award/kickoff dates, the brief's October 2 contribution date, and the presentation's ten-month term are not a confirmed delivery schedule. As of October 16, 2026, October 2 has passed. Confirm the meeting date, procurement stage, applicable term, and deadlines with HHIE. Sequence implementation by verified outcomes, not those date assumptions.

## Demo Objective

Show an HHIE participant how one consent-aware longitudinal record supports a concrete transition of care: a rural patient's hospital discharge reaches their treating practice, the clinician reviews information from several sources, and the practice closes a follow-up task. Then show the exchange how access decisions and onboarding progress can be inspected.

Present the portal as Hiive's access and workflow layer over governed FHIR services. Explain Smile's intended data-layer role without claiming that the current Medplum-backed demo is running on Smile.

### Positioning Boundaries

- HHIE remains prime and owns participant relationships, enterprise MPI, existing CHR and feeds, public health connections, Direct/HISP services, help desk accountability, and State reporting.
- Smile supplies the proposed governed FHIR foundation, normalization, repository-level consent/segmentation, APIs, and digital quality measurement.
- Hiive supplies provider experience, interface delivery, practice onboarding, training/TA, participant reporting, and access-layer controls.
- New connections can land alongside the existing CHR. Cross-repository unification requires a verified integration and identity design; a unified demo timeline is not proof that HHIE repositories are already federated.
- Existing patient identifiers are consumed as externally assigned MPI identifiers. Do not demonstrate a new matching algorithm or claim live HHIE MPI connectivity.
- Do not repeat certification, throughput, uptime, connector availability, or compliance claims as verified properties of this demo. Confirm the product, version, scope, and supporting evidence with the owning partner.

## Live Storyboard

Use one synthetic patient for the primary story, with separate consent and payer scenarios. Keep the main experience focused on HIE discovery, clinical review, notifications, documents, and follow-up; remove unrelated Army, occupational health, prescribing, and billing navigation from the Hawaii demo profile without deleting those features globally.

| Scene | Presenter action | Evidence shown | CQIE / RFI alignment |
| --- | --- | --- | --- |
| 1. Participant entry | Sign in as a synthetic rural practice clinician and open the practice worklist. | Organization-scoped identity and a persisted discharge notification with source, event time, and follow-up state. | Real-time notifications; IV.E.1.d |
| 2. Patient discovery | Search by synthetic name or external patient identifier; open an authorized match. | Minimum necessary discovery result, source identifiers, and visible consent status; no unauthorized clinical preview. | Longitudinal record access; IV.E.1.c |
| 3. Unified record | Review a hospital discharge, ambulatory conditions/medications, and laboratory results in one timeline. | At least three synthetic source organizations, source/time attribution, and links to persisted resources or documents. | Aggregation and longitudinal record; IV.E.1.a and IV.E.1.c |
| 4. Transition of care | Open the discharge event, assign a follow-up task, record an action, and complete it. | Persisted Task owner/status/history; duplicate delivery does not create duplicate work. | ENS expansion and provider workflow; IV.E.1.d |
| 5. Consent boundary | Switch to the not-declared and opt-out scenarios; attempt unauthorized access before any exception. | Clear blocked states and direct API denial. If approved policy permits an emergency exception, show reason capture, temporary access, expiry/revocation, and audit. | Consent; IV.D.2.c and SLA-003 |
| 6. Interoperability | Inspect a synthetic C-CDA document and demonstrate validated import/export when the migrated implementation supports it. | DocumentReference/Binary, source attribution, import outcome, and a real downloadable artifact. | Standards-native exchange; IV.E.1.f |
| 7. Accountability | Sign in as an authorized exchange operations user and inspect activity and site readiness. | Correlated access/exception events and a small persisted onboarding/quality dashboard with honest denominators. | D2, D8-D14, D16, D18 |

Optional extension: sign in as a synthetic Medicaid MCO care manager and contrast an in-roster patient with an out-of-roster patient. Show server-enforced denial, not just a filtered list. Treat this as a separate policy scenario, not a clinician break-glass shortcut (IV.E.1.h.i.4).

## Data and Personas

Use only clearly synthetic people and fictional organizations. Confirm any use of actual HHIE or partner branding and facility names before presentation. Do not imply that a named practice is participating.

| Fixture | Required state |
| --- | --- |
| Primary transition-of-care patient | Adult with explicit permitted demo consent, hospital discharge, ambulatory history, lab results, medication reconciliation context, and a follow-up task. |
| Consent boundary patients | Separate opt-in, opt-out, and not-declared records, plus a labeled synthetic sensitive-data example. |
| Payer boundary patients | One in-roster and one out-of-roster record; use distinct identities so another access grant cannot accidentally bypass the roster check. |
| Source organizations | Fictional rural hospital, ambulatory/FQHC-like practice, laboratory, and behavioral-health source; geographic context without caricature or unsupported population claims. |
| Clinician | Scoped practice membership and only the access necessary for the clinical story. |
| Exchange operations reviewer | Permission to review scoped audit, onboarding, and quality evidence; not automatically unrestricted clinical access. |
| Payer care manager | Separate membership and roster-scoped AccessPolicy. |

Represent clinical data with Patient, Organization, Practitioner/PractitionerRole, Encounter, Condition, Observation, MedicationRequest/MedicationStatement, and DocumentReference/Binary as supported by the verified backend. Use Consent for permission state, Group for payer roster, Task for follow-up, and Provenance for applicable origin/transformation evidence. Use AuditEvent for access and security decisions; do not manufacture Provenance for every read or claim client events constitute a complete server audit trail.

Seed a small, deterministic cohort first. Use demo identifiers, validate references and temporal ordering, and provide an idempotent reset restricted to the demo project. Never reuse Nevada project, policy, membership, bot, or roster UUIDs. No bulk patient generation is needed for the first meeting.

## Verified Reuse and Gaps

Inspection compared fetched `origin/main` with the Nevada branch. The Nevada-specific files below are reuse candidates, not features verified on the new Hawaii branch or in the running browser sessions.

| Surface | Evidence / decision |
| --- | --- |
| Baseline app | `origin/main` has patient timeline routing and Task components. Validate them with the Hawaii fixture before adding competing implementations. |
| Discovery | Nevada has `src/pages/patient/SecurePatientDiscoveryPage.tsx` and `src/bots/nevadaPatientDiscovery.ts`. Discovery invokes a hard-coded bot UUID; replace it with environment/project configuration and an explicit minimal response contract. |
| Consent | Nevada has `src/hooks/usePatientConsent.ts` and `src/components/consent/ConsentBanner.tsx`. The hook maps category text/provision to a UI status and contains Nevada demo identifiers. This is not a complete consent-policy evaluator or Part 2 enforcement engine. |
| Break-glass | Nevada has access/cleanup bots, `src/utils/breakGlass.ts`, and `scripts/nevada-consent-gateway.mjs`. Temporary grants, cleanup, backend enforcement, and clinical relationship preservation need regression tests before reuse. |
| Audit | Nevada has `src/utils/audit.ts`, audit reporting utilities, and an audit dashboard. Verify actual server coverage, allowed event creation, event scope, and correlation rather than assuming all access is captured. |
| Roster | Nevada has a roster dashboard and roster hooks. Carry over policy provisioning and negative API tests, not just UI filtering. |
| C-CDA | Nevada has import/export cards and `PatientTimelineWithCcda.tsx`. Validate formats, backend operations, provenance, and round-trip output before promising a live exchange. |
| ADT and operations | A real HHIE feed, Smile normalization, cross-repository federation, onboarding dashboard, and CQIE reporting were not established by this inspection. Plan explicit implementation or label fixture-driven demonstrations. |

Do not merge the entire Nevada branch: it includes unrelated occupational-health, deployment, and older application changes. Reconcile selected code and tests against current dependencies, routing, and access controls. Keep demo identifiers and feature configuration separate from general clinical logic.

## Ordered Implementation Slices

Each slice is an AI-agent-executable work package with a human reviewer and a concrete exit gate. Agent ownership here is a proposed execution model, not a claim that agents have already implemented the work.

### Slice 1: Reusable HIE Shell and Dependency Contract

**Scope:** Provider routes/navigation, selected Nevada discovery/timeline/documents components, project-scoped configuration, backend bot/gateway dependency inventory, and a capability manifest distinguishing live, synthetic-event, and architecture-only features.

**Deliverable:** Hawaii demo mode on current main with no Nevada UUIDs or unrelated module navigation, plus a documented backend compatibility/provisioning contract. Preserve ordinary provider mode.

**Owner:** Provider implementation agent; backend/security reviewer for access-related migration.

**Exit gate:** Focused migrated component tests pass; direct navigation cannot bypass configured routes/policies; missing dependencies produce an explicit unavailable state. Record backend version, operations, required bots, and policy prerequisites. No live deployment is authorized by this slice.

### Slice 2: Synthetic Cohort and Access Controls

**Scope:** Dedicated demo project/roles, repeatable seed/reset tooling, source organizations, clinical timeline fixtures, consent states, sensitive-data labels, and payer roster. Coordinate backend changes as a separately approved dependency if required.

**Deliverable:** Repeatable primary clinical story and an access matrix covering discovery, chart/document reads, searches, exports, consent errors, sensitive resources, and roster boundaries.

**Owner:** Data/provisioning agent with independent security review.

**Exit gate:** All references resolve; reset produces the same logical scenarios; no real patient data; unauthorized direct FHIR searches, reads, documents/Binary, history, and available export paths are denied or appropriately filtered. Consent service failure fails closed. Permission to create AuditEvent must not itself authorize a clinical access grant; validate actor, role, patient, purpose, and exception policy server-side. Audit-write failure must not silently grant exception access.

### Slice 3: Clinical Discovery and Longitudinal Review

**Scope:** Minimal patient discovery, source-aware timeline, clinical summary, consent banner, document view, and configured external MPI identifiers.

**Deliverable:** A clinician finds the primary patient and reviews attributed information from at least three synthetic organizations. Demo profile prioritizes HIE review over EHR order entry.

**Owner:** Provider implementation agent.

**Exit gate:** Allowed and denied discovery/record flows pass; source attribution matches stored data; no false patient match or clinical leakage; loading/empty/error states and narrow screens remain usable.

### Slice 4: Discharge Notification to Follow-Up

**Scope:** FHIR-native event/worklist path, persisted Task creation/update, duplicate-event handling, actor assignment, and event-to-record links. Prefer a supported Subscription plus Bot/Task path over custom polling infrastructure.

**Deliverable:** A controlled synthetic discharge event reaches the treating practice worklist and becomes completed follow-up work.

**Owner:** Workflow/backend agent with provider integration owner.

**Exit gate:** Triggered event arrives without reseeding/reloading the whole demo; duplicate replay is idempotent; other practices cannot see the work; assigned/completed state survives refresh. Display source event time separately from receipt time. A seeded notification alone is not evidence of real-time delivery.

### Slice 5: Consent Exceptions, Audit, and Payer Extension

**Scope:** Reconcile consent/access policy with HHIE/Smile, controlled break-glass if permitted, expiration/revocation, audit review, and optional MCO pilot scenario.

**Deliverable:** The presenter can prove a denial, an explicitly permitted exception, and its traceable end; payer access remains roster- and purpose-limited.

**Owner:** Security implementation agent with an independent reviewer and HHIE policy approver.

**Exit gate:** No reason-free/self-authorized escalation; no opt-out or Part 2 override by default; no unrestricted payer emergency access. Expiry is enforced on requests even if scheduled cleanup is late; cleanup preserves pre-existing clinical relationships. Test revocation, cache behavior, cross-user access, audit permissions, and forged/replayed exception requests. Do not claim Part 2 readiness without verified data-layer enforcement and policy review.

### Slice 6: Participant Onboarding and Quality Evidence

**Scope:** Six-step site tracker (assessment, connectivity, mapping, validation, cutover, monitoring), synthetic feed-health/validation findings, TA logs, and a small monthly-status view.

**Deliverable:** Operations can inspect one fictional site's readiness and a traceable validation issue. Define metric source, calculation, denominator, and last refresh; keep operational data separate from clinical records using suitable native resources or an explicitly documented model.

**Owner:** Operations/reporting implementation agent.

**Exit gate:** Tracker state persists; unresolved validation blocks a ready-for-cutover status; metrics reconcile to fixtures; synthetic counts cannot be mistaken for statewide production participation. Treat 75 CHR and 28 supplier figures as brief-supplied targets, not achieved counts or necessarily distinct sites. Do not label a simple gap count as certified HEDIS/eCQM output.

### Slice 7: Partner Rehearsal and Demo Release

**Scope:** Joint presentation, presenter script, synthetic event trigger/reset, role-switch rehearsal, fallback evidence, and approved environment selection.

**Deliverable:** A repeatable joint demo with named presenters and every claim classified by evidence level. The live portal uses Medplum; there is no Smile integration in scope. Keep Smile's contribution in the partner-approved presentation narrative.

**Owner:** Demo integration agent; Hiive/Smile presenters approve narrative and HHIE-specific statements.

**Exit gate:** Every primary scene runs in sequence after reset; security negative tests pass; no browser console errors or dead ends; desktop/mobile screenshots are reviewed; fallback captures contain no credentials or real patient information. Document which operations are actually audited. No deployment or mutation of existing demo tenants without explicit approval.

## Verification Commands and Release Gates

For application implementation, use the existing npm/Vitest setup. Run the touched tests first, then the repository build and lint gates. Install dependencies in the isolated worktree before application tests; do not assume another worktree's installation is usable.

```bash
npm ci
npx vitest run <touched-test-paths>
node --test scripts/nevada-consent-gateway.test.mjs
npm run build
npm run lint
```

The gateway command is a reuse check only after that test and its dependencies have been migrated; update it if the migrated filename changes. Browser tests must exercise real low-privilege sessions and direct API requests, not only mocked UI tests. Run broad existing tests as required by CI, and report unrelated baseline failures separately.

Acceptance requires the storyboard, access matrix, replay/reset test, API denials, and screenshot review to pass. Reuse the existing provider server on `5172` if it belongs to the intended demo checkout/environment. Do not switch its running checkout or start a conflicting server during planning; coordinate a deliberate handover before browser verification. Do not change the patient portal or restart the backend as part of this planning task.

## Current Implementation and Environment Handoff

| Slice | Current state |
| --- | --- |
| 1. HIE shell | Implemented with caller-authenticated FHIR APIs instead of Nevada's privileged discovery bot. Separate Hawaii shell avoids invoking EHR prescribing hooks. Hawaii and ordinary provider route tests pass. TypeScript and production build pass. Repository lint is blocked because the base branch has no ESLint configuration. Clean-session desktop/mobile browser checks pass. |
| 2. Data and access | The initial isolated baseline contains 20 synthetic resources: three organizations, three patients, two consents, and clinical entries for three patient scenarios. The follow-up slice adds a controlled discharge encounter and scoped workflow resources/identities. Live checks now pass for 13 clinical resources, including permitted reads/searches and denied clinical searches/direct reads/history. Clinician/reviewer and read-only fixture-verifier roles remain separate. Other security gates below remain pending. |
| 3. Clinical review | Implemented newest-first clinical entries, readable Hawaii timestamps, lab quantities/status, source attribution, and responsive table layout. A document action rechecks consent and rereads the patient-bound DocumentReference before displaying a current inline UTF-8 plain-text attachment. Desktop/mobile live checks pass. C-CDA/PDF/remote attachment rendering, import/export, medications, and broader clinical summarization remain outside this completed read-only slice. |
| 4. Notifications and follow-up | Implemented and live-verified for controlled synthetic discharges: native Subscription to scoped Bot to conditionally created, assigned Task. Work supports start/completion, patient/source links, separate event/receipt times, and refresh-persistent state. Another-practice identity cannot search/read this work. A processed replay preserves the completed Task ID, state, and version, backed by a new native success AuditEvent. No external ADT feed or browser push is claimed. |
| 5. Exceptions and audit | Readable persisted workflow audits and reviewer/clinician separation are live-verified at desktop/mobile sizes. After an approved 1 GiB capacity rollout, native JSON logging and reference-display redaction are enabled on the shared backend. Six real clinical probes were matched in CloudWatch: one allowed read, two denied reads, and three patient-scoped searches with result counts 1/0/0. These are operational logs, not newly persisted clinical-access AuditEvents in the portal. Matching is bounded actor/target/action/outcome/time evidence, not unique request tracing or complete coverage certification. Consent exceptions, dynamic consent enforcement, and Part 2 readiness remain unverified; no exception grants are implemented. |
| 6. Onboarding and quality | Implemented and live-verified at `/hie/operations`: one persisted synthetic Basic snapshot, a separate non-admin snapshot-scoped read-only operations role, six stages, reconciled monthly metrics, traceable validation findings, and assistance log. Desktop/mobile refresh/reload preserve the actual snapshot ID/version. Operations clinical/audit/Task denials and other-role operational denials pass; an identical-body update returns 403 without changing the snapshot. Existing policies/memberships and presenter follow-up work are unchanged. No live feed or tracker-editing workflow is claimed. |
| 7. Rehearsal | Sign-in, discovery, clinical/document review, denied charts, controlled discharge-to-completed-follow-up, and live operations inspection pass desktop/mobile checks. Full joint role-switch rehearsal and exception-policy review remain pending. |

### Enablement and Policy Contract

Enable the Hawaii routes only on an approved isolated demo Project by adding a Project setting with `name: hawaiiCqieDemo` and `valueBoolean: true`. This is a display configuration, not an authorization control. Do not enable it on the shared Army project. The app uses the existing sign-in configuration and the signed-in member's access token; no Nevada bot IDs or service credentials are used.

The current deployed backend omits `Project.setting` from `/auth/me`. For this version, set the frontend environment variable `MEDPLUM_HAWAII_PROJECT_ID` to the approved project UUID. Hawaii mode activates only when the signed-in project's ID matches exactly; it must not be a global boolean switch. Newer backend versions can use the project-setting path. This fallback changes no backend authorization behavior.

Provision separate clinician and fixture-verifier memberships in that demo project. The clinician needs minimum-necessary Patient directory reads, read/search access to the simple demo Consent records, and clinical reads/searches restricted to the permitted synthetic patient's Encounter, Condition, Observation, and DocumentReference resources. Explicitly prohibit access to the opt-out and not-declared patients' clinical entries, including history and alternate query paths. Do not grant project administration, unrestricted clinical access, or policy editing to the clinician. The fixture verifier needs read-only access to the three synthetic scenarios solely to prove that denied records really exist. The audit reviewer is a separate read-only AuditEvent role; fixture verification does not establish appropriate audit-review permissions. The follow-up slice adds only patient-, assignee-, and identifier-scoped Task read/search/update access for the clinician, with server-enforced forward status transitions and protected clinical/event/assignment fields.

Medplum AccessPolicy permissions do not automatically become a comprehensive consent or Part 2 policy engine because a Consent resource exists. A fixed synthetic cohort can use explicitly scoped permissions for this demo, but that is not proof of dynamic consent enforcement. The UI supports only one active, simple patient-specific permit; denied, absent, conflicting, constrained, or unavailable policies block clinical display. No Medicaid exception or Part 2 override is assumed.

Generate a bundle for review using `node scripts/hawaii-cqie-fixtures.mjs`. Generation only writes JSON to stdout; it makes no network calls. `npm run hawaii:check-fixtures` validates its structure and references. After explicit environment selection, an authorized provisioner must submit the reviewed transaction, validate it against the server schema, and record the resulting patient IDs. Re-running uses conditional creates, not updates: it must not silently overwrite consent or clinical changes. No destructive reset command is provided.

### Participant Operations Model and Live Handoff

The `/hie/operations` page reads one caller-authorized FHIR `Basic` by identifier with `_count=2` and `cache: no-cache`. No bundled fixture is used as a runtime fallback. Missing evidence, permission failures, invalid payloads, and duplicate snapshots never produce a readiness assessment. Refresh removes the old evidence before loading; a failed refresh cannot leave old metrics visible. This page has no FHIR write controls and does not change clinical follow-up Tasks.

The operational model is explicitly demo-specific, not a standard FHIR onboarding profile:

- Resource: one `Basic`, without a patient subject or clinical references.
- Identifier: system `https://hiivehealth.com/fhir/identifier/hawaii-cqie-onboarding`, value `synthetic-rural-site`.
- Code: the same system with code `site-readiness`.
- Extension: `https://hiivehealth.com/fhir/StructureDefinition/hawaii-cqie-onboarding`, carrying a JSON `valueString`. This URI identifies the documented contract; a formal StructureDefinition has not been published or installed.
- Payload version: `schemaVersion: 1`; fictional site name, evidence capture instant, UTC reporting month, exactly six unique stages, receipt records, record-linked validation findings, and dated assistance entries.
- Source fixture: `fhir/hawaii/onboarding-snapshot.json`. Offline bundle generation uses a separate conditional create and never adds these operations data to the clinical seed bundle. Generation makes no network requests; replaying an approved import must not overwrite an existing tracker.

Metrics derive from that payload, not fabricated headline totals:

| Metric | Calculation and denominator | Current synthetic fixture |
| --- | --- | --- |
| Acceptance | Accepted receipt records / all submitted receipt records in the UTC reporting month, multiplied by 100. No receipts means no percentage. | 1 / 2 = 50.0% |
| Rejected records | Rejected receipt records / all submitted receipt records in the UTC reporting month. | 1 / 2 |
| Assistance | Count of assistance entries dated in the UTC reporting month; not a site-participation percentage. | 1 session |
| Readiness | First four stages completed and no unresolved validation findings. Open findings block validation, cutover, and monitoring display even if raw stages incorrectly claim completion. | Not ready; VAL-001 is open; 3 / 6 stages completed |

`VAL-001` links synthetic receipt `SYNTH-ADT-002` to the missing `Encounter.class` field. This is an operational issue description, not an actual clinical Encounter write. The page shows the snapshot capture time, actual retrieval time, resource ID, and supplied version. Display times are HST; monthly aggregation is explicitly UTC. Receipts are historical synthetic feed evidence, not a live connectivity/heartbeat monitor. The 75 CHR and 28 supplier figures remain brief-supplied targets, not achieved participation or necessarily distinct sites. No HEDIS/eCQM certification is claimed.

Initial frontend and preview verification on 2026-10-17, retained separately from the live evidence below:

- 81 Hawaii/sign-in/ordinary PatientPage tests pass; production TypeScript/Vite build and both fixture checks pass. Existing large-chunk warning remains.
- The initial 21 tooling tests covered native root-relative duplicate searches and mixed GET-only batches, ordered native responses, denied preview responses, and rejection of mutating or foreign-server entries. The subsequent live-enablement suite passes 31 tests, including scoped-role policy and verifier failure cases.
- Desktop 1440x1000 and mobile 390x844 screenshots reviewed: readable stages, findings, provenance, monthly metrics, and assistance log; no horizontal overflow.
- The browser first verifies genuine live clinician unavailability, then explicitly intercepts synthetic onboarding reads. Both viewport reports show zero FHIR writes and zero JavaScript errors; refresh and reload fetch again; a denied refresh removes metrics. A POST containing only FHIR batch GETs is treated as a read, not a mutation.
- `hawaii-cqie.local/operations-preview-browser-check.json` and `screenshots/*-operations-fixture-preview.png` are private, ignored preview artifacts. They are not evidence that an operational resource persists on the server or that a live operations role exists. The unrelated CUI service remains unavailable.

Safe checks, preserving the presenter's follow-up work:

```bash
node scripts/hawaii-cqie-fixtures.mjs --onboarding --check
node --test scripts/hawaii-cqie-preflight.test.mjs
HAWAII_PLAYWRIGHT_MODULE=file:///tmp/hiive-hawaii-browser/node_modules/playwright/index.mjs node scripts/hawaii-cqie-browser-check.mjs --operations-preview
```

Do not run the browser script without a bounded mode: its full workflow can consume the pending presenter Task. `--operations-preview` does not enable a preview mode in the application or grant access to any role.

Live enablement was explicitly approved and completed on 2026-10-17 in the existing **Hawaii CQIE Synthetic Demo** project only. The setup used native conditional creation and a project-scoped invite with email disabled. No temporary broad client, existing-role expansion, shared backend restart, infrastructure change, or clinical write was needed. Existing clinician/reviewer memberships and all previously recorded role/workflow policies were compared before and after and remained unchanged.

| Persisted object | ID |
| --- | --- |
| Operational Basic | `c8e324e8-50b2-4d75-92eb-e582f730caed` |
| Snapshot version | `09df9c13-9cb7-4863-87f2-e029ab041d60` |
| Operations AccessPolicy | `cd35f6d8-ab01-4cea-9c00-71b4322eee3d` |
| Operations membership | `9c7da2bb-ef93-47c8-ac43-a0692423cde2` |

The custom operations policy grants only `Basic?_id=c8e324e8-50b2-4d75-92eb-e582f730caed` with read/search interactions and `readonly: true`. This does not describe or revoke platform-provided schema/conformance access. The operations member is explicitly non-admin. Its email is `hawaii.cqie.operations.a901f66f@example.com`; password and membership details are stored only in the ignored, owner-only provisioning manifest under `onboarding.account`. No credentials appear in committed documentation or screenshots.

Live evidence:

- `hawaii-cqie.local/onboarding-check.json`: verified at `2026-10-17T13:11:05.177Z`. Four distinct role identities authenticate to the exact project. Operations reads the reviewed persisted snapshot and finds exactly that snapshot in a broad Basic search. Clinician, reviewer, and existing other-practice identities cannot search or directly read it.
- Operations cannot search or directly read the tested existing Patient, Consent, Encounter, Condition, Observation, DocumentReference, Task, and AuditEvent resources. The clinician/reviewer first prove those resources exist. These are bounded direct-read/search checks, not certification of every FHIR interaction or query variant.
- The boundary verifier uses GET only. The CLI then separately attempts one identical-body, version-guarded PUT to the operational Basic as operations; it returns 403, and a fresh read confirms the same resource/version. No delete, clinical write, or Task transition was attempted. Do not describe this combined CLI as making only GET requests.
- `hawaii-cqie.local/onboarding-browser-check.json`: fresh operations sign-in, actual resource ID/version, 1/2 acceptance, six stages, open-finding readiness block, refresh and reload, clinical/audit denied views, and clinician operational denial all pass at 1440x1000 and 390x844. There is no request interception in `--operations-live`. Both viewport runs have zero FHIR writes, zero JavaScript errors, and no horizontal overflow. `screenshots/*-operations-live.png` were visually reviewed.
- Reports remain owner-only and ignored. The earlier fixture-preview reports remain clearly labeled as previews, not substituted for live evidence. The presenter's pending follow-up work was not consumed. CUI service unavailability and the baseline missing ESLint configuration remain unrelated limitations. Frontend tests/build were not rerun for this tooling-only live enablement; the earlier 81-test/build result remains the frontend gate.

The deployed API omits `meta.project` from the scoped Basic response; administrator setup verified resource project ownership, while scoped checks require the exact authenticated project and snapshot ID and reject any supplied foreign project. The existing other-practice ClientApplication omits its optional membership admin flag; this is accepted only for the exact recorded client identity, never for human roles. Both response shapes and their negative cases are regression-tested. An earlier reviewer-login failure was not reproduced in an isolated sign-in or the successful verification; its cause was not established and was not counted as a denial.

Current safe verification commands:

```bash
node scripts/hawaii-cqie-onboarding.mjs --check
node --test scripts/hawaii-cqie-preflight.test.mjs
node scripts/hawaii-cqie-onboarding.mjs --verify
HAWAII_PLAYWRIGHT_MODULE=file:///tmp/hiive-hawaii-browser/node_modules/playwright/index.mjs node scripts/hawaii-cqie-browser-check.mjs --operations-live
```

`--verify` includes the single rejected Basic PUT described above. `--apply` is the approved setup operation, not a reset; do not rerun it blindly after a partial invite or replace any existing tracker. Tracker-update testing or a write-capable operations workflow requires separately specified authorization and version guards. The operations user stays read-only. These checks do not establish audit-log coverage for onboarding accesses; the portal still shows persisted workflow audits, while ordinary clinical-access logging uses the separately verified operational destination.

Presenter sequence: sign in as operations at the project-scoped sign-in URL; open Participant Operations; inspect the fictional site; trace the blocked validation stage to `VAL-001` and `SYNTH-ADT-002`; reconcile acceptance to the two receipts; show `TA-001` and capture/retrieval timestamps; refresh and reload; switch to the clinician and confirm operational evidence is unavailable. Keep the clinical and operational roles distinct. Use the live captures as bounded fallback evidence, explicitly retaining the synthetic/historical qualification. This sequence does not change tracker state or consume follow-up work. No Smile integration is added.

### Read-Only Backend Verification

Run tooling tests with `npm run hawaii:test-preflight`. For a real check, set `HAWAII_CQIE_PREFLIGHT_CONFIG` to a private, untracked configuration file whose structure is:

```json
{
	"baseUrl": "https://approved-demo-api.example/",
	"projectId": "<demo-project-uuid>",
	"allowedPatientId": "<permitted-patient-uuid>",
	"deniedPatientIds": ["<opt-out-patient-uuid>", "<not-declared-patient-uuid>"],
	"clinicianTokenFile": "<private-path-to-clinician-token>",
	"verifierTokenFile": "<private-path-to-fixture-verifier-token>"
}
```

Token file paths resolve relative to the private configuration file. Use approved, short-lived credentials; never put them in chat, source control, command arguments, or committed fixtures. Run `npm run hawaii:preflight`. The verifier uses GET requests only, refuses redirects, validates project identity and synthetic fixture existence, proves permitted clinical reads/searches, and checks that denied clinical searches, direct reads, and histories do not leak data. A 401 or missing fixture is a failure, not evidence of enforcement. It prints no tokens or patient resource bodies.

A passing check covers those specific fixture paths only. It does not certify consent semantics, directory field minimization, Binary attachments, `_include`/`_revinclude`, bulk export, consent change/revocation, project-switch cache behavior, or audit completeness. These remain explicit release gates before any stronger security claims.

### Live Provisioning Evidence

- Environment: existing Hiive build Medplum API at `https://api.ehr.hiivehealth.net/`.
- Isolated project: **Hawaii CQIE Synthetic Demo**, ID `a901f66f-ace9-4895-a492-80364684194d`.
- Provisioned: 20 synthetic resources, a non-admin clinician, an audit-only reviewer, a read-only fixture-verifier client, and explicit role policies. Invitations did not send email. Temporary provisioner access was changed to an empty policy after provisioning.
- Live preflight passed for three patient scenarios and 12 clinical resources using distinct scoped credentials. Clinician clinical searches, direct reads, and history paths were blocked or filtered for the two denied scenarios; allowed clinical searches and reads succeeded.
- The first seed attempt produced partial success because the two Consent resources lacked the FHIR `ppc-1` policy invariant. Read-only validation identified the issue, the generator was corrected, and conditional creation completed the same project without deleting resources or overwriting existing entries. Always inspect every response entry; do not assume this deployed backend rolls back an unsuccessful transaction atomically.
- New-project initialization returned a Project directly, not a Parameters wrapper. Provisioning now supports both response shapes and requires an explicit project UUID to resume a pre-role partial run. Do not rerun it blindly after roles have been created.
- Generated credentials, short-lived tokens, patient IDs, and stage records are kept under the Git-ignored `hawaii-cqie.local/` directory. The provisioning manifest and credential files use owner-only file permissions. Never commit or paste their contents into chat. Tokens may expire; they are not a permanent login mechanism.

After explicit handover approval, the old temporary SOAP frontend listener was stopped and this worktree was started on the same port `5172`. No backend was restarted, and no files in the old checkout were changed. All live data/policy mutations were confined to the newly approved Hawaii project and its memberships; no shared Army/Nevada fixtures or existing policies were changed.

Launch from this worktree with:

```bash
MEDPLUM_BASE_URL=https://api.ehr.hiivehealth.net/ \
MEDPLUM_HAWAII_PROJECT_ID=a901f66f-ace9-4895-a492-80364684194d \
npm run dev -- --host 127.0.0.1 --port 5172 --strictPort
```

Open `http://127.0.0.1:5172/signin?project=a901f66f-ace9-4895-a492-80364684194d`. Generated clinician/reviewer logins are in the private provisioning manifest, not in this document. Sign out of an existing non-Hawaii session before the walkthrough.

Desktop (`1440x1000`) and mobile (`390x844`) Playwright checks passed with fresh clinician sessions: three directory matches, four allowed clinical rows from three organizations, blocked clinical views for two denied patients, no page-level horizontal overflow, and no uncaught JavaScript exceptions. Synthetic-only screenshots and a machine-readable result are under the private output directory. Use `HAWAII_PLAYWRIGHT_MODULE` to point the browser-check script at an available local Playwright module; no browser driver is added to application dependencies.

The clinical-review extension additionally verifies newest-first order, the persisted `8.1 %` A1c result, and opening/closing the seeded discharge summary at both viewports. Full timestamps are displayed in `Pacific/Honolulu`; date-only values keep their calendar date and unknown dates remain explicitly unknown. The viewer supports only one current inline `text/plain` attachment, decoded as UTF-8 with a 1 MiB limit. It does not render HTML or fetch external attachment URLs. Unit/component checks cover malformed/oversized/unsupported content, a revoked permit before document open, and a mismatched patient subject. These UI checks do not replace backend enforcement or prove continuous consent revalidation while a chart remains open.

Known remaining environment issue: the pre-existing CUI policy service at port `8105` is unavailable, producing `/api/cui-banner` proxy failures. The browser check records this separately; it is not a CUI policy verification or a clean-network-console claim. Do not use the baseline to demonstrate CUI handling. No audit-completeness, dynamic consent, Part 2, or document round-trip claims have been verified.

### Native Discharge-to-Follow-Up Rehearsal

The isolated project has the native `bots` feature enabled. A native Subscription matches finished, patient-bound synthetic discharge encounters in a dedicated identifier namespace. Its stable, non-admin source-client identity can read/write only that synthetic event cohort; its temporary permission to create the one subscription is removed after setup. The Bot uses its own scoped policy to read the event and consent and conditionally create one assigned Task per encounter. The temporary project-admin setup operators are disabled after setup; no shared backend settings, restarts, or other tenants are involved.

Use these explicit commands from the Hawaii worktree:

```bash
node scripts/hawaii-cqie-follow-up.mjs --check
node scripts/hawaii-cqie-follow-up.mjs --emit
node scripts/hawaii-cqie-follow-up.mjs --verify
node scripts/hawaii-cqie-follow-up.mjs --replay
node scripts/hawaii-cqie-follow-up.mjs --verify
```

`--check` is offline. `--emit` creates a new synthetic discharge without reseeding; it does not assert delivery. Open `/hie/follow-up` or use its refresh control, start follow-up, then complete it. Task state survives page reload. The worklist shows the patient name, separate discharge/receipt timestamps in Hawaii time, and links to the patient and exact source encounter. It loads on entry or explicit refresh, not a push channel or continuous polling loop. The persisted Task represents follow-up work only; completing it does not itself change medications, schedule an appointment, or prove contact with a patient.

`--replay` updates the same event, capturing the existing Task ID, status, and version first. `--verify` requires exactly one Task, a successful native execution AuditEvent for the latest emission, preserved replay state, another-practice search/direct-read denial, and the existing clinical cohort checks. It also attempts a skipped/reversed status update and requires backend denial; it is not a GET-only command. The completed live replay preserved the Task ID, completed state, and version. The native execution evidence verifies this workflow only, not a complete clinical-access audit pipeline or concurrent-delivery/load guarantees.

Initial setup/resumption requires `--apply` and `HAWAII_CQIE_ADMIN_LOGIN_REFERENCE` pointing to the documented administrator reference. Do not rerun the original project provisioner or blindly resume a partial native setup. The follow-up setup validates the fixed project ID, existing role policies, and recorded resource IDs. Its private stages/errors and credentials remain under `hawaii-cqie.local/`; no credentials enter frontend configuration or source control. Project-scoped Bot initialization requires a temporary project-admin capability, and new projects require the `bots` feature before deployment.

This is a controlled Medplum-native synthetic event path, not Smile integration, an HHIE/CHR feed, external ADT ingestion, or an operational notification/SLA claim. Static cohort policies remain the backend security boundary; fresh UI/Bot consent checks do not provide comprehensive dynamic consent or Part 2 enforcement. Existing CUI-service and ESLint configuration limitations remain unchanged.

### Audit Evidence and Presenter Handoff

The audit readability/role-boundary slice was checked against the isolated live project on October 16, 2026. It changes no backend logging configuration, infrastructure, clinical access policies, or consent state. The current restricted HIE view remains unchanged. Stored event type and action are displayed separately: for example, an `execute` type does not imply a populated FHIR action field. Actor identity is never inferred from the recording observer. Unknown/missing fields remain explicit rather than being filled with the signed-in reviewer or guessed patient data.

Verified role boundaries:

- Clinician: audit search is denied/empty and direct audit reads are denied; normal permitted clinical review remains available.
- Reviewer: actual audit records are readable, while patient reads, clinical searches, and direct clinical reads are denied/filtered. The audit view displays only fields stored in AuditEvent; it does not use elevated patient/profile lookups to resolve names.
- Fixture verifier: read-only clinical access proves that the denied clinical resources really exist.

The GET-only evidence probes produced these results:

| Scenario | Clinical response | Newly matching clinical-read AuditEvent |
| --- | --- | --- |
| Permitted patient | 200 | Not observed in the measurement window |
| Opted-out patient | 404 | Not observed in the measurement window |
| Not-declared patient | 404 | Not observed in the measurement window |

A 404 is accepted as a masked access denial only because separate verifier credentials establish the resource exists. Candidate audit matches require a new audit ID, timestamp at/after the probe, exact resource reference, clinician actor, read action, and compatible outcome. This is a bounded immediate observation, not proof that no record exists in another destination or arrives later, and not unique request-trace correlation. Existing native Bot/Subscription execution records do not close this clinical-access coverage gap. Do not fabricate AuditEvents in the browser or grant broader permissions to make the dashboard look complete.

#### Source-Traced Audit Destinations

Read-only source inspection identified separate paths in `medplum-ubix/packages/server/src/fhir/repo.ts` and `packages/server/src/util/auditevent.ts`:

- Ordinary reads construct RESTful AuditEvents with read action, requesting actor, resource reference, and success/failure outcome. `logAuditEvents` controls JSON emission to stdout; it does not persist a FHIR resource.
- `saveAuditEvents` separately controls asynchronous FHIR persistence, and the repository additionally requires a full Resource payload. Successful direct reads supply a Resource. Failed direct reads supply only a Reference and therefore do not pass this persistence guard. Search operations supply a query rather than a Resource and likewise do not pass it. Enabling this flag alone is not a complete denied-read/search auditing fix.
- Bot execution has its own destination configuration, defaulting to persisted AuditEvent resources. Visible execution events can therefore coexist with an empty clinical-read audit search.
- The checked-in ECS definition routes ordinary container stdout to `/ecs/medplum/build` when FireLens is not enabled. The deployed task routing was separately verified below; source code alone does not establish running configuration.

Do not treat the generic server-config description of saving "all" RESTful operations as proof of coverage: the repository's payload guard is narrower. Any remediation must address the actual destinations and denied/search paths, preserve actor/resource/request correlation and least privilege, and test persistence/log failures without expanding clinical access. No runtime flag has been changed by this investigation.

#### Deployed Audit Investigation

Read-only AWS checks on October 16, 2026 used the documented `hiive-build` SSO profile in account `476905305808`, Region `us-east-1`. The expired local SSO session was refreshed, then identity was rechecked. No backend restart, task update, parameter write, policy change, or clinical write was performed.

| Evidence | Observed result |
| --- | --- |
| Backend ECS service | Active; one running task; primary task-definition revision `MedplumBuildBackEndTaskDefinition25DAB390:5` |
| Running image | `medplum/medplum-server:5.1.10`, digest `sha256:5dcb8b0a4c0ce4423be8c6edfc8137c5891456e524084abd1050e7671a8b3004` |
| Configuration command | `aws:/medplum/build/,env` |
| Explicit SSM audit flags | `/medplum/build/logAuditEvents` and `/medplum/build/saveAuditEvents` both absent |
| Inspected environment sources | Neither audit flag present in the task definition or running task overrides; no ECS-injected secrets |
| Container log destination | `awslogs` to `/ecs/medplum/build`, prefix `Medplum`, Region `us-east-1` |
| Log retention configuration | 731 days; this is a configured retention period, not proof that required audit events were emitted or retained |
| Bounded CloudWatch lookup | Zero matching JSON AuditEvents for this exact Hawaii project between `2026-10-16T19:30:00Z` and `2026-10-16T19:45:00Z`, enclosing the recorded clinical probes |

Only the two named non-secret SSM flags were requested. ECS output was restricted to configuration command, image identity, audit-flag allowlisted values, log routing, and secret names, not unrelated environment values. CloudWatch output was restricted to match counts/timestamps/stream names, never raw messages. The lookup required both `resourceType=AuditEvent` and the isolated project's exact `meta.project`.

The running image is older than the local checkout. The relevant paths were cross-checked against the upstream [v5.1.10 repository implementation](https://raw.githubusercontent.com/medplum/medplum/v5.1.10/packages/server/src/fhir/repo.ts) and [v5.1.10 audit utility](https://raw.githubusercontent.com/medplum/medplum/v5.1.10/packages/server/src/util/auditevent.ts): both have the same Resource-only persistence guard, JSON logging flag, and independent default Bot resource destination. Release-tag source comparison is not an attestation of the running image's complete contents.

These findings are consistent with ordinary access auditing being unconfigured in the inspected sources and explain why persisted execution audits alone are visible. They do not inspect image-baked environment, prove what SSM values existed when this task started, inspect in-process cached configuration, or rule out a different logging destination/format/window. The portal still must not claim complete access auditing.

**Recommended next slice:** separately authorize the shared backend audit-destination decision before runtime changes. Server-side JSON logging is the existing native path capable of representing both allowed and denied reads and search operations; enabling it affects all projects on this backend and requires reviewed privacy/redaction, retention, operational access, correlation, and deployment/rollback gates. CloudWatch access is not granted by the demo's FHIR reviewer role. If the requirement is to show these access events inside the portal, define a scoped server-side persistence or read-only evidence interface and independently test it; do not expose AWS credentials to the frontend, grant clinicians AuditEvent creation, or assume `saveAuditEvents=true` alone covers denied requests. A complete follow-up gate must prove real allowed/denied reads and filtered searches at the selected destination, with actor, target/query, outcome, timestamp, and correlation, without consuming the presenter's Task or changing clinical access.

#### Authorized Shared Logging Rollout: Rolled Back

The user authorized the shared-backend logging remediation after the investigation. Scope is limited to native JSON audit emission plus reference-display redaction via SSM and a rolling restart of the existing ECS service. Do not enable FHIR audit persistence, change clinical permissions, deploy local backend changes, change the image/task definition, or alter log access/retention in this slice. These settings apply to all projects, not only Hawaii. Reference redaction is not de-identification: resource/actor IDs, network addresses, query values, and outcome descriptions can still contain sensitive information. Existing AWS operational access and the 731-day retention policy are inherited, not newly certified or independently approved for a production compliance scope.

Preflight established both target parameters absent, `saveAuditEvents` absent, one healthy service task on revision 5, and rolling deployment minimum/maximum healthy percentages 100/200. The authorized attempt created `/medplum/build/redactAuditEvents=true` and `/medplum/build/logAuditEvents=true` as version 1 parameters, then forced a new deployment of the same service/task definition. Both parameters have since been deleted to restore that baseline. Use `AWS_PROFILE=hiive-build AWS_SDK_LOAD_CONFIG=1 AWS_PAGER=''` for AWS commands. Recheck caller identity before restart. Wait for service stability, verify the new task and load-balancer health, then run fresh GET-only clinical probes. Do not interpret SSM writes alone as evidence that the running process loaded the settings.

Rollback restores the verified absent-parameter baseline, rather than setting unrelated defaults:

```bash
aws ssm delete-parameters --region us-east-1 --names /medplum/build/logAuditEvents /medplum/build/redactAuditEvents
aws ecs update-service --region us-east-1 --cluster MedplumBuild-BackEndCluster6B6DC4A8-RJc8IRf3ENQc --service MedplumBuild-BackEndFargateServiceD3B260C0-VHHbzrR6nDGn --force-new-deployment
aws ecs wait services-stable --region us-east-1 --cluster MedplumBuild-BackEndCluster6B6DC4A8-RJc8IRf3ENQc --services MedplumBuild-BackEndFargateServiceD3B260C0-VHHbzrR6nDGn
```

Only delete those two parameters if they are still the values created by this rollout and no concurrent operator has changed them. Restart/redeploy is necessary because the backend caches configuration at startup. No application code rollback or task-definition change is required. If healthy replacement cannot be established, restore the parameters and roll back rather than broadening infrastructure scope. Existing log records are not deleted by this rollback.

**Failed-replacement recovery:** the restart-based procedure above is not a substitute for stopping an actively failing deployment. When the previous successful service revision still has a healthy task, restore the parameter baseline, inspect `aws ecs list-service-deployments` and `describe-service-deployments`, and use `aws ecs stop-service-deployment --service-deployment-arn <verified-in-progress-arn> --stop-type ROLLBACK`. Confirm `ROLLBACK_SUCCESSFUL`, the expected primary revision, desired/running counts, and target health. Do not repeatedly force new deployments of an image that cannot start within its current resources. If the deployment already completed successfully, a later parameter rollback still needs a controlled restart to load the restored configuration.

October 16 runtime outcome:

| Gate | Actual result |
| --- | --- |
| Authorized logging attempt | `ecs-svc/1922598649690561453`, created `2026-10-16T19:56:44Z`; ECS stability waiter exhausted its attempts |
| Failed replacements | Tasks `6271d80c180745e5a23af72f6e2e1fde` and `c8630ba20dd2472fbf4f51f5992119f4`: essential container exit 137, explicit `OutOfMemoryError: container killed due to memory usage`; original image digest unchanged |
| Availability during failure | Original service revision retained its running healthy target; replacement targets were drained |
| Parameter restoration | Both newly created parameters were rechecked as `true`, version 1, then deleted; logging, redaction, and FHIR-persistence parameters all verified absent afterward |
| Restart-based recovery | `ecs-svc/5863042310216962201` was started after restoring parameters, then stopped using native rollback to avoid further replacement attempts |
| Native rollback | Service-deployment suffix `Y0jT2xLnQYu0pYlFiaIIe`: `ROLLBACK_SUCCESSFUL`; restored service revision `6663705316364336252` |
| Final settled service | One primary `COMPLETED` deployment, desired/running 1, pending 0, unchanged task-definition revision 5; original target healthy, stopped replacement deregistration observed draining |
| Fresh clinical checks | At `2026-10-16T20:09:16Z`: permitted Observation read 200, two masked denied reads 404; patient-scoped searches 200 with result counts 1/0/0; clinician/reviewer separation passed |
| Audit completion | Not established. No successful post-rollout CloudWatch coverage report; portal clinical-access audit gap remains open |

The OOM observations establish a replacement-startup capacity blocker, not proof that audit logging itself caused the memory exhaustion. No task memory/CPU, image, task definition, clinical policy, or log access/retention was changed. The next authorized runtime attempt requires a separately reviewed capacity/startup investigation and deployment plan; do not silently increase resources under this logging-only scope. The presenter's follow-up Task was not started or completed by these operations. The extended read-only evidence checker remains available and its 18 tooling tests pass, but passing tests are not successful live CloudWatch verification.

#### Read-Only Startup Memory Investigation

Subsequent read-only AWS checks confirmed task-definition revision 5 has **512 MiB task memory and 256 CPU units**, one essential application container, no separate container memory limit/reservation, and no explicit `NODE_OPTIONS` or `MEDPLUM_NODE_OPTIONS` in the task definition. Image-baked process options and actual V8 heap configuration were not inspected.

Both failed replacement streams contain only two early startup entries: the structured starting-server record and a second short non-JSON version-related entry. No listening/server-started record, migration phase, Node heap-fatal trace, or audit emission was observed in those bounded streams. Raw messages were not printed. ECS reports container-level OOM with exit 137 for both tasks; that is not sufficient to identify a JavaScript heap leak, distinguish native/heap allocation, or prove that audit logging caused the failure.

The service-level `AWS/ECS MemoryUtilization` series for `2026-10-16T19:45:00Z` through `20:15:00Z` stayed at approximately 50.20% maximum in the inspected minute samples (about 257 MiB against 512 MiB). This is aggregate service telemetry, not the failed task's measured startup peak. Cluster Container Insights is disabled, so it supplies no per-task/container memory series for reconstructing the spike. Do not interpret the service graph as disproving the explicit OOM termination, or add stopped-task/draining lifetime to infer how long allocation took.

**Proposed discriminating capacity test, not deployed:** increase task memory from 512 MiB to **1024 MiB**, retain 256 CPU units, the same image digest, command, environment, access policies, and absent audit parameters. This is a valid Fargate memory/CPU pairing, not a measured sizing guarantee. First establish a healthy cold replacement with logging still at baseline. Only after that succeeds, separately enable logging/redaction and prove healthy replacement plus CloudWatch read/search evidence. Separating the changes distinguishes a baseline startup-capacity problem from additional audit configuration behavior.

The capacity test requires explicit approval because it changes the shared service's task definition, allocated memory, and operating cost. Keep the durable CDK configuration (`serverMemory`) consistent with the deployed task revision, review a narrowly scoped infrastructure diff before deployment, and preserve unrelated backend work. Do not deploy a broad CDK diff, upgrade the image, change CPU/concurrency/heap flags, enable extra observability infrastructure, or change clinical grants as part of this test. On failed startup, retain the healthy previous revision and use native deployment rollback; avoid repeatedly forcing replacements. The next successful rollout must also identify a rollback revision with demonstrated cold-start capacity rather than assuming the old 512 MiB revision can be recreated successfully.

No runtime changes were made during this investigation. Audit logging remains rolled back, the original task remains the baseline, and live audit coverage is still unresolved.

#### Approved Capacity Rollout

After the read-only investigation, the user explicitly approved a 1 GiB memory-only rollout, with CPU and image unchanged, baseline startup verified before a separate audit retry. The durable build configuration now sets `serverMemory=1024`. Predeployment CDK diff reported exactly one resource difference: replacement of the backend TaskDefinition for memory 512 to 1024 MiB. It reported no image, CPU, environment, access, storage, networking, or other infrastructure changes. The actual CloudFormation change set contained that memory replacement plus the service's reference to the new TaskDefinition. Although CDK printed an intermediate manual-execution message, independent AWS checks confirmed `EXECUTE_COMPLETE`, stack `UPDATE_COMPLETE`, and a sole completed ECS deployment on revision 6.

The baseline replacement task `cf1352d69d1744f58a12a4aef91ca292` is running with memory 1024 MiB, CPU 256 units, image tag `5.1.10`, and the same config-loading command. Target health is healthy (prior-task draining observed). All audit parameters were still absent. Fresh GET-only evidence at `2026-10-17T00:11:22Z` passed clinician/reviewer separation, clinical reads 200/404/404, and patient-scoped search result counts 1/0/0. This establishes one successful cold replacement at the approved capacity, not a load-test or long-term sizing guarantee. Confirm its original image digest before the separate logging retry. Revision 6 is now the healthy capacity rollback baseline; do not revert memory to 512 MiB merely to disable logging. The CloudWatch verifier now requires revision 6, memory 1024, CPU 256, and the original image digest.

#### Verified Logging Retry at 1 GiB

The baseline image digest was independently confirmed unchanged. The separate logging retry then created only `/medplum/build/logAuditEvents=true` and `/medplum/build/redactAuditEvents=true` (version 1), leaving `saveAuditEvents` absent, and rolled the same revision 6 service. Deployment `ecs-svc/4932789783499085935` completed with one running task, zero pending tasks, and no CPU/image/task-definition change. Running task `b81c65f12676404588abb2cde153236a` owns the healthy active target; an old target draining is allowed only after proving it is not the running task's active target. The capacity baseline deployment was `ecs-svc/1535891518454434274`.

Fresh clinical probes at `2026-10-17T00:15:24Z` were independently matched in `/ecs/medplum/build`; private sanitized verification completed at `2026-10-17T00:17:27Z`:

| Probe | Clinical result | Native operational audit result |
| --- | --- | --- |
| Allowed direct read | 200 | Read subtype/action R, outcome 0, matching clinician and Observation |
| Opted-out direct read | 404 | Read subtype/action R, outcome 4, matching clinician and Observation |
| Not-declared direct read | 404 | Read subtype/action R, outcome 4, matching clinician and Observation |
| Allowed patient-scoped search | 200, one result | Search subtype/action R, outcome 0, matching clinician and patient/count query |
| Opted-out patient-scoped search | 200, zero results | Search subtype/action R, outcome 0, matching clinician and patient/count query |
| Not-declared patient-scoped search | 200, zero results | Search subtype/action R, outcome 0, matching clinician and patient/count query |

All six matches passed stored-reference display redaction checks. The report includes CloudWatch event IDs/stream/timestamps plus sanitized runtime identity, capacity, parameter, target-health, and digest evidence in `hawaii-cqie.local/audit-cloudwatch-check.json` (private, ignored). It does not contain raw messages. The six events demonstrate this bounded probe set only: identifiers, IP addresses, query values, and outcome descriptions are not de-identified, and unique request-trace correlation has not been established. FHIR audit searches still do not show these clinical accesses because database persistence remains disabled. Do not replace operational CloudWatch evidence with fabricated frontend AuditEvents or imply that the FHIR reviewer account has AWS log access.

The first post-restart browser attempt timed out at the discovery heading. A separate clean-session diagnostic then passed plain reviewer sign-in with successful auth responses and no failed auth/FHIR requests; the complete desktop/mobile `--audit-only` rerun subsequently passed reviewer evidence visibility, reviewer clinical denial, clinician audit denial, viewport fit, zero JavaScript errors, and **zero FHIR writes**. The initial timeout was not reproduced; its cause was not established. The unrelated CUI service remains unavailable. The presenter Task was not consumed.

Final scoped gates: 19 tooling tests passed, editor checks found no touched-file errors, and CDK diff reported **zero remaining stack differences**. The tracked build configuration retains 1024 MiB/256 CPU units; generated tracked CDK output changed during synthesis. Unrelated backend auth/ADTMC work was not deployed or edited. No commits or pushes were made. The broader application tests/build from the earlier UI slice were not rerun for this infrastructure/tooling-only change.

Presenter boundary: describe the portal as showing stored discharge workflow records. For the six allowed/denied/search access probes, an AWS-authorized operator can separately present the sanitized CloudWatch verification report. Do not describe the portal itself as a complete access log. Further patient/resource types, history/export paths, load behavior, retention/compliance suitability, and stronger request correlation remain separate verification work.

Fresh evidence commands:

```bash
node scripts/hawaii-cqie-audit-check.mjs
node scripts/hawaii-cqie-audit-check.mjs --verify-cloudwatch
```

The first captures permitted/denied direct reads and permitted/filtered patient-scoped searches. The second requires evidence less than 30 minutes old, verifies the exact AWS account, reads only this project's JSON audit records from the fixed log group, and validates matching actor, target/query, read action, operation subtype, outcome, and bounded recorded time. It verifies reference-display redaction and writes only a sanitized private report (`audit-cloudwatch-check.json`, mode 600), not raw messages. Logging delivery can lag the request: do not change the original evidence window merely to make a missing event pass. A successful filtered search has a successful audit outcome even when it returns zero clinical rows. Bounded event matching is not unique trace correlation or comprehensive coverage certification. The FHIR reviewer role does not gain CloudWatch access, and the portal remains a viewer of persisted workflow audits.

Operator verification:

```bash
node scripts/hawaii-cqie-audit-check.mjs
HAWAII_PLAYWRIGHT_MODULE=<local-playwright-module-uri> node scripts/hawaii-cqie-browser-check.mjs --audit-only
```

The first command uses existing scoped clinician/reviewer/verifier credentials, makes only GET requests for FHIR evidence, and writes the private `audit-check.json` result. Authentication uses the normal login/token endpoints. The second uses clean desktop/mobile role sessions, tests audit refresh and reciprocal UI denial, and asserts zero FHIR writes. Its result is `audit-browser-check.json`; screenshots have `-audit` and `-audit-denied` suffixes. Do not run the default browser-check mode when preserving pending presenter work: that mode starts/completes the latest follow-up Task. No task was started or completed by this audit-only slice.

For the presenter, use a separate private browser window to preserve the clinician session. Sign in to the same Hawaii project as the generated **reviewer** (`accounts.reviewer` in the private provisioning manifest), then open **Access Activity**. Point out the stored timestamp, actor, observer, resources, outcome, and audit ID for the actual discharge workflow. Say: "These records demonstrate workflow execution; complete clinical-access audit coverage has not yet been established." Do not present the current view as a comprehensive log of every allowed or denied chart read. Seeing "Activity unavailable" as the clinician is the expected role boundary, not a reason to grant audit access to that account.

Before claiming the clinical-access gap is closed, a separate backend investigation must identify the actual configured read/deny logging destination and verify actor/resource/action/outcome and request correlation with real requests. No shared backend logging or infrastructure mutation is authorized by this evidence/readability slice. No break-glass, opt-out override, payer exception, Smile integration, Part 2 certification, or CUI verification is implied. Existing CUI-service and lint-configuration limitations remain.

## Joint Presentation Handoff

1. **HHIE leads:** Existing exchange, participant relationships, and expansion priorities; confirm what the team is being asked to demonstrate.
2. **Hiive and Smile:** One architecture view distinguishing existing CHR/MPI, proposed Smile foundation, and Hiive portal/workflows. Label actual demo runtime versus proposed production architecture.
3. **Hiive live demo:** Transition-of-care story, followed by the consent/audit boundary and a brief onboarding evidence view.
4. **Smile segment:** Explain proposed normalization, data-layer consent/segmentation, API, and quality capabilities using partner-approved presentation evidence. Do not show or imply an implemented Smile integration.
5. **Joint close:** Agree a bounded pilot/site cohort, integration dependencies, policy decisions, owners, and verification criteria. Do not promise statewide rollout or procurement dates from the attachments.

## Decisions to Confirm Before Implementation

- Meeting date, attendees, procurement stage, and priority persona: clinician, exchange operator, payer, or a combination.
- Which isolated Medplum demo project/environment to use, with explicit disclosure that there is no Smile integration.
- Approved HHIE branding and whether any actual participating organizations may be named.
- HHIE rules for not-declared/opt-out consent, emergencies, purpose of use, payer access, Part 2 restrictions, and audit retention/review.
- Available CHR/MPI/document/event interfaces for future integration planning only; no partner endpoint connection is in scope for this demo.
- Which evidence matters most for the meeting: clinician utility, expansion capacity, consent assurance, MCO pilot, or monthly reporting.

These questions constrain later implementation and presentation claims; they do not block creating this branch and plan.