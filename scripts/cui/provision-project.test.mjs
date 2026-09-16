import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('provisioning resolves FHIR resources from any working directory and preserves least-privilege grants', async (t) => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const created = [];
  const directory = await mkdtemp(join(tmpdir(), 'cui-provision-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let result;
    if (url.pathname === '/auth/me') result = { project: { superAdmin: true } };
    else if (url.pathname === `/fhir/R4/Project/${projectId}`) result = { resourceType: 'Project', id: projectId };
    else if (req.method === 'GET') result = { resourceType: 'Bundle', type: 'searchset', entry: [] };
    else {
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      created.push(input);
      result = url.pathname.endsWith('/client')
        ? { resourceType: 'ClientApplication', id: 'reader-client', secret: 'test-only-secret' }
        : { ...input, id: input.resourceType === 'Basic' ? 'configuration-id' : `resource-${created.length}` };
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const output = join(directory, 'service.local');
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('./provision-project.mjs', import.meta.url)), projectId, output],
    {
      cwd: directory,
      env: {
        ...process.env,
        MEDPLUM_BASE_URL: `http://127.0.0.1:${server.address().port}/`,
        MEDPLUM_ACCESS_TOKEN: 'test-operator',
      },
    }
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  assert.equal(await new Promise((resolve) => child.on('close', resolve)), 0, stderr);
  assert.deepEqual(
    created
      .filter((r) => r.resourceType === 'StructureDefinition')
      .map((r) => r.type)
      .sort(),
    ['Basic', 'Extension']
  );
  const basic = created.find((r) => r.resourceType === 'Basic');
  assert.equal(basic.meta.project, projectId);
  assert.equal(basic.extension, undefined);
  const policies = created.filter((r) => r.resourceType === 'AccessPolicy');
  assert.deepEqual(
    policies.map((p) => p.resource),
    [
      [
        {
          resourceType: 'Basic',
          criteria: 'Basic?_id=configuration-id',
          interaction: ['read', 'search', 'vread', 'history', 'update'],
        },
      ],
      [{ resourceType: 'Basic', criteria: 'Basic?_id=configuration-id', interaction: ['read'] }],
    ]
  );
  const config = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(config.projects[projectId].configurationId, 'configuration-id');
  assert.equal(config.projects[projectId].readerClientSecret, 'test-only-secret');
  assert.equal((await stat(output)).mode & 0o777, 0o600);
});
