import { indexSearchParameterBundle, indexStructureDefinitionBundle, satisfiedAccessPolicy } from '@medplum/core';
import { readJson, SEARCH_PARAMETER_BUNDLE_FILES } from '@medplum/definitions';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const enabledUrl = 'https://ehr.hiivehealth.net/fhir/StructureDefinition/cui-banner-enabled';
const profileUrl = 'https://ehr.hiivehealth.net/fhir/StructureDefinition/cui-configuration';
const idPattern = /^[A-Za-z0-9.-]{1,64}$/;
const isId = (value) => typeof value === 'string' && idPattern.test(value);
indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json'));
indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json'));
for (const file of SEARCH_PARAMETER_BUNDLE_FILES) indexSearchParameterBundle(readJson(file));

class ServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Errors are never silently converted to an off decision. */
export function readEnabled(resource, projectId, configurationId) {
  if (
    resource.resourceType !== 'Basic' ||
    resource.id !== configurationId ||
    resource.meta?.project !== projectId ||
    !resource.meta?.profile?.includes(profileUrl)
  )
    throw new ServiceError(502, 'Invalid project configuration');
  const values = resource.extension?.filter((e) => e.url === enabledUrl) ?? [];
  if (values.length === 0) return false;
  if (
    values.length !== 1 ||
    typeof values[0].valueBoolean !== 'boolean' ||
    values[0].extension ||
    Object.keys(values[0]).some((key) => key.startsWith('value') && key !== 'valueBoolean')
  ) {
    throw new ServiceError(502, 'Invalid project configuration');
  }
  return values[0].valueBoolean;
}

export function createCuiHandler(config, fetchImpl = fetch) {
  const base = new URL(config.medplumBaseUrl);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol !== 'https:' &&
      !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))
  ) {
    throw new Error('Medplum must use HTTPS except on loopback');
  }
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const projects = config.projects;
  if (!projects || typeof projects !== 'object' || Array.isArray(projects) || Object.keys(projects).length === 0)
    throw new Error('Configure at least one project');
  for (const [id, entry] of Object.entries(projects)) {
    if (
      !isId(id) ||
      !entry ||
      typeof entry !== 'object' ||
      !isId(entry.configurationId) ||
      !isId(entry.readerClientId) ||
      typeof entry.readerClientSecret !== 'string' ||
      !entry.readerClientSecret.trim() ||
      !Array.isArray(entry.managerAccessPolicyIds) ||
      !entry.managerAccessPolicyIds.length ||
      entry.managerAccessPolicyIds.some((value) => !isId(value))
    )
      throw new Error('Invalid service project mapping');
  }
  const readers = new Map();
  const pendingReaders = new Map();
  async function request(path, token, options = {}) {
    return fetchImpl(new URL(path, base), {
      ...options,
      headers: { 'X-Medplum': 'extended', ...options.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  }
  async function readerToken(projectId, entry) {
    const cached = readers.get(projectId);
    if (cached && cached.expires > Date.now()) return cached.token;
    if (pendingReaders.has(projectId)) return pendingReaders.get(projectId);
    const pending = acquireReaderToken(projectId, entry);
    pendingReaders.set(projectId, pending);
    try {
      return await pending;
    } finally {
      pendingReaders.delete(projectId);
    }
  }
  async function acquireReaderToken(projectId, entry) {
    const response = await request('oauth2/token', undefined, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: entry.readerClientId,
        client_secret: entry.readerClientSecret,
      }),
    });
    if (!response.ok) throw new ServiceError(503, 'Configuration reader unavailable');
    const body = await response.json();
    if (typeof body.access_token !== 'string' || !body.access_token)
      throw new ServiceError(503, 'Configuration reader unavailable');
    const identity = await request('auth/me', body.access_token);
    if (!identity.ok) throw new ServiceError(503, 'Configuration reader unavailable');
    const me = await identity.json();
    if (me.project?.id !== projectId || me.project?.superAdmin || me.membership?.admin) {
      throw new ServiceError(503, 'Configuration reader must be a non-admin in the mapped project');
    }
    const cached = {
      token: body.access_token,
      expires: Date.now() + Math.max(0, Math.min(Number(body.expires_in) || 60, 300) - 30) * 1000,
    };
    readers.set(projectId, cached);
    return cached.token;
  }
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => {
      res.statusCode = status;
      res.end(JSON.stringify(body));
    };
    try {
      // No caller-controlled project, upstream URL, or resource ID is accepted.
      if (req.url !== '/api/cui-banner') return send(404, { error: 'Not found' });
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return send(405, { error: 'Method not allowed' });
      }
      const authorization = req.headers.authorization;
      if (typeof authorization !== 'string' || !/^Bearer [^\s]+$/i.test(authorization))
        return send(401, { error: 'Authentication required' });
      const token = authorization.slice(7);
      const identity = await request('auth/me', token);
      if ([401, 403].includes(identity.status)) return send(401, { error: 'Authentication required' });
      if (!identity.ok) throw new ServiceError(503, 'Authentication service unavailable');
      const me = await identity.json();
      const projectId = me.project?.id;
      const entry = Object.hasOwn(projects, projectId) ? projects[projectId] : undefined;
      if (!entry) throw new ServiceError(503, 'Project configuration is not provisioned');
      const path = `fhir/R4/Basic/${entry.configurationId}`;
      const reader = await readerToken(projectId, entry);
      const response = await request(path, reader);
      if (!response.ok) {
        if (response.status === 401) readers.delete(projectId);
        // Missing provisioned resource is an operational error, not an absent boolean.
        throw new ServiceError(503, 'Project configuration unavailable');
      }
      const resource = await response.json();
      const enabled = readEnabled(resource, projectId, entry.configurationId);
      const assignedRole = me.accessPolicy?.basedOn?.some((ref) =>
        entry.managerAccessPolicyIds.some((id) => ref.reference === `AccessPolicy/${id}`)
      );
      let canManage = false;
      if (assignedRole && me.accessPolicy) {
        const readRule = satisfiedAccessPolicy(resource, 'read', me.accessPolicy);
        const updateRule = satisfiedAccessPolicy(resource, 'update', me.accessPolicy);
        if (
          readRule &&
          updateRule &&
          !readRule.hiddenFields?.length &&
          !updateRule.readonlyFields?.length &&
          !updateRule.hiddenFields?.length
        ) {
          // Confirm the caller's current permissions with Medplum, including project boundaries.
          const access = await request(path, token);
          if (access.ok) canManage = readEnabled(await access.json(), projectId, entry.configurationId) === enabled;
          else if (![403, 404].includes(access.status))
            throw new ServiceError(503, 'Unable to check configuration access');
        }
      }
      send(200, { projectId, enabled, canManage, configurationId: entry.configurationId });
    } catch (error) {
      send(error instanceof ServiceError ? error.status : 503, {
        error: error instanceof ServiceError ? error.message : 'Policy service unavailable',
      });
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.CUI_SERVICE_CONFIG) throw new Error('Set CUI_SERVICE_CONFIG to a private configuration file');
  const config = JSON.parse(await readFile(process.env.CUI_SERVICE_CONFIG, 'utf8'));
  const server = createServer(createCuiHandler(config));
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.listen(Number(process.env.CUI_SERVICE_PORT ?? 8105), '127.0.0.1', () =>
    console.log('CUI policy service listening on loopback')
  );
}
