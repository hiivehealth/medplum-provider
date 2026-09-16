import { readFile, readdir } from 'node:fs/promises';

// This installs schema metadata only. It does not enable CUI or assign security roles.
const baseUrl = new URL(process.env.MEDPLUM_BASE_URL ?? 'http://localhost:8103/');
const token = process.env.MEDPLUM_ACCESS_TOKEN;
const projectId = process.argv[2];
if (!projectId || !/^[0-9a-f-]{36}$/i.test(projectId))
  throw new Error('Usage: npm run cui:install-profiles -- <target-project-uuid>');
if (!token) {
  throw new Error('Set MEDPLUM_ACCESS_TOKEN to a platform-operator access token.');
}
if (baseUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname)) {
  throw new Error('Use HTTPS for a remote Medplum server.');
}
if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';

async function request(path, method = 'GET', resource, extraHeaders = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/fhir+json', ...extraHeaders },
    ...(resource ? { body: JSON.stringify(resource) } : {}),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Medplum ${method} ${path.split('?')[0]} failed (${response.status}).`);
  return response.json();
}

const me = await request('auth/me');
if (me.project?.superAdmin !== true) throw new Error('A platform-operator account is required.');
await request(`fhir/R4/Project/${projectId}`);
const directory = new URL('../../fhir/StructureDefinition/', import.meta.url);
for (const filename of (await readdir(directory)).filter((name) => name.endsWith('.json')).sort()) {
  const resource = JSON.parse(await readFile(new URL(filename, directory), 'utf8'));
  if (resource.resourceType !== 'StructureDefinition') throw new Error(`Unexpected resource type in ${filename}`);
  const search = await request(
    `fhir/R4/StructureDefinition?url=${encodeURIComponent(resource.url)}&_count=2&_project=${encodeURIComponent(projectId)}`
  );
  const matches = search.entry?.filter((entry) => entry.resource?.resourceType === 'StructureDefinition') ?? [];
  if (matches.length > 1) throw new Error(`Duplicate profile: ${resource.url}`);
  const existing = matches[0]?.resource;
  const { id: _id, ...definition } = resource;
  definition.meta = { project: projectId };
  if (existing) {
    if (!existing.meta?.versionId) throw new Error('Profile has no version; refusing an unconditional overwrite.');
    await request(
      `fhir/R4/StructureDefinition/${existing.id}`,
      'PUT',
      { ...definition, id: existing.id },
      { 'If-Match': `W/"${existing.meta.versionId}"` }
    );
  } else {
    await request('fhir/R4/StructureDefinition', 'POST', definition, {
      'If-None-Exist': `url=${encodeURIComponent(resource.url)}&_project=${encodeURIComponent(projectId)}`,
    });
  }
  console.log(`Installed ${resource.name}`);
}
