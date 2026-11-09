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

### Encounter-template Access (HVCARE-1812)

The `feature/encountertemplates` integration depends on Provider PR #12 (HVCARE-1809)
and Core PR #8 (HVCARE-1810). It reuses PR #12's `hasArmyAccess` contract: the current
Project must have the admin-managed `army` feature, and the active ProjectMembership
and profile must match that project. Ordinary server AccessPolicies still decide which
interactions are permitted; there is no separate provider-role allowlist.

SOAP Subjective, Objective, Assessment, Plan, ROS, physical-exam templates, and generic
Chest Pain/Respiratory flows remain general-purpose. ADTMC A-01 templates and results
are military-only. The decision-flow selector registers A-01 only after its Questionnaire
is available through the server and its project matches the encounter and patient.
Unknown, missing, invalid, inactive, or mismatched Army eligibility fails closed without
disabling generic SOAP workflows. The result reader rejects foreign-project results and
source responses, and template writes recheck eligibility.

Confirmed A-01 guidance copied into a generic SOAP response retains the Army security
label through persistence, extraction, and Composition assembly. Generic templates are
not themselves reclassified. Server authorization from Core PR #8 enforces the label;
client filtering alone is not authorization. Authenticated document delivery, task
launch access, and clinical scoring remain owned by the prerequisite work.

Run the focused checks with:

```bash
npm test -- src/hooks/useDecisionFlows.test.tsx src/hooks/useAdtmcA01Result.test.tsx src/components/encounter/AdtmcA01DecisionSupport.test.ts src/utils/soap-extraction.test.ts
```

These are application tests, not proof of deployed ACL enforcement. Before merge/release,
verify on an authorized disposable server containing the prerequisite PRs that Army members
can use A-01, non-Army/invalid/inactive and cross-tenant contexts cannot discover or access
it, and ordinary AccessPolicies deny prohibited read/write operations through direct APIs.
Also verify generic templates remain usable. Record server-backed evidence with the ticket;
no deployment or live verification is performed by these local changes.

#### Local acceptance evidence (2026-11-10)

The authorized disposable stack `medplum-encounter-acceptance-20261109` was tested
with Provider base `634189e` and Core base `7d5d51af8`, plus uncommitted blocker
repairs. The full Provider suite passed: 163 files, 1,844 tests; production build
passed. Core session/project/Bot suites passed 86 tests, A-01 suites passed 23,
and template-scope checks passed 13. Patient `main` passed all 25 tests and its
build; a synthetic Patient signed in without the notice-availability blocker.

Army and General browser sessions retained generic SOAP and decision flows, with
A-01 visible only to Army. A real A-01 Bot execution created labelled results and
an idempotent handoff Task. Browser-confirmed Assessment/Plan copies persisted
Army-labelled responses and extracted resources. The existing Composition builder
was exercised with those saved responses and its labelled output persisted through
the API; the signing UI was not part of this check.

The final direct API matrix passed 57 checks across nine restricted resources:
Army reads allowed, ordinary read-only writes denied, cross-project reads/searches/
writes denied, generic reads/writes allowed, and non-Army labelled writes denied.
Core's existing SOAP work-slices document records fixture IDs and eligibility evidence.
This is local acceptance evidence, not hosted deployment or clinical approval.

Provider lint remains a deferred gate: 11 `header/header` attribution errors and
65 warnings. The user explicitly requested separate attribution review; no headers
were invented and no enforcement rule was disabled. Other lint errors were resolved.

### About Medplum

[Medplum](https://www.medplum.com/) is an open-source, API-first EHR. Medplum makes it easy to build healthcare apps quickly with less code.

Medplum supports self-hosting and provides a [hosted service](https://app.medplum.com/). Medplum Hello World uses the hosted service as a backend.

- Read our [documentation](https://www.medplum.com/docs)
- Browse our [react component library](https://storybook.medplum.com/)
- Join our [Discord](https://discord.gg/medplum)
