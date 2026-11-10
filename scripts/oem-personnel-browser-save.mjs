import { parse } from 'graphql';
import assert from 'node:assert/strict';
import { chmod, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { permitsReadOnlyFhir } from './oem-browser-check.mjs';

const project = '33e151fc-3e91-4df9-8093-106107f7e2f1';
const api = 'https://api.ehr.hiivehealth.net';
const origin = 'http://127.0.0.1:5172';
const previewBot = 'f164d473-0d95-486e-9743-140ced50ae57';
const saveBot = '910708cd-76af-4be7-9b5f-ea686f1a1e87';

export function permitsReadOnlyGraphql(method, url, body) {
  if (
    method !== 'POST' ||
    url !== `${api}/fhir/R4/$graphql` ||
    !body ||
    typeof body.query !== 'string' ||
    body.query.length > 100000 ||
    Object.keys(body).some((key) => !['query', 'variables', 'operationName'].includes(key))
  )
    return false;
  try {
    const document = parse(body.query);
    const operations = document.definitions.filter((definition) => definition.kind === 'OperationDefinition');
    return (
      operations.length === 1 &&
      operations[0].operation === 'query' &&
      (!body.operationName || body.operationName === operations[0].name?.value) &&
      document.definitions.every((definition) =>
        ['OperationDefinition', 'FragmentDefinition'].includes(definition.kind)
      )
    );
  } catch {
    return false;
  }
}

export function permitsPersonnelBrowserSave(method, url, body, expected) {
  return (
    method === 'POST' &&
    url === `${api}/fhir/R4/Bot/${saveBot}/$execute` &&
    expected &&
    body?.mode === 'save' &&
    body.patient === 'Patient/f8be7ab5-b799-4345-baba-2ba675122b13' &&
    body.submissionId === expected.submissionId &&
    /^[a-f0-9-]{36}$/i.test(body.submissionId) &&
    Object.keys(body).sort().join('|') === 'mode|patient|response|submissionId' &&
    JSON.stringify(body.response) === JSON.stringify(expected.response)
  );
}

async function reconcile(directory, state) {
  const journalPath = path.join(directory, 'personnel-browser-save.json');
  const originalJournal = await readFile(journalPath, 'utf8');
  const journal = JSON.parse(originalJournal);
  const result = journal.result;
  assert.equal(journal.saveRequests, 1);
  assert.equal(result?.status, 'completed');
  assert.equal(result.submissionId, journal.request?.submissionId);
  assert.equal(result.submissionId, '1a21167f-23d5-483d-8080-f4b6db4264fe');
  assert.equal(result.resources?.length, 3);
  const originalState = await readFile(path.join(directory, 'state.json'), 'utf8');
  const playwright = await import(process.env.OEM_PLAYWRIGHT_MODULE ?? 'playwright');
  const browser = await (playwright.default ?? playwright).chromium.launch({ channel: 'chrome', headless: true });
  const blocked = [];
  const errors = [];
  const versionViews = [];
  let authenticated = false;
  let checkpoint = 'authentication';
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    page.on('pageerror', () => errors.push('Browser runtime error'));
    await context.route(`${api}/fhir/R4**`, async (route) => {
      const request = route.request();
      let body;
      try {
        body = request.postDataJSON();
      } catch {
        body = undefined;
      }
      if (
        permitsReadOnlyGraphql(request.method(), request.url(), body) ||
        (permitsReadOnlyFhir(request.method(), request.url(), body) &&
          !new URL(request.url()).pathname.includes('/Bot/'))
      )
        return route.continue();
      blocked.push({ method: request.method(), path: new URL(request.url()).pathname });
      return route.abort('blockedbyclient');
    });
    await page.goto(`${origin}/signin?project=${project}`);
    await page.locator('input[type="email"]').fill(state.accounts.clinician.email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('input[type="password"]').fill(state.accounts.clinician.password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.getByRole('button', { name: 'User menu' }).waitFor();
    authenticated = true;
    for (const [name, width, height] of [
      ['desktop', 1440, 1000],
      ['mobile', 390, 844],
    ]) {
      checkpoint = `${name}:personnel-history`;
      await page.setViewportSize({ width, height });
      await page.goto(`${origin}/oem/personnel`);
      const history = page.getByRole('region', { name: 'Verified personnel history', exact: true });
      await history.getByText(`Receipt: ${result.receipt}`, { exact: true }).waitFor();
      for (const item of result.resources) {
        await history.getByText(`${item.step}: ${item.reference}`, { exact: true }).waitFor();
      }
      assert.equal(await page.getByRole('alert', { name: 'History Unverified' }).count(), 0);
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Saved history horizontal overflow'
      );
      const screenshot = path.join(directory, `personnel-browser-reconciled-${name}.png`);
      await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
      await chmod(screenshot, 0o600);
      const originalVersion =
        'Observation/997bd337-8bce-4f9d-b5ba-167dced16fbc/_history/ba7d5e1c-f3af-4569-a771-42c16981fc0b';
      for (const reference of [result.receipt, ...result.resources.map((item) => item.reference), originalVersion]) {
        checkpoint = `${name}:version:${reference.split('/')[0]}:${reference === originalVersion ? 'original-link' : 'saved-artifact'}`;
        await page.goto(`${origin}/${reference}`);
        await page.getByRole('heading', { name: 'Resource version', exact: true }).waitFor();
        await page.getByText(reference, { exact: true }).waitFor();
        await page.getByLabel('Loading resource version').waitFor({ state: 'hidden' });
        const unavailable = await page.getByRole('alert', { name: 'Version unavailable' }).count();
        if (reference !== originalVersion) assert.equal(unavailable, 0, 'Saved version must remain readable');
        if (!unavailable) {
          await page.locator('[data-version-content]').waitFor();
          assert(
            (await page.locator('[data-version-content]').innerText()).length > 50,
            'Version body must not be blank'
          );
        }
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          'Version view horizontal overflow'
        );
        versionViews.push({
          viewport: name,
          resourceType: reference.split('/')[0],
          originalReportedLink: reference === originalVersion,
          status: unavailable ? 'unavailable' : 'verified',
        });
        if (reference === originalVersion) {
          const versionScreenshot = path.join(directory, `personnel-version-view-${name}.png`);
          await page.screenshot({ path: versionScreenshot, fullPage: true, animations: 'disabled' });
          await chmod(versionScreenshot, 0o600);
        }
      }
    }
    assert.equal(blocked.length, 0);
    assert.equal(errors.length, 0);
    assert.equal(await readFile(journalPath, 'utf8'), originalJournal);
    assert.equal(await readFile(path.join(directory, 'state.json'), 'utf8'), originalState);
    const report = {
      status: 'PASS',
      submissionId: result.submissionId,
      existingReceiptVerified: true,
      exactArtifactsVerified: 3,
      desktopAndMobile: true,
      newSaveRequests: 0,
      botInvocations: 0,
      protectedJournalUnchanged: true,
      runtimeErrors: errors.length,
      blockedWrites: blocked.length,
      versionViews,
      activated: false,
    };
    await writeFile(path.join(directory, 'personnel-browser-reconciliation.json'), JSON.stringify(report, null, 2), {
      mode: 0o600,
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (authenticated) {
      const screenshot = path.join(directory, 'personnel-browser-reconciliation-failure.png');
      await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
      await chmod(screenshot, 0o600);
      const known = [
        'Version view horizontal overflow',
        'Saved version must remain readable',
        'Saved history horizontal overflow',
      ];
      console.error(
        JSON.stringify({
          checkpoint,
          errorKind: error.name,
          reason: known.find((message) => error.message.includes(message)) ?? 'Read-only check did not complete',
          blockedRequests: blocked,
          completedVersionViews: versionViews,
        })
      );
    }
    throw new Error(
      authenticated
        ? 'Read-only personnel reconciliation failed; no Save was submitted.'
        : 'Authentication failed; details suppressed.'
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  assert(
    process.argv.length === 3 && ['--apply', '--reconcile'].includes(process.argv[2]),
    'Use --apply for one synthetic Save or --reconcile for existing-submission reads only'
  );
  const directory =
    process.env.OEM_STATE_DIRECTORY ??
    path.resolve(import.meta.dirname, '../../medplum-ubix-army-oem/examples/medplum-demo-bots/src/army-oem/oem.local');
  const original = await readFile(path.join(directory, 'state.json'), 'utf8');
  const state = JSON.parse(original);
  assert(
    state.projectId === project && state.operatorDisabled && !state.pending && state.personnelSave?.nativeVerifiedAt
  );
  assert.equal(state.personnelSave.botId, saveBot);
  if (process.argv[2] === '--reconcile') return reconcile(directory, state);
  const { administrator } = await import(pathToFileURL(path.join(directory, '..', 'provision.mjs')).href);
  const { personnelVersions, personnelProtectedDigests } = await import(
    pathToFileURL(path.join(directory, '..', 'personnel-preview-live.mjs')).href
  );
  const admin = await administrator();
  const before = await personnelVersions(admin, state);
  const protectedBefore = await personnelProtectedDigests();
  const journalPath = path.join(directory, 'personnel-browser-save.json');
  const lock = await open(path.join(directory, 'personnel-browser-save.lock'), 'wx', 0o600);
  const journal = {
    stage: 'locked',
    projectId: project,
    at: new Date().toISOString(),
    before,
    protectedBefore,
    saveRequests: 0,
  };
  await lock.writeFile(JSON.stringify({ projectId: project, scope: 'one-synthetic-browser-personnel-attestation' }));
  await lock.close();
  const record = () => writeFile(journalPath, JSON.stringify(journal, null, 2), { mode: 0o600 });
  await record();
  const playwright = await import(process.env.OEM_PLAYWRIGHT_MODULE ?? 'playwright');
  const browser = await (playwright.default ?? playwright).chromium.launch({ channel: 'chrome', headless: true });
  let phase = 'sign-in';
  let expected;
  let saveCalls = 0;
  const blocked = [];
  const errors = [];
  const cuiStatuses = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', () => errors.push('Browser runtime error'));
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/cui-banner') cuiStatuses.push(response.status());
  });
  await context.route(`${api}/fhir/R4**`, async (route) => {
    const request = route.request();
    let body;
    try {
      body = request.postDataJSON();
    } catch {
      body = undefined;
    }
    if (permitsReadOnlyFhir(request.method(), request.url(), body)) return route.continue();
    if (
      phase === 'confirm-save' &&
      saveCalls === 0 &&
      permitsPersonnelBrowserSave(request.method(), request.url(), body, expected)
    ) {
      saveCalls++;
      journal.stage = 'request-pending';
      journal.saveRequests = saveCalls;
      journal.request = body;
      await record();
      return route.continue();
    }
    blocked.push({ method: request.method(), path: new URL(request.url()).pathname });
    return route.abort('blockedbyclient');
  });
  try {
    await page.goto(`${origin}/signin?project=${project}`);
    await page.locator('input[type="email"]').fill(state.accounts.clinician.email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('input[type="password"]').fill(state.accounts.clinician.password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.getByRole('button', { name: 'User menu' }).waitFor();
    phase = 'preview';
    await page.goto(`${origin}/oem/personnel`);
    const history = page.getByRole('region', { name: 'Verified personnel history', exact: true });
    await history.getByText('population: military', { exact: true }).first().waitFor();
    await page.getByRole('radio', { name: 'population', exact: true }).check();
    await page.getByRole('radio', { name: 'military', exact: true }).check();
    await page
      .locator('.mantine-Radio-root')
      .filter({ has: page.locator('a[href*="/DocumentReference/"]') })
      .first()
      .getByRole('radio')
      .check();
    await page.getByRole('radio', { name: 'synthetic clinician attestation', exact: true }).check();
    const previewResponse = page.waitForResponse(
      (response) => response.url() === `${api}/fhir/R4/Bot/${previewBot}/$execute`
    );
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const preview = await previewResponse;
    assert.equal(preview.status(), 200);
    expected = preview.request().postDataJSON();
    await page.getByText('Not Saved', { exact: true }).waitFor();
    journal.stage = 'previewed';
    journal.submissionId = expected.submissionId;
    await record();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm Personnel Save', exact: true });
    await dialog.waitFor();
    phase = 'confirm-save';
    const responsePending = page.waitForResponse(
      (response) => response.url() === `${api}/fhir/R4/Bot/${saveBot}/$execute`
    );
    await dialog.getByRole('button', { name: 'Confirm Save', exact: true }).click();
    const response = await responsePending;
    assert.equal(response.status(), 200);
    const result = await response.json();
    journal.result = result;
    await record();
    assert.equal(result.status, 'completed');
    assert.equal(result.submissionId, expected.submissionId);
    await page
      .getByRole('region', { name: 'Saved personnel attestation', exact: true })
      .getByText('Saved', { exact: true })
      .waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('army-oem-personnel-save-v1')), null);
    phase = 'reload-and-mobile-readback';
    for (const [name, width, height] of [
      ['desktop', 1440, 1000],
      ['mobile', 390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.reload();
      for (const item of result.resources)
        await history.getByText(`${item.step}: ${item.reference}`, { exact: true }).waitFor();
      await history.getByText(`Receipt: ${result.receipt}`, { exact: true }).waitFor();
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Saved history horizontal overflow'
      );
      const screenshot = path.join(directory, `personnel-browser-save-${name}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await chmod(screenshot, 0o600);
    }
    const after = await personnelVersions(admin, state);
    for (const type of Object.keys(before)) {
      const added = [...result.resources.map((item) => item.reference), result.receipt].filter((reference) =>
        reference.startsWith(`${type}/`)
      );
      assert.deepEqual(
        after[type].filter((reference) => !added.includes(reference)),
        before[type],
        `${type} changed outside one browser submission`
      );
      assert.equal(after[type].length - before[type].length, added.length);
    }
    assert.deepEqual(await personnelProtectedDigests(), protectedBefore);
    assert.equal(await readFile(path.join(directory, 'state.json'), 'utf8'), original);
    assert.equal(saveCalls, 1);
    assert.equal(blocked.length, 0);
    assert.equal(errors.length, 0);
    journal.stage = 'verified';
    journal.verifiedAt = new Date().toISOString();
    journal.desktopAndMobileReloadVerified = true;
    journal.cuiServiceAvailable = cuiStatuses.length > 0 && cuiStatuses.every((code) => code === 200);
    await record();
    console.log(
      JSON.stringify(
        {
          status: 'PASS',
          syntheticBrowserAttestations: 1,
          saveRequests: saveCalls,
          receipt: result.receipt,
          resources: result.resources,
          persistedReadbackAndReload: true,
          originalResourcesUnchanged: true,
          desktopAndMobile: true,
          runtimeErrors: errors.length,
          blockedWrites: blocked.length,
          cuiServiceAvailable: journal.cuiServiceAvailable,
          activated: false,
          externalOrders: 0,
        },
        null,
        2
      )
    );
  } catch (error) {
    journal.failure = {
      phase,
      kind: error.name,
      message: phase === 'sign-in' ? 'Authentication detail suppressed' : error.message,
    };
    await record();
    if (phase !== 'sign-in') {
      const screenshot = path.join(directory, 'personnel-browser-save-failure.png');
      await page.screenshot({ path: screenshot, fullPage: true });
      await chmod(screenshot, 0o600);
    }
    throw new Error(`Personnel browser Save stopped at ${phase}; journal retained; no automatic replay.`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
