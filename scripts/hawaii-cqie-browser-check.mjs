import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildHawaiiOnboardingBundle } from './hawaii-cqie-fixtures.mjs';

let phase = 'startup';

export async function buildOperationsPreviewResponse(bundle, resource, denied, fetchOtherReads) {
  assert.equal(bundle.resourceType, 'Bundle');
  assert.equal(bundle.type, 'batch');
  assert(Array.isArray(bundle.entry) && bundle.entry.length > 0);
  const expectedIdentifier = `${resource.identifier[0].system}|${resource.identifier[0].value}`;
  const operational = bundle.entry.map((entry) => {
    assert.equal(entry.request?.method, 'GET', 'Preview only accepts read-only batch entries');
    const url = new URL(entry.request.url, 'https://preview.invalid/fhir/R4/');
    assert.equal(url.origin, 'https://preview.invalid', 'Preview only accepts same-server reads');
    return ['/Basic', '/fhir/R4/Basic'].includes(url.pathname.replace(/\/$/, '')) && url.searchParams.get('identifier') === expectedIdentifier;
  });
  const interceptedReads = operational.filter(Boolean).length;
  if (!interceptedReads) { return undefined; }
  const otherEntries = bundle.entry.filter((_entry, index) => !operational[index]);
  let otherResponses = [];
  if (otherEntries.length) {
    const response = await fetchOtherReads({ ...bundle, entry: otherEntries });
    assert.equal(response.resourceType, 'Bundle');
    assert.equal(response.type, 'batch-response');
    assert.equal(response.entry?.length, otherEntries.length);
    otherResponses = response.entry;
  }
  let otherIndex = 0;
  const entry = operational.map((isOperational) => {
    if (!isOperational) { return otherResponses[otherIndex++]; }
    return { resource: denied ? { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'forbidden' }] } :
      { resourceType: 'Bundle', type: 'searchset', entry: [{ resource }] },
      response: { status: denied ? '403 Forbidden' : '200 OK' } };
  });
  return { body: { resourceType: 'Bundle', type: 'batch-response', entry }, interceptedReads };
}

async function signIn(page, account, projectId, plainUrl) {
  await page.goto(plainUrl ? 'http://127.0.0.1:5172/signin' :
    `http://127.0.0.1:5172/signin?project=${projectId}`);
  phase = 'sign-in-email';
  await page.locator('input[type="email"]').fill(account.email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  phase = 'sign-in-password';
  await page.locator('input[type="password"]').fill(account.password);
  phase = 'sign-in-submit';
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  phase = 'discovery-heading';
  await page.getByRole('heading', { name: 'Hawaii CQIE Provider Portal' }).waitFor();
}

async function main() {
  const auditOnly = process.argv.includes('--audit-only');
  const operationsPreview = process.argv.includes('--operations-preview');
  const operationsLive = process.argv.includes('--operations-live');
  assert(process.argv.slice(2).every((argument) => ['--audit-only', '--operations-preview', '--operations-live'].includes(argument)), 'Unknown browser-check option');
  assert([auditOnly, operationsPreview, operationsLive].filter(Boolean).length <= 1, 'Choose one bounded browser-check mode');
  const { chromium } = await import(process.env.HAWAII_PLAYWRIGHT_MODULE ?? 'playwright');
  const directory = path.resolve('hawaii-cqie.local');
  const manifest = JSON.parse(await readFile(path.join(directory, 'provisioning.json'), 'utf8'));
  assert.equal(manifest.stage, 'preflight-passed', 'Complete live API preflight before browser verification');
  if (operationsLive) {
    const evidence = JSON.parse(await readFile(path.join(directory, 'onboarding-check.json'), 'utf8'));
    assert(evidence.operationsReadSearch && evidence.snapshotUnchanged && evidence.rejectedIdenticalUpdate?.status === 403,
      'Complete live onboarding API verification before browser verification');
    assert.equal(evidence.snapshotId, manifest.onboarding?.snapshotId);
    assert.equal(evidence.versionId, manifest.onboarding.snapshotVersion);
  }
  const screenshots = path.join(directory, 'screenshots');
  await mkdir(screenshots, { recursive: true, mode: 0o700 });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  try {
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const errors = [];
      const fhirWrites = [];
      let cuiServiceUnavailable = false;
      page.on('pageerror', () => errors.push('JavaScript runtime error'));
      page.on('response', (response) => {
        if (response.url().includes('/api/cui-banner') && response.status() >= 400) { cuiServiceUnavailable = true; }
      });
      const trackFhirWrites = (request) => {
        const pathname = new URL(request.url()).pathname;
        if (!/\/fhir\/R4(?:\/|$)/.test(pathname) || ['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { return; }
        if (/\/fhir\/R4\/?$/.test(pathname) && request.method() === 'POST') {
          try {
            const bundle = request.postDataJSON();
            if (bundle.resourceType === 'Bundle' && bundle.type === 'batch' && bundle.entry?.length &&
              bundle.entry.every((entry) => ['GET', 'HEAD'].includes(entry.request?.method))) { return; }
          } catch { }
        }
        fhirWrites.push(request.method());
      };
      page.on('request', trackFhirWrites);
      await signIn(page, operationsLive ? manifest.onboarding.account : auditOnly ? manifest.accounts.reviewer : manifest.accounts.clinician,
        manifest.projectId, name === 'desktop');
      if (operationsLive) {
        let operationalReads = 0;
        page.on('request', (request) => {
          const url = new URL(request.url());
          if (!/\/fhir\/R4(?:\/|$)/.test(url.pathname)) { return; }
          let reads = [{ method: request.method(), url: request.url() }];
          if (request.method() === 'POST' && /\/fhir\/R4\/?$/.test(url.pathname)) {
            try { reads = request.postDataJSON().entry.map((entry) => entry.request); } catch { return; }
          }
          operationalReads += reads.filter((read) => {
            const target = new URL(read.url, 'https://preview.invalid/fhir/R4/');
            return read.method === 'GET' && ['/Basic', '/fhir/R4/Basic'].includes(target.pathname.replace(/\/$/, '')) &&
              target.searchParams.get('identifier') === 'https://hiivehealth.com/fhir/identifier/hawaii-cqie-onboarding|synthetic-rural-site';
          }).length;
        });
        phase = 'operations-live-persisted-evidence';
        await page.goto('http://127.0.0.1:5172/hie/operations');
        await page.getByRole('heading', { name: 'Demo Hawaii Rural Hospital' }).waitFor();
        await page.getByText(`Source: Basic/${manifest.onboarding.snapshotId} · Version ${manifest.onboarding.snapshotVersion}`, { exact: true }).waitFor();
        await page.getByText('50.0%', { exact: true }).waitFor();
        assert(await page.getByText('Not ready for cutover', { exact: true }).isVisible());
        assert.equal(await page.locator('ol li').count(), 6);
        assert(await page.getByText('VAL-001', { exact: true }).isVisible());
        assert(await page.getByText('TA-001 · mapping review', { exact: true }).isVisible());
        const initialReads = operationalReads;
        phase = 'operations-live-refresh';
        await page.getByRole('button', { name: 'Refresh operational evidence' }).click();
        await page.getByLabel('Loading operational evidence', { exact: true }).waitFor({ state: 'hidden' });
        await page.getByText('50.0%', { exact: true }).waitFor();
        assert(operationalReads > initialReads, 'Refresh must fetch live evidence');
        const refreshedReads = operationalReads;
        phase = 'operations-live-reload';
        await page.reload();
        await page.getByText('50.0%', { exact: true }).waitFor();
        await page.getByText(`Source: Basic/${manifest.onboarding.snapshotId} · Version ${manifest.onboarding.snapshotVersion}`, { exact: true }).waitFor();
        assert(operationalReads > refreshedReads, 'Reload must fetch persisted evidence');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Live operations must fit the viewport');
        await page.mouse.move(0, 0);
        await page.getByRole('tooltip').waitFor({ state: 'hidden' });
        await page.screenshot({ path: path.join(screenshots, `${name}-operations-live.png`), fullPage: true });
        phase = 'operations-live-clinical-denial';
        await page.goto(`http://127.0.0.1:5172/hie/patients/${manifest.allowedPatientId}`);
        await page.getByText('Record unavailable', { exact: true }).waitFor();
        phase = 'operations-live-audit-denial';
        await page.goto('http://127.0.0.1:5172/hie/audit');
        await page.getByText('Activity unavailable', { exact: true }).waitFor();
        await context.close();
        const clinicianContext = await browser.newContext({ viewport: { width, height } });
        const clinicianPage = await clinicianContext.newPage();
        clinicianPage.on('pageerror', () => errors.push('JavaScript runtime error'));
        clinicianPage.on('request', trackFhirWrites);
        await signIn(clinicianPage, manifest.accounts.clinician, manifest.projectId, false);
        phase = 'clinician-live-operations-denial';
        await clinicianPage.goto('http://127.0.0.1:5172/hie/operations');
        await clinicianPage.getByText(/^(Operational evidence unavailable|No operational evidence available)$/).waitFor();
        assert.equal(await clinicianPage.getByText('50.0%', { exact: true }).count(), 0);
        assert.equal(errors.length, 0, 'Unexpected browser runtime error');
        assert.equal(fhirWrites.length, 0, 'Live operations browser verification must not write FHIR resources');
        results.push({ viewport: name, evidenceLevel: 'live-persisted-operational-snapshot', snapshotId: manifest.onboarding.snapshotId,
          versionId: manifest.onboarding.snapshotVersion, sixStages: true, unresolvedValidationBlocksReadiness: true,
          reconciledAcceptancePercent: 50, operationalReads, refreshAndReloadPersistence: true, operationsClinicalDenied: true,
          operationsAuditDenied: true, clinicianOperationalEvidenceDenied: true, viewportFits: true,
          fhirWrites: 0, javascriptErrors: 0, cuiServiceUnavailable });
        await clinicianContext.close();
        continue;
      }
      if (operationsPreview) {
        phase = 'operations-live-evidence-unavailable';
        await page.goto('http://127.0.0.1:5172/hie/operations');
        await page.getByText(/^(Operational evidence unavailable|No operational evidence available)$/).waitFor();
        assert.equal(await page.getByText('50.0%', { exact: true }).count(), 0, 'Live missing access/data must not fall back to a fixture');
        let denied = false;
        let interceptedReads = 0;
        const interceptionErrors = [];
        const resource = { ...buildHawaiiOnboardingBundle().entry[0].resource, id: 'synthetic-preview-snapshot', meta: { versionId: 'preview-only' } };
        await page.route((url) => /^\/fhir\/R4(?:\/Basic)?\/?$/.test(url.pathname), async (route) => {
          try {
          const request = route.request();
          const batched = request.method() === 'POST';
          if (batched) {
            const preview = await buildOperationsPreviewResponse(request.postDataJSON(), resource, denied, async (bundle) => {
              const response = await route.fetch({ postData: JSON.stringify(bundle) });
              assert.equal(response.status(), 200);
              return response.json();
            });
            if (!preview) { await route.continue(); return; }
            interceptedReads += preview.interceptedReads;
            await route.fulfill({ status: 200, contentType: 'application/fhir+json', body: JSON.stringify(preview.body) });
            return;
          }
          assert.equal(request.method(), 'GET', 'Preview must not write operational data');
          const queryUrl = new URL(request.url());
          assert.equal(queryUrl.pathname.replace(/\/$/, ''), '/fhir/R4/Basic');
          const query = queryUrl.searchParams;
          assert.equal(query.get('identifier'), `${resource.identifier[0].system}|${resource.identifier[0].value}`);
          interceptedReads++;
          const body = denied ? { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'forbidden' }] } :
            { resourceType: 'Bundle', type: 'searchset', entry: [{ resource }] };
          await route.fulfill({ status: denied ? 403 : 200, contentType: 'application/fhir+json', body: JSON.stringify(body) });
          } catch {
            interceptionErrors.push('Preview interception failed');
            await route.abort();
          }
        });
        phase = 'operations-intercepted-synthetic-preview';
        await page.reload();
        await page.getByRole('heading', { name: 'Demo Hawaii Rural Hospital' }).waitFor();
        phase = 'operations-preview-metrics';
        await page.getByText('50.0%', { exact: true }).waitFor();
        assert(await page.getByText('Not ready for cutover', { exact: true }).isVisible());
        assert(await page.getByText('VAL-001', { exact: true }).isVisible());
        assert.equal(await page.locator('ol li').count(), 6, 'All six onboarding stages must render');
        const initialReads = interceptedReads;
        phase = 'operations-preview-refresh';
        await page.getByRole('button', { name: 'Refresh operational evidence' }).click();
        await page.getByLabel('Loading operational evidence', { exact: true }).waitFor({ state: 'hidden' });
        await page.getByText('50.0%', { exact: true }).waitFor();
        assert(interceptedReads > initialReads, 'Refresh must reread evidence');
        const refreshedReads = interceptedReads;
        phase = 'operations-preview-reload';
        await page.reload();
        await page.getByText('50.0%', { exact: true }).waitFor();
        assert(interceptedReads > refreshedReads, 'Reload must reread evidence');
        phase = 'operations-preview-screenshot';
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Operations preview must fit the viewport');
        await page.mouse.move(0, 0);
        await page.getByRole('tooltip').waitFor({ state: 'hidden' });
        await page.screenshot({ path: path.join(screenshots, `${name}-operations-fixture-preview.png`), fullPage: true });
        phase = 'operations-refresh-denial';
        denied = true;
        await page.getByRole('button', { name: 'Refresh operational evidence' }).click();
        await page.getByText('Operational evidence unavailable', { exact: true }).waitFor();
        assert.equal(await page.getByText('50.0%', { exact: true }).count(), 0, 'Refresh denial must clear stale metrics');
        assert.equal(errors.length, 0, 'Unexpected browser runtime error');
        assert.equal(interceptionErrors.length, 0, 'Preview interception must complete without errors');
        assert.equal(fhirWrites.length, 0, 'Operations preview must not write FHIR data or consume follow-up tasks');
        results.push({ viewport: name, evidenceLevel: 'intercepted-synthetic-preview-not-live-persistence',
          liveClinicianOperationalEvidenceUnavailable: true, sixStages: true, unresolvedValidationBlocksReadiness: true,
          reconciledAcceptancePercent: 50, interceptedReads, refreshDenialClearsEvidence: true,
          viewportFits: true, fhirWrites: 0, javascriptErrors: 0, cuiServiceUnavailable });
        await context.close();
        continue;
      }
      if (auditOnly) {
        phase = 'reviewer-audit-records';
        await page.goto('http://127.0.0.1:5172/hie/audit');
        await page.getByText(/^Audit ID:/).first().waitFor();
        assert(await page.getByText(/^Actor:/).first().isVisible(), 'Stored actor fields must be visible');
        assert(await page.getByText(/^Observer:/).first().isVisible(), 'Recording observer must remain separate from actor');
        assert(await page.getByText('Recorded resources', { exact: true }).first().isVisible(), 'Recorded resource fields must be visible');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Audit view must fit the viewport');
        await Promise.all([
          page.waitForResponse((response) => response.url().includes('/AuditEvent') &&
            response.request().method() === 'GET' && response.status() === 200),
          page.getByRole('button', { name: 'Refresh audit activity' }).click(),
        ]);
        await page.getByLabel('Loading activity', { exact: true }).waitFor({ state: 'hidden' });
        await page.getByText(/^Audit ID:/).first().waitFor();
        await page.mouse.move(0, 0);
        await page.getByRole('tooltip').waitFor({ state: 'hidden' });
        await page.screenshot({ path: path.join(screenshots, `${name}-audit.png`) });
        phase = 'reviewer-clinical-denial';
        await page.goto(`http://127.0.0.1:5172/hie/patients/${manifest.allowedPatientId}`);
        await page.getByText('Record unavailable', { exact: true }).waitFor();
        assert.equal(await page.getByRole('heading', { name: 'Shared clinical record' }).count(), 0, 'Reviewer must have no clinical preview');
        await context.close();
        const clinicianContext = await browser.newContext({ viewport: { width, height } });
        const clinicianPage = await clinicianContext.newPage();
        clinicianPage.on('pageerror', () => errors.push('JavaScript runtime error'));
        clinicianPage.on('request', trackFhirWrites);
        await signIn(clinicianPage, manifest.accounts.clinician, manifest.projectId, false);
        phase = 'clinician-audit-denial';
        await clinicianPage.goto('http://127.0.0.1:5172/hie/audit');
        await clinicianPage.getByText('Activity unavailable', { exact: true }).waitFor();
        assert.equal(await clinicianPage.getByText(/^Audit ID:/).count(), 0, 'Clinician must see no audit evidence');
        await clinicianPage.screenshot({ path: path.join(screenshots, `${name}-audit-denied.png`) });
        assert.equal(errors.length, 0, 'Unexpected browser runtime error');
        assert.equal(fhirWrites.length, 0, 'Audit-only browser checks must not write FHIR data or consume follow-up tasks');
        results.push({ viewport: name, reviewerAuditVisible: true, reviewerClinicalDenied: true,
          clinicianAuditDenied: true, viewportFits: true, fhirWrites: 0, javascriptErrors: 0, cuiServiceUnavailable });
        await clinicianContext.close();
        continue;
      }
      await page.getByLabel('Patient', { exact: true }).fill('Synthetic');
      await page.locator('main').getByRole('button', { name: 'Search', exact: true }).click();
      phase = 'directory-results';
      await page.getByRole('link', { name: 'Review record' }).first().waitFor();
      assert.equal(await page.getByRole('link', { name: 'Review record' }).count(), 3, 'All three synthetic directory records must be discoverable');
      await page.screenshot({ path: path.join(screenshots, `${name}-discovery.png`), fullPage: true });
      await page.goto(`http://127.0.0.1:5172/hie/patients/${manifest.allowedPatientId}`);
      phase = 'allowed-record';
      await page.getByRole('heading', { name: 'Shared clinical record' }).waitFor();
      for (const source of ['Demo Hawaii Rural Hospital', 'Demo Hawaii Laboratory', 'Demo Hawaii Community Practice']) {
        assert(await page.getByText(source, { exact: true }).first().isVisible(), 'Expected source attribution');
      }
      assert(await page.locator('tbody tr').count() >= 4, 'Expected the four baseline clinical entries plus any live discharge events');
      await page.getByText('8.1 %', { exact: true }).waitFor();
      const times = await page.locator('tbody tr').evaluateAll((rows) => rows.map((row) => Date.parse(row.getAttribute('data-record-time') ?? '')));
      assert(times.every((time, index) => Number.isFinite(time) && (index === 0 || times[index - 1] >= time)), 'Clinical entries must be newest first');
      assert((await page.locator('tbody tr').last().innerText()).includes('2020'), 'Historical condition must follow recent entries');
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      assert(fits, 'Page must not overflow the viewport');
      await page.screenshot({ path: path.join(screenshots, `${name}-record.png`), fullPage: true });
      phase = 'document-review';
      await page.getByRole('button', { name: 'View Synthetic discharge summary', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText('SYNTHETIC DEMO ONLY. Discharged home; reconcile medications and arrange primary care follow-up.', { exact: true }).waitFor();
      assert(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth), 'Document must fit its container');
      await page.screenshot({ path: path.join(screenshots, `${name}-document.png`), fullPage: true });
      await page.getByRole('button', { name: 'Close document', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      for (const patientId of manifest.deniedPatientIds) {
        phase = 'denied-record';
        await page.goto(`http://127.0.0.1:5172/hie/patients/${patientId}`);
        await page.getByText('Record unavailable', { exact: true }).waitFor();
        assert.equal(await page.locator('tbody tr').count(), 0, 'Denied patient must have no clinical rows');
      }
      await page.screenshot({ path: path.join(screenshots, `${name}-denied.png`), fullPage: true });
      let followUpWorkflow = false;
      if (manifest.followUp?.latestEncounterId) {
        phase = 'follow-up-worklist';
        await page.goto('http://127.0.0.1:5172/hie/follow-up');
        const work = page.getByRole('region', { name: `Follow-up for Encounter/${manifest.followUp.latestEncounterId}`, exact: true });
        await work.getByText('Post-discharge follow-up', { exact: true }).waitFor();
        if (await work.getByRole('button', { name: 'Start follow-up', exact: true }).count()) {
          phase = 'start-follow-up';
          await work.getByRole('button', { name: 'Start follow-up', exact: true }).click();
          await work.getByText('In progress', { exact: true }).waitFor();
          await page.reload();
          await work.getByText('In progress', { exact: true }).waitFor();
        }
        if (await work.getByRole('button', { name: 'Complete follow-up', exact: true }).count()) {
          phase = 'complete-follow-up';
          await work.getByRole('button', { name: 'Complete follow-up', exact: true }).click();
        }
        phase = 'completed-follow-up-persistence';
        await work.getByText('completed', { exact: true }).waitFor();
        await page.reload();
        await work.getByText('completed', { exact: true }).waitFor();
        assert(await work.getByText(/^Discharged:/).isVisible(), 'Source event time must be shown');
        assert(await work.getByText(/^Received:/).isVisible(), 'Task receipt time must be shown');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Worklist must fit its viewport');
        await page.screenshot({ path: path.join(screenshots, `${name}-follow-up.png`), fullPage: true });
        await work.getByRole('link', { name: 'Source discharge', exact: true }).click();
        await page.locator(`#Encounter-${manifest.followUp.latestEncounterId}`).waitFor();
        followUpWorkflow = true;
      }
      assert.equal(errors.length, 0, 'Unexpected browser runtime error');
      results.push({ viewport: name, discovery: true, sourceAttributedRecord: true, chronologicalEntries: true,
        clinicalValue: true, documentReview: true, followUpWorkflow, deniedScenarios: 2, viewportFits: fits,
        javascriptErrors: errors.length, cuiServiceUnavailable });
      await context.close();
    }
    await writeFile(path.join(directory, operationsLive ? 'onboarding-browser-check.json' : operationsPreview ? 'operations-preview-browser-check.json' : auditOnly ? 'audit-browser-check.json' : 'browser-check.json'), JSON.stringify(results, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ passed: true, results, screenshotDirectory: screenshots }));
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const summary = error?.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : error?.name ?? 'Browser check error';
    console.error(`BROWSER_CHECK_FAILED: ${summary} at ${phase}. No credentials or full browser traces are printed.`);
    process.exitCode = 1;
  });
}