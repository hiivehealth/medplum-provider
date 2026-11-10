import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { permitsSave } from './oem-browser-save.mjs';
import { permitsReadOnlyFhir } from './oem-browser-check.mjs';

const project = '33e151fc-3e91-4df9-8093-106107f7e2f1';
const patient = 'Patient/f8be7ab5-b799-4345-baba-2ba675122b13';
const origin = 'http://127.0.0.1:5172';
const api = 'https://api.ehr.hiivehealth.net';
const saveUrl = `${api}/fhir/R4/Bot/4dba434f-1549-4a02-93b6-e15bdcefdd90/$execute`;
const backend = path.resolve(import.meta.dirname, '../../medplum-ubix-army-oem/examples/medplum-demo-bots/src/army-oem');
const directory = path.join(backend, 'oem.local');
const output = path.join(directory, 'demo-intake-2026-10-26');
const journalFile = path.join(output, 'journal.json');
const date = '2026-10-26';
let phase = 'initialization';

export function permitsDemoIntake(method, url, request, evidence) {
  try {
    assert(permitsSave(method, url, request, { patient }));
    assert.deepEqual(Object.keys(request).sort(), ['at', 'mode', 'patient', 'response', 'submissionId']);
    assert.match(request.at, /^2026-10-26T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.match(evidence, /^DocumentReference\/[A-Za-z0-9.-]+(?:\/_history\/[A-Za-z0-9.-]+)?$/);
    const answers = {};
    function collect(items) {
      for (const item of items ?? []) {
        if (item.answer) {
          assert.equal(item.answer.length, 1);
          assert(!Object.hasOwn(answers, item.linkId));
          const answer = item.answer[0];
          assert.equal(Object.keys(answer).length, 1);
          answers[item.linkId] = answer.valueCoding?.code ?? answer.valueReference?.reference ?? answer.valueDate;
        }
        collect(item.item);
      }
    }
    collect(request.response.item);
    assert.deepEqual(answers, { worksite: 'synthetic-maintenance-bay', start: date,
      availability: 'unknown', metric: 'eight-hour-twa', unit: 'dBA', basis: '8h',
      method: 'synthetic-personal-dosimetry', assessed: date, 'measurement-evidence': evidence,
      determination: 'not-provided' });
    return true;
  } catch {
    return false;
  }
}

function exact(resource) {
  assert.equal(resource.meta?.project, project);
  assert(resource.id && resource.meta.versionId);
  return `${resource.resourceType}/${resource.id}/_history/${resource.meta.versionId}`;
}

async function inventory(admin, tools, pdf) {
  const result = await tools.lifecycleInventory(admin);
  for (const type of ['Basic', 'ClientApplication', 'Practitioner', 'PractitionerRole', 'Organization', 'Location', 'Encounter', 'DiagnosticReport', 'Specimen']) {
    const bundle = await admin.search(type, { _project: project, _count: '101' }, { cache: 'no-cache', maxRetries: 0 });
    assert((bundle.entry?.length ?? 0) < 101 && !bundle.link?.some(link => link.relation === 'next'));
    result[type] = (bundle.entry ?? []).map(entry => exact(entry.resource)).sort();
  }
  const binary = await admin.readResource('Binary', pdf.split('/')[1], { cache: 'no-cache', maxRetries: 0 });
  result.Binary = [...new Set([...result.Binary, exact(binary)])].sort();
  return result;
}

async function verify(admin, tools, journal) {
  phase = 'independent-readback';
  assert.equal(journal.projectId, project);
  assert.equal(journal.patient, patient);
  assert.equal(journal.attempts, 1);
  assert(permitsDemoIntake('POST', saveUrl, journal.request, journal.evidence));
  const result = journal.result;
  assert.equal(result?.status, 'completed');
  assert.equal(result.replayed, false);
  assert.deepEqual(result.resources.map(item => item.step).sort(), ['exposure', 'lineage', 'measurement', 'submission']);
  const references = [result.receipt, ...result.resources.map(item => item.reference)];
  assert.equal(new Set(references.map(reference => reference.split('/').slice(0, 2).join('/'))).size, 5);
  const expected = structuredClone(journal.before);
  const records = [];
  for (const reference of references) {
    assert.match(reference, /^(Task|Observation|Provenance|QuestionnaireResponse)\/[A-Za-z0-9.-]+\/_history\/[A-Za-z0-9.-]+$/);
    const [type, id] = reference.split('/');
    assert(!journal.before[type].some(previous => previous.startsWith(`${type}/${id}/`)));
    const resource = await admin.readResource(type, id, { cache: 'no-cache', maxRetries: 0 });
    assert.equal(exact(resource), reference);
    if (resource.subject) assert.equal(resource.subject.reference, patient);
    records.push(resource);
    expected[type] = [...expected[type], reference].sort();
  }
  const receipt = records[0];
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.for.reference, patient);
  assert.equal(receipt.requester.reference, journal.actor);
  assert.equal(receipt.identifier[0].value, journal.request.submissionId);
  assert.deepEqual(receipt.output.map(item => ({ step: item.type.text, reference: item.valueReference.reference })), result.resources);
  assert.equal(receipt.code.coding[0].code, 'intake-save');
  const byStep = step => records.find(resource => exact(resource) === result.resources.find(item => item.step === step).reference);
  assert.deepEqual(byStep('submission').item, journal.request.response.item);
  assert.equal(byStep('exposure').effectivePeriod.start, date);
  assert(!byStep('exposure').effectivePeriod.end);
  assert(byStep('exposure').extension.some(item => item.url.endsWith('/synthetic-worksite') && item.valueCode === 'synthetic-maintenance-bay'));
  assert.equal(byStep('measurement').valueQuantity?.value, undefined);
  assert(byStep('lineage').agent.some(item => item.who.reference === journal.actor));
  if (journal.artifacts) assert.deepEqual(records, journal.artifacts);
  assert.deepEqual(await inventory(admin, tools, journal.pdfBinary), expected);
  assert.deepEqual(await tools.lifecycleProtectedDigests(), journal.protectedFiles);
  assert.deepEqual(await admin.readResource('Project', project, { cache: 'no-cache', maxRetries: 0 }), journal.originalProject);
  journal.artifacts = records;
  journal.stage = 'verified';
  journal.verifiedAt = new Date().toISOString();
  await writeFile(journalFile, JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 });
  return { verified: true, verifiedAt: journal.verifiedAt, newExposureCount: 1, newIntakeArtifacts: 5,
    priorRecordsUnchanged: true, enrollmentCreated: false, clinicalOrdersCreated: 0,
    permissionsChanged: false, externalDispatch: false };
}

async function main(mode) {
  process.umask(0o077);
  assert(['--save-one', '--verify'].includes(mode) && process.argv.length === 3);
  const state = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
  assert.equal(state.projectId, project);
  assert(state.operatorDisabled && !state.pending);
  const { administrator, login } = await import(pathToFileURL(path.join(backend, 'provision.mjs')).href);
  const tools = await import(pathToFileURL(path.join(backend, 'lifecycle-inspection-live.mjs')).href);
  const admin = await administrator();
  if (mode === '--verify') return console.log(JSON.stringify(await verify(admin, tools, JSON.parse(await readFile(journalFile, 'utf8')))));
  await assert.rejects(access(output), { code: 'ENOENT' }, 'The single-save authorization is consumed; use --verify only');
  phase = 'pre-save-preservation';
  const preflight = JSON.parse(execFileSync(process.execPath, [path.join(backend, 'native-matrix-pdf-live.mjs'), '--verify'], { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert(preflight.verified && preflight.previousRecordsUnchanged && preflight.clinicalWrites === 0);
  const clinician = await login(state.accounts.clinician, project);
  const identity = await clinician.get('auth/me', { maxRetries: 0 });
  const actor = `${identity.profile.resourceType}/${identity.profile.id}`;
  assert.equal(identity.project.id, project);
  assert.equal(actor, state.accounts.clinician.profile);
  const publication = JSON.parse(await readFile(path.join(directory, 'native-matrix-pdf-publication.json'), 'utf8'));
  const pdfBinary = publication.plan.config.binary;
  const journal = { projectId: project, patient, actor, stage: 'prepared', attempts: 0, preflight, pdfBinary,
    before: await inventory(admin, tools, pdfBinary), protectedFiles: await tools.lifecycleProtectedDigests(),
    originalProject: await admin.readResource('Project', project, { cache: 'no-cache', maxRetries: 0 }) };
  const { chromium } = await import(process.env.OEM_PLAYWRIGHT_MODULE ?? 'playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let armed = false;
  let previewRequest;
  let evidence;
  const blocked = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await context.route(`${api}/fhir/R4**`, async route => {
      const request = route.request();
      let body;
      try { body = request.postDataJSON(); } catch { body = undefined; }
      if (permitsReadOnlyFhir(request.method(), request.url(), body)) {
        if (body?.mode === 'preview' && body.patient === patient && body.response?.questionnaire?.includes('synthetic-noise-intake')) previewRequest = structuredClone(body);
        return route.continue();
      }
      if (!armed || journal.attempts !== 0 || !permitsDemoIntake(request.method(), request.url(), body, evidence) ||
          JSON.stringify(body) !== JSON.stringify({ ...previewRequest, mode: 'save' })) {
        blocked.push(request.method());
        return route.abort('blockedbyclient');
      }
      armed = false;
      journal.attempts = 1;
      journal.request = body;
      journal.evidence = evidence;
      journal.stage = 'sent-outcome-unknown';
      await writeFile(journalFile, JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 });
      try {
        const response = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
        journal.httpStatus = response.status();
        if (response.status() === 200) journal.result = await response.json();
        await writeFile(journalFile, JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 });
        return route.fulfill({ response });
      } catch {
        return route.abort('failed');
      }
    });
    phase = 'browser-sign-in';
    await page.goto(`${origin}/signin?project=${project}`);
    await page.locator('input[type="email"]').fill(state.accounts.clinician.email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('input[type="password"]').fill(state.accounts.clinician.password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.getByRole('button', { name: 'User menu' }).waitFor();
    phase = 'prepare-single-exposure';
    await page.goto(`${origin}/oem/intake`);
    await page.getByPlaceholder('Select worker').click();
    await page.getByRole('option', { name: 'Demo Synthetic-1', exact: true }).click();
    await page.getByRole('radio', { name: 'synthetic maintenance bay', exact: true }).check();
    await page.getByRole('textbox', { name: 'Exposure start', exact: true }).fill(date);
    await page.getByRole('radio', { name: 'unknown', exact: true }).check();
    for (const name of ['eight hour twa', 'dBA', '8h', 'synthetic personal dosimetry']) await page.getByRole('radio', { name, exact: true }).check();
    await page.getByRole('textbox', { name: 'Assessment date', exact: true }).fill(date);
    const source = page.locator('.mantine-Radio-root').filter({ has: page.locator('a[href*="/DocumentReference/"]') }).first();
    evidence = (await source.getByRole('link').getAttribute('href')).slice(1);
    await source.getByRole('radio').check();
    await page.getByRole('radio', { name: 'not provided', exact: true }).last().check();
    await page.getByRole('button', { name: 'Preview intake', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Save synthetic intake?', exact: true });
    await dialog.waitFor();
    assert(previewRequest && permitsDemoIntake('POST', saveUrl, { ...previewRequest, mode: 'save' }, evidence));
    assert.equal(blocked.length, 0);
    assert.deepEqual(await inventory(admin, tools, pdfBinary), journal.before);
    await mkdir(output, { mode: 0o700 });
    const lock = await open(path.join(output, 'save.lock'), 'wx', 0o600);
    await lock.writeFile('Paul authorized exactly one new synthetic Noise exposure; no amendment, enrollment, decision, completion or external delivery.\n');
    await lock.close();
    await writeFile(journalFile, JSON.stringify(journal, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await dialog.screenshot({ path: path.join(output, 'before-confirm.png') });
    phase = 'save-one-exposure';
    armed = true;
    await dialog.getByRole('button', { name: 'Confirm save', exact: true }).click();
    await page.getByText('Intake saved', { exact: true }).waitFor();
    assert.equal(blocked.length, 0);
    assert.equal(journal.httpStatus, 200);
    await page.screenshot({ path: path.join(output, 'intake-saved.png'), fullPage: true });
    console.log(JSON.stringify(await verify(admin, tools, journal)));
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch(() => {
    console.error(JSON.stringify({ failed: true, phase, doNotRetrySave: true, privateDetailsSuppressed: true }));
    process.exitCode = 1;
  });
}
