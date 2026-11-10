import { getDisplayString } from '@medplum/core';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { permitsReadOnlyFhir } from './oem-browser-check.mjs';

const projectId = '33e151fc-3e91-4df9-8093-106107f7e2f1';
const saveBot = '4dba434f-1549-4a02-93b6-e15bdcefdd90';
const api = 'https://api.ehr.hiivehealth.net';
const origin = 'http://127.0.0.1:5172';
const backend = path.resolve(
  import.meta.dirname,
  '../../medplum-ubix-army-oem/examples/medplum-demo-bots/src/army-oem'
);

export function permitsSave(method, url, body, scope) {
  return (
    method === 'POST' &&
    url === `${api}/fhir/R4/Bot/${saveBot}/$execute` &&
    body?.mode === 'save' &&
    body.patient === scope.patient &&
    body.response?.subject?.reference === scope.patient &&
    body.response?.questionnaire === 'https://hiivehealth.com/fhir/Questionnaire/synthetic-noise-intake|demo-1' &&
    /^[0-9a-f-]{36}$/.test(body.submissionId ?? '') &&
    Object.keys(body).every((key) =>
      ['mode', 'patient', 'response', 'submissionId', 'at', 'exposure', 'amendmentReason'].includes(key)
    ) &&
    (scope.exposure
      ? body.exposure === scope.exposure && body.amendmentReason === 'correct-worksite'
      : !body.exposure && !body.amendmentReason)
  );
}

async function main() {
  assert.deepEqual(process.argv.slice(2), ['--save-and-amend'], 'Explicit two-save authorization required');
  const directory = process.env.OEM_STATE_DIRECTORY ?? path.join(backend, 'oem.local');
  assert.equal((await stat(directory)).mode & 0o077, 0);
  assert.equal((await stat(path.join(directory, 'state.json'))).mode & 0o077, 0);
  const state = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
  assert.equal(state.projectId, projectId);
  assert(state.operatorDisabled && !state.pending && state.ihReview?.verifiedAt);
  const { login, administrator } = await import(pathToFileURL(path.join(backend, 'provision.mjs')).href);
  const client = await login(state.accounts.clinician, projectId);
  const identity = await client.get('auth/me');
  assert.equal(identity.project.id, projectId);
  const workerId = state.fixtures['Patient/noise-worker-1'].id;
  const patient = `Patient/${workerId}`;
  const worker = await client.readResource('Patient', workerId, { cache: 'no-cache' });
  assert.equal(worker.meta.project, projectId);
  assert(
    worker.meta.tag.some(
      (tag) => tag.code === 'synthetic-only' && tag.system === 'https://hiivehealth.com/fhir/CodeSystem/demo-data'
    )
  );
  const auditor = await administrator();
  const types = [
    'Patient',
    'DocumentReference',
    'Observation',
    'QuestionnaireResponse',
    'Provenance',
    'Task',
    'ServiceRequest',
    'ClinicalImpression',
  ];
  async function snapshot() {
    const resources = new Map();
    for (const type of types) {
      const records = await auditor.searchResources(
        type,
        { _project: projectId, _count: '1000', _elements: 'id,meta' },
        { cache: 'no-cache' }
      );
      assert(records.length < 1000, 'Snapshot bound exceeded');
      for (const resource of records) {
        assert(resource.id && resource.meta?.versionId);
        assert.equal(resource.meta.project, projectId);
        resources.set(`${type}/${resource.id}`, resource.meta.versionId);
      }
    }
    return resources;
  }
  const baseline = await snapshot();
  const journal = { projectId, patient, phase: 'reserved', attempts: [], baseline: Object.fromEntries(baseline) };
  const journalFile = path.join(directory, 'browser-save-state.json');
  await writeFile(journalFile, JSON.stringify(journal, null, 2), { flag: 'wx', mode: 0o600 });
  const persist = () => writeFile(journalFile, JSON.stringify(journal, null, 2), { mode: 0o600 });
  const output = path.join(directory, 'browser-save-screenshots');
  await mkdir(output, { mode: 0o700 });
  const playwright = await import(process.env.OEM_PLAYWRIGHT_MODULE ?? 'playwright');
  const browser = await (playwright.default ?? playwright).chromium.launch({ channel: 'chrome', headless: true });
  let page;
  let armed;
  const blocked = [];
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    page.on('pageerror', () => errors.push('Runtime error'));
    await context.route(`${api}/fhir/R4**`, async (route) => {
      const request = route.request();
      let body;
      try {
        body = request.postDataJSON();
      } catch {
        body = undefined;
      }
      if (permitsReadOnlyFhir(request.method(), request.url(), body)) return route.continue();
      const scope = armed;
      armed = undefined;
      if (!scope || journal.attempts.length >= 2 || !permitsSave(request.method(), request.url(), body, scope)) {
        blocked.push(request.method());
        return route.abort('blockedbyclient');
      }
      const attempt = { request: body, phase: 'sent-outcome-unknown' };
      journal.attempts.push(attempt);
      await persist();
      try {
        const response = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
        attempt.httpStatus = response.status();
        attempt.result = await response.json();
        attempt.phase = 'response-recorded';
        await persist();
        return route.fulfill({ response });
      } catch {
        await persist();
        return route.abort('failed');
      }
    });
    journal.phase = 'sign-in';
    await persist();
    await page.goto(`${origin}/signin?project=${projectId}`);
    await page.locator('input[type="email"]').fill(state.accounts.clinician.email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('input[type="password"]').fill(state.accounts.clinician.password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.getByRole('button', { name: 'User menu' }).waitFor();
    async function openWorker() {
      await page.goto(`${origin}/oem/intake`);
      await page.getByPlaceholder('Select worker').click();
      await page.getByRole('option', { name: getDisplayString(worker), exact: true }).click();
    }
    async function confirmAndVerify(scope) {
      await page.getByRole('button', { name: 'Preview intake', exact: true }).click();
      await page.getByRole('dialog', { name: 'Save synthetic intake?' }).waitFor();
      armed = scope;
      await page.getByRole('button', { name: 'Confirm save', exact: true }).click();
      await page.getByText('Intake saved', { exact: true }).waitFor();
      const attempt = journal.attempts.at(-1);
      assert.equal(attempt.httpStatus, 200);
      assert.equal(attempt.result.status, 'completed');
      assert.equal(attempt.result.replayed, false);
      for (const resource of [...attempt.result.resources, { step: 'receipt', reference: attempt.result.receipt }]) {
        const [type, id, history, version] = resource.reference.split('/');
        assert.equal(history, '_history');
        const stored = await auditor.readVersion(type, id, version, { cache: 'no-cache' });
        assert.equal(stored.id, id);
        assert.equal(stored.meta.versionId, version);
        assert.equal(stored.meta.project, projectId);
        if (stored.subject) assert.equal(stored.subject.reference, patient);
        if (resource.step === 'receipt') assert.equal(stored.status, 'completed');
        if (['Observation', 'Task'].includes(type)) {
          const visible = await client.readVersion(type, id, version, { cache: 'no-cache' });
          assert.equal(visible.meta.versionId, version);
        }
      }
      assert(
        await page.evaluate(() => !Object.keys(sessionStorage).some((key) => key.startsWith('oem-intake-pending:')))
      );
      attempt.phase = 'read-back-verified';
      await persist();
      return attempt.result;
    }
    journal.phase = 'new-intake';
    await persist();
    await openWorker();
    await page.getByRole('radio', { name: 'synthetic maintenance bay', exact: true }).check();
    await page.getByRole('textbox', { name: 'Exposure start', exact: true }).fill('2026-01-01');
    await page.getByRole('radio', { name: 'unknown', exact: true }).check();
    await page.getByRole('radio', { name: 'eight hour twa', exact: true }).check();
    await page.getByRole('radio', { name: 'dBA', exact: true }).check();
    await page.getByRole('radio', { name: '8h', exact: true }).check();
    await page.getByRole('radio', { name: 'synthetic personal dosimetry', exact: true }).check();
    await page.getByRole('textbox', { name: 'Assessment date', exact: true }).fill('2026-01-02');
    await page
      .locator('.mantine-Radio-root')
      .filter({ has: page.locator('a[href*="/DocumentReference/"]') })
      .first()
      .getByRole('radio')
      .check();
    await page.getByRole('radio', { name: 'not provided', exact: true }).last().check();
    const initial = await confirmAndVerify({ patient });
    assert.equal(journal.attempts.length, 1);
    const exposureReference = initial.resources.find((resource) => resource.step === 'exposure').reference;
    const exposureId = exposureReference.split('/')[1];
    const measurementReference = initial.resources
      .find((resource) => resource.step === 'measurement')
      .reference.split('/');
    const measurement = await auditor.readVersion('Observation', measurementReference[1], measurementReference[3]);
    assert.equal(measurement.valueQuantity?.value, undefined);
    journal.phase = 'amendment';
    await persist();
    await openWorker();
    await page.getByRole('textbox', { name: 'Exposure episode', exact: true }).click();
    await page.getByRole('option', { name: `2026-01-01 / ${exposureId}`, exact: true }).click();
    await page.getByRole('textbox', { name: 'Amendment reason', exact: true }).click();
    await page.getByRole('option', { name: 'Correct worksite', exact: true }).click();
    await page.getByRole('radio', { name: 'synthetic training range', exact: true }).check();
    await page.getByRole('radio', { name: 'not provided', exact: true }).first().check();
    await page.getByRole('radio', { name: 'not provided', exact: true }).last().check();
    const amended = await confirmAndVerify({ patient, exposure: exposureReference });
    assert.equal(journal.attempts.length, 2);
    const current = await client.readResource('Observation', exposureId, { cache: 'no-cache' });
    assert.equal(
      current.extension.find((extension) => extension.url.endsWith('/synthetic-worksite')).valueCode,
      'synthetic-training-range'
    );
    assert.notEqual(current.meta.versionId, exposureReference.split('/')[3]);
    assert.equal(
      `Observation/${current.id}/_history/${current.meta.versionId}`,
      amended.resources.find((resource) => resource.step === 'exposure').reference
    );
    const after = await snapshot();
    for (const [reference, version] of baseline)
      assert.equal(after.get(reference), version, 'Existing resource changed');
    const expected = new Set(
      journal.attempts
        .flatMap((attempt) => [
          ...attempt.result.resources.map((resource) => resource.reference),
          attempt.result.receipt,
        ])
        .map((reference) => reference.split('/').slice(0, 2).join('/'))
    );
    for (const reference of after.keys())
      assert(baseline.has(reference) || expected.has(reference), 'Unexpected new resource');
    assert.equal(blocked.length, 0);
    assert.equal(errors.length, 0);
    await page.reload();
    await page.getByPlaceholder('Select worker').waitFor();
    assert.equal(journal.attempts.length, 2);
    for (const [name, width, height] of [
      ['desktop', 1440, 1000],
      ['mobile', 390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await openWorker();
      await page.getByRole('textbox', { name: 'Exposure episode', exact: true }).click();
      await page.getByRole('option', { name: `2026-01-01 / ${exposureId}`, exact: true }).click();
      assert(await page.getByRole('radio', { name: 'synthetic training range', exact: true }).isChecked());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const screenshot = path.join(output, `${name}-persisted-amendment.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await chmod(screenshot, 0o600);
    }
    journal.phase = 'verified';
    journal.verifiedAt = new Date().toISOString();
    journal.existingResourcesUnchanged = true;
    journal.ordersCreated = 0;
    journal.runtimeErrors = errors.length;
    await persist();
    console.log(
      'PASS: exactly one browser intake and one version-bound amendment; two completed receipts read back, reload/desktop/mobile verified, existing records unchanged, no clinical orders'
    );
  } catch {
    if (page && journal.phase !== 'sign-in') {
      const screenshot = path.join(output, 'failure.png');
      await page.screenshot({ path: screenshot, fullPage: true });
      await chmod(screenshot, 0o600);
    }
    await persist();
    throw new Error(`Save rehearsal stopped at ${journal.phase}; inspect protected journal before any retry`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(
      error.code === 'EEXIST'
        ? 'Existing save journal: inspect before any further action; no save was retried'
        : error.message
    );
    process.exitCode = 1;
  });
