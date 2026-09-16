import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createCuiHandler } from '../service.mjs';
const profile = 'https://medplum.com/fhir/StructureDefinition/cui-configuration';
const enabledUrl = 'https://medplum.com/fhir/StructureDefinition/cui-banner-enabled';
const config = {
  medplumBaseUrl: 'https://medplum.example/',
  projects: {
    p1: {
      configurationId: 'c1',
      readerClientId: 'reader',
      readerClientSecret: 'private',
      managerAccessPolicyIds: ['security'],
    },
  },
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
async function fixture(t, options = {}) {
  const calls = [];
  const resource = {
    resourceType: 'Basic',
    id: 'c1',
    meta: { project: 'p1', profile: [profile] },
    ...options.resource,
  };
  const policy = {
    resourceType: 'AccessPolicy',
    basedOn: [{ reference: 'AccessPolicy/security' }],
    resource: [{ resourceType: 'Basic', criteria: 'Basic?_id=c1', interaction: ['read', 'update'] }],
    ...options.policy,
  };
  const handler = createCuiHandler(config, async (url, init) => {
    const path = url.pathname;
    const auth = init.headers.Authorization;
    calls.push({ path, auth, method: init.method ?? 'GET', body: init.body?.toString(), redirect: init.redirect });
    if (path === '/oauth2/token') return json({ access_token: 'reader-token', expires_in: 300 });
    if (path === '/auth/me' && auth === 'Bearer reader-token')
      return json({
        project: { id: options.readerProject ?? 'p1' },
        membership: { admin: options.readerAdmin ?? false },
      });
    if (path === '/auth/me')
      return json({ project: { id: options.projectId ?? 'p1' }, accessPolicy: policy }, options.authStatus ?? 200);
    if (path === '/fhir/R4/Basic/c1' && auth === 'Bearer reader-token')
      return json(resource, options.readStatus ?? 200);
    if (path === '/fhir/R4/Basic/c1' && auth === 'Bearer caller') return json(resource, options.userReadStatus ?? 200);
    throw new Error('Unexpected upstream call');
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    resource,
    calls,
    get: (path = '/api/cui-banner', init = {}) =>
      fetch(url + path, { headers: { Authorization: 'Bearer caller' }, ...init }),
  };
}

test('absent boolean defaults to false, explicit on/off reflect fresh reads without writes', async (t) => {
  const f = await fixture(t);
  let response = await f.get();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { projectId: 'p1', configurationId: 'c1', enabled: false, canManage: true });
  f.resource.extension = [{ url: enabledUrl, valueBoolean: true }];
  assert.equal((await (await f.get()).json()).enabled, true);
  f.resource.extension[0].valueBoolean = false;
  assert.equal((await (await f.get()).json()).enabled, false);
  assert.equal(f.calls.filter((c) => c.method !== 'GET').length, 1); // client-credentials exchange only
  assert.ok(f.calls.every((c) => c.redirect === 'error'));
});
test('member receives only display decision without configuration read privileges', async (t) => {
  const f = await fixture(t, {
    policy: { basedOn: [], resource: [{ resourceType: 'Patient' }] },
    resource: { extension: [{ url: enabledUrl, valueBoolean: true }] },
  });
  assert.deepEqual(await (await f.get()).json(), {
    projectId: 'p1',
    configurationId: 'c1',
    enabled: true,
    canManage: false,
  });
  assert.equal(f.calls.filter((c) => c.auth === 'Bearer caller' && c.path.includes('/Basic/')).length, 0);
});
test('read-only scope and server denial prevent management', async (t) => {
  for (const options of [
    { policy: { resource: [{ resourceType: 'Basic', interaction: ['read'] }] } },
    { userReadStatus: 403 },
  ]) {
    const f = await fixture(t, options);
    assert.equal((await (await f.get()).json()).canManage, false);
  }
});
test('rejects missing and invalid authentication before service credentials are used', async (t) => {
  const f = await fixture(t, { authStatus: 401 });
  assert.equal((await f.get(undefined, { headers: {} })).status, 401);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.get()).status, 401);
  assert.equal(f.calls.length, 1);
});
test('rejects project override and all mutation routes', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.get('/api/cui-banner?projectId=other')).status, 404);
  assert.equal((await f.get(undefined, { method: 'POST' })).status, 405);
  assert.equal(f.calls.length, 0);
});
test('unprovisioned project and wrong reader identity fail closed', async (t) => {
  for (const options of [{ projectId: 'other' }, { readerProject: 'other' }, { readerAdmin: true }]) {
    const f = await fixture(t, options);
    assert.equal((await f.get()).status, 503);
    assert.equal(
      f.calls.some((c) => c.path.includes('/Basic/')),
      false
    );
  }
});
test('malformed, duplicate, cross-project and unprofiled resources never silently disable the banner', async (t) => {
  for (const resource of [
    { extension: [{ url: enabledUrl, valueString: 'true' }] },
    {
      extension: [
        { url: enabledUrl, valueBoolean: true },
        { url: enabledUrl, valueBoolean: false },
      ],
    },
    { extension: [{ url: enabledUrl, valueBoolean: true, valueString: 'true' }] },
    { meta: { project: 'other', profile: [profile] } },
    { meta: { project: 'p1' } },
  ]) {
    const f = await fixture(t, { resource });
    assert.equal((await f.get()).status, 502);
  }
});
test('missing provisioned record and upstream failures are operational errors', async (t) => {
  for (const readStatus of [403, 404, 500]) {
    const f = await fixture(t, { readStatus });
    const response = await f.get();
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('private'));
  }
});
test('rejects non-HTTPS remote upstreams', () => {
  assert.throws(() => createCuiHandler({ ...config, medplumBaseUrl: 'http://remote.example/' }), /HTTPS/);
});
