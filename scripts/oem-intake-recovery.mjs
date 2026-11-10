import assert from 'node:assert/strict';
import { chmod, mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDisplayString } from '@medplum/core';
import { permitsSave } from './oem-browser-save.mjs';
import { permitsReadOnlyFhir } from './oem-browser-check.mjs';

const projectId = '33e151fc-3e91-4df9-8093-106107f7e2f1';
const api = 'https://api.ehr.hiivehealth.net';
const backend = path.resolve(import.meta.dirname, '../../medplum-ubix-army-oem/examples/medplum-demo-bots/src/army-oem');
const directory = process.env.OEM_STATE_DIRECTORY ?? path.join(backend, 'oem.local');
const patient = 'Patient/f8be7ab5-b799-4345-baba-2ba675122b13';
const saveUrl = `${api}/fhir/R4/Bot/4dba434f-1549-4a02-93b6-e15bdcefdd90/$execute`;
const prefix = 'intake-recovery';
const journalFile = path.join(directory, `${prefix}.json`);
const output = path.join(directory, `${prefix}-evidence`);
let phase = 'initialization';

export function permitsRecoverySave(method, url, body, scope) {
  return scope?.patient === 'Patient/f8be7ab5-b799-4345-baba-2ba675122b13' &&
    permitsSave(method, url, body, { patient: scope.patient }) &&
    Object.keys(body).sort().join('|') === 'at|mode|patient|response|submissionId' &&
    !body.exposure && !body.amendmentReason &&
    (!scope.request || JSON.stringify(body) === JSON.stringify(scope.request));
}

export function checkRecoveryResult(result, replayed) {
  assert.equal(result?.status, 'completed'); assert.equal(result.replayed, replayed);
  assert.match(result.receipt, /^Task\/[A-Za-z0-9.-]+\/_history\/[A-Za-z0-9.-]+$/);
  assert(Array.isArray(result.resources));
  assert.deepEqual(result.resources.map(resource => resource.step).sort(), ['exposure', 'lineage', 'measurement', 'submission']);
  for (const resource of result.resources) assert.match(resource.reference,
    /^(Observation|QuestionnaireResponse|Provenance)\/[A-Za-z0-9.-]+\/_history\/[A-Za-z0-9.-]+$/);
  assert.equal(new Set(result.resources.map(resource => resource.reference.split('/').slice(0, 2).join('/'))).size, 4);
}

function exact(resource) {
  assert.equal(resource.meta?.project, projectId); assert(resource.id && resource.meta.versionId);
  return `${resource.resourceType}/${resource.id}/_history/${resource.meta.versionId}`;
}

async function bounded(admin, type) {
  const bundle = await admin.search(type, { _project: projectId, _count: '101' }, { cache: 'no-cache', maxRetries: 0 });
  assert((bundle.entry?.length ?? 0) < 101 && !bundle.link?.some(link => link.relation === 'next'));
  return (bundle.entry ?? []).map(entry => exact(entry.resource)).sort();
}

async function inventory(admin, tools) {
  const result = await tools.lifecycleInventory(admin);
  for (const type of ['Basic', 'ClientApplication']) result[type] = await bounded(admin, type);
  return result;
}

async function verifyNative(admin, tools, journal) {
  phase = 'verify-recorded-graph';
  assert.equal(journal.projectId, projectId); assert.equal(journal.patient, patient);
  assert(permitsRecoverySave('POST', saveUrl, journal.request, { patient, request: journal.request }));
  checkRecoveryResult(journal.first.result, false);
  const records = [];
  for (const reference of [journal.first.result.receipt, ...journal.first.result.resources.map(resource => resource.reference)]) {
    const [type, id] = reference.split('/');
    assert(!journal.before[type].some(value => value.startsWith(`${type}/${id}/`)), 'Fixture must not reuse an existing resource');
    const resource = await admin.readResource(type, id, { cache: 'no-cache', maxRetries: 0 });
    assert.equal(exact(resource), reference); records.push(resource);
  }
  const receipt = records[0];
  assert.equal(receipt.status, 'completed'); assert.equal(receipt.for.reference, patient);
  assert.equal(receipt.requester.reference, journal.actor);
  assert.equal(receipt.identifier[0].value, journal.request.submissionId);
  assert.match(receipt.input[0].valueString, /^[a-f0-9]{64}$/);
  assert.deepEqual(receipt.output.map(value => ({ step: value.type.text, reference: value.valueReference.reference })), journal.first.result.resources);
  const submission = records.find(resource => resource.resourceType === 'QuestionnaireResponse');
  assert.equal(submission.subject.reference, patient);
  assert.deepEqual(submission.item, journal.request.response.item);
  const measurement = records.find(resource => exact(resource) === journal.first.result.resources.find(value => value.step === 'measurement').reference);
  assert.equal(measurement.valueQuantity?.value, undefined, 'Unknown measurement must not become zero');
  for (const resource of records.slice(1)) {
    if (resource.subject) assert.equal(resource.subject.reference, patient);
    assert(resource.extension?.some(extension => extension.valueString === receipt.input[0].valueString), 'Save fingerprint is not retained');
  }
  if (journal.artifacts) assert.deepEqual(records, journal.artifacts, 'Recovery must not add artifact versions or change bodies');
  const expected = structuredClone(journal.before);
  for (const resource of records) expected[resource.resourceType] = [...expected[resource.resourceType], exact(resource)].sort();
  assert.deepEqual(await inventory(admin, tools), expected, 'Only the disposable episode artifacts may be added');
  assert.deepEqual(await tools.lifecycleProtectedDigests(prefix), journal.protectedFiles);
  assert.deepEqual(await tools.auditInventory(admin, journal.auditMarkers), journal.audits);
  assert.deepEqual(await admin.readResource('Project', projectId, { cache: 'no-cache' }), journal.originalProject);
  journal.artifacts = records;
  journal.verifiedAt = new Date().toISOString();
  return records;
}

async function reserve(name) {
  const handle = await open(path.join(directory, `${prefix}-${name}.lock`), 'wx', 0o600);
  await handle.writeFile(JSON.stringify({ projectId, authorized: 'Paul yes: separate new synthetic episode, withheld save response and exact-request recovery only' }));
  await handle.close();
}

async function interrupt(state, admin, tools, persist, probe = false) {
  phase = 'capture-preservation-baseline';
  let journal;
  if (probe) {
    journal = JSON.parse(await readFile(journalFile, 'utf8'));
    assert.equal(journal.stage, 'sent-outcome-unknown'); assert.equal(journal.attempts, 1);
    await verifyNative(admin, tools, journal);
    journal.initialBrowserRun = 'Completed native save and both pending-reload checks, then aggregate traffic assertion failed; original save must not be resent';
    await reserve('transport-probe');
  } else {
    const previous = JSON.parse(await readFile(path.join(directory, 'native-report-completion-publication.json'), 'utf8'));
    assert(previous.verified && previous.plan.auditMarkers.length === 2);
    journal = { projectId, patient, actor: state.accounts.clinician.profile, stage: 'reserved', attempts: 0,
      before: await inventory(admin, tools), protectedFiles: await tools.lifecycleProtectedDigests(prefix),
      originalProject: await admin.readResource('Project', projectId, { cache: 'no-cache' }),
      auditMarkers: previous.plan.auditMarkers, audits: await tools.auditInventory(admin, previous.plan.auditMarkers) };
    await reserve('interrupt');
    await mkdir(output, { mode: 0o700 });
  }
  await persist(journal);
  const playwright = await import(process.env.OEM_PLAYWRIGHT_MODULE ?? 'playwright');
  const browser = await (playwright.default ?? playwright).chromium.launch({ channel: 'chrome', headless: true });
  const blocked = []; const errors = [];
  let armed = false; let probeAttempts = 0; let probeRequest;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => sessionStorage.setItem('medplum_base_url', 'https://api.ehr.hiivehealth.net'));
    const page = await context.newPage();
    page.on('pageerror', () => errors.push('Browser runtime error'));
    await context.route(`${api}/fhir/R4**`, async route => {
      const request = route.request(); let body;
      try { body = request.postDataJSON(); } catch { body = undefined; }
      if (permitsReadOnlyFhir(request.method(), request.url(), body)) return route.continue();
      if (probe && permitsRecoverySave(request.method(), request.url(), body, { patient })) {
        probeAttempts += 1;
        if (armed && probeAttempts === 1) { probeRequest = body; armed = false; }
        else blocked.push('unexpected-save-retry');
        journal.transportProbe = { request: probeRequest, abortedClientSaveAttempts: probeAttempts, nativeSaveRequests: 0 };
        await persist(journal); return route.abort('failed');
      }
      if (!armed || journal.attempts !== 0 || !permitsRecoverySave(request.method(), request.url(), body, { patient })) {
        blocked.push(request.method()); return route.abort('blockedbyclient');
      }
      armed = false; journal.request = body; journal.attempts = 1; journal.stage = 'sent-outcome-unknown'; await persist(journal);
      try {
        const response = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
        journal.first = { httpStatus: response.status(), result: await response.json(), responseWithheld: true };
        await persist(journal);
        await route.abort('failed');
      } catch {
        journal.outcomeUncertain = true; await persist(journal); await route.abort('failed');
      }
    });
    phase = 'private-browser-sign-in';
    await page.goto(`http://127.0.0.1:5172/signin?project=${projectId}`);
    await page.locator('input[type="email"]').fill(state.accounts.clinician.email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('input[type="password"]').fill(state.accounts.clinician.password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.getByRole('button', { name: 'User menu' }).waitFor();
    await page.goto('http://127.0.0.1:5172/oem/intake');
    const worker = await admin.readResource('Patient', patient.split('/')[1], { cache: 'no-cache' });
    assert(worker.meta.tag?.some(tag => tag.system === 'https://hiivehealth.com/fhir/CodeSystem/demo-data' && tag.code === 'synthetic-only'));
    await page.getByPlaceholder('Select worker').click();
    await page.getByRole('option', { name: getDisplayString(worker), exact: true }).click();
    await page.getByRole('radio', { name: 'synthetic maintenance bay', exact: true }).check();
    await page.getByRole('textbox', { name: 'Exposure start', exact: true }).fill('2026-02-01');
    await page.getByRole('radio', { name: 'unknown', exact: true }).check();
    for (const name of ['eight hour twa', 'dBA', '8h', 'synthetic personal dosimetry']) await page.getByRole('radio', { name, exact: true }).check();
    await page.getByRole('textbox', { name: 'Assessment date', exact: true }).fill('2026-02-02');
    await page.locator('.mantine-Radio-root').filter({ has: page.locator('a[href*="/DocumentReference/"]') }).first().getByRole('radio').check();
    await page.getByRole('radio', { name: 'not provided', exact: true }).last().check();
    await page.getByRole('button', { name: 'Preview intake', exact: true }).click();
    await page.getByRole('dialog', { name: 'Save synthetic intake?' }).waitFor();
    phase = 'confirmed-disposable-episode-save';
    armed = true; await page.getByRole('button', { name: 'Confirm save', exact: true }).click();
    await page.getByText('Save completion was not confirmed. Inspect the submission receipt before another save; staged records may already exist.', { exact: true }).waitFor();
    assert.equal(journal.first.httpStatus, 200); checkRecoveryResult(journal.first.result, false);
    const markerKey = `oem-intake-pending:${projectId}:${journal.actor}`;
    const marker = await page.evaluate(key => sessionStorage.getItem(key), markerKey);
    assert.equal(JSON.parse(marker).submissionId, (probe ? probeRequest : journal.request).submissionId);
    if (probe) journal.transportProbe.pendingMarker = marker;
    else { journal.pendingMarker = marker; journal.uiOutcomeUncertain = true; }
    await persist(journal);
    for (const [viewport, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      phase = `verify-pending-${viewport}`;
      await page.setViewportSize({ width, height }); await page.reload();
      await page.getByText('Submission requires inspection', { exact: true }).waitFor();
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), markerKey), marker);
      assert(await page.getByPlaceholder('Select worker').isDisabled());
      assert.equal(journal.attempts, 1, 'Reload must not resubmit an uncertain save');
      await page.getByRole('complementary', { name: 'CUI', exact: true }).waitFor();
      const screenshot = path.join(output, `${viewport}-pending-after-${probe ? 'transport-fault' : 'lost-response'}.png`);
      await page.screenshot({ path: screenshot, animations: 'disabled' }); await chmod(screenshot, 0o600);
    }
    if (probe) {
      journal.transportProbe.blockedTrafficCount = blocked.length;
      journal.transportProbe.runtimeErrors = errors.length;
      journal.transportProbe.pendingAcrossReload = true;
    } else journal.browserTraffic = { blockedTrafficCount: blocked.length, runtimeErrors: errors.length };
    await persist(journal);
    assert.equal(blocked.length, 0); assert.equal(errors.length, 0);
    if (probe) assert.equal(probeAttempts, 1);
    journal.browserReloadBlocked = true;
    await verifyNative(admin, tools, journal);
    journal.stage = 'interrupted'; await persist(journal);
  } finally { await browser.close(); }
  return journal;
}

async function main(mode) {
  assert(['--preflight', '--interrupt-save', '--verify-transport-no-write', '--recover', '--verify'].includes(mode));
  assert.equal((await stat(directory)).mode & 0o077, 0);
  const { administrator } = await import(pathToFileURL(path.join(backend, 'provision.mjs')).href);
  const state = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
  assert.equal(state.projectId, projectId);
  assert(state.operatorDisabled && !state.pending);
  const admin = await administrator();
  const project = await admin.readResource('Project', projectId, { cache: 'no-cache', maxRetries: 0 });
  assert.equal(project.name, 'Army OEM Synthetic Demo');
  const bot = await admin.readResource('Bot', '4dba434f-1549-4a02-93b6-e15bdcefdd90', { cache: 'no-cache', maxRetries: 0 });
  assert.equal(bot.meta.project, projectId);
  assert.equal(bot.runAsUser, false);
  if (mode === '--preflight') {
    console.log(JSON.stringify({ preflight: true, projectId, fixture: 'new-independent-intake-episode',
      existingWorkerOnly: true, existingRecordsChanged: false, nativeWrites: 0 })); return;
  }
  const lifecycle = await import(pathToFileURL(path.join(backend, 'lifecycle-inspection-live.mjs')).href);
  const { auditInventory } = await import(pathToFileURL(path.join(backend, 'native-report-live.mjs')).href);
  const tools = { ...lifecycle, auditInventory };
  const persist = journal => writeFile(journalFile, JSON.stringify(journal, null, 2), { mode: 0o600 });
  let journal;
  if (mode === '--interrupt-save' || mode === '--verify-transport-no-write') {
    journal = await interrupt(state, admin, tools, persist, mode === '--verify-transport-no-write');
  }
  else {
    journal = JSON.parse(await readFile(journalFile, 'utf8'));
    await verifyNative(admin, tools, journal); await persist(journal);
    if (mode === '--recover') {
      assert.equal(journal.stage, 'interrupted'); assert(journal.browserReloadBlocked && !journal.recovery);
      const { login } = await import(pathToFileURL(path.join(backend, 'provision.mjs')).href);
      const client = await login(state.accounts.clinician, projectId);
      const identity = await client.get('auth/me', { maxRetries: 0 });
      assert.equal(identity.project?.id, projectId);
      assert.equal(`${identity.profile?.resourceType}/${identity.profile?.id}`, journal.actor);
      await reserve('recover');
      journal.recovery = { stage: 'attempting-identical-request', separateProcess: true }; await persist(journal);
      phase = 'explicit-identical-request-recovery';
      journal.recovery.result = await client.post('fhir/R4/Bot/4dba434f-1549-4a02-93b6-e15bdcefdd90/$execute', journal.request, 'application/json', { maxRetries: 0 });
      await persist(journal);
      checkRecoveryResult(journal.recovery.result, true);
      assert.deepEqual(journal.recovery.result, { ...journal.first.result, replayed: true });
      await verifyNative(admin, tools, journal);
      journal.stage = 'recovered'; journal.recovery.stage = 'verified-no-extra-versions'; await persist(journal);
    }
  }
  console.log(JSON.stringify({ stage: journal.stage, verifiedAt: journal.verifiedAt, disposableArtifacts: journal.artifacts.length,
    lostResponseObserved: journal.uiOutcomeUncertain, reloadSubmissionBlocked: journal.browserReloadBlocked,
    recoveryReplayed: journal.recovery?.result?.replayed ?? false, existingResourcesUnchanged: true,
    prescribingPermissionsChanged: false, externalDispatch: false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch(error => {
    console.error(JSON.stringify({ failed: true, phase, replayWrite: false, privateDetailsSuppressed: true,
      locations: error.stack?.split('\n').filter(line => line.trim().startsWith('at ') && line.includes('oem-intake-recovery.mjs:')).map(line => line.trim()).slice(0, 3) }));
    process.exitCode = 1;
  });
}