import { ClientStorage, MedplumClient, MemoryStorage, satisfiedAccessPolicy } from '@medplum/core';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, open, readFile } from 'node:fs/promises';
import { readEnabled } from './service.mjs';

const projectId = '8588313a-c8c6-4e07-8c1d-e684ed25e522';
const baseUrl = 'https://api.ehr.hiivehealth.net/';
const profileUrl = 'https://ehr.hiivehealth.net/fhir/StructureDefinition/cui-configuration';
const enabledUrl = 'https://ehr.hiivehealth.net/fhir/StructureDefinition/cui-banner-enabled';
const options = () => ({ cache: 'no-cache', maxRetries: 0 });
const reference = (resource) => `${resource.resourceType}/${resource.id}`;

export function buildCuiPlan(configurationId = randomUUID(), readerPolicyId = randomUUID()) {
  const meta = { project: projectId };
  const criterion = `Basic?_id=${configurationId}`;
  return {
    configuration: {
      resourceType: 'Basic',
      id: configurationId,
      meta: { ...meta, profile: [profileUrl] },
      code: { coding: [{ system: 'https://ehr.hiivehealth.net/fhir/CodeSystem/configuration', code: 'cui' }] },
      extension: [{ url: enabledUrl, valueBoolean: false }],
    },
    readerPolicy: {
      resourceType: 'AccessPolicy',
      id: readerPolicyId,
      meta,
      name: 'Red Rover Five Patient CUI Configuration Reader',
      resource: [{ resourceType: 'Basic', criteria: criterion, interaction: ['read'], readonly: true }],
    },
    managerPolicy: {
      resourceType: 'AccessPolicy',
      meta,
      name: 'Red Rover Five Patient CUI Configuration Manager (Unassigned)',
      resource: [{ resourceType: 'Basic', criteria: criterion, interaction: ['read', 'update'] }],
    },
    reader: {
      name: 'Red Rover Five Patient CUI Configuration Reader',
      admin: false,
      accessPolicy: { reference: `AccessPolicy/${readerPolicyId}` },
    },
  };
}

export function verifyReaderPolicy(policy, expectedRule, configuration) {
  assert(Array.isArray(policy?.resource));
  const metadataTypes = ['SearchParameter', 'StructureDefinition'];
  const metadataRules = policy.resource.filter((rule) => metadataTypes.includes(rule.resourceType));
  assert(
    metadataRules.every(
      (rule) => rule.readonly === true && Object.keys(rule).every((key) => ['resourceType', 'readonly'].includes(key))
    )
  );
  assert.deepEqual(
    policy.resource.filter((rule) => !metadataTypes.includes(rule.resourceType)),
    [expectedRule]
  );
  assert(satisfiedAccessPolicy(configuration, 'read', policy));
  for (const interaction of ['update', 'create', 'delete', 'search', 'vread', 'history']) {
    assert(!satisfiedAccessPolicy(configuration, interaction, policy));
  }
}

export async function provisionRedRoverCui(admin, approval) {
  assert.equal(approval.authorizeCuiProvisioning, true);
  assert.equal(approval.initialEnabled, false);
  const directory = `${process.env.HOME}/.config/hiive/red-rover`;
  const stat = await lstat(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid());
  assert.equal(stat.mode & 0o077, 0);
  const me = await admin.get('auth/me', options());
  assert.equal(me.project?.superAdmin, true, 'Use the existing platform admin, not a temporary clinical-service grant');
  const read = async (ref) => {
    const [type, id] = ref.split('/');
    return admin.readResource(type, id, options());
  };
  const search = async (type, query = {}) => {
    const bundle = await admin.search(type, { ...query, _count: '100' }, options());
    assert(!bundle.link?.some((link) => link.relation === 'next'));
    return (bundle.entry ?? []).flatMap((entry) => (entry.resource ? [entry.resource] : []));
  };
  const project = await read(`Project/${projectId}`);
  assert.equal(project.name, 'Red Rover UAT Five Patient Test');
  assert(!project.superAdmin);
  const members = await search('ProjectMembership', { project: `Project/${projectId}` });
  assert.equal(members.filter((member) => member.active !== false).length, 2);
  assert(members.filter((member) => member.active !== false).every((member) => member.admin !== true));
  const preserved = new Map([[reference(project), project]]);
  for (const member of members) {
    preserved.set(reference(member), member);
    for (const ref of [member.accessPolicy?.reference, member.profile?.reference].filter(Boolean)) {
      preserved.set(ref, await read(ref));
    }
  }
  const expected = { Patient: 5, Encounter: 5, AllergyIntolerance: 2, Condition: 7, Provenance: 6, Task: 6, Device: 1 };
  for (const [type, count] of Object.entries(expected)) {
    const resources = await search(type, { _project: projectId });
    assert.equal(resources.length, count);
    for (const resource of resources) {
      assert.equal(resource.meta?.project, projectId);
      preserved.set(reference(resource), resource);
    }
  }
  assert.equal(
    (await search('Basic', { _project: projectId, _profile: profileUrl })).length,
    0,
    'Existing CUI configuration requires reconciliation, not recreation'
  );
  let plan = buildCuiPlan();
  const journal = await open(`${directory}/cui-provisioning-v1.jsonl`, 'wx', 0o600);
  const configFile = await open(`${directory}/cui-service-v1.json`, 'wx', 0o600);
  const record = async (value) => {
    await journal.write(`${JSON.stringify({ recorded: new Date().toISOString(), value })}\n`);
    await journal.sync();
  };
  const created = [];
  let readerClient;
  try {
    await record({ status: 'preflight-verified', projectId, approval, plan, preserved: [...preserved] });
    const create = async (resource) => {
      const payload = structuredClone(resource);
      delete payload.id;
      await record({ intent: 'create', resource: payload });
      const result = await admin.createResource(payload, options());
      assert.equal(result.meta?.project, projectId);
      created.push(reference(result));
      await record({ created: reference(result) });
      return result;
    };
    const configuration = await create(plan.configuration);
    assert(configuration.id);
    assert.equal(readEnabled(configuration, projectId, configuration.id), false);
    plan = buildCuiPlan(configuration.id);
    const readerPolicy = await create(plan.readerPolicy);
    assert(readerPolicy.id);
    const managerPolicy = await create(plan.managerPolicy);
    const readerRequest = { ...plan.reader, accessPolicy: { reference: reference(readerPolicy) } };
    await record({ intent: 'create-non-admin-reader', request: readerRequest });
    const reader = await admin.post(`admin/projects/${projectId}/client`, readerRequest, undefined, options());
    assert(reader.id && reader.secret && reader.meta?.project === projectId);
    created.push(reference(reader));
    const config = {
      medplumBaseUrl: baseUrl,
      projects: {
        [projectId]: {
          configurationId: configuration.id,
          readerClientId: reader.id,
          readerClientSecret: reader.secret,
          managerAccessPolicyIds: [managerPolicy.id],
        },
      },
    };
    await configFile.write(JSON.stringify(config, null, 2) + '\n');
    await configFile.sync();
    await record({ created: reference(reader), privateConfigSaved: true });
    const afterMembers = await search('ProjectMembership', { project: `Project/${projectId}` });
    const added = afterMembers.filter((member) => !members.some((before) => before.id === member.id));
    assert.equal(added.length, 1);
    const membership = added[0];
    assert.equal(membership.profile?.reference, reference(reader));
    assert.notEqual(membership.admin, true);
    assert.notEqual(membership.active, false);
    assert.equal(membership.accessPolicy?.reference, reference(readerPolicy));
    created.push(reference(membership));
    readerClient = new MedplumClient({ baseUrl, storage: new ClientStorage(new MemoryStorage()) });
    await readerClient.startClientLogin(reader.id, reader.secret);
    const identity = await readerClient.get('auth/me', options());
    assert.equal(identity.project?.id, projectId);
    assert(!identity.project.superAdmin && !identity.membership?.admin);
    assert.equal(identity.profile?.id, reader.id);
    verifyReaderPolicy(identity.accessPolicy, readerPolicy.resource[0], configuration);
    assert.equal(
      readEnabled(await readerClient.readResource('Basic', configuration.id, options()), projectId, configuration.id),
      false
    );
    for (const [type, id] of [
      ['Patient', '56e610e8-2f17-43d1-b113-9d5f51ec1036'],
      ['AccessPolicy', managerPolicy.id],
    ]) {
      let denied = false;
      try {
        await readerClient.readResource(type, id, options());
      } catch (error) {
        denied = /Forbidden|Not Found|not found/i.test(error.message);
      }
      assert(denied, `Configuration reader must not read ${type}`);
    }
    assert.equal(afterMembers.filter((member) => member.active !== false).length, 3);
    assert(afterMembers.filter((member) => member.active !== false).every((member) => !member.admin));
    for (const [ref, before] of preserved)
      assert.deepEqual(await read(ref), before, `Existing resource changed: ${ref}`);
    for (const [type, count] of Object.entries(expected))
      assert.equal((await search(type, { _project: projectId })).length, count);
    await record({
      status: 'complete',
      projectId,
      enabled: false,
      created,
      managerPolicyAssigned: false,
      readerClinicalAccessDenied: true,
      existingResourcesUnchanged: true,
    });
    return {
      projectId,
      enabled: false,
      configurationId: configuration.id,
      readerClientId: reader.id,
      managerPolicyId: managerPolicy.id,
      configPath: `${directory}/cui-service-v1.json`,
    };
  } catch (error) {
    await record({
      status: 'stopped',
      created,
      reason: 'Provisioning or validation failed; reconcile before retrying',
    });
    throw error;
  } finally {
    if (readerClient) await readerClient.signOut();
    await configFile.close();
    await journal.close();
  }
}

export async function reconcileCuiVerification(admin) {
  const directory = `${process.env.HOME}/.config/hiive/red-rover`;
  const journalPath = `${directory}/cui-provisioning-v1.jsonl`;
  const configPath = `${directory}/cui-service-v1.json`;
  for (const path of [directory, journalPath, configPath]) {
    const stat = await lstat(path);
    assert(!stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0);
    assert(path === directory ? stat.isDirectory() : stat.isFile());
  }
  const events = (await readFile(journalPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line).value);
  assert.equal(events.at(-1)?.status, 'stopped');
  assert.equal(events.at(-1).created?.length, 5);
  const baseline = events[0];
  assert.equal(baseline.status, 'preflight-verified');
  assert.equal(baseline.projectId, projectId);
  assert.equal(baseline.approval.authorizeCuiProvisioning, true);
  assert.equal(baseline.approval.initialEnabled, false);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.medplumBaseUrl, baseUrl);
  assert.deepEqual(Object.keys(config.projects), [projectId]);
  const entry = config.projects[projectId];
  assert.equal(entry.managerAccessPolicyIds.length, 1);
  assert.equal((await admin.get('auth/me', options())).project?.superAdmin, true);
  const read = async (type, id) => admin.readResource(type, id, options());
  const search = async (type, query = {}) => {
    const bundle = await admin.search(type, { ...query, _count: '100' }, options());
    assert(!bundle.link?.some((link) => link.relation === 'next'));
    return (bundle.entry ?? []).flatMap((item) => (item.resource ? [item.resource] : []));
  };
  for (const [ref, resource] of baseline.preserved) {
    assert.deepEqual(await read(...ref.split('/')), resource, `Existing resource changed: ${ref}`);
  }
  const membersBefore = baseline.preserved
    .filter(([ref]) => ref.startsWith('ProjectMembership/'))
    .map(([, resource]) => resource);
  const members = await search('ProjectMembership', { project: `Project/${projectId}` });
  const added = members.filter((member) => !membersBefore.some((before) => before.id === member.id));
  assert.equal(members.length, membersBefore.length + 1);
  assert.equal(added.length, 1);
  assert.equal(members.filter((member) => member.active !== false).length, 3);
  assert(members.filter((member) => member.active !== false).every((member) => !member.admin));
  const membership = added[0];
  assert.equal(membership.profile?.reference, `ClientApplication/${entry.readerClientId}`);
  assert.notEqual(membership.active, false);
  const readerPolicyId = membership.accessPolicy?.reference?.split('/')[1];
  assert(readerPolicyId);
  const readerPolicy = await read('AccessPolicy', readerPolicyId);
  const managerPolicy = await read('AccessPolicy', entry.managerAccessPolicyIds[0]);
  const configuration = await read('Basic', entry.configurationId);
  const reader = await read('ClientApplication', entry.readerClientId);
  const plan = buildCuiPlan(entry.configurationId, readerPolicyId);
  for (const resource of [configuration, readerPolicy, managerPolicy, reader, membership]) {
    assert.equal(resource.meta?.project, projectId);
    assert(events.at(-1).created.includes(reference(resource)));
  }
  assert.equal(reader.secret, entry.readerClientSecret);
  assert.deepEqual(readerPolicy.resource, plan.readerPolicy.resource);
  assert.deepEqual(managerPolicy.resource, plan.managerPolicy.resource);
  assert(members.every((member) => member.accessPolicy?.reference !== reference(managerPolicy)));
  assert.equal(readEnabled(configuration, projectId, entry.configurationId), false);
  assert.equal((await search('Basic', { _project: projectId, _profile: profileUrl })).length, 1);
  for (const [type, count] of Object.entries({
    Patient: 5,
    Encounter: 5,
    AllergyIntolerance: 2,
    Condition: 7,
    Provenance: 6,
    Task: 6,
    Device: 1,
  })) {
    assert.equal((await search(type, { _project: projectId })).length, count);
  }
  const client = new MedplumClient({ baseUrl, storage: new ClientStorage(new MemoryStorage()) });
  try {
    await client.startClientLogin(entry.readerClientId, entry.readerClientSecret);
    const identity = await client.get('auth/me', options());
    assert.equal(identity.project?.id, projectId);
    assert(!identity.project.superAdmin && !identity.membership?.admin);
    assert.equal(identity.profile?.id, reader.id);
    verifyReaderPolicy(identity.accessPolicy, readerPolicy.resource[0], configuration);
    assert.equal(
      readEnabled(await client.readResource('Basic', configuration.id, options()), projectId, configuration.id),
      false
    );
    for (const [type, id] of [
      ['Patient', '56e610e8-2f17-43d1-b113-9d5f51ec1036'],
      ['AccessPolicy', managerPolicy.id],
    ]) {
      let denied = false;
      try {
        await client.readResource(type, id, options());
      } catch (error) {
        denied = /Forbidden|Not Found|not found/i.test(error.message);
      }
      assert(denied, `Configuration reader must not read ${type}`);
    }
  } finally {
    if (client.getAccessToken()) await client.signOut();
  }
  const journal = await open(journalPath, 'a');
  try {
    await journal.write(
      `${JSON.stringify({
        recorded: new Date().toISOString(),
        value: {
          status: 'complete',
          projectId,
          enabled: false,
          verificationOnlyReconciliation: true,
          created: events.at(-1).created,
          activeNonAdminMemberships: 3,
          managerPolicyAssigned: false,
          readerClinicalAccessDenied: true,
          readerMutationsDenied: true,
          existingResourcesUnchanged: true,
        },
      })}\n`
    );
    await journal.sync();
  } finally {
    await journal.close();
  }
  return {
    projectId,
    enabled: false,
    configurationId: entry.configurationId,
    readerClientId: entry.readerClientId,
    managerPolicyId: managerPolicy.id,
    configPath,
  };
}
