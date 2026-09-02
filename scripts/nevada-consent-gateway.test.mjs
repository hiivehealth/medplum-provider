import assert from 'node:assert/strict';
import test from 'node:test';
import { getBreakGlassAudit } from './nevada-consent-gateway.mjs';

test('gets only the newest Break Glass audit for the requesting practitioner and patient', async () => {
  let requestUrl;
  const audit = { resourceType: 'AuditEvent', id: 'audit-1' };
  const fetchImpl = async (url) => {
    requestUrl = new URL(url);
    return new Response(JSON.stringify({ resourceType: 'Bundle', entry: [{ resource: audit }] }), {
      status: 200,
      headers: { 'content-type': 'application/fhir+json' },
    });
  };

  const result = await getBreakGlassAudit(
    fetchImpl,
    'Patient/patient-1',
    'Practitioner/provider-1',
    'test-token'
  );

  assert.deepEqual(result, audit);
  assert.equal(requestUrl.pathname, '/fhir/R4/AuditEvent');
  assert.equal(requestUrl.searchParams.get('entity'), 'Patient/patient-1');
  assert.equal(requestUrl.searchParams.get('subtype'), 'emergency-access');
  assert.equal(requestUrl.searchParams.get('agent'), 'Practitioner/provider-1');
  assert.equal(requestUrl.searchParams.get('_sort'), '-recorded');
  assert.equal(requestUrl.searchParams.get('_count'), '1');
});

test('does not look up an audit without both patient and practitioner context', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return new Response();
  };

  assert.equal(await getBreakGlassAudit(fetchImpl, 'Patient/patient-1', undefined, 'test-token'), undefined);
  assert.equal(called, false);
});