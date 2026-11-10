import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const projectId = '33e151fc-3e91-4df9-8093-106107f7e2f1';
const previewBotId = 'd92817e9-c540-410a-b92e-73cd92a78876';
const noisePreviewBotId = '58eb84c1-5d92-4e0f-b476-b300c240abca';
const personnelPreviewBotId = 'f164d473-0d95-486e-9743-140ced50ae57';
const lifecycleBotId = '15f69821-6267-4911-b255-e7460b395ec3';
const decisionBotId = 'e198aa1a-31c8-4316-b8f4-e14f0214bc33';
const completionPreviewBotId = 'c0ce6818-1d5e-4e38-a086-80a1a218b6aa';
const completionSaveBotId = 'd9af955e-eeba-489f-a4cc-13b8e088e1dc';
const nativeReportBotId = 'debacf60-927e-4d92-9603-5bd2b45b0e5c';
const cohortReportBotId = 'c6b0f60a-0e14-4cfe-8488-c62ff905a537';
const completionReportBotId = '7ce499ba-7b76-4ba2-92c1-6b115c507a87';
const nativeHistoryBotId = '071345cf-dbcb-44f5-b152-cb403326f397';
const evidenceHistoryBotId = 'e4623052-26bd-49d1-83de-5e00afa70cff';
const lineageHistoryBotId = 'd62fce54-6582-4cd3-8feb-d6889f717d70';
const recordedTimeBotId = 'bdbdcf1c-8c70-453d-ad9e-c18721cd33ba';
const ruleHistoryBotId = 'b22601ef-7972-4d1e-a1a5-1d7f591584b7';
const matrixHistoryBotId = '416a2192-7e77-4c24-92be-425ec077432e';
const matrixPdfBotId = 'ca2e981d-6b7a-4580-affc-02d9218e1703';
const api = 'https://api.ehr.hiivehealth.net';
const origin = 'http://127.0.0.1:5172';
const requireCui = process.env.OEM_REQUIRE_CUI === '1';
const requireNoDoseSpot = process.env.OEM_REQUIRE_NO_DOSESPOT === '1';

export function readOnlyRehearsalMode(args) {
  assert(Array.isArray(args) && args.length === 1 && ['--read-only', '--accepted-read-only', '--completion-read-only',
    '--saved-completion-read-only', '--report-read-only', '--cohort-report-read-only', '--completion-report-read-only',
    '--rule-review-read-only', '--personnel-read-only', '--presenter-read-only'].includes(args[0]), 'Use an explicit read-only rehearsal mode');
  const presenterOnly = args[0] === '--presenter-read-only';
  return { presenterOnly, examplesOnly: presenterOnly || args[0] === '--completion-report-read-only', technicalDrilldowns: !presenterOnly };
}

export function permitsReadOnlyFhir(method, url, body) {
  const target = new URL(url);
  if (target.origin !== api || !/^\/fhir\/R4(?:\/|$)/.test(target.pathname)) return false;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  if (method !== 'POST') return false;
  if (target.pathname === `/fhir/R4/Bot/${matrixPdfBotId}/$execute`) {
    return target.search === '' && body?.mode === 'verify-pdf' && body.confirmedSynthetic === true &&
      Object.keys(body).sort().join('|') === 'confirmedSynthetic|mode';
  }
  if ([recordedTimeBotId, ruleHistoryBotId, matrixHistoryBotId].some(id => target.pathname === `/fhir/R4/Bot/${id}/$execute`)) {
    return target.search === '' && body?.mode === 'as-of' && body.confirmedSynthetic === true &&
      Object.keys(body).sort().join('|') === 'asOf|confirmedSynthetic|mode' && typeof body.asOf === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.asOf) && Number.isFinite(Date.parse(body.asOf)) && new Date(body.asOf).toISOString() === body.asOf;
  }
  if ([nativeHistoryBotId, evidenceHistoryBotId, lineageHistoryBotId].some(id => target.pathname === `/fhir/R4/Bot/${id}/$execute`)) {
    return target.search === '' && body?.mode === 'history' && body.confirmedSynthetic === true &&
      Object.keys(body).sort().join('|') === 'confirmedSynthetic|mode';
  }
  if ([nativeReportBotId, cohortReportBotId, completionReportBotId].some(id => target.pathname === `/fhir/R4/Bot/${id}/$execute`)) {
    return target.search === '' && body?.mode === 'export' && body.confirmedSynthetic === true &&
      Object.keys(body).sort().join('|') === 'confirmedSynthetic|mode';
  }
  if ([completionPreviewBotId, completionSaveBotId].some(id => target.pathname === `/fhir/R4/Bot/${id}/$execute`)) {
    return target.search === '' && body?.mode === 'preview' && body.confirmedSimulation === true &&
      Object.keys(body).sort().join('|') === 'confirmedSimulation|mode';
  }
  if (target.pathname === `/fhir/R4/Bot/${decisionBotId}/$execute`) {
    return target.search === '' && body?.mode === 'preview' &&
      body.task === 'Task/790e5844-e7f4-446e-ae9a-f6ead2b1a37b/_history/42fdbec8-c94b-49f4-b1da-8a6ff345c8b9' &&
      Object.keys(body).sort().join('|') === (body.decision === 'modify' ? 'decision|due|mode|reason|task' : 'decision|mode|reason|task') &&
      ((body.decision === 'accept' && body.reason === 'local-proposal-requested') ||
        (body.decision === 'modify' && body.reason === 'timing-adjusted' && /^\d{4}-\d{2}-\d{2}$/.test(body.due ?? '') &&
          Number.isFinite(Date.parse(body.due)) && new Date(body.due).toISOString().slice(0, 10) === body.due) ||
        (body.decision === 'dismiss' && ['evidence-pending', 'already-addressed', 'not-indicated-for-demo'].includes(body.reason)));
  }
  if (target.pathname === `/fhir/R4/Bot/${lifecycleBotId}/$execute`) {
    if (body?.mode === 'collect') {
      return target.search === '' && body.patient === 'Patient/f8be7ab5-b799-4345-baba-2ba675122b13' &&
        body.exposure === 'Observation/baa7efea-26cc-44ee-9d9b-b4351aff9112/_history/305afa94-491a-4838-a4d7-e4abf3bc367f' &&
        Object.keys(body).sort().join('|') === 'exposure|mode|patient';
    }
    return target.search === '' && body?.mode === 'inspect' &&
      body.patient === 'Patient/f8be7ab5-b799-4345-baba-2ba675122b13' &&
      body.exposure === 'Observation/baa7efea-26cc-44ee-9d9b-b4351aff9112/_history/305afa94-491a-4838-a4d7-e4abf3bc367f' &&
      Array.isArray(body.recommendations) && body.recommendations.length === 1 &&
      body.recommendations[0] === 'Task/790e5844-e7f4-446e-ae9a-f6ead2b1a37b/_history/42fdbec8-c94b-49f4-b1da-8a6ff345c8b9' &&
      Array.isArray(body.proposals) && body.proposals.length === 0 &&
      Object.keys(body).sort().join('|') === 'exposure|mode|patient|proposals|recommendations';
  }
  if (target.pathname === `/fhir/R4/Bot/${personnelPreviewBotId}/$execute`) {
    return (
      body?.mode === 'preview' &&
      body.patient === 'Patient/f8be7ab5-b799-4345-baba-2ba675122b13' &&
      /^[a-f0-9-]{36}$/i.test(body.submissionId ?? '') &&
      body.response?.resourceType === 'QuestionnaireResponse' &&
      body.response.status === 'completed' &&
      body.response.questionnaire ===
        'https://hiivehealth.com/fhir/Questionnaire/synthetic-dod-personnel-attestation|draft-1' &&
      body.response.subject?.reference === body.patient &&
      Object.keys(body).sort().join('|') === 'mode|patient|response|submissionId'
    );
  }
  if (target.pathname === `/fhir/R4/Bot/${noisePreviewBotId}/$execute`) {
    const observation = /^Observation\/[A-Za-z0-9.-]+\/_history\/[A-Za-z0-9.-]+$/;
    return (
      body?.mode === 'preview' &&
      /^Patient\/[A-Za-z0-9.-]+$/.test(body.patient ?? '') &&
      observation.test(body.exposure ?? '') &&
      (!body.enrollment || observation.test(body.enrollment)) &&
      (!Object.hasOwn(body, 'completion') ||
        (observation.test(body.completion ?? '') && observation.test(body.enrollment ?? ''))) &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.asOf ?? '') &&
      Object.keys(body).every((key) =>
        ['mode', 'patient', 'exposure', 'enrollment', 'completion', 'asOf'].includes(key)
      )
    );
  }
  if (target.pathname === `/fhir/R4/Bot/${previewBotId}/$execute`) {
    return (
      body?.mode === 'preview' &&
      body.patient?.startsWith('Patient/') &&
      Object.keys(body).every((key) =>
        ['mode', 'patient', 'response', 'submissionId', 'at', 'exposure', 'amendmentReason'].includes(key)
      )
    );
  }
  return (
    /^\/fhir\/R4\/?$/.test(target.pathname) &&
    body?.resourceType === 'Bundle' &&
    body.type === 'batch' &&
    Array.isArray(body.entry) &&
    body.entry.length > 0 &&
    body.entry.every((entry) => {
      if (!['GET', 'HEAD'].includes(entry.request?.method)) return false;
      const nested = new URL(entry.request.url, `${api}/fhir/R4/`);
      const resourcePath = nested.pathname.replace(/^\/fhir\/R4(?=\/|$)/, '');
      return (
        nested.origin === api &&
        /^\/[A-Z][A-Za-z]+(?:\/[A-Za-z0-9.-]+(?:\/_history(?:\/[A-Za-z0-9.-]+)?)?)?\/?$/.test(resourcePath)
      );
    })
  );
}

export function retainedWorkExpectations(accepted, alternatives, conflict, concurrentAccept, repeatAccept) {
  const expected = [{ reference: accepted?.result.task ?? 'Task/790e5844-e7f4-446e-ae9a-f6ead2b1a37b/_history/42fdbec8-c94b-49f4-b1da-8a6ff345c8b9',
    status: accepted ? 'accepted' : 'requested', reviewRequired: false }];
  if (alternatives) {
    assert(accepted && alternatives.stage === 'published' && alternatives.verifiedAt);
    for (const decision of ['modify', 'dismiss']) {
      const saved = alternatives.decisions[decision];
      assert.equal(saved.stage, 'verified'); assert.equal(saved.replay, 'verified-no-extra-versions');
      const task = saved.records.find(resource => resource.resourceType === 'Task' && resource.id === alternatives.plan.fixtures[decision].id);
      assert.equal(task.meta.project, projectId);
      assert.equal(task.status, decision === 'modify' ? 'requested' : 'rejected');
      if (decision === 'modify') assert.equal(task.restriction.period.end, '2027-02-01');
      expected.push({ reference: `Task/${task.id}/_history/${task.meta.versionId}`, status: task.status, reviewRequired: false });
    }
  }
  if (conflict) {
    assert(accepted && alternatives && conflict.stage === 'published' && conflict.verifiedAt);
    assert.equal(conflict.race.stage, 'verified-one-winner');
    const { winner, loser, records, outcomes } = conflict.race;
    assert(['modify', 'dismiss'].includes(winner)); assert.equal(loser, winner === 'modify' ? 'dismiss' : 'modify');
    assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(value => value.status === 'rejected').length, 1);
    assert.equal(outcomes.find(value => value.status === 'fulfilled').decision, winner);
    const task = records.find(resource => resource.resourceType === 'Task' && resource.id === conflict.plan.fixture.id);
    assert.equal(task.meta.project, projectId); assert.equal(task.status, winner === 'modify' ? 'requested' : 'rejected');
    if (winner === 'modify') assert.equal(task.restriction.period.end, '2027-02-01');
    expected.push({ reference: `Task/${task.id}/_history/${task.meta.versionId}`, status: task.status, reviewRequired: false });
  }
  for (const [index, savedAccept] of [concurrentAccept, repeatAccept].entries()) {
    if (!savedAccept) continue;
    assert(accepted && alternatives && conflict && savedAccept.stage === 'published' && savedAccept.verifiedAt);
    if (index === 1) {
      assert(concurrentAccept); assert.equal(savedAccept.run, 'corrected-repeat');
      assert.equal(savedAccept.plan.draftPolicyFormat, 'receipt-tag-v1');
      assert.equal(savedAccept.race.stage, 'verified-single-graph');
      assert(!savedAccept.recovery && !savedAccept.policyCorrection);
    }
    const recovered = savedAccept.race.stage === 'verified-recovered-single-graph';
    assert(recovered || savedAccept.race.stage === 'verified-single-graph');
    const { outcomes, records } = savedAccept.race;
    assert.equal(outcomes.length, 2);
    const successes = outcomes.filter(value => value.status === 'fulfilled');
    const winners = successes.filter(value => value.value.status === 'recorded');
    assert.equal(winners.length, recovered ? 0 : 1);
    if (recovered) {
      assert.equal(successes.length, 0); assert.equal(savedAccept.race.concurrencyProven, false);
      assert.equal(savedAccept.policyCorrection.stage, 'verified-pending-recovery');
      assert.equal(savedAccept.recovery.stage, 'verified-completed-pending-graph');
      assert.equal(outcomes.filter(value => value.reason?.issue?.some(issue => issue.code === 'forbidden')).length, 1);
      assert.equal(outcomes.filter(value => JSON.stringify(value.reason).includes('Concurrent receipt exists; retry the same decision to reconcile')).length, 1);
    }
    const result = recovered ? savedAccept.recovery.result : winners[0].value;
    assert.equal(result.decision, 'accept'); assert.equal(result.persisted, true);
    assert.equal(result.activated, false); assert.equal(result.externalDispatch, false); assert.equal(result.completionRecorded, false);
    for (const success of successes) {
      assert(['recorded', 'replayed'].includes(success.value.status));
      assert.deepEqual({ ...success.value, status: 'replayed' }, { ...result, status: 'replayed' });
    }
    if (savedAccept.recovery) {
      assert.equal(savedAccept.recovery.stage, recovered ? 'verified-completed-pending-graph' : 'verified-no-extra-versions');
      assert.deepEqual({ ...savedAccept.recovery.result, status: 'replayed' }, { ...result, status: 'replayed' });
    }
    const task = records.find(resource => resource.resourceType === 'Task' && resource.id === savedAccept.plan.fixture.id);
    assert.equal(task.meta.project, projectId); assert.equal(task.status, 'accepted');
    const reference = `Task/${task.id}/_history/${task.meta.versionId}`;
    assert.equal(result.task, reference);
    const draft = records.find(resource => resource.resourceType === 'ServiceRequest');
    assert.equal(draft.meta.project, projectId); assert.equal(draft.status, 'draft'); assert.equal(draft.intent, 'proposal');
    assert.equal(result.proposal, `ServiceRequest/${draft.id}/_history/${draft.meta.versionId}`);
    expected.push({ reference, status: task.status, reviewRequired: false });
  }
  assert.equal(new Set(expected.map(value => value.reference.split('/')[1])).size, expected.length);
  return expected;
}

export function retainedDraftExpectations(accepted, concurrentAccept, repeatAccept) {
  const references = accepted ? [accepted.result.proposal] : [];
  for (const savedAccept of [concurrentAccept, repeatAccept]) {
    if (!savedAccept) continue;
    assert(['verified-single-graph', 'verified-recovered-single-graph'].includes(savedAccept.race.stage));
    const draft = savedAccept.race.records.find(resource => resource.resourceType === 'ServiceRequest');
    references.push(`ServiceRequest/${draft.id}/_history/${draft.meta.versionId}`);
  }
  for (const reference of references) assert.match(reference, /^ServiceRequest\/[A-Za-z0-9.-]+\/_history\/[A-Za-z0-9.-]+$/);
  assert.equal(new Set(references.map(reference => reference.split('/')[1])).size, references.length);
  return references.map(reference => ({ reference, status: 'draft', reviewRequired: false }));
}

async function exerciseNativeHistory(page, output, role, viewport, results, evidence = false, lineage = false) {
  const title = lineage ? 'Synthetic technical history' : evidence ? 'Synthetic evidence history' : 'Recorded history';
  const panel = page.getByRole('region', { name: title, exact: true });
  const inspect = panel.getByRole('button', { name: lineage ? 'Inspect synthetic technical history' : evidence ? 'Inspect synthetic evidence history' : 'Inspect recorded history', exact: true });
  const confirmation = panel.getByRole('checkbox', { name: lineage ? 'I confirm this is synthetic technical history' : evidence ? 'I confirm this is synthetic evidence history' : 'I confirm this is a synthetic history', exact: true });
  const url = `${api}/fhir/R4/Bot/${lineage ? lineageHistoryBotId : evidence ? evidenceHistoryBotId : nativeHistoryBotId}/$execute`;
  const requested = 'Task/790e5844-e7f4-446e-ae9a-f6ead2b1a37b/_history/42fdbec8-c94b-49f4-b1da-8a6ff345c8b9';
  const accepted = 'Task/790e5844-e7f4-446e-ae9a-f6ead2b1a37b/_history/f52a02c7-9f50-4c7d-8185-67a1251bca98';
  const draft = 'ServiceRequest/7a148912-2637-4044-b55e-690088ff2d03/_history/29a8212b-e1a9-4621-9dac-95e022c8f7df';
  await panel.waitFor(); assert(await inspect.isDisabled()); assert(!(await confirmation.isChecked()));
  assert.equal(await panel.getByRole('table').count(), 0);
  for (const failureKind of ['transport', 'malformed-envelope', 'mismatched-source-head']) {
    const target = failureKind === 'mismatched-source-head' ? `${api}/fhir/R4/Patient/f8be7ab5-b799-4345-baba-2ba675122b13` : url;
    let interruptedRequests = 0;
    const interrupt = async route => {
      const request = route.request(); interruptedRequests++;
      assert(permitsReadOnlyFhir(request.method(), request.url(), request.method() === 'POST' ? request.postDataJSON() : undefined));
      if (failureKind === 'transport') await route.abort('failed');
      else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(failureKind === 'malformed-envelope' ? {} :
        { resourceType: 'Patient', id: 'f8be7ab5-b799-4345-baba-2ba675122b13', meta: { project: projectId, versionId: 'unverified-history-head' } }) });
    };
    await page.route(target, interrupt);
    try {
      await confirmation.check(); await inspect.click(); await panel.getByText('History unavailable', { exact: true }).waitFor();
      assert.equal(interruptedRequests, 1, 'History failure must not be automatically retried');
      assert.equal(await panel.getByRole('table').count(), 0);
    } finally { await page.unroute(target, interrupt); }
    await confirmation.uncheck(); assert(await inspect.isDisabled());
    results.push({ role, viewport, evidenceHistory: evidence, lineageHistory: lineage, historyUnavailable: 'verified', failureKind, interruptedReadOnlyRequests: interruptedRequests, automaticRetries: 0, clinicalWrites: 0 });
  }
  await confirmation.check(); await inspect.click();
  await panel.getByRole('cell', { name: 'requested', exact: true }).waitFor();
  await panel.getByRole('cell', { name: 'Not recorded', exact: true }).first().waitFor();
  assert.equal(await panel.getByRole('cell', { name: 'Not recorded', exact: true }).count(), lineage ? 10 : evidence ? 4 : 1);
  assert.equal(await panel.getByRole('row').count(), lineage ? 15 : evidence ? 9 : 5);
  assert.equal(await panel.getByRole('link', { name: 'View recommendation history', exact: true }).getAttribute('href'), `/${requested}`);
  assert.equal(await panel.getByRole('link', { name: 'View local proposal history', exact: true }).count(), 0);
  await panel.getByText('Recorded as of 2026-10-21T01:39:00.858Z (UTC)', { exact: true }).waitFor();
  for (const checkpoint of ['before', 'after']) {
    if (checkpoint === 'after') {
      await panel.getByRole('tab', { name: lineage ? 'After synthetic save' : evidence ? 'After synthetic attestation' : 'After acceptance', exact: true }).click();
      await panel.getByRole('cell', { name: 'accepted', exact: true }).waitFor();
      await panel.getByRole('cell', { name: 'draft', exact: true }).waitFor();
      await panel.getByText(`Recorded as of ${lineage ? '2026-10-23T20:06:37.676Z' : evidence ? '2026-10-23T20:06:36.878Z' : '2026-10-23T18:50:42.985Z'} (UTC)`, { exact: true }).waitFor();
      assert.equal(await panel.getByRole('link', { name: 'View recommendation history', exact: true }).getAttribute('href'), `/${accepted}`);
      assert.equal(await panel.getByRole('link', { name: 'View local proposal history', exact: true }).getAttribute('href'), `/${draft}`);
      if (evidence) {
        assert.equal(await panel.getByRole('row').count(), lineage ? 15 : 9); assert.equal(await panel.getByRole('cell', { name: 'Not recorded', exact: true }).count(), 0);
        assert.equal(await panel.getByRole('link', { name: 'View synthetic attestation history', exact: true }).getAttribute('href'), '/Observation/b115ef08-5d4e-497e-9dac-48f4f2e8d99d/_history/f6be80ad-9de3-4205-b7d5-53cff3344adb');
        assert.equal(await panel.getByRole('link', { name: 'View synthetic report history', exact: true }).getAttribute('href'), '/DocumentReference/054e1aa6-6eaa-4776-88ce-92f553a299d8/_history/b2c33455-1e8a-4f19-b895-2caf5aa17de0');
        await panel.getByText('Synthetic performed date: 2026-06-15. Clinical rule approval: unverified.', { exact: true }).waitFor();
      }
      if (lineage) {
        const references = [
          ['Decision receipt', 'Task/0e61be2d-a868-4ce9-ba76-ae1d5a3bd659/_history/a00fd963-0f3a-4443-b51a-09dae9fbbe99'],
          ['Decision audit', 'AuditEvent/cdc5b6c3-ae8f-499a-86d0-a02898983d2c/_history/df6559df-05d6-495f-b2eb-955546f8acd2'],
          ['Decision provenance', 'Provenance/eccfbeea-a955-4652-8cc2-1ffb1ec3efe4/_history/16b1ecb3-2f7d-4603-8b8a-ba163b5a6523'],
          ['Synthetic save receipt', 'Task/577011b1-059d-47b4-83d2-832e016fd358/_history/fc5c7ce5-7691-4c32-af2f-1809512822c3'],
          ['Synthetic save audit', 'AuditEvent/2ee2a9d9-62cd-443c-8090-bbd6853f0fac/_history/00fd39bf-951e-4523-8b40-4309be9c31af'],
          ['Synthetic save provenance', 'Provenance/48424259-02cc-4122-9c39-85b9e2e814dd/_history/40ad8392-e4bd-488d-9908-42a524e02022']];
        for (const [label, reference] of references) {
          assert.equal(await panel.getByLabel(`${label} reference`, { exact: true }).getAttribute('data-reference'), reference);
          assert.equal(await panel.getByRole('link', { name: `View ${label.toLowerCase()} history`, exact: true }).count(), 0);
        }
        assert.equal(await panel.getByRole('cell', { name: 'Saved (technical receipt)', exact: true }).count(), 2);
        await panel.getByText('Saved technical receipts are not clinical completion.', { exact: true }).waitFor();
      }
    }
    await panel.evaluate(element => element.scrollIntoView({ block: 'start' }));
    const box = await panel.boundingBox(); assert(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width);
    const heading = await panel.getByRole('heading', { name: title, exact: true }).boundingBox();
    assert(heading && heading.y >= 32, 'Recorded history heading is hidden by the CUI banner');
    assert(await panel.evaluate(element => [element, ...element.querySelectorAll('td,th,p,button')].every(node => node.scrollWidth <= node.clientWidth)), 'History text overflows');
    const screenshot = path.join(output, `${role}-${viewport}-${lineage ? 'lineage-history' : evidence ? 'evidence-history' : 'history'}-${checkpoint}.png`);
    await panel.screenshot({ path: screenshot, animations: 'disabled' }); await chmod(screenshot, 0o600);
  }
  let reloadReads = 0;
  const countReads = request => { if (request.method() === 'POST' && [nativeHistoryBotId, evidenceHistoryBotId, lineageHistoryBotId, recordedTimeBotId, ruleHistoryBotId, matrixHistoryBotId, matrixPdfBotId].some(id => request.url() === `${api}/fhir/R4/Bot/${id}/$execute`)) reloadReads++; };
  page.on('request', countReads);
  try {
    await page.reload(); await page.getByPlaceholder('Select worker').click(); await page.getByRole('option').first().click();
    await panel.waitFor(); await page.getByRole('radio', { name: 'synthetic maintenance bay', exact: true }).check();
    assert(!(await confirmation.isChecked())); assert(await inspect.isDisabled()); assert.equal(await panel.getByRole('table').count(), 0);
    assert.equal(reloadReads, 0, 'Reload must not automatically inspect history');
    await confirmation.check(); await inspect.click(); await panel.getByRole('cell', { name: 'requested', exact: true }).waitFor();
    assert.equal(reloadReads, 1, 'Only the explicitly confirmed fresh history read may run');
    await panel.getByRole('button', { name: lineage ? 'Dismiss technical history' : evidence ? 'Dismiss evidence history' : 'Dismiss history', exact: true }).click();
    assert(!(await confirmation.isChecked())); assert(await inspect.isDisabled()); assert.equal(await panel.getByRole('table').count(), 0);
  } finally { page.off('request', countReads); }
  results.push({ role, viewport, [lineage ? 'nativeLineageHistory' : evidence ? 'nativeEvidenceHistory' : 'nativeHistory']: 'verified', fixedCheckpoints: 2, suppliedIdentities: lineage ? 14 : evidence ? 8 : 4, suppliedVersions: lineage ? 17 : evidence ? 9 : 5,
    before: evidence ? 'requested/no-draft/no-attestation/shared-rule-recorded' : 'requested/no-draft', after: lineage ? 'accepted/draft/synthetic-attestation-and-technical-receipts' : evidence ? 'accepted/draft/synthetic-attestation-and-report' : 'accepted/draft', reloadCleared: true, freshConfirmationRequired: true,
    automaticReads: 0, completeSourceGraph: false, historicalReconstruction: false, clinicalCompletionVerified: false, complianceAssessed: false, clinicalWrites: 0 });
}

async function exerciseNativeRecordedTime(page, output, role, viewport, results, directory, rules = false, matrix = false) {
  const botId = matrix ? matrixHistoryBotId : rules ? ruleHistoryBotId : recordedTimeBotId; const title = matrix ? 'Matrix source history' : rules ? 'Rule and review history' : 'Explore recorded time';
  const publication = JSON.parse(await readFile(path.join(directory, matrix ? 'native-matrix-history-publication-metadata-correction-binary-identity.json' : rules ? 'native-rule-history-publication.json' : 'native-recorded-time-publication.json'), 'utf8'));
  assert(publication.verified && publication.roleChecks.length === 4); assert.equal(publication.result.botId, botId);
  const baseline = publication.plan.baseline; const sources = baseline.sources; const timeline = baseline.recordedVersions;
  const pendingReference = baseline.historyVersions[8].versions.find(reference => reference !== sources[8]);
  const pendingAt = timeline.find(record => record.reference === pendingReference).recordedAt;
  const panel = page.getByRole('region', { name: title, exact: true });
  const picker = panel.getByLabel(matrix ? 'Matrix-history instant (UTC)' : rules ? 'Rule-history instant (UTC)' : 'Recorded instant (UTC)', { exact: true });
  const confirmation = panel.getByRole('checkbox', { name: matrix ? 'I confirm this is synthetic Matrix history' : rules ? 'I confirm this is synthetic rule history' : 'I confirm this is synthetic recorded-time inspection', exact: true });
  const inspect = panel.getByRole('button', { name: matrix ? 'Inspect Matrix history' : rules ? 'Inspect rule history' : 'Inspect selected recorded time', exact: true });
  const matrixTimeline = matrix ? timeline.filter(record => record.reference.split('/')[1] === sources[16].split('/')[1]).sort((first, second) => first.recordedAt.localeCompare(second.recordedAt)) : [];
  const url = `${api}/fhir/R4/Bot/${botId}/$execute`;
  await panel.waitFor(); assert(await inspect.isDisabled()); assert(!(await confirmation.isChecked()));
  for (const failureKind of ['transport', 'malformed-envelope', 'mismatched-source-head', ...(rules ? ['altered-rule-body'] : []), ...(matrix ? ['altered-matrix-current', 'altered-matrix-initial'] : [])]) {
    if (failureKind === 'altered-matrix-initial') await picker.fill(matrixTimeline[0].recordedAt.slice(0, -1).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').replace(/:00$/, ''));
    const target = failureKind === 'mismatched-source-head' ? `${api}/fhir/R4/Patient/${sources[0].split('/')[1]}` : url;
    let interrupted = 0; const interrupt = async route => { interrupted++;
      const request = route.request(); assert(permitsReadOnlyFhir(request.method(), request.url(), request.method() === 'POST' ? request.postDataJSON() : undefined));
      if (failureKind === 'transport') await route.abort('failed');
      else if (failureKind === 'altered-rule-body') {
        const response = await route.fetch({ maxRetries: 0 }); const body = await response.json();
        const rule = body.snapshots[1].selected.find(record => record.reference === sources[14]);
        assert(rule && rule.resource.resourceType === 'PlanDefinition'); rule.resource.title = 'Altered unapproved rule';
        await route.fulfill({ response, json: body });
      }
      else if (failureKind.startsWith('altered-matrix-')) {
        const response = await route.fetch({ maxRetries: 0 }); const body = await response.json();
        const records = failureKind === 'altered-matrix-initial' ? body.selection.selected : body.snapshots[1].selected;
        const document = records.find(record => record.reference.split('/')[1] === sources[16].split('/')[1]);
        assert(document?.resource.resourceType === 'DocumentReference'); document.resource.content[0].attachment.title = 'Altered Matrix metadata';
        await route.fulfill({ response, json: body });
      }
      else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }); };
    await page.route(target, interrupt);
    try { await confirmation.check(); await inspect.click(); await panel.getByText('History unavailable', { exact: true }).waitFor();
      assert.equal(interrupted, 1); assert.equal(await panel.getByRole('table').count(), 0);
    } finally { await page.unroute(target, interrupt); }
    await confirmation.uncheck(); results.push({ role, viewport, ruleHistory: rules, matrixHistory: matrix, recordedTimeUnavailable: 'verified', failureKind, interruptedReadOnlyRequests: interrupted, automaticRetries: 0, clinicalWrites: 0 });
  }
  let reads = 0; const count = request => { if (request.method() === 'POST' && [nativeHistoryBotId, evidenceHistoryBotId, lineageHistoryBotId, recordedTimeBotId, ruleHistoryBotId, matrixHistoryBotId, matrixPdfBotId].some(id => request.url() === `${api}/fhir/R4/Bot/${id}/$execute`)) reads++; };
  page.on('request', count);
  try {
    const ruleTimes = rules ? [['rule-created', sources[14]], ['review-created', sources[15]]].map(([label, reference]) => [label, timeline.find(record => record.reference === reference).recordedAt]) : [];
    const matrixTimes = matrixTimeline.map((record, index) => [index === 0 ? 'matrix-metadata-only' : 'matrix-linked', record.recordedAt]);
    for (const [label, asOf] of [['empty', '2000-01-01T00:00:00.000Z'], ['before', publication.plan.config.checkpoints[0]], ...matrixTimes, ...ruleTimes, ['pending', pendingAt], ['final', publication.plan.config.checkpoints[1]]]) {
      const before = reads; await picker.fill(asOf.slice(0, -1).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').replace(/:00$/, '')); assert(!(await confirmation.isChecked())); assert(await inspect.isDisabled());
      assert.equal(await panel.getByRole('table').count(), 0); assert.equal(reads, before);
      await confirmation.check(); await inspect.click(); await panel.getByRole('table').waitFor();
      assert.equal(reads, before + 1); assert.equal(await panel.getByRole('row').count(), sources.length + 1);
      await panel.getByText(`Recorded as of ${asOf} (UTC)`, { exact: true }).waitFor();
      const selected = sources.map(source => timeline.filter(record => record.reference.split('/')[1] === source.split('/')[1] && record.recordedAt <= asOf)
        .sort((first, second) => first.recordedAt.localeCompare(second.recordedAt)).at(-1)).filter(Boolean);
      assert.equal(await panel.getByRole('cell', { name: 'Not recorded', exact: true }).count(), sources.length - selected.length);
      if (rules) {
        await panel.getByText(matrix ? 'Matrix metadata: verified. PDF content: unverified. Rule approval: unverified.' : 'Rule approval: unverified. Referenced Matrix document: not inspected.', { exact: true }).waitFor();
        for (const [index, label] of ['Rule draft', 'Rule review'].entries()) {
          const present = selected.some(record => record.reference === sources[14 + index]);
          assert.equal(await panel.locator(`[data-reference="${sources[14 + index]}"]`).count(), present ? 1 : 0);
          assert.equal(await panel.getByRole('link', { name: `View ${label.toLowerCase()} history`, exact: true }).count(), 0);
          assert.equal(await panel.getByRole('cell', { name: index === 0 ? 'Draft (unapproved rule)' : 'Requested (rule review)', exact: true }).count(), present ? 1 : 0);
        }
      }
      if (matrix) {
        const document = selected.find(record => record.reference.split('/')[1] === sources[16].split('/')[1]);
        assert.equal(await panel.getByRole('link', { name: 'View matrix metadata history', exact: true }).count(), 0);
        assert.equal(await panel.locator('a[href*="storage.ehr.hiivehealth.net"],a[href*="/Binary/"]').count(), 0);
        if (document) {
          assert.equal(await panel.locator(`[data-reference="${document.reference}"]`).count(), 1);
          await panel.getByText(document.reference === sources[16] ? 'Linked metadata (PDF bytes unverified)' : 'Initial metadata (no attachment)', { exact: true }).waitFor();
        }
      }
      if (label === 'pending') { assert.equal(await panel.locator(`[data-reference="${pendingReference}"]`).count(), 1);
        assert(await panel.getByRole('cell', { name: 'Pending (technical receipt)', exact: true }).count()); }
      if (label === 'final') assert.equal(await panel.getByRole('cell', { name: 'Saved (technical receipt)', exact: true }).count(), 2);
      await panel.evaluate(element => element.scrollIntoView({ block: 'start' }));
      const heading = await panel.getByRole('heading', { name: title, exact: true }).boundingBox(); assert(heading && heading.y >= 32);
      assert(await panel.evaluate(element => [element, ...element.querySelectorAll('td,th,p,button,input,label')].every(node => node.scrollWidth <= node.clientWidth)), 'Recorded-time text overflows');
      const screenshot = path.join(output, `${role}-${viewport}-${matrix ? 'matrix-history' : rules ? 'rule-history' : 'recorded-time'}-${label}.png`); await panel.screenshot({ path: screenshot, animations: 'disabled' }); await chmod(screenshot, 0o600);
    }
    const beforeFuture = reads; await picker.fill('2099-01-01T00:00'); assert(!(await confirmation.isChecked()));
    await confirmation.check(); await inspect.click(); await panel.getByText('History unavailable', { exact: true }).waitFor();
    assert.equal(await panel.getByRole('table').count(), 0); assert.equal(reads, beforeFuture + 1);
    const beforeReload = reads; await page.reload(); await page.getByPlaceholder('Select worker').click(); await page.getByRole('option').first().click();
    await panel.waitFor(); await page.getByRole('radio', { name: 'synthetic maintenance bay', exact: true }).check();
    assert.equal(reads, beforeReload); assert(!(await confirmation.isChecked())); assert(await inspect.isDisabled()); assert.equal(await panel.getByRole('table').count(), 0);
    await confirmation.check(); await inspect.click(); await panel.getByRole('table').waitFor(); assert.equal(reads, beforeReload + 1);
    await panel.getByRole('button', { name: matrix ? 'Dismiss Matrix history' : rules ? 'Dismiss rule history' : 'Dismiss selected history', exact: true }).click(); assert(!(await confirmation.isChecked())); assert.equal(await panel.getByRole('table').count(), 0);
  } finally { page.off('request', count); }
  results.push({ role, viewport, nativeRecordedTime: 'verified', nativeRuleHistory: rules ? 'verified' : undefined, nativeMatrixHistory: matrix ? 'verified' : undefined, suppliedIdentities: sources.length, suppliedVersions: timeline.length,
    emptyBeforePendingFinal: true, futureRefused: true, selectionChangeClearsConfirmation: true, reloadCleared: true, automaticReads: 0, clinicalWrites: 0,
    completeSourceGraph: false, historicalReconstruction: false, clinicalCompletionVerified: false, complianceAssessed: false });
}

async function exerciseNativeMatrixPdf(page, output, role, viewport, results, directory) {
  const publication = JSON.parse(await readFile(path.join(directory, 'native-matrix-pdf-publication.json'), 'utf8'));
  assert.equal(publication.verified, true); const config = publication.plan.config;
  assert.equal(config.sha256, 'c60c0406b829ec59122de1966a81b562b9e6eac348550cca2496cf7246309b03');
  assert.equal(config.byteLength, 4022607);
  const panel = page.getByRole('region', { name: 'Matrix PDF verification', exact: true });
  const confirmation = panel.getByRole('checkbox', { name: 'I confirm synthetic PDF verification', exact: true });
  const inspect = panel.getByRole('button', { name: 'Verify Matrix PDF bytes', exact: true });
  const url = `${api}/fhir/R4/Bot/${matrixPdfBotId}/$execute`;
  let reads = 0; let attachmentReads = 0;
  const count = request => {
    if (request.url() === url && request.method() === 'POST') {
      assert(permitsReadOnlyFhir(request.method(), request.url(), request.postDataJSON())); reads++;
    }
    const target = new URL(request.url());
    if (target.origin === 'https://storage.ehr.hiivehealth.net' || (target.origin === api && /^\/fhir\/R4\/Binary\//.test(target.pathname))) attachmentReads++;
  };
  page.on('request', count);
  try {
    await panel.waitFor(); assert(await inspect.isDisabled()); assert(!(await confirmation.isChecked())); assert.equal(reads, 0);
    for (const failureKind of ['transport', 'altered-hash', 'unsafe-claim', 'extra-payload']) {
      let interrupted = 0; const interrupt = async route => {
        interrupted++;
        if (failureKind === 'transport') await route.abort('failed');
        else {
          const response = await route.fetch({ maxRetries: 0 }); const body = await response.json();
          if (failureKind === 'altered-hash') body.pdfSha256 = '0'.repeat(64);
          else if (failureKind === 'unsafe-claim') body.clinicalInterpretationVerified = true;
          else body.attachment = { url: 'https://foreign.invalid/private-pdf' };
          await route.fulfill({ response, json: body });
        }
      };
      const before = reads; await page.route(url, interrupt);
      try {
        await confirmation.check(); await inspect.click(); await panel.getByText('PDF verification unavailable', { exact: true }).waitFor();
        assert.equal(interrupted, 1); assert.equal(reads, before + 1); assert(await inspect.isDisabled()); assert(!(await confirmation.isChecked()));
        assert.equal(await panel.locator('[data-reference]').count(), 0);
        assert.equal(await panel.getByText(/private-pdf/).count(), 0);
      } finally { await page.unroute(url, interrupt); }
      results.push({ role, viewport, matrixPdfUnavailable: 'verified', failureKind, automaticRetries: 0, clinicalWrites: 0 });
    }
    for (const label of ['confirmed', 'after-reload']) {
      const before = reads; assert(await inspect.isDisabled()); assert(!(await confirmation.isChecked()));
      await confirmation.check(); await inspect.click();
      await panel.getByText('PDF bytes: verified. Clinical interpretation and rule approval: unverified.', { exact: true }).waitFor();
      assert.equal(reads, before + 1);
      await panel.getByText(`${config.byteLength.toLocaleString('en-US')} bytes - application/pdf`, { exact: true }).waitFor();
      await panel.getByText(`PDF SHA-256: ${config.sha256}`, { exact: true }).waitFor();
      assert.equal(await panel.locator(`[data-reference="${config.document}"]`).count(), 1);
      assert.equal(await panel.locator(`[data-reference="${config.binary}"]`).count(), 1);
      assert.equal(await panel.getByRole('link').count(), 0); assert.equal(attachmentReads, 0);
      await panel.evaluate(element => element.scrollIntoView({ block: 'start' }));
      const heading = await panel.getByRole('heading', { name: 'Matrix PDF verification', exact: true }).boundingBox();
      assert(heading && heading.y >= 32);
      assert(await panel.evaluate(element => [element, ...element.querySelectorAll('p,button,input,label')].every(node => node.scrollWidth <= node.clientWidth)), 'PDF verification text overflows');
      const screenshot = path.join(output, `${role}-${viewport}-matrix-pdf-${label}.png`);
      await panel.screenshot({ path: screenshot, animations: 'disabled' }); await chmod(screenshot, 0o600);
      await panel.getByRole('button', { name: 'Dismiss PDF verification', exact: true }).click();
      assert(await inspect.isDisabled()); assert(!(await confirmation.isChecked())); assert.equal(await panel.locator('[data-reference]').count(), 0);
      if (label === 'confirmed') {
        const beforeReload = reads; await page.reload(); await page.getByPlaceholder('Select worker').click(); await page.getByRole('option').first().click();
        await panel.waitFor(); await page.getByRole('radio', { name: 'synthetic maintenance bay', exact: true }).check();
        assert.equal(reads, beforeReload); assert(await inspect.isDisabled()); assert(!(await confirmation.isChecked()));
      }
    }
    results.push({ role, viewport, nativeMatrixPdf: 'verified', pdfSha256: config.sha256, byteLength: config.byteLength,
      independentConfirmation: true, reloadCleared: true, dismissCleared: true, automaticReads: 0, browserAttachmentReads: attachmentReads,
      clinicalInterpretationVerified: false, ruleApprovalVerified: false, clinicalCompletionVerified: false, complianceAssessed: false, clinicalWrites: 0 });
  } finally { page.off('request', count); }
}

async function main() {
  process.umask(0o077);
  const { presenterOnly, examplesOnly, technicalDrilldowns } = readOnlyRehearsalMode(process.argv.slice(2));
  const cohortOnly = examplesOnly || process.argv[2] === '--cohort-report-read-only';
  const reportOnly = cohortOnly || process.argv[2] === '--report-read-only';
  const ruleOnly = process.argv[2] === '--rule-review-read-only';
  const personnelOnly = process.argv[2] === '--personnel-read-only';
  const completionOnly = reportOnly || ['--completion-read-only', '--saved-completion-read-only'].includes(process.argv[2]);
  const acceptedOnly = process.argv[2] === '--accepted-read-only' || completionOnly;
  const directory =
    process.env.OEM_STATE_DIRECTORY ??
    path.resolve(import.meta.dirname, '../../medplum-ubix-army-oem/examples/medplum-demo-bots/src/army-oem/oem.local');
  assert.equal((await stat(directory)).mode & 0o077, 0, 'Private state directory permissions required');
  const stateFile = path.join(directory, 'state.json');
  assert.equal((await stat(stateFile)).mode & 0o077, 0, 'Private state permissions required');
  const originalState = await readFile(stateFile, 'utf8');
  const state = JSON.parse(originalState);
  const demoPolicy = reportOnly ? (await import(pathToFileURL(path.resolve(directory, '../dist/fixtures.js')).href)).DEMO_POLICY : undefined;
  if (demoPolicy) {
    assert.equal(demoPolicy.status, 'demo-only-unapproved'); assert.equal(demoPolicy.clinicallyApproved, false);
    assert.equal(demoPolicy.clinicalCompletionVerified, false); assert.equal(demoPolicy.activated, false); assert.equal(demoPolicy.externalDispatch, false);
  }
  const accepted = acceptedOnly ? JSON.parse(await readFile(path.join(directory, 'clinician-accept-synthetic-1.json'), 'utf8')) : undefined;
  if (accepted) {
    assert.equal(accepted.stage, 'verified');
    assert.equal(accepted.nativeReplay, true);
    assert.equal(accepted.collectionVerified, true);
    assert.equal(accepted.result.decision, 'accept');
    assert.equal(accepted.result.externalDispatch, false);
    assert.equal(accepted.result.completionRecorded, false);
  }
  let alternatives;
  let conflict;
  let concurrentAccept;
  let repeatAccept;
  if (accepted) {
    try { alternatives = JSON.parse(await readFile(path.join(directory, 'clinician-alternatives.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { conflict = JSON.parse(await readFile(path.join(directory, 'clinician-conflict.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { concurrentAccept = JSON.parse(await readFile(path.join(directory, 'clinician-accept-concurrency.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { repeatAccept = JSON.parse(await readFile(path.join(directory, 'clinician-accept-repeat.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const retainedExpected = retainedWorkExpectations(accepted, alternatives, conflict, concurrentAccept, repeatAccept);
  const retainedDrafts = retainedDraftExpectations(accepted, concurrentAccept, repeatAccept);
  const originalDraftLink = page => page.getByRole('link', { name: /^View retained local draft proposal(?: \d+)?$/ })
    .and(page.locator(`a[href="/${accepted.result.proposal}"]`));
  const completion = completionOnly ? JSON.parse(await readFile(path.join(directory, 'completion-preview-publication.json'), 'utf8')) : undefined;
  if (completion) {
    assert.equal(completion.verified, true);
    assert.equal(completion.result.botId, completionPreviewBotId);
    assert.deepEqual(completion.roleChecks, ['clinician', 'ih', 'reviewer', 'configuration']);
  }
  const savedCompletion = completionOnly ? JSON.parse(await readFile(path.join(directory, 'completion-save-publication.json'), 'utf8')) : undefined;
  if (savedCompletion) {
    assert(savedCompletion.verified && savedCompletion.save.verified && savedCompletion.save.nativeReplay);
    assert.equal(savedCompletion.result.botId, completionSaveBotId);
    assert.equal(savedCompletion.save.result.clinicalCompletionVerified, false);
    assert.equal(savedCompletion.save.result.externalDispatch, false);
  }
  const nativeReport = reportOnly ? JSON.parse(await readFile(path.join(directory, examplesOnly ? 'native-report-completion-publication.json' : cohortOnly ? 'native-report-cohort-publication.json' : 'native-report-publication.json'), 'utf8')) : undefined;
  if (nativeReport) {
    assert.equal(nativeReport.verified, true); assert.equal(nativeReport.result.botId, examplesOnly ? completionReportBotId : cohortOnly ? cohortReportBotId : nativeReportBotId);
    assert.deepEqual(nativeReport.roleChecks, ['clinician', 'ih', 'reviewer', 'configuration']);
  }
  assert.equal(state.projectId, projectId);
  assert(state.operatorDisabled && !state.pending && state.ihReview?.verifiedAt, 'Complete backend verification first');
  if (ruleOnly) assert(state.ruleGovernance?.stage === 'verified', 'Verify the rule-review Bot before UI rehearsal');
  if (personnelOnly)
    assert(
      state.personnelPreview?.verifiedAt &&
        state.personnelPreview.sourceContinuation?.verifiedAt &&
        !state.personnelPreview.verificationBlocked,
      'Verify the personnel preview and source continuation before UI rehearsal'
    );
  const playwright = await import(process.env.OEM_PLAYWRIGHT_MODULE ?? 'playwright');
  const { chromium } = playwright.default ?? playwright;
  const output = path.join(directory, `browser-readonly-${new Date().toISOString().replaceAll(':', '-')}`);
  await mkdir(output, { mode: 0o700 });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  let phase = 'start';
  let activePage;
  const network = [];
  const requests = new Map();
  try {
    for (const role of personnelOnly
      ? ['clinician', 'ih', 'reviewer', 'configuration']
      : ruleOnly
        ? ['configuration', 'clinician', 'ih', 'reviewer']
        : ['clinician', 'ih', 'reviewer']) {
      assert(state.accounts[role]?.email && state.accounts[role]?.password, 'Recorded demo account required');
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.addInitScript(({ providerOrigin, apiOrigin }) => {
        if (location.origin === providerOrigin) sessionStorage.setItem('medplum_base_url', apiOrigin);
      }, { providerOrigin: origin, apiOrigin: api });
      for (const pattern of ['**/auth/**', '**/oauth2/**']) {
        await context.route(pattern, route => new URL(route.request().url()).origin === api
          ? route.continue() : route.abort('blockedbyclient'));
      }
      const blocked = [];
      const errors = [];
      const cuiStatuses = [];
      let doseSpotAccessRequests = 0;
      const page = await context.newPage();
      activePage = page;
      page.on('request', (request) => {
        const target = new URL(request.url());
        if (target.origin !== api || !target.pathname.startsWith('/fhir/R4')) return;
        if (target.pathname === '/fhir/R4/PractitionerRole' && target.searchParams.has('practitioner') &&
          target.searchParams.get('active') === 'true') doseSpotAccessRequests += 1;
        const entry = {
          role,
          phase,
          method: request.method(),
          resourceType: target.pathname.split('/')[3] || 'batch',
          state: 'pending',
        };
        requests.set(request, entry);
        network.push(entry);
      });
      page.on('requestfinished', (request) => {
        const entry = requests.get(request);
        if (entry) entry.state = 'finished';
      });
      page.on('requestfailed', (request) => {
        const entry = requests.get(request);
        if (entry) entry.state = 'failed';
      });
      page.on('pageerror', () => errors.push('Browser runtime error'));
      page.on('framenavigated', frame => {
        if (frame === page.mainFrame() && phase.endsWith(':completion-scenario')) {
          results.push({ role, completionScenarioUnexpectedNavigation: true, clinicalWrites: 0 });
        }
      });
      page.on('response', async (response) => {
        const entry = requests.get(response.request());
        if (entry) entry.status = response.status();
        if (entry?.resourceType === 'batch') {
          try {
            const bundle = await response.json();
            entry.batchStatuses = bundle.entry?.map((item) => item.response?.status);
            const request = response.request().postDataJSON();
            entry.batchReads = (bundle.entry ?? [])
              .map((item, index) => {
                const url = new URL(request.entry?.[index]?.request?.url ?? '', `${api}/fhir/R4/`);
                const parts = url.pathname.split('/').filter(Boolean);
                const resourceType = parts[parts.includes('R4') ? parts.indexOf('R4') + 1 : 0];
                return { resourceType, status: item.response?.status ?? 'no-response' };
              })
              .filter((item) => ['Observation', 'Provenance'].includes(item.resourceType));
          } catch {
            entry.batchStatuses = ['Response unavailable'];
          }
        }
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
        blocked.push({ method: request.method(), path: new URL(request.url()).pathname });
        return route.abort('blockedbyclient');
      });
      phase = `${role}:sign-in`;
      await page.goto(`${origin}/signin?project=${projectId}`);
      await page.locator('input[type="email"]').fill(state.accounts[role].email);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.locator('input[type="password"]').fill(state.accounts[role].password);
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      await page.getByRole('button', { name: 'User menu' }).waitFor();
      for (const [viewport, width, height] of [
        ['desktop', 1440, 1000],
        ['mobile', 390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        if (requireCui) {
          phase = `${role}:${viewport}:cui-banner`;
          const banner = page.getByRole('complementary', { name: 'CUI', exact: true });
          await banner.waitFor({ state: 'visible' });
          assert.equal(await banner.count(), 1);
          assert.equal((await banner.innerText()).trim(), 'CUI');
          const bounds = await banner.boundingBox();
          assert(bounds && Math.abs(bounds.x) <= 1 && Math.abs(bounds.y) <= 1 &&
            Math.abs(bounds.width - width) <= 1 && bounds.height === 32, 'CUI banner is not fully framed');
          const screenshot = path.join(output, `${role}-${viewport}-cui-banner.png`);
          await page.screenshot({ path: screenshot, animations: 'disabled' }); await chmod(screenshot, 0o600);
          results.push({ role, viewport, cuiBanner: 'visible', enabled: true, clinicalWrites: 0 });
        }
        if (personnelOnly) {
          phase = `${role}:${viewport}:personnel-preview`;
          await page.goto(`${origin}/oem/personnel`);
          await page.getByRole('heading', { name: 'Personnel Facts', exact: true }).waitFor();
          if (role === 'clinician') {
            await page.getByRole('radio', { name: 'population', exact: true }).check();
            await page.getByRole('radio', { name: 'military', exact: true }).check();
            await page
              .locator('.mantine-Radio-root')
              .filter({ has: page.locator('a[href*="/DocumentReference/"]') })
              .first()
              .getByRole('radio')
              .check();
            await page.getByRole('radio', { name: 'synthetic clinician attestation', exact: true }).check();
            await page.getByRole('button', { name: 'Preview', exact: true }).click();
            await page.getByText('Not Saved', { exact: true }).waitFor();
            await page.getByText('Population: military', { exact: true }).waitFor();
            await page.getByRole('table', { name: 'Proposed personnel resources', exact: true }).waitFor();
            if (state.personnelSave?.nativeVerifiedAt) {
              await page.getByRole('button', { name: 'Save', exact: true }).click();
              const dialog = page.getByRole('dialog', { name: 'Confirm Personnel Save', exact: true });
              await dialog.waitFor();
              await page.waitForFunction(() =>
                [...document.querySelectorAll('[role="dialog"]')].every((dialog) => {
                  for (let element = dialog; element; element = element.parentElement) {
                    if (Number(getComputedStyle(element).opacity) !== 1) return false;
                  }
                  const bounds = dialog.getBoundingClientRect();
                  return (
                    bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight
                  );
                })
              );
              await dialog.getByText('No rule activation, enrollment decision or orders.', { exact: true }).waitFor();
              await page.screenshot({
                path: path.join(output, `${role}-${viewport}-personnel-confirmation.png`),
                fullPage: true,
              });
              await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
              await dialog.waitFor({ state: 'hidden' });
              assert.equal(await page.evaluate(() => sessionStorage.getItem('army-oem-personnel-save-v1')), null);
            } else {
              assert.equal(await page.getByRole('button', { name: /save|approve|record decision/i }).count(), 0);
            }
          } else {
            await page
              .getByText('Personnel preview access, worker, form or source could not be verified.', { exact: true })
              .waitFor();
            assert.equal(await page.getByRole('button', { name: 'Preview', exact: true }).count(), 0);
          }
          assert(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            'Personnel preview horizontal overflow'
          );
          const screenshot = path.join(output, `${role}-${viewport}-personnel.png`);
          await page.screenshot({ path: screenshot, fullPage: true });
          await chmod(screenshot, 0o600);
          if (role === 'clinician') {
            await page.getByRole('button', { name: 'Cancel', exact: true }).click();
            await page.getByText('Not Saved', { exact: true }).waitFor({ state: 'hidden' });
          }
          results.push({ role, viewport, personnelPreviewReadOnly: true, attestationSaved: false });
          continue;
        }
        if (ruleOnly) {
          phase = `${role}:${viewport}:rule-review`;
          await page.goto(`${origin}/oem/rule-review`);
          await page.getByRole('heading', { name: 'Noise rule review', exact: true }).waitFor();
          if (role === 'configuration') {
            await page
              .getByRole('button', { name: `Open rule review ${state.ruleGovernance.task.split('/')[1]}`, exact: true })
              .click();
            await page.getByRole('heading', { name: 'Unresolved requirements', exact: true }).waitFor();
            const baseline = page.getByRole('region', { name: 'Baseline audiogram', exact: true });
            await baseline.getByText('Duration: Not recorded', { exact: true }).waitFor();
            await baseline.getByText('Baseline anchor: Not recorded', { exact: true }).waitFor();
            const periodic = page.getByRole('region', { name: 'Annual audiogram', exact: true });
            for (const label of ['Frequency: 1', 'Period: 1', 'Period unit: a', 'Periodic anchor: Not recorded']) {
              await periodic.getByText(label, { exact: true }).waitFor();
            }
            await page.getByText('Termination handling: Not recorded', { exact: true }).waitFor();
            await page.getByText('No policy resolutions recorded.', { exact: true }).waitFor();
            await page.getByText('Approval blocked', { exact: true }).waitFor();
            for (const label of [
              'baseline timing',
              'periodic anchor',
              'termination policy',
              'enrollment authority',
              'supplementary policy',
            ]) {
              assert(await page.getByText(label, { exact: true }).isVisible(), 'Missing source requirement');
            }
            await page.getByRole('textbox', { name: 'Decision', exact: true }).click();
            const approval = page.getByRole('option', { name: 'Approve content', exact: true });
            assert(
              (await approval.getAttribute('data-combobox-disabled')) !== null ||
                (await approval.getAttribute('data-disabled')) !== null,
              'Unresolved draft approval option must be disabled'
            );
            await page.keyboard.press('Escape');
            await page.getByPlaceholder('Select reason', { exact: true }).click();
            await page.getByRole('option', { name: 'Timing unresolved', exact: true }).click();
            await page.getByRole('button', { name: 'Review decision', exact: true }).click();
            const dialog = page.getByRole('dialog');
            await dialog.getByText(state.ruleGovernance.draft, { exact: true }).waitFor();
            await page.waitForFunction(
              (element) => {
                for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
                  if (Number(getComputedStyle(ancestor).opacity) !== 1) return false;
                }
                return true;
              },
              await dialog.elementHandle()
            );
            const dialogBounds = await dialog.boundingBox();
            assert(
              dialogBounds && dialogBounds.x >= 0 && dialogBounds.x + dialogBounds.width <= width,
              'Rule confirmation outside viewport'
            );
            assert(
              await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
              'Rule confirmation content overflow'
            );
            assert(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
              'Rule confirmation horizontal overflow'
            );
            const confirmationScreenshot = path.join(output, `${role}-${viewport}-rule-confirmation.png`);
            await page.screenshot({ path: confirmationScreenshot });
            await chmod(confirmationScreenshot, 0o600);
            await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
            await dialog.waitFor({ state: 'hidden' });
          } else {
            await page.getByText('Reviews unavailable', { exact: true }).waitFor();
            assert.equal(await page.getByRole('button', { name: /^Open rule review / }).count(), 0);
            assert.equal(await page.getByRole('button', { name: 'Record decision', exact: true }).count(), 0);
          }
          assert(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            'Rule-review horizontal overflow'
          );
          const screenshot = path.join(output, `${role}-${viewport}-rule-review.png`);
          await page.screenshot({ path: screenshot, fullPage: true });
          await chmod(screenshot, 0o600);
          results.push({ role, viewport, ruleReviewReadOnly: true, decisionSubmitted: false });
          continue;
        }
        phase = `${role}:${viewport}:intake`;
        await page.goto(`${origin}/oem/intake`);
        await page.getByRole('heading', { name: 'Noise intake', exact: true }).waitFor();
        const brand = await page.getByRole('img', { name: 'Hiive Health', exact: true }).boundingBox();
        const heading = await page.getByRole('heading', { name: 'Noise intake', exact: true }).boundingBox();
        assert(brand && heading && brand.x + brand.width <= heading.x, 'Collapsed wordmark overlaps page title');
        if (role === 'reviewer') {
          await page
            .getByText('Intake access or the pinned definition could not be verified.', { exact: true })
            .waitFor();
          assert.equal(await page.getByPlaceholder('Select worker').count(), 0);
        } else {
          await page.getByPlaceholder('Select worker').click();
          await page.getByRole('option').first().click();
          await page.getByRole('radio', { name: 'synthetic maintenance bay', exact: true }).check();
          await page.getByRole('heading', { name: 'Exposure timeline', exact: true }).waitFor();
          const timeline = page.getByRole('table', { name: 'Exposure timeline', exact: true });
          if (await timeline.count()) {
            assert(await timeline.isVisible(), 'Exposure timeline is not visible');
            for (const heading of ['Exposure', 'Status', 'Source']) {
              assert(await timeline.getByRole('columnheader', { name: heading, exact: true }).isVisible());
            }
            await page.getByText(/^Status as of \d{4}-\d{2}-\d{2} \(UTC\)$/).waitFor();
            for (const row of await timeline.locator('tbody tr').all()) {
              const cells = await row.getByRole('cell').allTextContents();
              assert.equal(cells.length, 7);
              assert.equal(cells[0], 'Noise 503');
              assert(['Active', 'Inactive', 'Future', 'Unknown'].includes(cells[1]));
              assert(
                await row.locator('.mantine-Badge-label').evaluate((label) => label.scrollWidth <= label.clientWidth),
                'Exposure status badge is clipped'
              );
              assert(
                ['IH-imported', 'IH-entered', 'Clinician-entered', 'Clinician-amended', 'Unknown'].includes(cells[2])
              );
            }
            const historyLinks = await timeline.getByRole('link').all();
            assert(historyLinks.length > 0, 'Exposure timeline lacks history links');
            for (const link of historyLinks) {
              assert.equal(await link.getAttribute('aria-label'), 'View exposure history');
              assert.match(await link.getAttribute('href'), /^\/Observation\/[A-Za-z0-9.-]+\/history$/);
              if (viewport === 'desktop') {
                const box = await link.boundingBox();
                assert(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width, 'History icon is cut off');
              }
            }
            assert.equal(await timeline.getByRole('columnheader', { name: 'Details', exact: true }).count(), 0);
            assert.equal(await timeline.getByRole('columnheader', { name: 'Version', exact: true }).count(), 0);
            await historyLinks[0].scrollIntoViewIfNeeded();
            const historyBox = await historyLinks[0].boundingBox();
            assert(
              historyBox && historyBox.x >= 0 && historyBox.x + historyBox.width <= page.viewportSize().width,
              'History icon cannot be reached within viewport'
            );
            await page.screenshot({
              path: path.join(output, `${role}-${viewport}-exposure-history.png`),
              animations: 'disabled',
            });
            const inspectWork = page.getByRole('button', { name: 'Inspect retained work', exact: true });
            if (role === 'clinician') {
              phase = `${role}:${viewport}:retained-work-inspection`;
              const collectionResponse = page.waitForResponse(response => response.url() === `${api}/fhir/R4/Bot/${lifecycleBotId}/$execute` &&
                response.request().method() === 'POST' && response.request().postDataJSON()?.mode === 'collect');
              await inspectWork.click();
              const collected = await (await collectionResponse).json();
              const retained = collected.inspection.retained;
              const recommendations = retained.filter(value => value.reference.startsWith('Task/'));
              const byReference = values => values.map(({ reference, status, reviewRequired }) => ({ reference, status, reviewRequired })).sort((first, second) => first.reference.localeCompare(second.reference));
              assert.deepEqual(byReference(recommendations), byReference(retainedExpected));
              assert.equal(collected.searchedRecommendations, retainedExpected.length);
              assert.deepEqual(byReference(retained.filter(value => value.reference.startsWith('ServiceRequest/'))), byReference(retainedDrafts));
              await page.getByText(`Exposure: active. Recommendation: ${recommendations.map(value => value.status).join(', ')}.`, { exact: true }).waitFor();
              await page.getByText('Scope: bounded worker search.', { exact: true }).waitFor();
              await page.getByText(`Visible audiogram Tasks: ${retainedExpected.length}. Retained recommendations: ${retainedExpected.length}.`, { exact: true }).waitFor();
              await page.getByText('Selected versions matched at read checks.', { exact: true }).waitFor();
              const retainedLink = reference => page.getByRole('link', { name: /^View retained recommendation(?: \d+)?$/ }).and(page.locator(`a[href="/${reference}"]`));
              for (const expected of retainedExpected) assert.equal(await retainedLink(expected.reference).count(), 1);
              for (const draft of retainedDrafts) assert(await page.locator(`a[href="/${draft.reference}"]`).count() >= 1);
              const dismissWork = page.getByRole('button', { name: 'Dismiss retained work', exact: true });
              assert(await dismissWork.isEnabled());
              assert.equal(await dismissWork.getAttribute('aria-expanded'), 'true');
              await dismissWork.scrollIntoViewIfNeeded();
              await page.screenshot({ path: path.join(output, `${role}-${viewport}-retained-work.png`), animations: 'disabled' });
              results.push({ role, viewport, retainedWorkInspection: 'verified', clinicalWrites: 0 });
              if (acceptedOnly) {
                phase = `${role}:${viewport}:accepted-decision-readback`;
                assert.equal(await retainedLink(accepted.result.task).getAttribute('href'), `/${accepted.result.task}`);
                await page.getByText('Audiogram: accepted', { exact: true }).waitFor();
                await page.getByText('Requirement classification: Unclassified', { exact: true }).waitFor();
                await page.getByText('Local proposal: draft', { exact: true }).first().waitFor();
                assert.equal(await originalDraftLink(page).getAttribute('href'), `/${accepted.result.proposal}`);
                assert(await page.getByRole('button', { name: 'Review decision', exact: true }).isDisabled());
                for (const name of ['Accept', 'Modify', 'Dismiss']) assert(await page.getByRole('radio', { name, exact: true }).isDisabled());
                await originalDraftLink(page).scrollIntoViewIfNeeded();
                await page.screenshot({ path: path.join(output, `${role}-${viewport}-accepted-decision.png`), animations: 'disabled' });
                results.push({ role, viewport, acceptedDecision: 'verified', localDraft: 'verified', newDecisionLocked: true, clinicalWrites: 0 });
                if (completionOnly) {
                  const remountCompletion = async () => {
                    await page.getByPlaceholder('Select worker').click();
                    await page.getByRole('option').nth(1).click();
                    await page.getByRole('heading', { name: 'Simulated completion', exact: true }).waitFor({ state: 'hidden' });
                    await page.getByPlaceholder('Select worker').click();
                    await page.getByRole('option').first().click();
                    await page.getByRole('heading', { name: 'Simulated completion', exact: true }).waitFor();
                  };
                  for (const storageFault of ['denied', 'corrupt']) {
                    phase = `${role}:${viewport}:completion-recovery:${storageFault}`;
                    let completionRequests = 0;
                    const countCompletion = request => {
                      const target = new URL(request.url());
                      if (request.method() === 'POST' && target.origin === api &&
                        target.pathname === `/fhir/R4/Bot/${completionSaveBotId}/$execute`) completionRequests++;
                    };
                    page.on('request', countCompletion);
                    await page.evaluate(fault => {
                      const original = Storage.prototype.getItem;
                      globalThis.__oemRestoreRecoveryStorage = () => { Storage.prototype.getItem = original; };
                      Storage.prototype.getItem = function (key) {
                        if (key.startsWith('oem-synthetic-completion:')) {
                          if (fault === 'denied') throw new DOMException('Storage unavailable', 'SecurityError');
                          return 'invalid-demo-recovery-fingerprint';
                        }
                        return original.call(this, key);
                      };
                    }, storageFault);
                    try {
                      await remountCompletion();
                      const recoveryPanel = page.getByRole('heading', { name: 'Simulated completion', exact: true }).locator('..');
                      await recoveryPanel.getByText('Recovery unavailable', { exact: true }).waitFor();
                      assert(await recoveryPanel.getByRole('checkbox', { name: 'I confirm this is a synthetic example', exact: true }).isDisabled());
                      assert(await recoveryPanel.getByRole('button', { name: 'Preview simulated completion', exact: true }).isDisabled());
                      assert.equal(await recoveryPanel.getByRole('button', { name: /save|reconcile/i }).count(), 0);
                      assert.equal(completionRequests, 0, 'Unavailable recovery must not execute completion requests');
                      await recoveryPanel.evaluate(element => element.scrollIntoView({ block: 'start' }));
                      assert(await recoveryPanel.evaluate(element => element.scrollWidth <= element.clientWidth), 'Recovery warning text overflows');
                      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Recovery warning horizontal overflow');
                      const screenshot = path.join(output, `${role}-${viewport}-completion-recovery-${storageFault}.png`);
                      await page.screenshot({ path: screenshot, animations: 'disabled' }); await chmod(screenshot, 0o600);
                      results.push({ role, viewport, completionRecovery: 'verified', storageFault,
                        executionBlocked: true, completionRequests, clinicalWrites: 0 });
                    } finally {
                      await page.evaluate(() => { globalThis.__oemRestoreRecoveryStorage(); delete globalThis.__oemRestoreRecoveryStorage; });
                      page.off('request', countCompletion);
                      await remountCompletion();
                    }
                  }
                  await page.getByRole('radio', { name: 'synthetic maintenance bay', exact: true }).check();
                  for (const readbackPhase of ['initial', 'after-reload']) {
                    if (readbackPhase === 'after-reload') {
                      phase = `${role}:${viewport}:saved-state-reload`;
                      await page.reload();
                      await page.getByPlaceholder('Select worker').click();
                      await page.getByRole('option').first().click();
                      await page.getByRole('heading', { name: 'Simulated completion', exact: true }).waitFor();
                      await page.getByRole('radio', { name: 'synthetic maintenance bay', exact: true }).check();
                      await page.getByText('Audiogram: accepted', { exact: true }).waitFor();
                      assert(await page.getByRole('button', { name: 'Review decision', exact: true }).isDisabled());
                      for (const name of ['Accept', 'Modify', 'Dismiss']) assert(await page.getByRole('radio', { name, exact: true }).isDisabled());
                      await page.getByRole('button', { name: 'Inspect retained work', exact: true }).click();
                      await page.getByText('Selected versions matched at read checks.', { exact: true }).waitFor();
                      await page.getByText('Local proposal: draft', { exact: true }).first().waitFor();
                      assert.equal(await retainedLink(accepted.result.task).getAttribute('href'), `/${accepted.result.task}`);
                      assert.equal(await originalDraftLink(page).getAttribute('href'), `/${accepted.result.proposal}`);
                      if (requireCui) await page.getByRole('complementary', { name: 'CUI', exact: true }).waitFor();
                    }
                    phase = `${role}:${viewport}:saved-synthetic-attestation-readback:${readbackPhase}`;
                    const panel = page.getByRole('heading', { name: 'Simulated completion', exact: true }).locator('..');
                    await panel.evaluate(element => element.scrollIntoView({ block: 'start' }));
                    const preview = panel.getByRole('button', { name: 'Preview simulated completion', exact: true });
                    assert(await preview.isDisabled());
                    assert.equal(await panel.getByText('Synthetic attestation saved', { exact: true }).count(), 0);
                    assert(!(await panel.getByRole('checkbox', { name: 'I confirm this is a synthetic example', exact: true }).isChecked()));
                    await panel.getByRole('checkbox', { name: 'I confirm this is a synthetic example', exact: true }).check();
                    assert(await preview.isEnabled());
                    await preview.click();
                    await panel.getByText('Synthetic attestation saved', { exact: true }).waitFor();
                    await panel.getByText('Simulated attestation only. Clinical completion is not verified.', { exact: true }).waitFor();
                    await panel.getByText('Simulated performed date: 2026-06-15', { exact: true }).waitFor();
                    await panel.getByText('Illustrative next periodic date: 2027-06-15', { exact: true }).waitFor();
                    assert.equal(await panel.getByRole('link', { name: 'View synthetic audiogram report', exact: true }).getAttribute('href'), `/${completion.result.report}`);
                    for (const [name, key] of [['View synthetic attestation', 'attestation'], ['View attestation lineage', 'lineage'], ['View save receipt', 'receipt']]) {
                      assert.equal(await panel.getByRole('link', { name, exact: true }).getAttribute('href'), `/${savedCompletion.save.result[key]}`);
                    }
                    assert.equal(await panel.getByRole('button', { name: /save|record completion/i }).count(), 0);
                    await panel.evaluate(element => element.scrollIntoView({ block: 'start' }));
                    const box = await panel.boundingBox();
                    assert(box && box.x >= 0 && box.x + box.width <= width && box.height < height, 'Completion preview does not fit the viewport');
                    assert(await panel.evaluate(element => element.scrollWidth <= element.clientWidth), 'Completion preview text overflows');
                    const screenshot = path.join(output, `${role}-${viewport}-saved-synthetic-attestation${readbackPhase === 'after-reload' ? '-after-reload' : ''}.png`);
                    await page.screenshot({ path: screenshot, animations: 'disabled' }); await chmod(screenshot, 0o600);
                    await panel.getByRole('button', { name: 'Dismiss preview', exact: true }).click();
                    assert(!(await panel.getByRole('checkbox').isChecked()));
                    results.push({ role, viewport, savedSyntheticAttestationReadBack: 'verified', confirmationRequired: true, noSaveControl: true,
                      readbackPhase, performedOn: '2026-06-15', illustrativeNextPeriodicOn: '2027-06-15', clinicalCompletionVerified: false, clinicalWrites: 0 });
                  }
                  if (reportOnly) {
                    phase = `${role}:${viewport}:demo-policy-assumptions`;
                    const assumptionControl = page.getByRole('button', { name: 'Demo policy assumptions', exact: true });
                    assert.equal(await assumptionControl.getAttribute('aria-expanded'), 'false'); await assumptionControl.click();
                    const policyPanel = page.getByRole('region', { name: 'Demo policy details', exact: true }); await policyPanel.waitFor();
                    assert.equal(await policyPanel.getAttribute('data-demo-policy'), demoPolicy.id);
                    assert.equal(await policyPanel.getAttribute('data-periodic-months'), String(demoPolicy.periodic.months));
                    assert.equal(await policyPanel.getAttribute('data-clinically-approved'), String(demoPolicy.clinicallyApproved));
                    assert.equal(await policyPanel.getByRole('heading').count(), 5);
                    await policyPanel.getByText(`Matrix Edition ${demoPolicy.matrix.edition}, Noise ${demoPolicy.matrix.program}, printed page ${demoPolicy.matrix.printedPage}. Demo-only implementation assumptions; clinical approval pending.`, { exact: true }).waitFor();
                    await policyPanel.getByText(`${demoPolicy.periodic.months} calendar months from the test performed date. Final synthetic evidence or a labelled attestation; clinical completion unverified.`, { exact: true }).waitFor();
                    for (const policy of [demoPolicy.baseline, demoPolicy.periodic, demoPolicy.termination, demoPolicy.enrollment, demoPolicy.supplementary]) {
                      await policyPanel.getByText(`Clinical review: ${policy.sme.join(', ')}`, { exact: true }).waitFor();
                    }
                    assert.equal(await policyPanel.getByRole('button').count(), 0); assert.equal(await policyPanel.getByRole('textbox').count(), 0);
                    const policyBox = await policyPanel.boundingBox(); assert(policyBox && policyBox.x >= 0 && policyBox.x + policyBox.width <= width);
                    assert(await policyPanel.evaluate(element => [element, ...element.querySelectorAll('p,h4')].every(node => node.scrollWidth <= node.clientWidth)), 'Policy text overflows');
                    const policyScreenshot = path.join(output, `${role}-${viewport}-demo-policy.png`);
                    await policyPanel.screenshot({ path: policyScreenshot, animations: 'disabled' }); await chmod(policyScreenshot, 0o600);
                    await assumptionControl.click(); assert.equal(await assumptionControl.getAttribute('aria-expanded'), 'false');
                    results.push({ role, viewport, demoPolicy: demoPolicy.id, assumptionCount: 5, approved: false,
                      clinicalCompletionVerified: false, operationalApprovalDeferred: true, clinicalWrites: 0, externalDispatch: false });
                    phase = `${role}:${viewport}:native-report-downloads`;
                    const reportPanel = page.getByRole('heading', { name: 'Synthetic worker report', exact: true }).locator('..');
                    await reportPanel.evaluate(element => element.scrollIntoView({ block: 'start' }));
                    for (const radio of await reportPanel.getByRole('radio').all()) {
                      const label = reportPanel.locator(`label[for="${await radio.getAttribute('id')}"]`);
                      assert(await label.evaluate(element => {
                        const range = document.createRange(); range.selectNodeContents(element);
                        const text = range.getBoundingClientRect(); const box = element.getBoundingClientRect();
                        return text.left >= box.left && text.right <= box.right;
                      }), 'Report mode label is clipped');
                    }
                    if (cohortOnly) {
                      const scope = reportPanel.getByRole('radio', { name: examplesOnly ? 'Examples' : 'Three workers', exact: true });
                      await reportPanel.locator(`label[for="${await scope.getAttribute('id')}"]`).click(); assert(await scope.isChecked());
                    }
                    const generate = reportPanel.getByRole('button', { name: 'Generate synthetic report', exact: true });
                    assert(await generate.isDisabled());
                    const reportUrl = `${api}/fhir/R4/Bot/${examplesOnly ? completionReportBotId : cohortOnly ? cohortReportBotId : nativeReportBotId}/$execute`;
                    for (const failureKind of ['transport', 'malformed-envelope', 'mismatched-source-head']) {
                      phase = `${role}:${viewport}:native-report-unavailable:${failureKind}`;
                      const sourceId = 'ee9554d3-4d03-483b-89cd-cda0fe3f5bcf';
                      const target = failureKind === 'mismatched-source-head'
                        ? url => url.origin === api && url.pathname === `/fhir/R4/DocumentReference/${sourceId}`
                        : reportUrl;
                      let interruptedRequests = 0;
                      const interruptReport = async route => {
                        const request = route.request();
                        assert.equal(request.method(), failureKind === 'mismatched-source-head' ? 'GET' : 'POST');
                        assert(permitsReadOnlyFhir(request.method(), request.url(), request.method() === 'POST' ? request.postDataJSON() : undefined));
                        interruptedRequests++;
                        if (failureKind === 'transport') await route.abort('failed');
                        else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
                          failureKind === 'malformed-envelope' ? {} : { resourceType: 'DocumentReference', id: sourceId,
                            meta: { project: projectId, versionId: 'unverified-demo-head' } }) });
                      };
                      await page.route(target, interruptReport);
                      await reportPanel.getByRole('checkbox', { name: 'I confirm this is a synthetic report', exact: true }).check();
                      await generate.click(); await reportPanel.getByText('Report unavailable', { exact: true }).waitFor();
                      assert.equal(interruptedRequests, 1, 'Unavailable report must not be automatically retried');
                      assert.equal(await reportPanel.getByRole('button', { name: 'Download synthetic CSV', exact: true }).count(), 0);
                      assert.equal(await reportPanel.getByRole('button', { name: 'Download report manifest', exact: true }).count(), 0);
                      await page.unroute(target, interruptReport);
                      await reportPanel.getByRole('checkbox', { name: 'I confirm this is a synthetic report', exact: true }).uncheck();
                      assert(await generate.isDisabled());
                      results.push({ role, viewport, reportUnavailable: 'verified', failureKind, interruptedReadOnlyRequests: interruptedRequests,
                        automaticRetries: 0, downloadsBlocked: true, clinicalWrites: 0, externalDispatch: false });
                    }
                    phase = `${role}:${viewport}:native-report-downloads`;
                    await reportPanel.getByRole('checkbox', { name: 'I confirm this is a synthetic report', exact: true }).check();
                    await generate.click();
                    await reportPanel.getByRole('button', { name: 'Download synthetic CSV', exact: true }).waitFor();
                    const files = {};
                    for (const [name, kind] of [['Download synthetic CSV', 'csv'], ['Download report manifest', 'manifest']]) {
                      const [download] = await Promise.all([page.waitForEvent('download'), reportPanel.getByRole('button', { name, exact: true }).click()]);
                      const suggested = download.suggestedFilename();
                      assert.match(suggested, kind === 'csv' ? /^synthetic-noise-report-\d{4}-\d{2}-\d{2}\.csv$/ : /^synthetic-noise-report-\d{4}-\d{2}-\d{2}\.manifest\.json$/);
                      const filename = path.join(output, `${viewport}-${suggested}`); await download.saveAs(filename); await chmod(filename, 0o600);
                      files[kind] = await readFile(filename, 'utf8');
                    }
                    const manifest = JSON.parse(files.manifest); const rows = parse(files.csv, { columns: true });
                    const expectedCount = cohortOnly ? 3 : 1;
                    assert.equal(rows.length, expectedCount); assert.equal(manifest.rowCount, expectedCount); assert.equal(manifest.suppliedWorkers, expectedCount); assert.equal(manifest.suppliedObligations, expectedCount);
                    assert.equal(manifest.projectId, projectId); assert.equal(manifest.csvSha256, createHash('sha256').update(files.csv).digest('hex'));
                    if (cohortOnly) {
                      const workers = nativeReport.result.config.workers;
                      assert.deepEqual(rows.map(row => row.worker), workers.map(worker => worker.worker.split('/').slice(0, 2).join('/')).sort());
                      const due = examplesOnly ? '2027-06-15' : '2026-01-01';
                      const timing = manifest.asOf > due ? 'overdue' : manifest.asOf < due ? 'current' : 'due';
                      assert.equal(rows.filter(row => row.synthetic_timing === timing).length, 2);
                      assert.equal(rows.filter(row => row.synthetic_timing === 'needs-review').length, 1);
                      assert.deepEqual(manifest.syntheticTimingCounts, { due: 0, overdue: 0, current: 0, 'needs-review': 1, [timing]: 2 });
                      if (examplesOnly) {
                        const expected = nativeReport.plan.config.completionExamples.map(example => ({ patient: example.worker.split('/').slice(0, 2).join('/'),
                          record: example.record, evidence: example.evidence, kind: example.kind, performedOn: '2026-06-15',
                          illustrativeNextPeriodicOn: '2027-06-15', clinicalCompletionVerified: false }));
                        assert.deepEqual(manifest.syntheticCompletionExamples, expected);
                        assert.equal(await reportPanel.getByText('Synthetic example performed 2026-06-15. Clinical completion unverified.', { exact: true }).count(), 2);
                        for (const [index, example] of expected.entries()) {
                          const row = rows.find(row => row.worker === example.patient);
                          assert.equal(row.stage, 'periodic'); assert.equal(row.due, example.illustrativeNextPeriodicOn);
                          assert(JSON.parse(row.supporting_references_json).includes(example.record)); assert(JSON.parse(row.supporting_references_json).includes(example.evidence));
                          for (const key of ['record', 'evidence']) {
                            const label = key === 'record' ? 'example' : 'evidence';
                            assert.equal(await reportPanel.getByRole('link', { name: `View Synthetic-${index + 1} ${label}`, exact: true }).getAttribute('href'), `/${example[key]}`);
                          }
                        }
                      }
                      assert.equal(manifest.clinicalCompletionVerified, false); assert.equal(manifest.completePopulation, false);
                      for (const [index, configured] of workers.entries()) {
                        const row = rows.find(candidate => candidate.worker === configured.worker.split('/').slice(0, 2).join('/'));
                        const obligation = configured.obligations[0];
                        assert.equal(row.exposure_history, obligation.exposure); assert.equal(row.source_history, nativeReport.result.config.ruleSource);
                        assert.equal(row.classification, 'unclassified'); assert.equal(row.clinical_completion_verified, 'false');
                        assert.equal(await reportPanel.getByRole('link', { name: `View Synthetic-${index + 1} exposure`, exact: true }).getAttribute('href'), `/${obligation.exposure}`);
                        if (obligation.enrollment) {
                          assert(JSON.parse(row.supporting_references_json).includes(obligation.enrollment));
                          assert.equal(await reportPanel.getByRole('link', { name: `View Synthetic-${index + 1} enrollment`, exact: true }).getAttribute('href'), `/${obligation.enrollment}`);
                        } else {
                          assert.equal(row.synthetic_timing, 'needs-review'); assert.equal(row.due, ''); assert.equal(row.review_required, 'true');
                          await reportPanel.getByText('Synthetic-3 - needs-review - No configured enrollment', { exact: true }).waitFor();
                          assert.equal(await reportPanel.getByRole('link', { name: 'View Synthetic-3 enrollment', exact: true }).count(), 0);
                        }
                      }
                      assert.equal(await reportPanel.getByRole('link', { name: 'View report rule source', exact: true }).getAttribute('href'), `/${nativeReport.result.config.ruleSource}`);
                    } else {
                    assert.equal(rows[0].worker, nativeReport.result.config.worker.split('/').slice(0, 2).join('/'));
                    assert.equal(rows[0].exposure_history, nativeReport.result.config.exposure); assert.equal(rows[0].source_history, nativeReport.result.config.ruleSource);
                    assert(JSON.parse(rows[0].supporting_references_json).includes(nativeReport.result.config.enrollment));
                    assert.equal(rows[0].classification, 'unclassified'); assert.equal(rows[0].clinical_completion_verified, 'false');
                    assert.equal(manifest.complianceAssessed, false); assert.equal(manifest.historicalReconstruction, false);
                    for (const [name, key] of [['View report exposure', 'exposure'], ['View report enrollment', 'enrollment'], ['View report rule source', 'ruleSource']]) {
                      assert.equal(await reportPanel.getByRole('link', { name, exact: true }).getAttribute('href'), `/${nativeReport.result.config[key]}`);
                    }
                    }
                    assert.equal(manifest.complianceAssessed, false); assert.equal(manifest.historicalReconstruction, false);
                    await reportPanel.getByText(`CSV SHA-256: ${manifest.csvSha256}`, { exact: true }).waitFor();
                    await reportPanel.evaluate(element => element.scrollIntoView({ block: 'start' }));
                    const reportBox = await reportPanel.boundingBox(); assert(reportBox && reportBox.x >= 0 && reportBox.x + reportBox.width <= width && reportBox.height < height,
                      `Report bounds ${JSON.stringify(reportBox)} exceed ${width}x${height}`);
                    assert(await reportPanel.evaluate(element => element.scrollWidth <= element.clientWidth), 'Report text overflows');
                    const reportScreenshot = path.join(output, `${role}-${viewport}-${examplesOnly ? 'completion' : cohortOnly ? 'cohort' : 'native'}-report.png`);
                    await page.screenshot({ path: reportScreenshot, animations: 'disabled' }); await chmod(reportScreenshot, 0o600);
                    phase = `${role}:${viewport}:native-report-reload`;
                    let reloadExports = 0;
                    const countReloadExports = request => {
                      const target = new URL(request.url());
                      if (request.method() === 'POST' && target.origin === api &&
                        [nativeReportBotId, cohortReportBotId, completionReportBotId].some(id => target.pathname === `/fhir/R4/Bot/${id}/$execute`)) reloadExports++;
                    };
                    page.on('request', countReloadExports);
                    try {
                      await page.reload();
                      await page.getByPlaceholder('Select worker').click();
                      await page.getByRole('option').first().click();
                      await reportPanel.waitFor();
                      await page.getByRole('radio', { name: 'synthetic maintenance bay', exact: true }).check();
                      assert(await reportPanel.getByRole('radio', { name: 'Selected worker', exact: true }).isChecked());
                      assert(!(await reportPanel.getByRole('checkbox', { name: 'I confirm this is a synthetic report', exact: true }).isChecked()));
                      assert(await generate.isDisabled());
                      for (const name of ['Download synthetic CSV', 'Download report manifest']) {
                        assert.equal(await reportPanel.getByRole('button', { name, exact: true }).count(), 0);
                      }
                      assert.equal(reloadExports, 0, 'Reload must not automatically generate a report');
                      if (cohortOnly) {
                        const scope = reportPanel.getByRole('radio', { name: examplesOnly ? 'Examples' : 'Three workers', exact: true });
                        await reportPanel.locator(`label[for="${await scope.getAttribute('id')}"]`).click();
                      }
                      await reportPanel.getByRole('checkbox', { name: 'I confirm this is a synthetic report', exact: true }).check();
                      await generate.click();
                      await reportPanel.getByText(`CSV SHA-256: ${manifest.csvSha256}`, { exact: true }).waitFor();
                      assert.equal(reloadExports, 1, 'Only the explicitly confirmed export may run');
                      for (const [name, kind] of [['Download synthetic CSV', 'csv'], ['Download report manifest', 'manifest']]) {
                        const [download] = await Promise.all([page.waitForEvent('download'), reportPanel.getByRole('button', { name, exact: true }).click()]);
                        const filename = path.join(output, `${viewport}-after-reload-${download.suggestedFilename()}`);
                        await download.saveAs(filename); await chmod(filename, 0o600);
                        const content = await readFile(filename, 'utf8');
                        if (kind === 'csv') assert.equal(content, files.csv);
                        else {
                          const freshManifest = JSON.parse(content);
                          assert.equal(freshManifest.csvSha256, manifest.csvSha256);
                          assert.equal(freshManifest.projectId, projectId);
                          assert.equal(freshManifest.rowCount, expectedCount);
                          assert.equal(freshManifest.clinicalCompletionVerified, manifest.clinicalCompletionVerified);
                        }
                      }
                      await reportPanel.evaluate(element => element.scrollIntoView({ block: 'start' }));
                      const reloadScreenshot = path.join(output, `${role}-${viewport}-report-after-reload.png`);
                      await page.screenshot({ path: reloadScreenshot, animations: 'disabled' }); await chmod(reloadScreenshot, 0o600);
                      results.push({ role, viewport, reportReload: 'verified', previousDownloadsCleared: true,
                        freshConfirmationRequired: true, automaticExports: 0, explicitExports: reloadExports,
                        csvSha256: manifest.csvSha256, clinicalWrites: 0 });
                    } finally {
                      page.off('request', countReloadExports);
                    }
                    await reportPanel.getByRole('button', { name: 'Dismiss report', exact: true }).click();
                    assert(!(await reportPanel.getByRole('checkbox').isChecked()));
                    assert.equal(await reportPanel.getByRole('button', { name: 'Download synthetic CSV', exact: true }).count(), 0);
                    results.push({ role, viewport, nativeScopedReport: 'verified', csvAndManifestDownloaded: true, csvSha256: manifest.csvSha256,
                      suppliedWorkers: expectedCount, suppliedObligations: expectedCount, missingEnrollmentRetained: cohortOnly,
                      completionAssessed: false, clinicalWrites: 0, externalDispatch: false });
                    if (examplesOnly) results.at(-1).syntheticCompletionExamples = 2;
                    if (technicalDrilldowns) {
                      phase = `${role}:${viewport}:native-history`;
                      await exerciseNativeHistory(page, output, role, viewport, results);
                      phase = `${role}:${viewport}:native-evidence-history`;
                      await exerciseNativeHistory(page, output, role, viewport, results, true);
                      phase = `${role}:${viewport}:native-lineage-history`;
                      await exerciseNativeHistory(page, output, role, viewport, results, true, true);
                      phase = `${role}:${viewport}:native-recorded-time`;
                      await exerciseNativeRecordedTime(page, output, role, viewport, results, directory);
                      phase = `${role}:${viewport}:native-rule-history`;
                      await exerciseNativeRecordedTime(page, output, role, viewport, results, directory, true);
                      phase = `${role}:${viewport}:native-matrix-history`;
                      await exerciseNativeRecordedTime(page, output, role, viewport, results, directory, true, true);
                      phase = `${role}:${viewport}:native-matrix-pdf`;
                      await exerciseNativeMatrixPdf(page, output, role, viewport, results, directory);
                    }
                  }
                }
              }
              for (const decision of acceptedOnly ? [] : ['Accept', 'Modify', 'Dismiss']) {
                phase = `${role}:${viewport}:decision-${decision.toLowerCase()}-preview`;
                await page.getByText('Requirement classification: Unclassified', { exact: true }).waitFor();
                const radio = page.getByRole('radio', { name: decision, exact: true });
                await page.locator(`label[for="${await radio.getAttribute('id')}"]`).click();
                assert(await radio.isChecked());
                if (decision === 'Modify') await page.getByLabel('Clinician-selected due date', { exact: true }).fill('2026-12-01');
                await page.getByRole('button', { name: 'Review decision', exact: true }).click();
                const dialog = page.getByRole('dialog', { name: 'Confirm clinician decision', exact: true });
                await dialog.waitFor();
                const confirm = dialog.getByRole('button', { name: 'Record decision', exact: true });
                assert(await confirm.isDisabled(), 'Clinician confirmation is required');
                const checkbox = dialog.getByRole('checkbox');
                await checkbox.check();
                assert(await confirm.isEnabled());
                await checkbox.uncheck();
                assert(await confirm.isDisabled());
                await page.waitForFunction(element => {
                  for (let node = element; node; node = node.parentElement) if (Number(getComputedStyle(node).opacity) < 1) return false;
                  const box = element.getBoundingClientRect();
                  return box.width > 0 && box.x >= 0 && box.right <= innerWidth && box.y >= 0 && box.bottom <= innerHeight &&
                    element.scrollWidth <= element.clientWidth;
                }, await dialog.elementHandle());
                const screenshot = path.join(output, `${role}-${viewport}-decision-${decision.toLowerCase()}.png`);
                await page.screenshot({ path: screenshot, animations: 'disabled' });
                await chmod(screenshot, 0o600);
                await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
                await dialog.waitFor({ state: 'hidden' });
                results.push({ role, viewport, decision: decision.toLowerCase(), nativePreview: 'verified', confirmationCancelled: true, clinicalWrites: 0 });
              }
            } else {
              assert.equal(await inspectWork.count(), 0, 'Read-only role has clinician inspection control');
              assert.equal(await page.getByRole('button', { name: 'Inspect synthetic technical history', exact: true }).count(), 0, 'Read-only role has technical history control');
              assert.equal(await page.getByRole('button', { name: 'Inspect selected recorded time', exact: true }).count(), 0, 'Read-only role has recorded-time control');
              assert.equal(await page.getByRole('button', { name: 'Inspect rule history', exact: true }).count(), 0, 'Read-only role has rule-history control');
              assert.equal(await page.getByRole('button', { name: 'Inspect Matrix history', exact: true }).count(), 0, 'Read-only role has Matrix-history control');
              assert.equal(await page.getByRole('button', { name: 'Review decision', exact: true }).count(), 0, 'Read-only role has clinician decision controls');
              assert.equal(await page.getByRole('button', { name: 'Preview simulated completion', exact: true }).count(), 0, 'Read-only role has completion preview controls');
              assert.equal(await page.getByRole('button', { name: 'Generate synthetic report', exact: true }).count(), 0, 'Read-only role has report controls');
              assert.equal(await page.getByRole('region', { name: 'Matrix PDF verification', exact: true }).count(), 0, 'Read-only role has PDF verification controls');
              assert.equal(await page.getByRole('button', { name: 'Inspect recorded history', exact: true }).count(), 0, 'Read-only role has history controls');
              assert.equal(await page.getByRole('button', { name: 'Inspect synthetic evidence history', exact: true }).count(), 0, 'Read-only role has evidence-history controls');
            }
            const attribution = timeline.getByRole('button', { name: 'View amendment attribution', exact: true });
            if (await attribution.count()) {
              phase = `${role}:${viewport}:amendment-attribution`;
              await attribution.first().click();
              const dialog = page.getByRole('dialog', { name: 'Amendment attribution', exact: true });
              const lineage = dialog.getByRole('link', { name: 'Amendment lineage', exact: true });
              const unavailable = dialog.getByText('Verified amendment attribution is unavailable.', { exact: true });
              await lineage.or(unavailable).waitFor();
              const verified = (await lineage.count()) === 1;
              if (verified) {
                assert.match(
                  await lineage.getAttribute('href'),
                  /^\/Provenance\/[A-Za-z0-9.-]+\/_history\/[A-Za-z0-9.-]+$/
                );
                assert.match(
                  await dialog.getByRole('link', { name: 'Prior exposure version', exact: true }).getAttribute('href'),
                  /^\/Observation\/[A-Za-z0-9.-]+\/_history\/[A-Za-z0-9.-]+$/
                );
                assert.match(
                  await dialog.getByRole('link', { name: /^Practitioner\// }).getAttribute('href'),
                  /^\/Practitioner\/[A-Za-z0-9.-]+$/
                );
                await dialog.getByText('Recorded at (UTC)', { exact: true }).waitFor();
                await dialog.getByText(/^(Correct dates|Correct worksite|End exposure)$/).waitFor();
              } else assert.equal(await dialog.getByText('Recorded by', { exact: true }).count(), 0);
              assert.equal(await dialog.getByRole('button', { name: /save|apply|repair/i }).count(), 0);
              const bounds = await dialog.boundingBox();
              assert(
                bounds && bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width,
                'Amendment attribution outside viewport'
              );
              assert(
                await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
                'Amendment attribution content overflow'
              );
              const screenshot = path.join(output, `${role}-${viewport}-amendment-attribution.png`);
              await page.screenshot({ path: screenshot, animations: 'disabled' });
              await chmod(screenshot, 0o600);
              results.push({ role, viewport, amendmentAttribution: verified ? 'verified' : 'unavailable' });
              await dialog.getByRole('button', { name: 'Close amendment attribution', exact: true }).click();
              await dialog.waitFor({ state: 'hidden' });
            } else results.push({ role, viewport, amendmentAttribution: 'not-exercised' });
            await timeline.getByRole('cell').first().scrollIntoViewIfNeeded();
          } else await page.getByText('No recorded exposure episodes.', { exact: true }).waitFor();
          phase = `${role}:${viewport}:assessment-history`;
          await page
            .getByRole('heading', { name: 'Noise measurements', exact: true })
            .or(page.getByText('Assessment history unavailable', { exact: true }))
            .first()
            .waitFor();
          assert.equal(
            await page.getByText('Assessment history unavailable', { exact: true }).count(),
            0,
            'Assessment bindings failed verification'
          );
          for (const [title, empty] of [
            ['Noise measurements', 'No recorded noise measurements in this result.'],
            ['Enrollment determinations', 'No recorded enrollment determinations in this result.'],
          ]) {
            await page.getByRole('heading', { name: title, exact: true }).waitFor();
            const section = page.getByRole('region', { name: title, exact: true });
            const assessments = section.getByRole('table', { name: title, exact: true });
            if (await assessments.count()) {
              for (const link of await assessments.getByRole('link').all()) {
                assert.match(
                  await link.getAttribute('href'),
                  /^\/(?:Observation|DocumentReference)\/[A-Za-z0-9.-]+\/history$/
                );
              }
            } else {
              await section
                .getByText(empty, { exact: true })
                .or(section.getByText('No verified records in this result.', { exact: true }))
                .waitFor();
              if (await section.getByText('No verified records in this result.', { exact: true }).count())
                assert(
                  await section.getByText(/^Needs review: /).count(),
                  'Unverified records lack a source-review state'
                );
            }
          }
          for (const link of await page.getByRole('link', { name: /^View (measurement|enrollment) record$/ }).all()) {
            assert.match(await link.getAttribute('href'), /^\/Observation\/[A-Za-z0-9.-]+\/_history\/[A-Za-z0-9.-]+$/);
            assert.match(await link.locator('..').innerText(), /A linked|The recorded/);
          }
          await page.getByRole('textbox', { name: 'Exposure start', exact: true }).fill('2026-01-01');
          await page.getByRole('radio', { name: 'unknown', exact: true }).check();
          await page.getByRole('checkbox', { name: 'Record known assessment details', exact: true }).check();
          await page.getByRole('radio', { name: 'eight hour twa', exact: true }).check();
          await page.getByRole('radio', { name: 'dBA', exact: true }).check();
          await page.getByRole('radio', { name: '8h', exact: true }).check();
          await page.getByRole('radio', { name: 'synthetic personal dosimetry', exact: true }).check();
          await page.getByRole('textbox', { name: 'Assessment date', exact: true }).fill('2026-01-02');
          phase = `${role}:${viewport}:evidence`;
          const evidenceRadio = page
            .locator('.mantine-Radio-root')
            .filter({ has: page.locator('a[href*="/DocumentReference/"]') })
            .first()
            .getByRole('radio');
          await evidenceRadio.check();
          if (role === 'clinician') await page.getByRole('radio', { name: 'not provided', exact: true }).last().check();
          else {
            assert.equal(await page.getByText('Separate enrollment review', { exact: true }).count(), 0);
            assert.equal(await page.getByRole('textbox', { name: 'Exposure episode', exact: true }).count(), 0);
          }
          assert.equal(await page.getByRole('textbox', { name: 'Measured value', exact: true }).count(), 0);
          phase = `${role}:${viewport}:preview`;
          await page.getByRole('button', { name: 'Preview intake', exact: true }).click();
          await page.getByRole('dialog', { name: 'Save synthetic intake?' }).waitFor();
          await page.getByText('Measurement: unknown', { exact: true }).waitFor();
          await page.getByRole('button', { name: 'Cancel', exact: true }).click();
          await page.getByRole('dialog', { name: 'Save synthetic intake?' }).waitFor({ state: 'hidden' });
          if (role === 'clinician') {
            phase = `${role}:${viewport}:advisory-scenario`;
            const scenario = page.getByRole('region', { name: 'Synthetic advisory scenario' });
            await scenario.getByRole('textbox', { name: 'Advisory exposure', exact: true }).click();
            await page.getByRole('option').first().click();
            await scenario.getByRole('button', { name: 'Preview advisory', exact: true }).click();
            await scenario
              .getByText(/^Scenario status:/)
              .or(scenario.getByText('Advisory not confirmed', { exact: true }))
              .first()
              .waitFor();
            assert.equal(
              await scenario.getByText('Advisory not confirmed', { exact: true }).count(),
              0,
              'Advisory response failed verification'
            );
            await scenario.getByText('Scenario status: needs review', { exact: true }).waitFor();
            await page.waitForFunction(
              (button) => {
                const label = button?.querySelector('.mantine-Button-label');
                if (!label || button.hasAttribute('data-loading')) return false;
                const outer = button.getBoundingClientRect();
                const inner = label.getBoundingClientRect();
                return inner.top >= outer.top && inner.bottom <= outer.bottom;
              },
              await scenario.getByRole('button', { name: 'Preview advisory', exact: true }).elementHandle()
            );
            await scenario
              .getByText('Rule: https://hiivehealth.com/fhir/PlanDefinition/synthetic-noise-503|demo-1', {
                exact: true,
              })
              .waitFor();
            assert.equal(await scenario.getByRole('button', { name: /accept|apply|save/i }).count(), 0);
          } else assert.equal(await page.getByRole('region', { name: 'Synthetic advisory scenario' }).count(), 0);
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
        const screenshot = path.join(output, `${role}-${viewport}-intake.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        await chmod(screenshot, 0o600);
        if (role === 'clinician') {
          phase = `${role}:${viewport}:completion-scenario`;
          await page.getByPlaceholder('Select worker').click();
          await page.getByRole('option', { name: /Synthetic-2/ }).click();
          await page.getByRole('heading', { name: 'Enrollment determinations', exact: true }).waitFor();
          const scenario = page.getByRole('region', { name: 'Synthetic advisory scenario' });
          const exposureId = state.references['Observation/noise-episode-noise-worker-2'].split('/')[1];
          const enrollmentId = state.references['Observation/enrollment-2'].split('/')[1];
          const completionId = state.references['Observation/completed-audiogram'].split('/')[1];
          await scenario.getByRole('textbox', { name: 'Advisory exposure', exact: true }).click();
          await page.getByRole('option', { name: new RegExp(exposureId) }).click();
          await scenario.getByRole('textbox', { name: 'Advisory enrollment', exact: true }).click();
          await page.getByRole('option', { name: 'Not included', exact: true }).waitFor();
          const enrollmentOption = page.getByRole('option', { name: new RegExp(enrollmentId) });
          if (!(await enrollmentOption.count())) {
            await page.keyboard.press('Escape');
            assert(
              await page.locator(`a[href^="/Observation/${enrollmentId}/_history/"]`).count(),
              'Missing enrollment must have a visible source-review state'
            );
            results.push({ role, viewport, completionScenario: 'blocked-unverified-enrollment', clinicalWrites: 0 });
          } else {
            await enrollmentOption.click();
            await scenario.getByLabel('Scenario date', { exact: true }).fill('2026-10-21');
            await scenario.getByRole('button', { name: 'Preview advisory', exact: true }).click();
            await scenario.getByText('Scenario status: overdue', { exact: true })
              .or(scenario.getByText('Advisory not confirmed', { exact: true })).first().waitFor();
            assert.equal(await scenario.getByText('Advisory not confirmed', { exact: true }).count(), 0,
              'Baseline advisory failed verification');
            await scenario.getByText('Scenario status: overdue', { exact: true }).waitFor();
            await scenario.getByText('Stage: baseline', { exact: true }).waitFor();
            await scenario.getByText('Scenario due date: 2026-01-01', { exact: true }).waitFor();
            results.push({
              role,
              viewport,
              enrollmentScenario: 'verified-baseline-overdue-completion-omitted',
              clinicalWrites: 0,
            });
            const completionInput = scenario.getByRole('textbox', { name: 'Advisory completion', exact: true });
            await page.waitForFunction((input) => !input.disabled, await completionInput.elementHandle());
            await completionInput.click();
            const completionOption = page.getByRole('option', { name: new RegExp(completionId) });
            assert(await completionOption.count(), 'Saved completion is not eligible; source review required');
            await completionOption.click();
            await scenario.getByRole('button', { name: 'Preview advisory', exact: true }).click();
            await scenario.getByText('Scenario status: current', { exact: true }).waitFor();
            await scenario.getByText('Stage: periodic', { exact: true }).waitFor();
            await scenario.getByText('Scenario due date: 2027-06-15', { exact: true }).waitFor();
            await page.waitForFunction(
              (button) => {
                const label = button?.querySelector('.mantine-Button-label');
                if (!label || button.hasAttribute('data-loading')) return false;
                const outer = button.getBoundingClientRect();
                const inner = label.getBoundingClientRect();
                return inner.top >= outer.top && inner.bottom <= outer.bottom;
              },
              await scenario.getByRole('button', { name: 'Preview advisory', exact: true }).elementHandle()
            );
            results.push({ role, viewport, completionScenario: 'verified-periodic-current', clinicalWrites: 0 });
          }
          assert(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            'Completion scenario overflow'
          );
          const completionScreenshot = path.join(output, `${role}-${viewport}-completion.png`);
          await page.screenshot({ path: completionScreenshot, fullPage: true });
          await chmod(completionScreenshot, 0o600);
        }
        phase = `${role}:${viewport}:review`;
        await page.goto(`${origin}/oem/ih-review`);
        await page.getByRole('heading', { name: 'IH source review', exact: true }).waitFor();
        if (role === 'clinician') {
          await page
            .getByRole('button', { name: /^Open review / })
            .first()
            .click();
          await page.getByText('Exact evidence', { exact: true }).waitFor();
          assert(await page.getByRole('button', { name: 'Keep current record', exact: true }).isDisabled());
        } else assert.equal(await page.getByRole('button', { name: 'Keep current record', exact: true }).count(), 0);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
        const reviewScreenshot = path.join(output, `${role}-${viewport}-review.png`);
        await page.screenshot({ path: reviewScreenshot, fullPage: true });
        await chmod(reviewScreenshot, 0o600);
        results.push({ role, viewport, intakeReadOnly: true, reviewReadOnly: true });
      }
      assert.equal(results.filter(result => result.role === role && result.completionScenarioUnexpectedNavigation).length, 0,
        'Unexpected document navigation interrupted the completion scenario');
      assert.equal(blocked.length, 0, 'Unexpected FHIR write was blocked');
      assert.equal(errors.length, 0, 'Browser runtime error');
      results.push({
        role,
        blockedWrites: blocked.length,
        runtimeErrors: errors.length,
        attributionReadStatuses: network
          .filter((entry) => entry.role === role && entry.phase.endsWith(':amendment-attribution'))
          .flatMap((entry) =>
            entry.resourceType === 'batch'
              ? (entry.batchReads ?? [])
              : ['Observation', 'Provenance'].includes(entry.resourceType)
                ? [{ resourceType: entry.resourceType, status: entry.status ?? 'no-response' }]
                : []
          ),
        provenanceReadStatuses: [
          ...new Set(
            network
              .filter((entry) => entry.role === role && entry.resourceType === 'Provenance')
              .map((entry) => entry.status ?? 'no-response')
          ),
        ],
        cuiServiceAvailable: cuiStatuses.length > 0 && cuiStatuses.every((status) => status === 200),
      });
      if (requireCui) assert(cuiStatuses.length > 0 && cuiStatuses.every(status => status === 200), 'Required CUI service unavailable');
      if (requireNoDoseSpot) {
        assert.equal(doseSpotAccessRequests, 0, 'Demo must not run DoseSpot enrollment searches');
        assert.equal(await page.getByText('DoseSpot Access Check Failed', { exact: true }).count(), 0);
        assert.equal(await page.locator('iframe[src*="dosespot"]').count(), 0);
        results.push({ role, doseSpotAccessRequests, doseSpotErrorOverlays: 0, prescribingPermissionsChanged: false });
      }
      await context.close();
    }
    assert.equal(await readFile(stateFile, 'utf8'), originalState, 'Protected backend state changed');
    await writeFile(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          mode: presenterOnly ? 'presenter-completion-report-read-only' : examplesOnly ? 'native-completion-report-read-only' : cohortOnly ? 'native-cohort-report-read-only' : reportOnly ? 'native-report-read-only' : personnelOnly
            ? 'authenticated-personnel-preview-read-only'
            : ruleOnly
              ? 'authenticated-rule-review-read-only'
              : 'authenticated-read-only',
          projectId,
          results,
          ...(presenterOnly ? { technicalDrilldownsExercised: false } : {}),
          clinicalWrites: 0,
          saveReadBackVerified: false,
        },
        null,
        2
      ),
      { mode: 0o600, flag: 'wx' }
    );
    console.log(
      `PASS: authenticated read-only desktop/mobile ${presenterOnly ? 'presenter workflow for clinician, IH and reviewer (optional technical drill-downs excluded)' : personnelOnly ? 'personnel preview for clinician and three denied roles' : ruleOnly ? 'rule review for admin and three denied roles' : 'rehearsal for clinician, IH and reviewer'}; no save or review decisions submitted`
    );
    console.log(
      'CUI policy service availability:',
      results.filter((result) => 'cuiServiceAvailable' in result).every((result) => result.cuiServiceAvailable)
    );
  } catch (error) {
    if (activePage && !phase.endsWith(':sign-in')) {
      const screenshot = path.join(output, 'failure.png');
      await activePage.screenshot({ path: screenshot, fullPage: true });
      await chmod(screenshot, 0o600);
    }
    await writeFile(
      path.join(output, 'failure.json'),
      JSON.stringify({
        phase,
        completedChecks: results,
        clinicalWrites: 0,
        network,
        errorKind: error.name,
        detail: phase.endsWith(':sign-in') ? 'Authentication detail suppressed' : error.message,
      }),
      { mode: 0o600, flag: 'wx' }
    );
    throw new Error(
      `Read-only browser rehearsal stopped at ${phase}; private evidence retained, credentials suppressed`
    );
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
