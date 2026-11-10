<h1 align="center">Medplum Provider</h1>
<p align="center">A starter application for building a health record system on Medplum.</p>
<p align="center">
<a href="https://github.com/medplum/medplum-hello-world/blob/main/LICENSE.txt">
    <img src="https://img.shields.io/badge/license-Apache-blue.svg" />
  </a>
</p>

This example app demonstrates the following:

- Using [Medplum React Components](https://storybook.medplum.com/?path=/docs/medplum-introduction--docs) to display a chart that provides visibility on a patient
  - More information on a [charting experience](https://www.medplum.com/docs/charting)
- Using [Medplum GraphQL](https://graphiql.medplum.com/) queries to fetch linked resources

### Blank TESTONE Demo Visit (November 6, 2026 UTC)

The separately approved blank demo visit is
`0ab08290-acd2-4976-8748-0bbe87036530`. Open TESTONE > Visits > **Blank demo visit**,
or [open the demo directly](http://127.0.0.1:5172/Patient/56e610e8-2f17-43d1-b113-9d5f51ec1036/Encounter/0ab08290-acd2-4976-8748-0bbe87036530).
It has twelve separate empty unsigned drafts and no recorded vitals at provisioning.
The original visit, including the clinician's saved notes and vitals, is preserved.
Exact new draft permissions and encounter-scoped preliminary vitals permissions
were appended without changing existing grants. Signing, task routing and Red Rover
delivery remain disabled. The private `blank-demo-testone-v1.jsonl` journal is complete
and consumed; never replay this operation or substitute a journal path.

Independent postflight verified 80 resources at creation. This supersedes the earlier
64-resource baseline below. Nine offline provisioning tests, 46 provider tests and
provider types pass. The clinician browser shows empty visible narrative fields,
no recorded vitals, enabled draft/vitals controls and the distinct demo list entry.
The original browser tab was left untouched; no answers or measurements were entered.

### Red Rover Local SOAP Authoring (November 6, 2026 UTC)

The existing TESTONE local visit `fa224c51-c4b8-42f9-806e-7b5da5ff8a07`
now has twelve linked, unsigned draft slots: Subjective, Objective, Assessment,
Plan, ADTMC A-01, three ROS templates and four physical-exam templates. The
running local chart reuses the established SOAP components, searchable A-01
screening and native-style two-column vitals form inside an Add Vitals modal.
The five A-01 Scope of Practice PDFs are served by the repaired local viewer.

The clinician has update access only to these exact draft IDs. Switching ROS or
exam templates clears the selected draft on explicit save; resources are never
deleted. Vitals require an explicit measurement time, native LOINC/UCUM values,
and exact patient, visit and clinician links. New Observations are preliminary;
the narrowly constrained grant permits create/read/search, not update/delete.
Recording first version-saves Objective, uses a conditional native transaction
with no automatic retries, and independently reads back each result. An
unconfirmed transaction blocks further writes, including after a page reload.

The separately approved hosted provisioning is complete: seven empty drafts were
added to the same visit, the original 51 resources and existing five drafts are
unchanged, and unrelated access/CUI/memberships are unchanged. The current native
baseline is 64 resources. No clinical vital values were invented or recorded.
Both private authoring journals are complete and consumed; never replay them.

Validation: 45 focused authoring/encounter tests, full provider types and six
offline provisioning tests pass. All five reference PDF mappings and actual PDF
content types/signatures pass; the viewer was screenshot-verified on desktop and
narrow screens. After direct clinician sign-in, the same visit loads with enabled
ROS/exam editing and Save draft, no unexpected alerts, all five A-01 references,
no completion/routing controls and a blank, enabled vitals modal. Desktop/mobile
screenshots and overflow checks pass; compact unit labels fit on narrow screens.
No screening answers or vital values were entered/saved for browser verification.
Live clinical recording awaits clinician-supplied measurements. Provider remains on port 5172.
Signing, automated ADTMC evaluation/routing, Red Rover delivery, hosted app
deployment, commits and pushes remain disabled or unperformed. Imported chart
editing, Timeline, diagnosis-status UI and Details & Billing remain unchanged.

### Red Rover Chief Complaints (November 5, 2026 UTC)

The exact five-patient UAT cohort now has a **Chief Complaints** sidebar section.
The first patient has three separately imported text Observations with distinct
source IDs/timestamps; the other four have none imported. Selecting an entry opens
read-only text, source status, observed and created/updated times, unresolved
performer ID and `Clinical signature: Not supplied`. The source's `Auth (Verified)`
is retained without inferring FHIR final status or a signature. Identical text is
not merged, dates/names within it are not interpreted, and unused numeric zeros
are not clinical values. The existing five medication orders remain visible.

The owner separately approved this saved-capture mapping/import, one import
Provenance/Task and exact-three-ID Observation read/search with `readonly=true`.
All 46 prior clinical/supporting resources and unrelated access/memberships are
unchanged; the verified baseline is now 51 resources and three non-admin members.
The private import journal is complete and consumed; never replay it. This
supersedes earlier Chief Complaint capture-only statements. No new vendor calls,
credential changes, Timeline, diagnosis-status or billing changes occurred.

Validation: 21 patient-page tests and full provider types pass. All five reviewer
chart routes have zero alerts/summary errors; desktop/mobile screenshots and
overflow checks pass. No hosted deployment occurred.

### Red Rover Medication Orders (November 5, 2026 UTC)

The exact five-patient Red Rover UAT cohort now has a **Medication Orders**
sidebar section in the local chart. The first patient has five separately
imported prescription/discharge orders, including two distinct atorvastatin
orders; the remaining four have none imported. Selecting an entry opens read-only
source details with order ID, status, instructions and ordered/start/stop times.
Loratadine's stop date is retained. Current use is not established, and no edit or
prescribing controls were added. These are not assertions of active medication use.

The owner separately approved five `MedicationRequest` resources with conservative
FHIR status `unknown`, import Provenance/Task and an exact-five-ID read/search
reviewer grant with `readonly=true`. Prior clinical resources, existing rules and
three non-admin memberships remain unchanged. The private completed import journal
is consumed; no reimport or new Red Rover API request occurred. Chief Complaints,
Timeline, diagnosis-status UI and billing remain unchanged by this work.

Validation: 20 patient-page tests and full provider types pass. All five live
chart routes have zero alerts/summary errors; desktop/mobile screenshots verify
the read-only detail view and no horizontal overflow. This supersedes earlier
medication API-only/unimported-domain checkpoints. No hosted deployment occurred.

### Workflows

The application will feature the following core workflows:

- Visit documentation
- Task creation and assignment
- Appointment scheduling
- Patient registration/onboarding
- Lab orders
- Ordering medications
- Claim creation and billing
- Patient/Provider Messaging

### Getting Started

If you haven't already done so, follow the instructions in [this tutorial](https://www.medplum.com/docs/tutorials/register) to register a Medplum project to store your data.

[Fork](https://github.com/medplum/medplum-provider/fork) and clone the repo. Alternatively, this app lives in the [Medplum monorepo](https://github.com/medplum/medplum) at `examples/medplum-provider` — if you are working from the monorepo, run `npm ci` and `npm run build` at the repo root first so the workspace packages are built.

Next, install the dependencies.

```bash
npm install
```

Then, run the app

```bash
npm run dev
```

This app should run on `http://localhost:3001/`

By default, the app connects to the hosted Medplum service at `https://api.medplum.com/`.

### Running against a local Medplum server

To run against a Medplum server on your own machine, follow the [Run the stack](https://www.medplum.com/docs/contributing/run-the-stack) guide to start the API server on port 8103, then edit `.env` in this directory:

```
MEDPLUM_BASE_URL=http://localhost:8103/
```

Restart `npm run dev` after changing `.env`.

### Read-Only Red Rover Visit Review

For the exact five assigned patients, Details & Billing displays the current
facility, distinct building/unit labels, visit FIN, imported visit dates, the
supplied practitioner if present, and existing linked diagnoses as read-only data.
MRN appears alongside the native patient demographics, not in visit details.
Location labels come from the verified unit-to-building-to-facility hierarchy;
duplicate display labels are omitted without merging the resources. Failed
location reads show an unavailable state rather than a guessed facility.
The Details & Billing label and "Billing information not imported." placeholder
are explicitly retained. Empty
diagnosis links are labeled "No encounter diagnoses imported," not a clinical
negative assertion. The view does not mount claim, charge, coverage, billing
organization or self-pay creation workflows. Other patients retain standard
billing behavior.

The owner separately approved read-only reviewer access to exactly the six mapped
Locations. The existing reviewer policy gained one exact-ID rule permitting only
direct reads, not Location searches or writes. All other grants, clinical data
and CUI settings were preserved; the private `reviewer-location-read-v1.jsonl`
journal is complete and consumed, never replayable.

All five visits were checked after loading, with correct FIN/MRN/location display,
retained billing and no alerts. The 56 affected tests and provider typecheck pass.
Desktop and 390px mobile screenshots and overflow checks pass; only this cohort
uses stacked summary and visit panes on narrow screens. Diagnosis status and
verification display changes remain on hold. This verifies bounded UI loading
and display, not clinical mapping acceptance, write-back approval or production
readiness. No hosted deployment was performed.

### Local Red Rover CUI Policy Service

The isolated five-patient project has an explicitly approved CUI configuration
set to **off pending policy review**, not an off fallback for lookup failures.
The loopback service on port 8105 uses a dedicated non-admin reader restricted
to reading that single configuration. The reviewer and import service retain
their existing permissions. The new CUI manager policy is unassigned.

From this checkout, start the service using its private provisioned configuration:

```bash
CUI_SERVICE_CONFIG="$HOME/.config/hiive/red-rover/cui-service-v1.json" \
  node server/cui/service.mjs
```

Keep this owner-only file private; it contains the generated reader secret.
The provider on port 5172 proxies its authenticated CUI decision requests to
the service. Missing service/configuration remains an operational error, never
a policy decision. Reviewers receive the display decision but cannot manage CUI
or directly access the protected configuration.

Provisioning is complete in the exclusive private `cui-provisioning-v1.jsonl`
journal. Do not replay provisioning, substitute another journal, recreate its
reader, or use an example configuration. The initial verification mismatch was
reconciled with readback only: Medplum adds read-only `SearchParameter` and
`StructureDefinition` rules to effective policies. The CUI reader still has no
clinical access or CUI mutation privileges. There are now three active non-admin
memberships in this project. No clinical resources or existing grants changed.

```bash
npm run cui:test-service
```

### A note on value sets

Some fields in this app (diagnoses, medications, race/ethnicity, and others) autocomplete against clinical terminologies such as ICD-10, RxNorm, and US Core / VSAC value sets. On hosted Medplum, these are provided by shared projects [linked](https://www.medplum.com/docs/access/projects#project-linking) into your project. A fresh self-hosted or local server includes only the base FHIR R4 terminology, so these fields will show a "ValueSet not found" message inline and you will need to enter codes manually. To enable them, upload the value sets and import their code systems into a shared project (see [`CodeSystem/$import`](https://www.medplum.com/docs/api/fhir/operations/codesystem-import)) and link that project, or contact Medplum for access to the hosted terminology.

### Army ADTMC A-01 Boundary (HVCARE-1809)

This candidate adds only the military A-01 launcher, questionnaire, Task guards,
and authenticated reference-document route to the current main branch. Nevada
consent, privileged break-glass Bots, occupational dashboards, demo identity
overrides, branding, and delivery changes from `feature/adtmc` are excluded.
Existing general Provider routes, CUI policy integration, ScriptSure behavior,
and Task query-string navigation remain unchanged.

The authoritative tenant eligibility signal is the admin-controlled `army` entry
in `Project.features`, supplied by the paired HVCARE-1810 server work. All
authenticated active members of that same project are eligible, subject to normal
Medplum AccessPolicies. There is no additional provider-role allowlist or admin
bypass. Omitted membership `active` follows Medplum's default-active behavior;
false or malformed values, missing/mismatched project or profile identity, and
unverifiable eligibility fail closed.

Military scope includes the A-01 canonical
`https://ehr.hiivehealth.net/fhir/Questionnaire/a01-sore-throat`, its responses,
ADTMC launch/handoff Tasks and algorithm outputs, and the five reference PDFs.
Shared charting and generic Task workflows remain general functionality.
Client checks are not authorization: HVCARE-1810 supplies the resource/API/search,
Binary security-context, and Bot execution boundary, in addition to normal
AccessPolicies. Frontend and server changes need coordinated release review;
mocked UI tests do not establish deployed authorization.

A-01 response creation uses server-side conditional create with identifier system
`urn:hiivehealth:adtmc-task-response` and a project/Task identity. Retries reuse
the first completed response, including after an ambiguous save outcome. A stale
Task version, conflicting recovered answers, or session/project change does not
overwrite clinical data. Task completion uses `If-Match`; these two writes are
not represented as an atomic transaction.

Reference PDFs use `/adtmc/a01/documents/:documentKey`, never public static URLs.
Each project needs one current PDF `DocumentReference` per controlled identifier
under `https://ehr.hiivehealth.net/fhir/NamingSystem/adtmc-a01-document`:

| Document Key | Approved Provider Source Filename |
| --- | --- |
| `a01-sore-throat-hoarseness` | `a01-sore-throat-hoarseness.pdf` |
| `policy-guide` | `Policy Guide.pdf` |
| `obtain-a-throat-culture` | `How to Obtain a Throat Culture.pdf` |
| `perform-an-heent-exam` | `How to Perform an HEENT Exam.pdf` |
| `care-for-common-throat-infections` | `How to Provide Care for Common Throat Infections.pdf` |

Use private Binary-backed attachments whose `Binary.securityContext` references
the protected `DocumentReference`. The viewer accepts authenticated local Binary
downloads or server-returned HTTPS attachment URLs, rejects missing/duplicate or
foreign-project document records, and has no public fallback. The Vite plugin
blocks `/documents/adtmc` in dev/preview and removes it from production output.

The selected rollout environment is the existing instance and existing
`ADTMC A-01 Test` and `Army OEM Synthetic Demo` projects; no new environment or
hard-coded project IDs are required. No live upload, project enablement, or
deployment is authorized by local validation.

HVCARE-1160 is Done for the historical Django `adtmc_load` workflow, with 2025 QA
evidence. The existing Medplum A-01 package/runtime source in the core repository
is reused, not duplicated in the resource catalog. Current live resource
inventory remains unverified because no authenticated existing-instance session
is available. Inventory approved resource metadata before provisioning anything.
This limitation is distinct from deployment or PDF provisioning, which are
rollout activities rather than additional original HVCARE-1809 closure criteria.

Run `npm test`, `npm run lint`, and `npm run build` on this candidate, together
with the paired server ACL checks. Final review and merge remain pending explicit
authorization; local implementation does not by itself close HVCARE-1809.

### About Medplum

[Medplum](https://www.medplum.com/) is an open-source, API-first EHR. Medplum makes it easy to build healthcare apps quickly with less code.

Medplum supports self-hosting and provides a [hosted service](https://app.medplum.com/). Medplum Hello World uses the hosted service as a backend.

- Read our [documentation](https://www.medplum.com/docs)
- Browse our [react component library](https://storybook.medplum.com/)
- Join our [Discord](https://discord.gg/medplum)
