import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const HAWAII_DEMO_SYSTEM = 'https://hiivehealth.com/fhir/identifier/hawaii-cqie-demo';

export function buildHawaiiOnboardingBundle() {
  const system = 'https://hiivehealth.com/fhir/identifier/hawaii-cqie-onboarding';
  const snapshot = JSON.parse(readFileSync(new URL('../fhir/hawaii/onboarding-snapshot.json', import.meta.url), 'utf8'));
  return { resourceType: 'Bundle', type: 'transaction', entry: [{
    fullUrl: `urn:uuid:${randomUUID()}`,
    resource: { resourceType: 'Basic', identifier: [{ system, value: 'synthetic-rural-site' }],
      code: { coding: [{ system, code: 'site-readiness' }], text: 'Synthetic participant onboarding snapshot' },
      extension: [{ url: 'https://hiivehealth.com/fhir/StructureDefinition/hawaii-cqie-onboarding', valueString: JSON.stringify(snapshot) }] },
    request: { method: 'POST', url: 'Basic', ifNoneExist: `identifier=${encodeURIComponent(`${system}|synthetic-rural-site`)}` },
  }] };
}

export function buildHawaiiDemoBundle() {
  const resources = new Map();
  const reference = (key, display) => ({ reference: resources.get(key).fullUrl, ...(display ? { display } : {}) });
  const add = (key, resource) => {
    resources.set(key, {
      fullUrl: `urn:uuid:${randomUUID()}`,
      resource: { ...resource, identifier: [{ system: HAWAII_DEMO_SYSTEM, value: key }] },
      request: { method: 'POST', url: resource.resourceType,
        ifNoneExist: `identifier=${encodeURIComponent(`${HAWAII_DEMO_SYSTEM}|${key}`)}` },
    });
  };
  for (const [key, name] of [
    ['hospital', 'Demo Hawaii Rural Hospital'], ['practice', 'Demo Hawaii Community Practice'],
    ['laboratory', 'Demo Hawaii Laboratory'],
  ]) {
    add(key, { resourceType: 'Organization', active: true, name });
  }
  for (const [key, given, provision] of [
    ['patient-permitted', 'Avery', 'permit'], ['patient-opted-out', 'Morgan', 'deny'],
    ['patient-not-declared', 'Taylor', undefined],
  ]) {
    add(key, { resourceType: 'Patient', active: true, name: [{ family: 'Synthetic', given: [given] }],
      birthDate: '1978-05-12', gender: 'unknown', managingOrganization: reference('practice', 'Demo Hawaii Community Practice') });
    if (provision) {
      add(`consent-${key}`, { resourceType: 'Consent', status: 'active',
        scope: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy' }] },
        category: [{ coding: [{ system: 'http://loinc.org', code: '59284-0', display: 'Consent Document' }] }],
        policyRule: { text: 'Synthetic demonstration sharing policy; not a production consent authorization' },
        patient: reference(key), dateTime: '2026-10-01T00:00:00Z',
        provision: { type: provision, period: { start: '2026-10-01T00:00:00Z', end: '2027-10-01T00:00:00Z' } } });
    }
    add(`encounter-${key}`, { resourceType: 'Encounter', status: 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP' },
      type: [{ text: 'Hospital discharge' }], subject: reference(key),
      period: { start: '2026-10-12T14:00:00Z', end: '2026-10-14T16:00:00Z' },
      serviceProvider: reference('hospital', 'Demo Hawaii Rural Hospital') });
    add(`condition-${key}`, { resourceType: 'Condition', subject: reference(key),
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
      code: { text: 'Type 2 diabetes mellitus', coding: [{ system: 'http://snomed.info/sct', code: '44054006' }] },
      onsetDateTime: '2020-03-01T00:00:00Z', recorder: reference('practice', 'Demo Hawaii Community Practice') });
    add(`observation-${key}`, { resourceType: 'Observation', status: 'final', subject: reference(key),
      code: { text: 'Hemoglobin A1c', coding: [{ system: 'http://loinc.org', code: '4548-4' }] },
      effectiveDateTime: '2026-10-13T09:00:00Z', valueQuantity: { value: 8.1, unit: '%', system: 'http://unitsofmeasure.org', code: '%' },
      performer: [reference('laboratory', 'Demo Hawaii Laboratory')] });
    add(`document-${key}`, { resourceType: 'DocumentReference', status: 'current', subject: reference(key),
      date: '2026-10-14T16:00:00Z', description: 'Synthetic discharge summary',
      custodian: reference('hospital', 'Demo Hawaii Rural Hospital'),
      content: [{ attachment: { contentType: 'text/plain', title: 'Synthetic discharge summary',
        data: Buffer.from('SYNTHETIC DEMO ONLY. Discharged home; reconcile medications and arrange primary care follow-up.').toString('base64') } }] });
  }
  return { resourceType: 'Bundle', type: 'transaction', entry: [...resources.values()] };
}

function checkBundle(bundle) {
  const urls = new Set(bundle.entry.map((entry) => entry.fullUrl));
  const identifiers = new Set();
  for (const entry of bundle.entry) {
    const identifier = entry.resource.identifier[0];
    assert(!identifiers.has(identifier.value));
    identifiers.add(identifier.value);
    assert(entry.request.ifNoneExist.includes(encodeURIComponent(HAWAII_DEMO_SYSTEM)));
    const visit = (value) => {
      if (!value || typeof value !== 'object') { return; }
      if (typeof value.reference === 'string') { assert(urls.has(value.reference), `Unresolved ${value.reference}`); }
      Object.values(value).forEach(visit);
    };
    visit(entry.resource);
    if (entry.resource.resourceType === 'Consent') {
      assert(entry.resource.policyRule || entry.resource.policy?.length, 'Consent requires policy or policyRule (ppc-1)');
    }
  }
  assert.equal(bundle.entry.filter((entry) => entry.resource.resourceType === 'Patient').length, 3);
  assert.equal(bundle.entry.filter((entry) => entry.resource.resourceType === 'Organization').length, 3);
  assert.equal(bundle.entry.filter((entry) => entry.resource.resourceType === 'Consent').length, 2);
  console.log(`PASS: ${bundle.entry.length} synthetic resources; references, conditional creation, and three consent scenarios checked.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const onboarding = process.argv.includes('--onboarding');
  const bundle = onboarding ? buildHawaiiOnboardingBundle() : buildHawaiiDemoBundle();
  if (process.argv.includes('--check') && onboarding) {
    assert.equal(bundle.entry.length, 1);
    assert.equal(bundle.entry[0].resource.resourceType, 'Basic');
    assert.equal(bundle.entry[0].resource.subject, undefined);
    console.log('PASS: separate operational Basic bundle; no clinical resources or writes. Run the onboarding tests for schema and metric validation.');
  }
  else if (process.argv.includes('--check')) { checkBundle(bundle); }
  else { console.log(JSON.stringify(bundle, null, 2)); }
}