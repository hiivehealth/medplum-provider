import assert from 'node:assert/strict';
import { ClientStorage, MedplumClient, MemoryStorage } from '@medplum/core';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { HAWAII_DEMO_SYSTEM } from './hawaii-cqie-fixtures.mjs';
import { loginHawaiiProject } from './hawaii-cqie-provision.mjs';
import { verifyHawaiiBackend } from './hawaii-cqie-preflight.mjs';

export const FOLLOW_UP_SYSTEM = 'https://hiivehealth.com/fhir/identifier/hawaii-cqie-follow-up';
export const DISCHARGE_SYSTEM = 'https://hiivehealth.com/fhir/identifier/hawaii-cqie-discharge-event';
const PROJECT_ID = 'a901f66f-ace9-4895-a492-80364684194d';
const BASE_URL = 'https://api.ehr.hiivehealth.net/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let phase = 'offline-check';

export function buildHawaiiFollowUpPolicies(patientId, ownerReference, otherOwnerReference) {
  assert(UUID.test(patientId) && [ownerReference, otherOwnerReference].every((reference) =>
    /^Practitioner\/[A-Za-z0-9.-]+$/.test(reference)) && ownerReference !== otherOwnerReference, 'Distinct clinician references and a patient UUID are required');
  const query = (type, parameters) => `${type}?${new URLSearchParams(parameters)}`;
  const taskCriteria = query('Task', { patient: `Patient/${patientId}`, owner: ownerReference, identifier: `${FOLLOW_UP_SYSTEM}|` });
  const encounterCriteria = query('Encounter', { patient: `Patient/${patientId}`, identifier: `${DISCHARGE_SYSTEM}|` });
  const readonlyFields = [
    'identifier', 'instantiatesCanonical', 'instantiatesUri', 'basedOn', 'groupIdentifier', 'partOf',
    'statusReason', 'businessStatus', 'intent', 'priority', 'code', 'description', 'focus', 'for', 'encounter',
    'executionPeriod', 'authoredOn', 'requester', 'performerType', 'owner', 'location', 'reasonCode',
    'reasonReference', 'insurance', 'note', 'relevantHistory', 'restriction', 'input', 'output',
    'implicitRules', 'language', 'text', 'contained', 'extension', 'modifierExtension',
  ];
  return {
    clinicianTask: {
      resourceType: 'Task', criteria: taskCriteria, interaction: ['read', 'search', 'update'], readonlyFields,
      writeConstraint: [{ language: 'text/fhirpath', expression:
        "(%before.status = 'requested' and %after.status = 'in-progress') or (%before.status = 'in-progress' and %after.status = 'completed')" }],
    },
    bot: { resourceType: 'AccessPolicy', name: 'Hawaii CQIE Follow-Up Bot', resource: [
      { resourceType: 'Encounter', criteria: encounterCriteria, interaction: ['read', 'search'] },
      { resourceType: 'Consent', criteria: query('Consent', { patient: `Patient/${patientId}` }), interaction: ['read', 'search'] },
      { resourceType: 'Task', criteria: taskCriteria, interaction: ['read', 'search', 'create'] },
    ] },
    event: { resourceType: 'AccessPolicy', name: 'Hawaii CQIE Synthetic Discharge Source', resource: [
      { resourceType: 'Encounter', criteria: encounterCriteria, interaction: ['read', 'search', 'create', 'update'],
        writeConstraint: [{ language: 'text/fhirpath', expression: "status = 'finished' and class.code = 'IMP' and period.end.exists()" }] },
    ] },
    other: { resourceType: 'AccessPolicy', name: 'Hawaii CQIE Other Practice Follow-Up Reader', resource: [
      { resourceType: 'Task', criteria: query('Task', { patient: `Patient/${patientId}`, owner: otherOwnerReference,
        identifier: `${FOLLOW_UP_SYSTEM}|` }), interaction: ['read', 'search'] },
    ] },
  };
}

export async function bundleHawaiiFollowUp(config) {
  const { build } = await import('vite');
  const virtualEntry = path.resolve('hawaii-follow-up-bot.ts');
  const helper = path.resolve('src/features/hawaii/followUp.ts');
  const source = `import { handleHawaiiDischarge } from ${JSON.stringify(helper)};
export function handler(medplum, event) { return handleHawaiiDischarge(medplum, event.input, ${JSON.stringify(config)}); }`;
  const result = await build({
    configFile: false, logLevel: 'silent',
    plugins: [{ name: 'hawaii-follow-up-entry',
      resolveId(id) { return id === virtualEntry ? virtualEntry : undefined; },
      load(id) { return id === virtualEntry ? source : undefined; },
    }],
    build: { write: false, minify: false, target: 'node18',
      lib: { entry: virtualEntry, name: 'HawaiiFollowUpBot', formats: ['iife'] },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((output) => output.output);
  const chunk = outputs.find((output) => output.type === 'chunk');
  assert(chunk?.code, 'Expected one executable bot bundle');
  const code = `${chunk.code}\nexports.handler = HawaiiFollowUpBot.handler;`;
  const context = { exports: {}, URLSearchParams };
  vm.runInNewContext(code, context, { timeout: 1000 });
  assert.equal(typeof context.exports.handler, 'function', 'Native VM exports.handler is required');
  return code;
}

async function clientLogin(credentials) {
  const client = new MedplumClient({ baseUrl: BASE_URL, storage: new ClientStorage(new MemoryStorage()) });
  await client.startClientLogin(credentials.clientId, credentials.clientSecret);
  assert.equal((await client.get('auth/me')).project?.id, PROJECT_ID, 'Client project mismatch');
  return client;
}

async function setup(manifest, save) {
  phase = 'administrator-preflight';
  assert(process.env.HAWAII_CQIE_ADMIN_LOGIN_REFERENCE, 'A documented local administrator login reference is required');
  const reference = await readFile(process.env.HAWAII_CQIE_ADMIN_LOGIN_REFERENCE, 'utf8');
  const rows = reference.split('\n').filter((line) => line.startsWith('| Initial '))
    .map((line) => line.split('|').map((cell) => cell.trim().replaceAll('`', '')));
  const account = { email: rows.find((row) => row[1] === 'Initial email')?.[2],
    password: rows.find((row) => row[1] === 'Initial password')?.[2] };
  assert(account.email && account.password, 'Administrator login reference is incomplete');
  const admin = await loginHawaiiProject(BASE_URL, account, undefined, true);
  const project = await admin.readResource('Project', PROJECT_ID);
  assert.equal(project.name, 'Hawaii CQIE Synthetic Demo', 'Unexpected target project');
  if (!project.features?.includes('bots')) {
    await admin.updateResource({ ...project, features: [...(project.features ?? []), 'bots'] });
  }
  const membership = await admin.readResource('ProjectMembership', manifest.accounts.clinician.membershipId);
  assert.equal(membership.project?.reference, `Project/${PROJECT_ID}`, 'Clinician project mismatch');
  assert.equal(membership.accessPolicy?.reference, `AccessPolicy/${manifest.policies.clinician}`, 'Clinician policy mismatch');
  assert(/^Practitioner\/.+/.test(membership.profile?.reference ?? ''), 'Clinician profile required');
  const clinicianPolicy = await admin.readResource('AccessPolicy', manifest.policies.clinician);
  assert.equal(clinicianPolicy.meta?.project, PROJECT_ID, 'Policy project mismatch');
  assert(clinicianPolicy.resource.filter((rule) => rule.resourceType !== 'Task').every((rule) => rule.readonly === true),
    'Existing clinical rules must remain read-only');
  const state = manifest.followUp ??= { stage: 'starting', ownerReference: membership.profile.reference };
  assert.equal(state.ownerReference, membership.profile.reference, 'Assigned clinician changed');
  await save();
  const temporary = await admin.post(`admin/projects/${PROJECT_ID}/client`, { name: 'Hawaii CQIE Follow-Up Setup Operator' });
  let operator = await clientLogin({ clientId: temporary.id, clientSecret: temporary.secret });
  const operatorMemberships = await admin.searchResources('ProjectMembership', {
    project: `Project/${PROJECT_ID}`, user: `ClientApplication/${temporary.id}`,
  });
  assert.equal(operatorMemberships.length, 1, 'Expected one isolated setup operator');
  state.operatorClientId = temporary.id;
  await save();
  let eventPolicy;
  try {
    await admin.updateResource({ ...operatorMemberships[0], admin: true });
    operator = await clientLogin({ clientId: temporary.id, clientSecret: temporary.secret });
    state.operatorDisabled = false;
    await save();
    phase = 'scoped-policies';
    const other = await operator.createResourceIfNoneExist({ resourceType: 'Practitioner', active: true,
      identifier: [{ system: HAWAII_DEMO_SYSTEM, value: 'other-practice-clinician' }],
      name: [{ text: 'Synthetic Other Practice Clinician' }],
    }, new URLSearchParams({ identifier: `${HAWAII_DEMO_SYSTEM}|other-practice-clinician` }).toString());
    state.otherOwnerReference = `Practitioner/${other.id}`;
    const policies = buildHawaiiFollowUpPolicies(manifest.allowedPatientId, state.ownerReference, state.otherOwnerReference);
    state.policies ??= {};
    for (const role of ['bot', 'event', 'other']) {
      const policy = state.policies[role] ? await operator.readResource('AccessPolicy', state.policies[role]) :
        await operator.createResourceIfNoneExist(policies[role], new URLSearchParams({ name: policies[role].name }).toString());
      assert.equal(policy.meta?.project, PROJECT_ID, 'Workflow policy must stay in the Hawaii project');
      assert.deepEqual(policy.resource, policies[role].resource, 'An existing workflow policy differs; inspect before continuing');
      state.policies[role] = policy.id;
      if (role === 'event') { eventPolicy = policy; }
      await save();
    }
    phase = 'native-bot';
    if (!state.botId) {
      const initialized = await operator.post('fhir/R4/Bot/$init', { resourceType: 'Parameters', parameter: [
        { name: 'name', valueString: 'Hawaii CQIE Discharge Follow-Up' },
        { name: 'accessPolicy', valueReference: { reference: `AccessPolicy/${state.policies.bot}` } },
      ] });
      const bot = initialized.resourceType === 'Bot' ? initialized : initialized.parameter?.find((parameter) => parameter.resource?.resourceType === 'Bot')?.resource;
      assert(bot?.id, 'Bot initialization did not return a bot');
      state.botId = bot.id;
      await save();
    }
    const bot = await operator.readResource('Bot', state.botId);
    assert.equal(bot.meta?.project, PROJECT_ID, 'Bot project mismatch');
    await operator.updateResource({ ...bot, runtimeVersion: 'vmcontext', runAsUser: false });
    const code = await bundleHawaiiFollowUp({ patientId: manifest.allowedPatientId, ownerReference: state.ownerReference });
    await operator.post(`fhir/R4/Bot/${state.botId}/$deploy`, { filename: 'index.js', code });
    for (const role of ['event', 'other']) {
      if (!state[`${role}Client`]) {
        const created = await admin.post(`admin/projects/${PROJECT_ID}/client`, {
          name: `Hawaii CQIE Follow-Up ${role}`, accessPolicy: { reference: `AccessPolicy/${state.policies[role]}` },
        });
        state[`${role}Client`] = { clientId: created.id, clientSecret: created.secret };
        await save();
      }
    }
    const existingTaskRule = clinicianPolicy.resource.find((rule) => rule.resourceType === 'Task');
    if (existingTaskRule) { assert.deepEqual(existingTaskRule, policies.clinicianTask, 'Unexpected existing Task permission'); }
    await admin.updateResource({ ...clinicianPolicy, resource: [
      ...clinicianPolicy.resource.filter((rule) => rule.resourceType !== 'Task'), policies.clinicianTask,
    ] });
    phase = 'native-subscription';
    if (!state.subscriptionId) {
      const eventClient = await clientLogin(state.eventClient);
      const criteria = `Encounter?${new URLSearchParams({ patient: `Patient/${manifest.allowedPatientId}`,
        identifier: `${DISCHARGE_SYSTEM}|`, status: 'finished' })}`;
      const existing = await operator.searchResources('Subscription', { url: `Bot/${state.botId}`, _count: '2' });
      assert.equal(existing.length, 0, 'A subscription already exists; inspect partial setup before retrying');
      await operator.updateResource({ ...eventPolicy, resource: [...eventPolicy.resource, {
        resourceType: 'Subscription', interaction: ['create'], writeConstraint: [{ language: 'text/fhirpath',
          expression: `criteria = '${criteria}' and channel.type = 'rest-hook' and channel.endpoint = 'Bot/${state.botId}' and status = 'active'` }],
      }] });
      const subscription = await eventClient.createResource({ resourceType: 'Subscription', status: 'active',
        reason: 'Synthetic inpatient discharge to assigned practice follow-up', criteria,
        channel: { type: 'rest-hook', endpoint: `Bot/${state.botId}`, payload: 'application/fhir+json' },
      });
      assert.equal(subscription.meta?.project, PROJECT_ID, 'Subscription project mismatch');
      state.subscriptionId = subscription.id;
      await save();
    }
    const sourceEncounters = await operator.searchResources('Encounter', {
      patient: `Patient/${manifest.allowedPatientId}`, identifier: `${HAWAII_DEMO_SYSTEM}|`, _count: '50',
    });
    state.sourceOrganization = sourceEncounters.find((encounter) => encounter.serviceProvider?.reference?.startsWith('Organization/'))?.serviceProvider;
    assert(state.sourceOrganization, 'A persisted synthetic source organization is required');
    state.stage = 'native-configured';
    await save();
  } finally {
    try {
      if (eventPolicy) { await operator.updateResource(eventPolicy); }
    } finally {
      await admin.updateResource({ ...operatorMemberships[0], admin: false,
        accessPolicy: { reference: `AccessPolicy/${manifest.policies.disabled}` } });
      state.operatorDisabled = true;
      await save();
    }
  }
}

async function emit(manifest, save, replay) {
  const state = manifest.followUp;
  assert(state?.stage === 'native-configured' && state.operatorDisabled, 'Native setup must be complete');
  phase = replay ? 'replay-synthetic-discharge' : 'emit-synthetic-discharge';
  const client = await clientLogin(state.eventClient);
  let encounter;
  if (replay) {
    assert(state.latestEncounterId, 'A persisted source event is required');
    const clinician = await loginHawaiiProject(BASE_URL, manifest.accounts.clinician, PROJECT_ID);
    const tasks = await clinician.searchResources('Task', {
      identifier: `${FOLLOW_UP_SYSTEM}|Encounter/${state.latestEncounterId}`, _count: '2',
    }, { cache: 'no-cache' });
    assert.equal(tasks.length, 1, 'Exactly one existing Task is required before replay');
    state.replayExpectedTask = { id: tasks[0].id, status: tasks[0].status, versionId: tasks[0].meta?.versionId };
    const current = await client.readResource('Encounter', state.latestEncounterId, { cache: 'no-cache' });
    encounter = await client.updateResource({ ...current, meta: { ...current.meta,
      tag: [{ system: DISCHARGE_SYSTEM, code: randomUUID() }] } });
  } else {
    const now = new Date();
    encounter = await client.createResource({ resourceType: 'Encounter', status: 'finished', class: { code: 'IMP' },
      subject: { reference: `Patient/${manifest.allowedPatientId}` }, serviceProvider: state.sourceOrganization,
      type: [{ text: 'Synthetic discharge event' }],
      period: { start: new Date(now.getTime() - 3600000).toISOString(), end: now.toISOString() },
      identifier: [{ system: DISCHARGE_SYSTEM, value: randomUUID() },
        { system: HAWAII_DEMO_SYSTEM, value: `follow-up-discharge-${randomUUID()}` }],
    });
    state.latestEncounterId = encounter.id;
    delete state.replayExpectedTask;
  }
  assert.equal(encounter.meta?.project, PROJECT_ID, 'Source event project mismatch');
  assert(encounter.meta?.lastUpdated && encounter.meta?.versionId, 'Persisted source event metadata is required');
  state.lastEmission = { encounterId: encounter.id, versionId: encounter.meta.versionId, writtenAt: encounter.meta.lastUpdated, replay };
  await save();
  console.log(JSON.stringify({ projectId: PROJECT_ID, sourceEncounterId: encounter.id, replay, sourceEventWritten: true,
    taskArrivalVerified: false }));
}

async function verify(manifest, directory) {
  phase = 'verify-native-arrival';
  const state = manifest.followUp;
  assert(state?.latestEncounterId, 'Emit a synthetic discharge before verifying');
  const clinician = await loginHawaiiProject(BASE_URL, manifest.accounts.clinician, PROJECT_ID);
  const query = { identifier: `${FOLLOW_UP_SYSTEM}|Encounter/${state.latestEncounterId}`, _count: '2' };
  let tasks = [];
  const deadline = Date.now() + 20000;
  for (let attempt = 0; attempt < 60 && Date.now() < deadline; attempt++) {
    tasks = await clinician.searchResources('Task', query, { cache: 'no-cache' });
    if (tasks.length) { break; }
  }
  assert.equal(tasks.length, 1, 'Native delivery must produce exactly one assigned Task');
  let task = tasks[0];
  phase = 'verify-native-execution-audit';
  assert(state.lastEmission?.encounterId === state.latestEncounterId, 'Expected source event receipt metadata');
  const reviewer = await loginHawaiiProject(BASE_URL, manifest.accounts.reviewer, PROJECT_ID);
  let execution;
  const auditDeadline = Date.now() + 20000;
  for (let attempt = 0; attempt < 60 && Date.now() < auditDeadline; attempt++) {
    const events = await reviewer.searchResources('AuditEvent', {
      entity: `Encounter/${state.latestEncounterId}`, _sort: '-date', _count: '20',
    }, { cache: 'no-cache' });
    execution = events.find((event) => event.outcome === '0' &&
      Date.parse(event.recorded) >= Date.parse(state.lastEmission.writtenAt) &&
      event.entity?.some((entity) => entity.what?.reference === `Subscription/${state.subscriptionId}`));
    if (execution) { break; }
  }
  assert(execution?.id, 'A successful native execution audit for this emission is required');
  task = await clinician.readResource('Task', task.id, { cache: 'no-cache' });
  if (state.replayExpectedTask) {
    assert.deepEqual({ id: task.id, status: task.status, versionId: task.meta?.versionId }, state.replayExpectedTask,
      'Replay must preserve the existing Task ID, state, and version');
  }
  phase = 'verify-task-transition-policy';
  let invalidTransitionDenied = false;
  try {
    await clinician.updateResource({ ...task, status: task.status === 'requested' ? 'completed' : 'requested' },
      { headers: { 'If-Match': `W/"${task.meta.versionId}"` } });
  } catch (error) {
    invalidTransitionDenied = error?.outcome?.issue?.some((issue) => ['forbidden', 'security'].includes(issue.code)) === true;
  }
  assert(invalidTransitionDenied, 'The backend must reject skipped or reversed Task transitions');
  assert.equal(task.owner?.reference, state.ownerReference, 'Task owner mismatch');
  assert.equal(task.for?.reference, `Patient/${manifest.allowedPatientId}`, 'Task patient mismatch');
  const other = await clientLogin(state.otherClient);
  assert.equal((await other.searchResources('Task', query, { cache: 'no-cache' })).length, 0, 'Other practice search leaked work');
  let denied = false;
  try { await other.readResource('Task', task.id, { cache: 'no-cache' }); } catch (error) {
    denied = error?.outcome?.issue?.some((issue) => ['forbidden', 'not-found', 'security'].includes(issue.code)) === true;
  }
  assert(denied, 'Other practice direct read must be forbidden or hidden');
  const verifier = await clientLogin(manifest.verifier);
  const clinical = await verifyHawaiiBackend(manifest, { clinicianToken: clinician.getAccessToken(), verifierToken: verifier.getAccessToken() });
  await writeFile(path.join(directory, 'clinician.token'), clinician.getAccessToken(), { mode: 0o600 });
  await writeFile(path.join(directory, 'verifier.token'), verifier.getAccessToken(), { mode: 0o600 });
  const result = { projectId: PROJECT_ID, taskId: task.id, sourceEncounterId: state.latestEncounterId, status: task.status,
    nativeArrival: true, taskCount: tasks.length, otherPracticeSearchDenied: true, otherPracticeReadDenied: true,
    executionAuditId: execution.id, replayStatePreserved: !!state.replayExpectedTask, invalidTransitionDenied,
    clinicalResourcesChecked: clinical.clinicalResourcesChecked };
  await writeFile(path.join(directory, 'follow-up-check.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result));
}

async function main() {
  const commands = ['--check', '--apply', '--emit', '--replay', '--verify'].filter((flag) => process.argv.includes(flag));
  assert.equal(commands.length, 1, 'Choose exactly one explicit operation');
  if (commands[0] === '--check') {
    const config = { patientId: '00000000-0000-4000-8000-000000000001', ownerReference: 'Practitioner/demo-clinician' };
    buildHawaiiFollowUpPolicies(config.patientId, config.ownerReference, 'Practitioner/other-clinician');
    await bundleHawaiiFollowUp(config);
    console.log('PASS: scoped follow-up policies and native VM bot bundle; no live requests or writes.');
    return;
  }
  const directory = path.resolve('hawaii-cqie.local');
  const file = path.join(directory, 'provisioning.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  assert(manifest.baseUrl === BASE_URL && manifest.projectId === PROJECT_ID && manifest.stage === 'preflight-passed',
    'Only the verified isolated Hawaii project may be changed');
  const save = () => writeFile(file, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  if (commands[0] === '--apply') { await setup(manifest, save); }
  if (['--emit', '--replay'].includes(commands[0])) { await emit(manifest, save, commands[0] === '--replay'); }
  if (commands[0] === '--verify') { await verify(manifest, directory); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    if (!process.argv.includes('--check')) {
      await writeFile(path.resolve('hawaii-cqie.local/follow-up-error.json'), JSON.stringify({ phase, message: error?.message,
        outcome: error?.outcome }, null, 2), { mode: 0o600 }).catch(() => {});
    }
    console.error(`FOLLOW_UP_STOPPED at ${phase}: inspect the private stage record before retrying. No credentials or response bodies are printed.`);
    process.exitCode = 1;
  });
}