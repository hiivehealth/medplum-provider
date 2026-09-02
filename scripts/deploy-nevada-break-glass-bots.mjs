#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClientStorage, MedplumClient, MemoryStorage, normalizeErrorString } from '@medplum/core';
import { TextDecoder, TextEncoder } from 'node:util';

globalThis.TextDecoder = TextDecoder;
globalThis.TextEncoder = TextEncoder;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '..');
const botOutputDir = path.join(repoDir, 'dist', 'bots');
const baseUrl = process.env.MEDPLUM_BASE_URL || 'https://api.ehr.hiivehealth.net/';
const projectId = process.env.MEDPLUM_PROJECT_ID || '7e472dfd-3ab9-4b75-adac-38e0c5c5d6c8';
const enableSubscription = process.argv.includes('--enable-subscription');
const dryRun = process.argv.includes('--dry-run');
const botLayerRoot = process.env.MEDPLUM_MONOREPO_ROOT || path.resolve(repoDir, '..', 'medplum-ubix');
const esbuildBin = path.join(botLayerRoot, 'node_modules', '.bin', 'esbuild');
const botDefinitions = [
  {
    name: 'nevada-break-glass-access',
    source: path.join(repoDir, 'src', 'bots', 'nevadaBreakGlassAccess.ts'),
    output: path.join(botOutputDir, 'nevadaBreakGlassAccess.js'),
    globalName: 'NevadaBreakGlassAccess',
    description: 'Privileged activation of parameterized Nevada Break-Glass membership access.',
    criteria: 'AuditEvent?subtype=emergency-access',
  },
  {
    name: 'nevada-break-glass-cleanup',
    source: path.join(repoDir, 'src', 'bots', 'nevadaBreakGlassCleanup.ts'),
    output: path.join(botOutputDir, 'nevadaBreakGlassCleanup.js'),
    globalName: 'NevadaBreakGlassCleanup',
    description: 'Cleanup of expired Nevada Break-Glass membership parameters.',
    cronString: '0 * * * *',
  },
  {
    name: 'nevada-patient-discovery',
    source: path.join(repoDir, 'src', 'bots', 'nevadaPatientDiscovery.ts'),
    output: path.join(botOutputDir, 'nevadaPatientDiscovery.js'),
    globalName: 'NevadaPatientDiscovery',
    description: 'Minimum-necessary patient directory search for Nevada Break-Glass requests.',
  },
];

function createStorageShim() {
  const memoryStore = new MemoryStorage();
  globalThis.sessionStorage = memoryStore;
  globalThis.localStorage = memoryStore;
  globalThis.location = { protocol: 'https:', hostname: new URL(baseUrl).hostname, href: baseUrl };
  globalThis.window = {
    crypto: globalThis.crypto,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    TextDecoder,
    TextEncoder,
    location: globalThis.location,
  };
  return new ClientStorage(memoryStore);
}

function bundleBots() {
  mkdirSync(botOutputDir, { recursive: true });
  if (!existsSync(esbuildBin)) {
    throw new Error(`esbuild was not found at ${esbuildBin}`);
  }
  for (const bot of botDefinitions) {
    execFileSync(esbuildBin, [bot.source, '--bundle', '--platform=node', '--format=iife', `--global-name=${bot.globalName}`, '--target=es2020', `--outfile=${bot.output}`], {
      cwd: repoDir,
      stdio: 'inherit',
    });
    writeFileSync(bot.output, `${readFileSync(bot.output, 'utf8')}\nexports.handler = ${bot.globalName}.handler;\n`);
  }
}

async function login() {
  if (process.env.MEDPLUM_EMAIL && process.env.MEDPLUM_PASSWORD) {
    const medplum = new MedplumClient({ baseUrl, storage: createStorageShim() });
    const loginParams = {
      email: process.env.MEDPLUM_EMAIL,
      password: process.env.MEDPLUM_PASSWORD,
      scope: 'openid profile email',
      redirectUri: 'https://app.ehr.hiivehealth.net/',
      projectId,
    };
    let result = await medplum.startLogin(loginParams);
    if (!result.code && result.memberships?.length) {
      const membership = result.memberships.find((candidate) => candidate.project?.reference === `Project/${projectId}`);
      if (!membership?.id) {
        throw new Error(`No active ProjectMembership found for target project ${projectId}.`);
      }
      result = await medplum.post('auth/profile', { login: result.login, profile: membership.id });
    }
    if (result.code) {
      await medplum.processCode(result.code, loginParams);
    } else {
      throw new Error(`Unable to complete login for target project ${projectId}.`);
    }
    return medplum;
  }

  if (!process.env.MEDPLUM_CLIENT_ID || !process.env.MEDPLUM_CLIENT_SECRET) {
    throw new Error('Set MEDPLUM_EMAIL/MEDPLUM_PASSWORD or MEDPLUM_CLIENT_ID/MEDPLUM_CLIENT_SECRET for Bot deployment.');
  }
  const medplum = new MedplumClient({ baseUrl, clientId: process.env.MEDPLUM_CLIENT_ID, storage: createStorageShim() });
  await medplum.startClientLogin(process.env.MEDPLUM_CLIENT_ID, process.env.MEDPLUM_CLIENT_SECRET);
  return medplum;
}

async function deployBot(medplum, bot) {
  const identifier = `https://hiivehealth.com/fhir/identifier/nevada-break-glass|${bot.name}`;
  const sourceBinary = await medplum.createBinary({ data: readFileSync(bot.source, 'utf8'), contentType: 'text/typescript' });
  const executableBinary = await medplum.createBinary({ data: readFileSync(bot.output, 'utf8'), contentType: 'application/javascript' });
  const sourceCode = { contentType: 'text/typescript', url: `Binary/${sourceBinary.id}` };
  const executableCode = { contentType: 'application/javascript', url: `Binary/${executableBinary.id}` };
  const existing = await medplum.searchOne('Bot', { name: bot.name });
  const payload = {
    resourceType: 'Bot',
    ...(existing ?? {}),
    name: bot.name,
    description: bot.description,
    identifier: [{ system: 'https://hiivehealth.com/fhir/identifier/nevada-break-glass', value: bot.name }],
    runtimeVersion: process.env.MEDPLUM_BOT_RUNTIME || 'vmcontext',
    runAsUser: false,
    auditEventTrigger: 'always',
    auditEventDestination: ['resource'],
    ...(bot.cronString ? { cronString: bot.cronString } : {}),
    sourceCode,
    executableCode,
  };
  const deployed = existing
    ? await medplum.updateResource(payload)
    : await medplum.post(`admin/projects/${projectId}/bot`, payload);
  const deployedBot = await medplum.post(medplum.fhirUrl('Bot', deployed.id, '$deploy'), {
    code: readFileSync(bot.output, 'utf8'),
    filename: path.basename(bot.output),
  });
  if (bot.criteria && enableSubscription) {
    const subscriptions = await medplum.searchResources('Subscription', { _count: '100' });
    const subscription = subscriptions.find((candidate) => candidate.reason === bot.name);
    const subscriptionResource = {
      resourceType: 'Subscription',
      ...(subscription ?? {}),
      status: 'active',
      reason: bot.name,
      criteria: bot.criteria,
      channel: { type: 'rest-hook', endpoint: `Bot/${deployed.id}` },
    };
    if (subscription) {
      await medplum.updateResource(subscriptionResource);
    } else {
      await medplum.createResource(subscriptionResource);
    }
  }
  return { id: deployed.id, subscriptionEnabled: Boolean(bot.criteria && enableSubscription), deployed: Boolean(deployedBot) };
}

async function main() {
  bundleBots();
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, bots: botDefinitions.map((bot) => ({ name: bot.name, source: bot.source, output: bot.output })), enableSubscription }, null, 2));
    return;
  }
  const medplum = await login();
  const results = [];
  for (const bot of botDefinitions) {
    results.push({ name: bot.name, ...(await deployBot(medplum, bot)) });
  }
  console.log(JSON.stringify({ projectId, results }, null, 2));
}

main().catch((error) => {
  console.error(normalizeErrorString(error));
  process.exitCode = 1;
});
