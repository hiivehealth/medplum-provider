import { MedplumClient } from '@medplum/core';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

// Bootstrap only an empty project. Existing tenants require a reviewed policy migration.
const [projectId, output] = process.argv.slice(2);
if (!projectId || !output || !/^[0-9a-f-]{36}$/i.test(projectId))
  throw new Error('Usage: npm run cui:provision -- <empty-project-id> <private-output.local>');
if (!output.endsWith('.local'))
  throw new Error('Use a .local output file (gitignored); it contains a service credential');
const baseUrl = process.env.MEDPLUM_BASE_URL ?? 'http://localhost:8103/';
const url = new URL(baseUrl);
if (
  url.protocol !== 'https:' &&
  !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
)
  throw new Error('Remote servers require HTTPS');
if (!process.env.MEDPLUM_ACCESS_TOKEN) throw new Error('Set MEDPLUM_ACCESS_TOKEN to an operator token');
const medplum = new MedplumClient({ baseUrl, accessToken: process.env.MEDPLUM_ACCESS_TOKEN });
if ((await medplum.get('auth/me')).project?.superAdmin !== true) throw new Error('Platform operator required');
await medplum.readResource('Project', projectId);
const members = await medplum.searchResources('ProjectMembership', { project: `Project/${projectId}`, _count: '2' });
// $init can create a default OAuth client. Only an already-restricted, non-admin
// client with an empty policy is permitted; never change an existing user's grants.
for (const member of members) {
  if (
    member.admin ||
    member.access?.length ||
    !member.profile?.reference?.startsWith('ClientApplication/') ||
    !member.accessPolicy
  )
    throw new Error('Existing memberships require a reviewed migration. Restrict the fresh default client first.');
  const policy = await medplum.readReference(member.accessPolicy);
  if (policy.resource?.length || policy.meta?.project !== projectId)
    throw new Error('Existing memberships require a reviewed migration');
}
if (members.length > 1)
  throw new Error('Only a fresh project with at most one restricted default client can be provisioned');
// Reserve the output before making server-side changes; never overwrite credentials.
await writeFile(output, '{}\n', { mode: 0o600, flag: 'wx' });
const install = spawnSync(
  process.execPath,
  [new URL('./install-cui-profiles.mjs', import.meta.url).pathname, projectId],
  { env: process.env, encoding: 'utf8' }
);
if (install.status !== 0) throw new Error(install.stderr || 'Profile installation failed');
const configuration = await medplum.createResource({
  resourceType: 'Basic',
  meta: { project: projectId, profile: ['https://medplum.com/fhir/StructureDefinition/cui-configuration'] },
  code: { coding: [{ system: 'https://medplum.com/fhir/CodeSystem/project-configuration', code: 'cui-banner' }] },
});
const manager = await medplum.createResource({
  resourceType: 'AccessPolicy',
  meta: { project: projectId },
  name: 'CUI Security Administrator',
  resource: [
    {
      resourceType: 'Basic',
      criteria: `Basic?_id=${configuration.id}`,
      interaction: ['read', 'search', 'vread', 'history', 'update'],
    },
  ],
});
const reader = await medplum.createResource({
  resourceType: 'AccessPolicy',
  meta: { project: projectId },
  name: 'CUI Service Reader',
  resource: [{ resourceType: 'Basic', criteria: `Basic?_id=${configuration.id}`, interaction: ['read'] }],
});
const client = await medplum.post(`admin/projects/${projectId}/client`, {
  name: 'CUI Policy Service',
  accessPolicy: { reference: `AccessPolicy/${reader.id}` },
});
await writeFile(
  output,
  JSON.stringify(
    {
      medplumBaseUrl: baseUrl,
      projects: {
        [projectId]: {
          configurationId: configuration.id,
          readerClientId: client.id,
          readerClientSecret: client.secret,
          managerAccessPolicyIds: [manager.id],
        },
      },
    },
    null,
    2
  ) + '\n',
  { mode: 0o600 }
);
console.log(`Provisioned CUI configuration ${configuration.id}. Private service config written to ${output}.`);
console.log(
  `Assign AccessPolicy/${manager.id} only to designated security administrators, alongside reviewed clinical permissions.`
);
console.log(
  'All other members require explicit policies excluding this Basic resource. Do not use unrestricted wildcard access.'
);
