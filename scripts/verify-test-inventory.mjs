#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCHEMA = 'elogbook.test-inventory/v1';

function finding(path, message) {
  return { path, message };
}

function isSafeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && !/^[A-Za-z]:/.test(value)
    && !value.split('/').includes('..');
}

function referenceFile(reference) {
  if (typeof reference === 'string') return reference.split('#')[0];
  if (reference && typeof reference === 'object' && typeof reference.path === 'string') {
    return reference.path.split('#')[0];
  }
  return null;
}

function hasAssertions(source, framework) {
  if (framework === 'pgTAP') return /SELECT\s+plan\s*\(\s*[1-9]\d*\s*\)/i.test(source);
  // Deno's assertion helpers are prefixed (assertEquals, assertThrows, ...), so
  // the check has to allow the dotted import form the other frameworks do not
  // use. Without it a Deno suite is registered but its assertions go unverified.
  return /\b(?:expect|assert|assertEquals|assertStrictEquals|assertNotEquals|assertThrows|assertRejects|assertExists|assertMatch)\s*\(/.test(source);
}

function hasTestDeclaration(source, framework) {
  if (framework === 'pgTAP') return /SELECT\s+plan\s*\(/i.test(source);
  return /\b(?:describe|it|test|Deno\.test)\s*\(/.test(source);
}

function validateIdList(entry, field, references, findings) {
  if (!Array.isArray(entry[field])) {
    findings.push(finding(entry.path ?? '<unknown>', `${field} must be an array`));
    return;
  }
  if (field !== 'adr_ids' && entry[field].length === 0) {
    findings.push(finding(entry.path ?? '<unknown>', `${field} must be a non-empty array`));
    return;
  }
  for (const id of entry[field]) {
    if (!references || !Object.hasOwn(references, id)) {
      findings.push(finding(entry.path ?? '<unknown>', `${field} references unknown id ${id}`));
    }
  }
}

export function readTestInventory(root = ROOT) {
  const inventoryPath = join(root, 'docs', 'security', 'test-inventory.yaml');
  return JSON.parse(readFileSync(inventoryPath, 'utf8'));
}

export function validateTestInventory(inventory, root = ROOT) {
  const findings = [];
  if (inventory?.version !== 1) findings.push(finding('version', 'version must be 1'));
  if (inventory?.schema !== SCHEMA) findings.push(finding('schema', `schema must be ${SCHEMA}`));
  if (typeof inventory?.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(inventory.as_of)) {
    findings.push(finding('as_of', 'as_of must be an ISO date'));
  }

  const references = inventory?.references;
  for (const kind of ['plans', 'specs', 'adrs', 'checks']) {
    if (!references || !references[kind] || typeof references[kind] !== 'object' || Array.isArray(references[kind])) {
      findings.push(finding(`references.${kind}`, `${kind} references are required`));
      continue;
    }
    for (const [id, reference] of Object.entries(references[kind])) {
      const path = referenceFile(reference);
      if (!path || !isSafeRelativePath(path) || !existsSync(join(root, path))) {
        findings.push(finding(`references.${kind}.${id}`, `reference path does not exist: ${path ?? '<missing>'}`));
      }
    }
  }

  if (!Array.isArray(inventory?.entries) || inventory.entries.length === 0) {
    findings.push(finding('entries', 'entries must be a non-empty array'));
    return findings;
  }

  const paths = new Set();
  for (const entry of inventory.entries) {
    const entryPath = entry?.path ?? '<unknown>';
    if (!isSafeRelativePath(entry.path)) {
      findings.push(finding(entryPath, 'path must be a safe repository-relative POSIX path'));
      continue;
    }
    if (paths.has(entry.path)) findings.push(finding(entry.path, 'duplicate inventory path'));
    paths.add(entry.path);
    if (!['test', 'helper'].includes(entry.kind)) findings.push(finding(entry.path, 'kind must be test or helper'));
    if (!existsSync(join(root, entry.path)) || !statSync(join(root, entry.path)).isFile()) {
      findings.push(finding(entry.path, 'inventory path is missing'));
      continue;
    }

    const source = readFileSync(join(root, entry.path), 'utf8');
    if (entry.kind === 'helper') {
      if (typeof entry.helper_reason !== 'string' || entry.helper_reason.trim().length === 0) {
        findings.push(finding(entry.path, 'helper entries require helper_reason'));
      }
      if (entry.gate_d !== null && entry.gate_d !== undefined) {
        findings.push(finding(entry.path, 'helper entries cannot be registered as Gate D tests'));
      }
      continue;
    }

    if (typeof entry.framework !== 'string' || entry.framework.trim().length === 0) {
      findings.push(finding(entry.path, 'test entries require framework'));
    }
    if (!hasTestDeclaration(source, entry.framework)) findings.push(finding(entry.path, 'test entry has no test declaration'));
    if (!hasAssertions(source, entry.framework)) findings.push(finding(entry.path, 'test entry has no executable assertion'));
    if (/\b(?:describe|it|test)\.skip\s*\(|\bno_plan\s*\(|\bskip\s*\(|\btodo\s*\(/i.test(source)) {
      findings.push(finding(entry.path, 'test entry contains a skipped or todo test'));
    }
    if (!['suite', 'database', null, undefined].includes(entry.gate_d)) {
      findings.push(finding(entry.path, 'gate_d must be suite, database, or null'));
    }
    validateIdList(entry, 'plan_ids', references?.plans, findings);
    validateIdList(entry, 'spec_ids', references?.specs, findings);
    validateIdList(entry, 'adr_ids', references?.adrs, findings);
    validateIdList(entry, 'check_ids', references?.checks, findings);
  }

  const databaseRoot = join(root, 'supabase', 'tests');
  const discovered = readdirSync(databaseRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => `supabase/tests/${entry.name}`)
    .sort();
  const registered = inventory.entries.filter((entry) => entry.gate_d === 'database').map((entry) => entry.path);
  for (const path of discovered.filter((path) => !registered.includes(path))) {
    findings.push(finding(path, 'maintained database test is missing from Gate D inventory'));
  }
  for (const path of registered.filter((path) => !discovered.includes(path))) {
    findings.push(finding(path, 'Gate D database inventory path does not exist'));
  }

  const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const workflowDatabaseSuites = [...workflow.matchAll(/^[ \t]+(supabase\/tests\/[^\s]+[.]sql)[ \t]*\\?[ \t]*$/gm)]
    .map((match) => match[1]);
  if (workflowDatabaseSuites.length !== registered.length || workflowDatabaseSuites.some((path, index) => path !== registered[index])) {
    findings.push(finding('.github/workflows/ci.yml', 'CI database test order differs from Gate D inventory'));
  }

  return findings;
}

export function loadTestInventory(root = ROOT) {
  const inventory = readTestInventory(root);
  const findings = validateTestInventory(inventory, root);
  if (findings.length > 0) {
    throw new Error(findings.map((item) => `${item.path}: ${item.message}`).join('\n'));
  }
  return inventory;
}

export function gateDPaths(inventory, gate) {
  return inventory.entries.filter((entry) => entry.gate_d === gate).map((entry) => entry.path);
}

function main() {
  try {
    const inventory = loadTestInventory();
    const suites = gateDPaths(inventory, 'suite').length;
    const databaseSuites = gateDPaths(inventory, 'database').length;
    console.log(`Gate D inventory passed: ${suites} required suites and ${databaseSuites} database tests registered`);
  } catch (error) {
    console.error(`Gate D inventory failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
