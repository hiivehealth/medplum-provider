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

[Fork](https://github.com/medplum/medplum-provider/fork) and clone the repo.

Next, install the dependencies.

```bash
npm install
```

Then, run the app

```bash
npm run dev
```

This app should run on `http://localhost:3000/`

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

### About Medplum

[Medplum](https://www.medplum.com/) is an open-source, API-first EHR. Medplum makes it easy to build healthcare apps quickly with less code.

Medplum supports self-hosting and provides a [hosted service](https://app.medplum.com/). Medplum Hello World uses the hosted service as a backend.

- Read our [documentation](https://www.medplum.com/docs)
- Browse our [react component library](https://storybook.medplum.com/)
- Join our [Discord](https://discord.gg/medplum)
