#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileNoFollow } from './lib/read-file-no-follow.mjs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEvidence, EvidenceError, parseArguments, resolveCommit } from './generate-release-evidence.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_FILES = [
  'manifest.json',
  'pnpm.cdx.json',
  'container.cdx.json',
  'deno.cdx.json',
  'mobile.cdx.json',
  'checksums.json',
];

function finding(path, rule, message) {
  return { path, rule, message };
}

function readJson(path, label, findings) {
  const raw = readFileNoFollow(path, 'utf8');
  if (raw === null) {
    findings.push(finding(path, 'evidence-file-missing', `${label} is missing`));
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    findings.push(finding(path, 'evidence-json-invalid', `${label} is not valid JSON: ${error.message}`));
    return null;
  }
}

function compareFile(path, expected, actual, findings) {
  const content = readFileNoFollow(path, 'utf8');
  if (content === null) {
    findings.push(finding(path, 'evidence-file-missing', 'required evidence file is missing'));
    return;
  }
  if (content !== expected) findings.push(finding(path, 'evidence-content-mismatch', 'evidence content differs from deterministic source evidence'));
  const expectedHash = createHash('sha256').update(expected).digest('hex');
  if (actual && actual.sha256 !== expectedHash) findings.push(finding(path, 'evidence-hash-mismatch', 'evidence digest differs from the manifest'));
}

function externalVerifierPassed(command, args) {
  if (typeof command !== 'string' || command.trim().length === 0) return false;
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.trim() === 'verified';
  } catch {
    return false;
  }
}

export async function verifyReleaseEvidence({ root = ROOT, output = 'docs/upgrade/evidence/release', commit, mode = 'promotion' } = {}) {
  const repositoryRoot = resolve(root);
  const outputDirectory = resolve(repositoryRoot, output);
  const findings = [];
  let expectedCommit;
  try {
    expectedCommit = resolveCommit({ root: repositoryRoot, commit });
  } catch (error) {
    findings.push(finding('release', 'commit-unavailable', error.message));
    return { ok: false, deterministicOk: false, promotionOk: false, findings, manifest: null };
  }

  let expected;
  try {
    expected = buildEvidence({ root: repositoryRoot, commit: expectedCommit });
  } catch (error) {
    findings.push(finding('release', 'evidence-generation-failed', error.message));
    return { ok: false, deterministicOk: false, promotionOk: false, findings, manifest: null };
  }

  for (const path of REQUIRED_FILES) {
    if (readFileNoFollow(join(outputDirectory, path)) === null) findings.push(finding(join(outputDirectory, path), 'evidence-file-missing', 'required evidence file is missing'));
  }

  const manifest = readJson(join(outputDirectory, 'manifest.json'), 'release evidence manifest', findings);
  const checksums = readJson(join(outputDirectory, 'checksums.json'), 'release evidence checksums', findings);
  if (manifest) {
    if (manifest.commit !== expectedCommit) findings.push(finding(join(outputDirectory, 'manifest.json'), 'commit-mismatch', 'manifest is not bound to the release commit'));
    for (const [kind, entry] of Object.entries(manifest.manifests ?? {})) {
      const expectedEntry = expected.manifest.manifests[kind];
      if (!expectedEntry || entry?.path !== expectedEntry.path || entry?.sha256 !== expectedEntry.sha256) {
        findings.push(finding(join(outputDirectory, 'manifest.json'), 'manifest-reference-invalid', `${kind} manifest reference is invalid`));
      }
    }
  }

  for (const [path, content] of Object.entries(expected.files)) {
    const actualHash = checksums?.[path];
    compareFile(join(outputDirectory, path), content, actualHash ? { sha256: actualHash } : null, findings);
  }
  if (checksums) {
    for (const path of REQUIRED_FILES.filter((value) => value !== 'checksums.json')) {
      if (typeof checksums[path] !== 'string') findings.push(finding(join(outputDirectory, 'checksums.json'), 'checksum-entry-missing', `${path} has no checksum`));
    }
  }

  for (const bomPath of ['pnpm.cdx.json', 'container.cdx.json', 'deno.cdx.json', 'mobile.cdx.json']) {
    const bom = readJson(join(outputDirectory, bomPath), bomPath, findings);
    if (!bom) continue;
    if (bom.bomFormat !== 'CycloneDX' || bom.specVersion !== '1.5') findings.push(finding(join(outputDirectory, bomPath), 'cyclonedx-format-invalid', 'CycloneDX format or specification version is invalid'));
    const commitProperty = bom.metadata?.properties?.find((property) => property.name === 'elogbook.release.commit')?.value;
    if (commitProperty !== expectedCommit) findings.push(finding(join(outputDirectory, bomPath), 'bom-commit-mismatch', 'CycloneDX document is not bound to the release commit'));
  }

  const deterministicOk = findings.length === 0;
  if (!deterministicOk) {
    return {
      ok: false,
      deterministicOk,
      promotionOk: false,
      findings,
      manifest,
    };
  }

  const manifestPath = join(outputDirectory, 'manifest.json');
  const checksumPath = join(outputDirectory, 'checksums.json');
  const provenance = manifest.provenance;
  if (
    !provenance
    || provenance.status !== 'signed'
    || provenance.attestation !== 'verified'
    || provenance.externalAttestationConfigured !== true
    || !Array.isArray(provenance.signatures)
    || provenance.signatures.length === 0
  ) {
    findings.push(finding(manifestPath, 'release-provenance-required', 'signed and externally verified provenance is required for promotion'));
  }

  for (const [kind, entry] of Object.entries(expected.manifest.manifests)) {
    const artifact = manifest.artifacts?.[kind];
    if (
      !artifact
      || artifact.path !== entry.path
      || artifact.sha256 !== entry.sha256
      || artifact.signature?.status !== 'verified'
      || typeof artifact.signature?.subject !== 'string'
    ) {
      findings.push(finding(manifestPath, 'artifact-signature-required', `${kind} artifact signature is absent or unverified`));
    }
  }

  const validAttestation = Array.isArray(manifest.attestations)
    && manifest.attestations.some((attestation) =>
      attestation?.status === 'verified'
      && attestation?.subject === expectedCommit
      && typeof attestation?.predicateType === 'string');
  if (!validAttestation) {
    findings.push(finding(manifestPath, 'release-attestation-required', 'a verified release attestation bound to the commit is required'));
  }
  const attestationVerifier = process.env.RELEASE_ATTESTATION_VERIFIER;
  if (!attestationVerifier) {
    findings.push(finding(manifestPath, 'attestation-verifier-unconfigured', 'an operator-approved attestation verifier is required'));
  } else if (!externalVerifierPassed(attestationVerifier, [manifestPath, checksumPath])) {
    findings.push(finding(manifestPath, 'release-attestation-unverified', 'the external attestation verifier rejected the evidence'));
  }

  if (manifest.productionControls?.status !== 'verified' || manifest.productionControls?.verifierConfigured !== true) {
    findings.push(finding(manifestPath, 'production-environment-controls-required', 'verified production environment controls are required'));
  }
  const productionVerifier = process.env.PRODUCTION_ENVIRONMENT_VERIFIER;
  if (!productionVerifier) {
    findings.push(finding(manifestPath, 'production-environment-verifier-unconfigured', 'an operator-approved production environment verifier is required'));
  } else if (!externalVerifierPassed(productionVerifier, [expectedCommit, manifestPath])) {
    findings.push(finding(manifestPath, 'production-environment-controls-unverified', 'the production environment verifier rejected the release controls'));
  }

  if (mode === 'deterministic-only') {
    return {
      ok: false,
      deterministicOk,
      promotionOk: false,
      findings,
      manifest,
    };
  }

  return {
    ok: findings.length === 0,
    deterministicOk,
    promotionOk: findings.length === 0,
    findings,
    manifest,
  };
}

export function formatFinding(item) {
  return `${item.path}: ${item.rule}: ${item.message}`;
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`release-evidence-error: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  verifyReleaseEvidence(options).then((result) => {
    for (const item of result.findings) console.error(formatFinding(item));
    if (result.ok) {
        console.log('release-evidence-pass: signed/verified');
        return;
    }
    if (result.deterministicOk && options.mode === 'deterministic-only') {
      console.log('release-evidence-deterministic: promotion-blocked');
      return;
    }
    process.exitCode = 1;
  }).catch((error) => {
    console.error(`release-evidence-error: ${error instanceof EvidenceError ? error.message : 'verification failed'}`);
    process.exitCode = 1;
  });
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
