import { ClientStorage, MedplumClient, MemoryStorage } from '@medplum/core';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Opt-in integration verification for a disposable LOCAL project, never a customer tenant.
// Input: {medplumBaseUrl, serviceBaseUrl, projectId, security:{email,password}, members:[{email,password}]}
async function main() {
  if (!process.env.CUI_TEST_CONFIG) throw new Error('Set CUI_TEST_CONFIG to a private local test-account JSON file');
  const config = JSON.parse(await readFile(process.env.CUI_TEST_CONFIG, 'utf8'));
  for (const raw of [config.medplumBaseUrl, config.serviceBaseUrl]) {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(raw).hostname))
      throw new Error('Integration tests require loopback test servers');
  }
  if (!config.members?.length) throw new Error('At least one unauthorized test member is required');
  const clients = [];
  for (const account of [config.security, ...config.members]) {
    const storage = new ClientStorage(new MemoryStorage());
    const verifier = randomBytes(32).toString('base64url');
    storage.setString('codeVerifier', verifier);
    const client = new MedplumClient({ baseUrl: config.medplumBaseUrl, storage });
    const login = await client.startLogin({
      ...account,
      projectId: config.projectId,
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      codeChallengeMethod: 'S256',
    });
    if (!login.code) throw new Error('Test account requires an unexpected login step');
    await client.processCode(login.code);
    clients.push(client);
  }
  const [security, ...members] = clients;
  const status = async (client) => {
    const r = await fetch(new URL('/api/cui-banner', config.serviceBaseUrl), {
      headers: { Authorization: `Bearer ${client.getAccessToken()}` },
      redirect: 'error',
    });
    assert.equal(r.status, 200, 'Policy service must be available');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const value = await r.json();
    assert.equal(value.projectId, config.projectId);
    return value;
  };
  const first = await status(security);
  assert.equal(first.canManage, true);
  const id = first.configurationId;
  const read = () => security.readResource('Basic', id, { cache: 'no-store' });
  const initial = await read();
  const enabledUrl = 'https://medplum.com/fhir/StructureDefinition/cui-banner-enabled';
  try {
    for (const enabled of [true, false]) {
      const current = await read();
      await security.updateResource(
        {
          ...current,
          extension: [
            ...(current.extension?.filter((e) => e.url !== enabledUrl) ?? []),
            { url: enabledUrl, valueBoolean: enabled },
          ],
        },
        { headers: { 'If-Match': `W/"${current.meta.versionId}"` } }
      );
      for (const client of clients) {
        const result = await status(client);
        assert.equal(result.enabled, enabled);
        assert.equal(result.canManage, client === security);
      }
    }
    const protectedVersion = (await read()).meta.versionId;
    for (const client of members) {
      const headers = { Authorization: `Bearer ${client.getAccessToken()}`, 'Content-Type': 'application/fhir+json' };
      const base = new URL(`fhir/R4/Basic/${id}`, config.medplumBaseUrl).href;
      for (const [method, url, body] of [
        ['GET', base],
        ['GET', base + '/_history'],
        ['PUT', base, JSON.stringify(initial)],
        [
          'PATCH',
          base,
          JSON.stringify([{ op: 'replace', path: '/extension', value: [{ url: enabledUrl, valueBoolean: true }] }]),
        ],
        ['DELETE', base],
      ]) {
        const r = await fetch(url, {
          method,
          headers: { ...headers, ...(method === 'PATCH' ? { 'Content-Type': 'application/json-patch+json' } : {}) },
          body,
        });
        assert.ok([403, 404].includes(r.status), `${method} must be denied, received ${r.status}`);
      }
      assert.equal((await client.searchResources('Basic', { _id: id })).length, 0);
      for (const type of ['batch', 'transaction']) {
        const r = await fetch(new URL('fhir/R4', config.medplumBaseUrl), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            resourceType: 'Bundle',
            type,
            entry: [{ resource: initial, request: { method: 'PUT', url: `Basic/${id}` } }],
          }),
        });
        const body = await r.json();
        if (r.status === 200) assert.match(body.entry?.[0]?.response?.status ?? '', /^(403|404)/);
        else assert.ok([403, 404].includes(r.status), `${type}: ${r.status}`);
      }
    }
    assert.equal((await read()).meta.versionId, protectedVersion, 'Denied operations must not mutate configuration');
    await assert.rejects(
      security.updateResource(initial, { headers: { 'If-Match': `W/"${initial.meta.versionId}"` } }),
      /version|precondition|conflict/i
    );
    assert.equal((await fetch(new URL('/api/cui-banner', config.serviceBaseUrl))).status, 401);
    console.log(
      'PASS: on/off, shared display decision, denied direct read/search/history/PUT/PATCH/delete/batch/transaction, stale write, unauthenticated request.'
    );
  } finally {
    const current = await read();
    await security.updateResource(
      { ...current, extension: initial.extension },
      { headers: { 'If-Match': `W/"${current.meta.versionId}"` } }
    );
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
