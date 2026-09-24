import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const baseUrl = process.env.MEDPLUM_BASE_URL;
const projectId = process.env.MEDPLUM_PROJECT_ID;
const token = process.env.MEDPLUM_ACCESS_TOKEN;
const administratorMembershipIds = (process.env.CUI_SECURITY_ADMIN_MEMBERSHIP_IDS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (!baseUrl || !projectId || (!dryRun && !token)) {
  throw new Error(
    'Set MEDPLUM_BASE_URL and MEDPLUM_PROJECT_ID; set MEDPLUM_ACCESS_TOKEN unless using --dry-run.'
  );
}

const base = new URL(baseUrl);
if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
  throw new Error('MEDPLUM_BASE_URL must use HTTPS except on loopback.');
}
if (!base.pathname.endsWith('/')) base.pathname += '/';

const resource = async (filename) =>
  JSON.parse(await readFile(resolve(import.meta.dirname, '..', 'fhir', 'cui', filename), 'utf8'));
const extensionDefinition = await resource('cui-banner-enabled.json');
const configurationProfile = await resource('cui-configuration.json');
const administratorPolicyTemplate = await resource('cui-security-administrator.json');
const configurationId = `cui-configuration-${projectId}`;

function url(path) {
  return new URL(path, base).toString();
}

async function request(method, path, body) {
  if (dryRun) return undefined;
  const response = await fetch(url(path), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/fhir+json',
      ...(body ? { 'Content-Type': 'application/fhir+json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`${method} ${path} failed with ${response.status}.`);
  return response.json();
}

async function putStructureDefinition(definition) {
  await request('PUT', `fhir/R4/StructureDefinition/${definition.id}`, definition);
}

function projectReferenceMatches(reference) {
  return reference === `Project/${projectId}`;
}

async function validateLivePreflight() {
  if (dryRun) return new Map();

  const session = await request('GET', 'auth/me');
  if (session?.project?.id !== projectId || !projectReferenceMatches(session?.membership?.project?.reference)) {
    throw new Error('MEDPLUM_ACCESS_TOKEN is not scoped to MEDPLUM_PROJECT_ID.');
  }
  if (session.membership.admin !== true) {
    throw new Error('MEDPLUM_ACCESS_TOKEN must belong to a project administrator.');
  }

  const memberships = new Map();
  for (const membershipId of administratorMembershipIds) {
    const membership = await request('GET', `fhir/R4/ProjectMembership/${membershipId}`);
    if (!projectReferenceMatches(membership?.project?.reference)) {
      throw new Error(`ProjectMembership/${membershipId} does not belong to MEDPLUM_PROJECT_ID.`);
    }
    memberships.set(membershipId, membership);
  }
  return memberships;
}

async function verifyProvisioning(memberships) {
  if (dryRun) return;

  const [storedConfiguration, storedPolicy] = await Promise.all([
    request('GET', `fhir/R4/Basic/${configurationId}`),
    request('GET', `fhir/R4/AccessPolicy/${administratorPolicy.id}`),
  ]);
  const enabledExtension = storedConfiguration?.extension?.find(
    (extension) => extension.url === extensionDefinition.url
  );
  const expectedCriteria = `Basic?_id=${configurationId}`;
  if (
    storedConfiguration?.meta?.project !== projectId ||
    !storedConfiguration.meta.profile?.includes(configurationProfile.url) ||
    enabledExtension?.valueBoolean !== false ||
    !storedPolicy?.resource?.some((rule) => rule.criteria === expectedCriteria)
  ) {
    throw new Error('Postflight verification failed for the CUI configuration or administrator policy.');
  }

  for (const [membershipId] of memberships) {
    const membership = await request('GET', `fhir/R4/ProjectMembership/${membershipId}`);
    if (
      !membership.access?.some(
        (entry) => entry.policy?.reference === `AccessPolicy/${administratorPolicy.id}`
      )
    ) {
      throw new Error(`Postflight verification failed for ProjectMembership/${membershipId}.`);
    }
  }
}

const memberships = await validateLivePreflight();
await putStructureDefinition(extensionDefinition);
await putStructureDefinition(configurationProfile);

const configuration = {
  resourceType: 'Basic',
  id: configurationId,
  meta: {
    project: projectId,
    profile: [configurationProfile.url],
  },
  code: { text: 'CUI configuration' },
  extension: [{ url: extensionDefinition.url, valueBoolean: false }],
};
await request('PUT', `fhir/R4/Basic/${configurationId}`, configuration);

const administratorPolicy = {
  ...administratorPolicyTemplate,
  id: `cui-security-administrator-${projectId}`,
  meta: { project: projectId },
  resource: administratorPolicyTemplate.resource.map((rule) => ({
    ...rule,
    criteria: rule.criteria.replace('REPLACE_WITH_CONFIGURATION_ID', configurationId),
  })),
};
await request('PUT', `fhir/R4/AccessPolicy/${administratorPolicy.id}`, administratorPolicy);

for (const [membershipId, membership] of memberships) {
  const access = membership.access ?? [];
  if (!access.some((entry) => entry.policy?.reference === `AccessPolicy/${administratorPolicy.id}`)) {
    access.push({ policy: { reference: `AccessPolicy/${administratorPolicy.id}` } });
    await request('PUT', `fhir/R4/ProjectMembership/${membershipId}`, { ...membership, access });
  }
}

await verifyProvisioning(memberships);

console.log(
  dryRun
    ? `Dry run passed for project ${projectId}; no resources were changed.`
    : `Provisioned CUI configuration ${configurationId} and policy ${administratorPolicy.id}.`
);