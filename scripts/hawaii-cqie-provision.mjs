import { ClientStorage, MedplumClient, MemoryStorage } from '@medplum/core';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildHawaiiDemoBundle, HAWAII_DEMO_SYSTEM } from './hawaii-cqie-fixtures.mjs';
import { verifyHawaiiBackend } from './hawaii-cqie-preflight.mjs';

const PROJECT_NAME = 'Hawaii CQIE Synthetic Demo';
const BASE_URL = 'https://api.ehr.hiivehealth.net/';
const CLINICAL_TYPES = ['Encounter', 'Condition', 'Observation', 'DocumentReference'];

export function buildHawaiiPolicies(allowedPatientId) {
  assert(/^[0-9a-f-]{36}$/i.test(allowedPatientId), 'Patient UUID required');
  const read = (resourceType, criteria) => ({ resourceType, ...(criteria ? { criteria } : {}), readonly: true });
  return {
    clinician: { resourceType: 'AccessPolicy', name: 'Hawaii CQIE Synthetic Clinician', resource: [
      read('Patient'), read('Consent'), read('Practitioner'), read('Organization'),
      ...CLINICAL_TYPES.map((type) => read(type, `${type}?${type === 'DocumentReference' ? 'subject' : 'patient'}=Patient/${allowedPatientId}`)),
    ] },
    reviewer: { resourceType: 'AccessPolicy', name: 'Hawaii CQIE Audit Reviewer', resource: [read('AuditEvent')] },
    verifier: { resourceType: 'AccessPolicy', name: 'Hawaii CQIE Synthetic Fixture Verifier', resource: [
      read('Patient'), read('Consent'), ...CLINICAL_TYPES.map((type) => read(type)),
    ] },
    disabled: { resourceType: 'AccessPolicy', name: 'Hawaii CQIE Provisioner Disabled', resource: [] },
  };
}

async function login(baseUrl, account, projectId, superAdmin = false) {
  const storage = new ClientStorage(new MemoryStorage());
  const verifier = randomBytes(32).toString('base64url');
  storage.setString('codeVerifier', verifier);
  const client = new MedplumClient({ baseUrl, storage });
  let result = await client.startLogin({ ...account, projectId,
    codeChallenge: createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256' });
  assert(!result.mfaRequired && !result.mfaEnrollRequired, 'Complete required authentication directly; no secrets may be requested in chat');
  if (!result.code && result.memberships) {
    const membership = result.memberships.find((member) => superAdmin
      ? member.project?.display?.toLowerCase() === 'super admin'
      : member.project?.reference === `Project/${projectId}`);
    assert(membership?.id, 'An unambiguous expected membership is required');
    result = await client.post('auth/profile', { login: result.login, profile: membership.id });
  }
  assert(result.code, 'Authentication requires an unsupported additional step');
  await client.processCode(result.code);
  const identity = await client.get('auth/me');
  assert(superAdmin ? identity.project?.superAdmin === true : identity.project?.id === projectId, 'Unexpected authenticated project');
  return client;
}

async function main() {
  assert(process.argv.includes('--apply'), 'Provisioning requires --apply and explicit authorization for a new isolated project');
  const referenceFile = process.env.HAWAII_CQIE_ADMIN_LOGIN_REFERENCE;
  assert(referenceFile, 'Set HAWAII_CQIE_ADMIN_LOGIN_REFERENCE to the documented private/local admin login reference');
  const outputDirectory = path.resolve(process.env.HAWAII_CQIE_PRIVATE_DIR ?? 'hawaii-cqie.local');
  assert(outputDirectory.endsWith('.local'), 'Private generated output directory must end in .local');
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const referenceText = await readFile(referenceFile, 'utf8');
  const rows = referenceText.split('\n').filter((line) => line.startsWith('| Initial '))
    .map((line) => line.split('|').map((cell) => cell.trim().replaceAll('`', '')));
  const account = {
    email: rows.find((row) => row[1] === 'Initial email')?.[2],
    password: rows.find((row) => row[1] === 'Initial password')?.[2],
  };
  assert(account.email && account.password, 'Documented administrator credentials were not found');
  const admin = await login(BASE_URL, account, undefined, true);
  const existing = await admin.searchResources('Project', { name: PROJECT_NAME, _count: '2' });
  const resumeProjectId = process.argv[process.argv.indexOf('--resume-project') + 1];
  const resume = process.argv.includes('--resume-project');
  assert(resume ? existing.length === 1 && existing[0].id === resumeProjectId : existing.length === 0,
    'A matching project requires an explicit verified --resume-project UUID; do not create duplicates');
  const initialized = resume ? existing[0] : await admin.post('fhir/R4/Project/$init', {
    resourceType: 'Parameters', parameter: [{ name: 'name', valueString: PROJECT_NAME }],
  });
  const project = initialized.resourceType === 'Project' ? initialized :
    initialized.parameter?.find((parameter) => parameter.resource?.resourceType === 'Project')?.resource;
  assert(project?.id && project.name === PROJECT_NAME, 'Project initialization did not return the expected project');
  let previous;
  try {
    previous = JSON.parse(await readFile(path.join(outputDirectory, 'provisioning.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') { throw error; }
  }
  assert(!previous || (resume && previous.projectId === project.id && previous.stage === 'project-created'),
    'Only a verified pre-role partial run may be resumed automatically');
  const manifest = previous ?? { baseUrl: BASE_URL, projectId: project.id, projectName: PROJECT_NAME, stage: 'project-created' };
  const save = () => writeFile(path.join(outputDirectory, 'provisioning.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  await save();
  await admin.updateResource({ ...project, setting: [...(project.setting ?? []), { name: 'hawaiiCqieDemo', valueBoolean: true }] });
  const temporary = manifest.provisionerClientId ? await admin.readResource('ClientApplication', manifest.provisionerClientId) :
    await admin.post(`admin/projects/${project.id}/client`, { name: 'Hawaii CQIE Temporary Provisioner' });
  manifest.provisionerClientId = temporary.id;
  await save();
  const provisioner = new MedplumClient({ baseUrl: BASE_URL, storage: new ClientStorage(new MemoryStorage()) });
  await provisioner.startClientLogin(temporary.id, temporary.secret);
  const identity = await provisioner.get('auth/me');
  assert.equal(identity.project?.id, project.id, 'Provisioner must be scoped to the new project');
  const memberships = await admin.searchResources('ProjectMembership', { project: `Project/${project.id}`, user: `ClientApplication/${temporary.id}` });
  assert.equal(memberships.length, 1, 'Expected one new provisioner membership');
  const seeded = await provisioner.post('fhir/R4', buildHawaiiDemoBundle());
  assert(seeded.resourceType === 'Bundle' && ['transaction-response', 'batch-response'].includes(seeded.type) &&
    seeded.entry?.length === 20 && seeded.entry.every((entry) => /^20[01]/.test(entry.response?.status ?? '')), 'Synthetic transaction did not complete');
  const patientIds = [];
  for (const key of ['patient-permitted', 'patient-opted-out', 'patient-not-declared']) {
    const patients = await provisioner.searchResources('Patient', { identifier: `${HAWAII_DEMO_SYSTEM}|${key}` });
    assert.equal(patients.length, 1, 'Expected exactly one synthetic patient');
    assert.equal(patients[0].meta?.project, project.id, 'Fixtures must belong to the new project');
    patientIds.push(patients[0].id);
  }
  manifest.allowedPatientId = patientIds[0];
  manifest.deniedPatientIds = patientIds.slice(1);
  manifest.stage = 'fixtures-created';
  await save();

  const policies = {};
  for (const [role, policy] of Object.entries(buildHawaiiPolicies(patientIds[0]))) {
    const created = await admin.createResource({ ...policy, meta: { project: project.id } });
    assert.equal(created.meta?.project, project.id, 'AccessPolicy must remain in the isolated project');
    policies[role] = created.id;
  }
  manifest.policies = policies;
  manifest.accounts = {};
  for (const role of ['clinician', 'reviewer']) {
    const credentials = { email: `hawaii.cqie.${role}.${project.id.slice(0, 8)}@example.com`, password: `Hiive-${randomBytes(24).toString('base64url')}!7a` };
    const membership = await admin.post(`admin/projects/${project.id}/invite`, {
      resourceType: 'Practitioner', firstName: 'Hawaii Demo', lastName: role === 'clinician' ? 'Clinician' : 'Reviewer',
      ...credentials, scope: 'project', sendEmail: false,
      membership: { admin: false, accessPolicy: { reference: `AccessPolicy/${policies[role]}` } },
    });
    assert.equal(membership.project?.reference, `Project/${project.id}`, 'Invited member must belong to the isolated project');
    assert.equal(membership.accessPolicy?.reference, `AccessPolicy/${policies[role]}`, 'Invited member must use the scoped policy');
    manifest.accounts[role] = { ...credentials, membershipId: membership.id };
    await save();
  }
  const verifierResource = await admin.post(`admin/projects/${project.id}/client`, {
    name: 'Hawaii CQIE Read-Only Fixture Verifier', accessPolicy: { reference: `AccessPolicy/${policies.verifier}` },
  });
  manifest.verifier = { clientId: verifierResource.id, clientSecret: verifierResource.secret };
  const verifier = new MedplumClient({ baseUrl: BASE_URL, storage: new ClientStorage(new MemoryStorage()) });
  await verifier.startClientLogin(verifierResource.id, verifierResource.secret);
  const clinician = await login(BASE_URL, manifest.accounts.clinician, project.id);
  await writeFile(path.join(outputDirectory, 'clinician.token'), clinician.getAccessToken(), { mode: 0o600 });
  await writeFile(path.join(outputDirectory, 'verifier.token'), verifier.getAccessToken(), { mode: 0o600 });
  const preflight = { baseUrl: BASE_URL, projectId: project.id, allowedPatientId: patientIds[0], deniedPatientIds: patientIds.slice(1),
    clinicianTokenFile: 'clinician.token', verifierTokenFile: 'verifier.token' };
  await writeFile(path.join(outputDirectory, 'preflight.json'), JSON.stringify(preflight, null, 2), { mode: 0o600 });
  manifest.stage = 'scoped-roles-created';
  await save();
  await admin.updateResource({ ...memberships[0], admin: false, accessPolicy: { reference: `AccessPolicy/${policies.disabled}` } });
  manifest.stage = 'provisioner-disabled';
  await save();
  const result = await verifyHawaiiBackend(preflight, { clinicianToken: clinician.getAccessToken(), verifierToken: verifier.getAccessToken() });
  manifest.stage = 'preflight-passed';
  await save();
  console.log(JSON.stringify({ projectId: project.id, projectName: PROJECT_NAME, fixtureCount: 20,
    patientScenarios: result.patientScenarios, clinicalResourcesChecked: result.clinicalResourcesChecked,
    privateOutputDirectory: outputDirectory, existingTenantsChanged: false, serverChanged: false }));
}

export { login as loginHawaiiProject };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    if (error?.code === 'ERR_ASSERTION') {
      console.error(`PRECONDITION_FAILED: ${error.message.split('\n')[0]}`);
    }
    console.error('PROVISIONING_STOPPED: inspect the private provisioning manifest for the last completed stage. No secrets or backend response bodies are logged. Do not rerun blindly or delete existing resources.');
    process.exitCode = 1;
  });
}