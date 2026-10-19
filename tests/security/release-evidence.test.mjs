import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const generatorPath = resolve(root, 'scripts', 'generate-release-evidence.mjs');
const verifierPath = resolve(root, 'scripts', 'verify-release-evidence.mjs');

async function loadModule(path) {
  return import(`${pathToFileURL(path).href}?test=${Date.now()}-${Math.random()}`);
}

function fixture() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'elogbook-release-evidence-'));
  mkdirSync(join(fixtureRoot, 'apps', 'web'), { recursive: true });
  mkdirSync(join(fixtureRoot, 'apps', 'mobile'), { recursive: true });
  mkdirSync(join(fixtureRoot, 'supabase', 'functions', 'payment-webhook'), { recursive: true });
  writeFileSync(join(fixtureRoot, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\npackages:\n  '@scope/pkg@1.2.3':\n    resolution: {}\n");
  writeFileSync(join(fixtureRoot, 'apps', 'web', 'Dockerfile'), 'FROM node:22-alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa AS base\nFROM base AS builder\nLABEL org.opencontainers.image.revision="fixture"\n');
  writeFileSync(join(fixtureRoot, 'supabase', 'functions', 'payment-webhook', 'deno.json'), '{"lock":"deno.lock"}\n');
  writeFileSync(join(fixtureRoot, 'supabase', 'functions', 'payment-webhook', 'deno.lock'), '{"version":"5","remote":{"https://deno.land/std@0.1.0/mod.ts":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}\n');
  writeFileSync(join(fixtureRoot, 'apps', 'mobile', 'eas.json'), '{"cli":{"version":"14.0.0"},"build":{"production":{"distribution":"store"}}}\n');
  return fixtureRoot;
}

const commit = 'a'.repeat(40);

test('generates deterministic CycloneDX evidence and unsigned provenance', async () => {
  const generator = await loadModule(generatorPath);
  const fixtureRoot = fixture();
  const firstOutput = join(fixtureRoot, 'evidence-one');
  const secondOutput = join(fixtureRoot, 'evidence-two');

  try {
    await generator.generateReleaseEvidence({ root: fixtureRoot, output: firstOutput, commit });
    await generator.generateReleaseEvidence({ root: fixtureRoot, output: secondOutput, commit });
    const first = JSON.parse(readFileSync(join(firstOutput, 'manifest.json'), 'utf8'));
    const second = JSON.parse(readFileSync(join(secondOutput, 'manifest.json'), 'utf8'));

    assert.deepEqual(first, second);
    assert.equal(first.commit, commit);
    assert.equal(first.provenance.status, 'unsigned');
    assert.equal(first.provenance.attestation, 'pending');
    assert.deepEqual(first.provenance.signatures, []);
    assert.equal(first.attestations.length, 0);
    assert.equal(first.productionControls.status, 'pending');
    assert.ok(Object.values(first.artifacts).every((artifact) => artifact.signature.status === 'unsigned'));
    assert.deepEqual(Object.keys(first.manifests).sort(), ['container', 'deno', 'mobile', 'pnpm']);
    assert.equal(first.inputs.find(({ kind }) => kind === 'dockerfile').metadata.labels['org.opencontainers.image.revision'], 'fixture');
    assert.deepEqual(first.inputs.find(({ kind }) => kind === 'dockerfile').metadata.baseImages, ['node:22-alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']);
    for (const relativePath of Object.values(first.manifests).map(({ path }) => path)) {
      assert.equal(readFileSync(join(firstOutput, relativePath), 'utf8'), readFileSync(join(secondOutput, relativePath), 'utf8'));
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('verification passes generated evidence and rejects missing required inputs', async () => {
  const generator = await loadModule(generatorPath);
  const verifier = await loadModule(verifierPath);
  const fixtureRoot = fixture();
  const output = join(fixtureRoot, 'evidence');

  try {
    await generator.generateReleaseEvidence({ root: fixtureRoot, output, commit });
    const valid = await verifier.verifyReleaseEvidence({ root: fixtureRoot, output, commit, mode: 'deterministic-only' });
    assert.equal(valid.deterministicOk, true, JSON.stringify(valid.findings));
    assert.equal(valid.ok, false);
    for (const rule of [
      'artifact-signature-required',
      'release-attestation-required',
      'attestation-verifier-unconfigured',
      'production-environment-controls-required',
    ]) {
      assert.ok(valid.findings.some((finding) => finding.rule === rule), rule);
    }

    rmSync(join(output, 'manifest.json'));
    const missing = await verifier.verifyReleaseEvidence({ root: fixtureRoot, output, commit });
    assert.equal(missing.ok, false);
    assert.ok(missing.findings.some(({ rule }) => rule === 'evidence-file-missing'));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('generator verification CLI fails closed instead of printing promotion success', async () => {
  const fixtureRoot = fixture();
  const output = join(fixtureRoot, 'evidence');
  try {
    const result = spawnSync(process.execPath, [
      generatorPath,
      '--all',
      '--verify',
      '--root',
      fixtureRoot,
      '--output',
      output,
      '--commit',
      commit,
    ], { cwd: root, encoding: 'utf8', timeout: 120000 });

    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /release-evidence-pass/);
    assert.match(result.stderr, /artifact-signature-required/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('release operations keep unsigned evidence and absent environment controls blocked', async () => {
  const cadence = readFileSync(resolve(root, 'docs', 'security', 'operating-cadence.md'), 'utf8');
  const exceptions = readFileSync(resolve(root, 'docs', 'security', 'exception-register.yaml'), 'utf8');

  assert.match(cadence, /signed and verified/i);
  assert.match(cadence, /production environment controls/i);
  assert.match(cadence, /deterministic inventory[\s\S]*not promotion evidence/i);
  assert.match(exceptions, /RELEASE_ATTESTATION/);
  assert.match(exceptions, /unsigned/i);
});

test('verification rejects tampered evidence and fabricated signatures', async () => {
  const generator = await loadModule(generatorPath);
  const verifier = await loadModule(verifierPath);
  const fixtureRoot = fixture();
  const output = join(fixtureRoot, 'evidence');

  try {
    await generator.generateReleaseEvidence({ root: fixtureRoot, output, commit });
    const manifestPath = join(output, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.provenance.status = 'signed';
    manifest.provenance.signatures = [{ value: 'fabricated' }];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = await verifier.verifyReleaseEvidence({ root: fixtureRoot, output, commit });

    assert.equal(result.ok, false);
    assert.ok(result.findings.some(({ rule }) => rule === 'evidence-content-mismatch'));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
