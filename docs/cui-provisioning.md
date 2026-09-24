# Provider CUI Provisioning

The Provider application reads one project-scoped `Basic` resource directly
after authentication. This procedure installs the required FHIR profiles,
creates the configuration disabled by default, and creates a least-privilege
administrator policy.

Run the dry-run check first:

```sh
MEDPLUM_BASE_URL=https://api.ehr.hiivehealth.net/ \
MEDPLUM_PROJECT_ID=<project-id> \
npm run cui:provision -- --dry-run
```

An authorized platform administrator then runs the actual provisioner in a
secure terminal. Set `MEDPLUM_ACCESS_TOKEN` directly in that terminal; do not
put it in a source file, chat message, or CI configuration. To grant the new
policy to designated non-admin security administrators, provide their
comma-separated `ProjectMembership` IDs in `CUI_SECURITY_ADMIN_MEMBERSHIP_IDS`.
Project administrators remain the Provider UI's default security managers.

Before changing anything, the live command verifies that the token is scoped to
the target project and belongs to a project administrator. It also verifies that
every named membership belongs to that project. After provisioning, it reads
back the configuration, policy, and membership assignments.

After provisioning, sign in to Provider as a project administrator, open
`/Settings/Security`, and enable the CUI setting. Verify that an ordinary
authenticated member can read the configuration but cannot update it.

The hosted Medplum admin session must be authenticated before live provisioning
or verification. The script never prints its bearer token.