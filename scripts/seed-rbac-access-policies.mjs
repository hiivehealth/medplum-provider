#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://api.ehr.hiivehealth.net';
const DEFAULT_CATALOG = './scripts/rbac-access-policy-catalog.json';

function parseArgs(argv) {
  const args = {
    apply: false,
    baseUrl: process.env.MEDPLUM_BASE_URL || DEFAULT_BASE_URL,
    token: process.env.MEDPLUM_ACCESS_TOKEN || process.env.MEDPLUM_TOKEN,
    catalog: process.env.RBAC_POLICY_CATALOG || DEFAULT_CATALOG,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--base-url') {
      args.baseUrl = argv[++i];
      continue;
    }
    if (arg === '--token') {
      args.token = argv[++i];
      continue;
    }
    if (arg === '--catalog') {
      args.catalog = argv[++i];
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`Seed RBAC AccessPolicy role catalog into Medplum.

Usage:
  node ./scripts/seed-rbac-access-policies.mjs [--apply] [--base-url URL] [--token TOKEN] [--catalog PATH]

Defaults:
  --base-url ${DEFAULT_BASE_URL}
  --catalog ${DEFAULT_CATALOG}
  --token from MEDPLUM_ACCESS_TOKEN or MEDPLUM_TOKEN

Modes:
  dry-run (default): prints planned create/update actions only
  --apply: performs create/update requests
`);
}

async function loadCatalog(catalogPath) {
  const resolved = path.resolve(process.cwd(), catalogPath);
  const raw = await fs.readFile(resolved, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed?.policies) || parsed.policies.length === 0) {
    throw new Error(`Catalog has no policies: ${resolved}`);
  }

  return { resolved, policies: parsed.policies };
}

function normalizePolicy(policy) {
  if (!policy?.name) {
    throw new Error('Policy is missing required field: name');
  }

  if (!Array.isArray(policy.resource) || policy.resource.length === 0) {
    throw new Error(`Policy ${policy.name} must include at least one resource rule`);
  }

  return {
    resourceType: 'AccessPolicy',
    name: policy.name,
    description: policy.description,
    meta: policy.meta,
    resource: policy.resource,
  };
}

async function medplumRequest(baseUrl, token, method, resourcePath, body) {
  const url = `${baseUrl.replace(/\/$/, '')}/fhir/R4/${resourcePath}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/fhir+json',
      'Content-Type': 'application/fhir+json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const issue = json?.issue?.[0]?.diagnostics || json?.issue?.[0]?.details?.text || text;
    throw new Error(`${method} ${resourcePath} failed (${response.status}): ${issue}`);
  }

  return json;
}

async function findExistingPolicy(baseUrl, token, name) {
  const params = new URLSearchParams([
    ['name', name],
    ['_count', '50'],
    ['_sort', '-_lastUpdated'],
  ]);
  const bundle = await medplumRequest(baseUrl, token, 'GET', `AccessPolicy?${params.toString()}`);

  const entries = bundle?.entry?.map((entry) => entry.resource).filter(Boolean) || [];
  return entries.find((policy) => policy.name === name);
}

function summarizeRuleCount(policy) {
  return Array.isArray(policy?.resource) ? policy.resource.length : 0;
}

async function main() {
  const args = parseArgs(process.argv);
  const { resolved, policies } = await loadCatalog(args.catalog);

  console.log(`Catalog: ${resolved}`);
  console.log(`Base URL: ${args.baseUrl}`);
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY RUN'}`);

  if (!args.token) {
    throw new Error('Missing token. Set MEDPLUM_ACCESS_TOKEN (or MEDPLUM_TOKEN), or pass --token.');
  }

  const actions = [];

  for (const rawPolicy of policies) {
    const candidate = normalizePolicy(rawPolicy);
    const existing = await findExistingPolicy(args.baseUrl, args.token, candidate.name);

    if (!existing) {
      actions.push({ type: 'create', policy: candidate });
      continue;
    }

    actions.push({
      type: 'update',
      policy: {
        ...candidate,
        id: existing.id,
      },
      previousRules: summarizeRuleCount(existing),
    });
  }

  for (const action of actions) {
    if (action.type === 'create') {
      console.log(`[create] ${action.policy.name} (${summarizeRuleCount(action.policy)} rules)`);
    } else {
      console.log(
        `[update] ${action.policy.name} (${action.previousRules} -> ${summarizeRuleCount(action.policy)} rules)`
      );
    }
  }

  if (!args.apply) {
    console.log('\nDry run complete. Re-run with --apply to persist changes.');
    return;
  }

  const results = [];
  for (const action of actions) {
    if (action.type === 'create') {
      const created = await medplumRequest(args.baseUrl, args.token, 'POST', 'AccessPolicy', action.policy);
      results.push({ action: 'created', name: created.name, id: created.id });
    } else {
      const updated = await medplumRequest(
        args.baseUrl,
        args.token,
        'PUT',
        `AccessPolicy/${action.policy.id}`,
        action.policy
      );
      results.push({ action: 'updated', name: updated.name, id: updated.id });
    }
  }

  console.log('\nApply complete:');
  for (const result of results) {
    console.log(`- ${result.action}: ${result.name} (${result.id})`);
  }
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
