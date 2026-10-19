#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RELEASE_WORKFLOW = '.github/workflows/release.yml';
export const FUNCTION_MANIFEST = 'supabase/functions/manifest.json';
export const DEPLOY_WORKFLOWS = [
  '.github/workflows/cd.yml',
  '.github/workflows/deploy-web.yml',
  '.github/workflows/deploy-mobile.yml',
];

const GATE_PATTERNS = [
  ['typecheck', /type[-_]?check/i],
  ['tests', /(^|[-_])tests?$|(^|[-_])(unit|e2e)[-_]?tests?/i],
  ['migration-replay', /migration|replay|database|db[-_]?test/i],
  ['sast', /sast|semgrep|codeql/i],
  ['secret-scan', /secret|containment/i],
  ['dependency-audit', /audit|dependency/i],
  ['container-scan', /container|trivy|image[-_]?scan/i],
  ['function-scan', /function|deno|edge/i],
  ['sbom', /sbom/i],
  ['evidence', /evidence|artifact/i],
  ['staging-smoke', /staging.*smoke|smoke/i],
  ['dast', /dast|zap|dynamic.*security/i],
  ['staging-approval', /staging.*approval|approval/i],
];

const RELEASE_REQUIRED_JOBS = [
  ['typecheck', 'typecheck-gate-required'],
  ['tests', 'tests-gate-required'],
  ['migration-replay', 'migration-replay-gate-required'],
  ['sast', 'sast-gate-required'],
  ['secret-scan', 'secret-scan-gate-required'],
  ['dependency-audit', 'dependency-audit-gate-required'],
  ['container-scan', 'container-scan-gate-required'],
  ['function-scan', 'function-scan-gate-required'],
  ['sbom', 'sbom-gate-required'],
  ['evidence', 'evidence-gate-required'],
  ['staging-smoke', 'staging-smoke-gate-required'],
  ['dast', 'dast-gate-required'],
  ['staging-approval', 'staging-approval-required'],
];

const DIRECT_PROMOTION_KINDS = new Set(['typecheck', 'tests', 'migration-replay', 'sast', 'secret-scan', 'dependency-audit', 'container-scan', 'function-scan', 'sbom', 'evidence', 'staging-smoke', 'dast', 'staging-approval']);
const GATE_COMMAND_PATTERNS = new Map([
  ['migration-replay', /supabase\s+db\s+(?:reset|test)\b/i],
  ['sast', /semgrep|codeql/i],
  ['dast', /zap|dast|dynamic.*security/i],
  ['sbom', /generate-release-evidence\.mjs[\s\S]*--all/i],
  ['evidence', /verify-release-evidence\.mjs[\s\S]*--verify/i],
]);
const APPROVAL_INPUTS = new Set(['staging_approved', 'staging_approval', 'approved_promotion']);
const RELEASE_TRIGGERS = new Set(['workflow_call', 'workflow_dispatch']);
const BYPASS_NAME = /(?:^|[_-])(?:bypass|skip|override)(?:$|[_-])/i;
const CHECKOUT = /^actions\/checkout@/i;
const IMMUTABLE_REF = /@[0-9a-f]{40}$/i;
const PRODUCTION_COMMAND_PATTERNS = [
  /vercel(?:\s+[^\n]*)?\s+(?:deploy\s+)?[^\n]*--(?:prod|target=production)\b/i,
  /vercel-args\s*:\s*['"]?[^\n#]*--(?:prod|target=production)\b/i,
  /\bsupabase\s+db\s+push\b/i,
  /\bsupabase\s+functions\s+deploy\b/i,
  /\beas\s+build\b[^\n]*--profile(?:\s+|=)\s*production\b/i,
  /\b(?:pnpm|npm|yarn)\s+(?:run\s+)?(?:db:migrate|functions:deploy|deploy:production)\b/i,
  /\b(?:deploy[-_: ]?production|production[-_: ]?deploy)\b/i,
];
const STAGING_APPROVAL_INPUT = /inputs\.(?:staging_approved|staging_approval|approved_promotion)\s*(?:==|===)\s*true/i;
const MANIFEST_FUNCTION_ENUMERATION = /jq\s+-e?r?\s+['"]\.functions\s*\|\s*keys\[\]['"]\s+['"]?supabase\/functions\/manifest\.json['"]?(?!\s*\|)/i;
const FROZEN_INSTALL = /pnpm\s+install\s+[^\n#]*--frozen-lockfile(?:\s|$)/i;

function normalized(text) {
  return String(text ?? '').replace(/\r\n/g, '\n');
}

function withoutComments(text) {
  return normalized(text).split('\n').map((line) => line.trimStart().startsWith('#') ? '' : line.replace(/\s+#.*$/, '')).join('\n');
}

function hasProductionCommand(text) {
  const source = withoutComments(text);
  return PRODUCTION_COMMAND_PATTERNS.some((pattern) => pattern.test(source));
}

function isDeploymentWorkflow(path) {
  return DEPLOY_WORKFLOWS.includes(path);
}

function reusableReleasePath(job) {
  const match = job.lines.map((line) => line.match(/^\s{4}uses:\s*(['"]?)([^\s#"']+)\1\s*(?:#.*)?$/)).find(Boolean);
  return match ? unquote(match[2]) === './.github/workflows/release.yml' : false;
}

function reusableReleaseInput(job, name) {
  const sourceNames = name === 'staging_approved' ? [...APPROVAL_INPUTS] : [name];
  return job.lines.some((line) => new RegExp(`^\\s{6}${name}:\\s*\\$\\{\\{\\s*inputs\\.(?:${sourceNames.join('|')})\\s*\\}\\}\\s*(?:#.*)?$`, 'i').test(line));
}

function hasFrozenInstall(text) {
  const installs = withoutComments(text).split('\n').filter((line) => /\bpnpm\s+install\b/.test(line));
  return installs.length === 0 || installs.every((line) => FROZEN_INSTALL.test(line));
}

function manifestFunctionNames(manifest) {
  if (manifest && typeof manifest === 'object' && manifest.functions && typeof manifest.functions === 'object' && !Array.isArray(manifest.functions)) {
    return Object.keys(manifest.functions).filter((name) => /^[A-Za-z0-9_-]+$/.test(name));
  }
  return null;
}

function parseManifest(manifest) {
  if (manifest === undefined || manifest === null) return { names: null, error: null };
  if (typeof manifest === 'string') {
    try {
      return { names: manifestFunctionNames(JSON.parse(manifest)), error: null };
    } catch (error) {
      return { names: null, error: `manifest is not valid JSON: ${error.message}` };
    }
  }
  const names = manifestFunctionNames(manifest);
  return { names, error: names ? null : 'manifest functions must be an object' };
}

function indentOf(line) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function unquote(value) {
  return String(value ?? '').trim().replace(/^['"]|['"]$/g, '').trim();
}

function finding(path, line, rule, message = '') {
  return { path, line, rule, ...(message ? { message } : {}) };
}

function topLevelLine(lines, key) {
  return lines.findIndex((line) => new RegExp(`^${key}:\\s*(?:#.*)?$`, 'i').test(line));
}

function blockEnd(lines, start, indent) {
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (indentOf(line) <= indent) return index;
  }
  return lines.length;
}

function parseTriggers(lines) {
  const start = lines.findIndex((line) => /^["']?on["']?\s*:/.test(line));
  if (start === -1) return { triggers: [], workflowCall: null, workflowDispatch: null, push: null, start };
  const first = lines[start];
  const inline = first.match(/^["']?on["']?\s*:\s*\[(.*)\]\s*(?:#.*)?$/i);
  if (inline) {
    const triggers = inline[1].split(',').map((value) => unquote(value)).filter(Boolean);
    return {
      triggers,
      workflowCall: triggers.includes('workflow_call') ? { start, lines: [] } : null,
      workflowDispatch: triggers.includes('workflow_dispatch') ? { start, lines: [] } : null,
      push: triggers.includes('push') ? { start, lines: [] } : null,
      start,
    };
  }
  const end = blockEnd(lines, start + 1, 0);
  const triggers = [];
  let workflowCall = null;
  let workflowDispatch = null;
  let push = null;
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#') || indentOf(line) !== 2) continue;
    const match = line.match(/^\s{2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
    if (!match) continue;
    const name = match[1];
    triggers.push(name);
    if (name === 'workflow_call' || name === 'workflow_dispatch' || name === 'push') {
      const childEnd = blockEnd(lines, index + 1, 2);
      const value = { start: index, lines: lines.slice(index + 1, childEnd) };
      if (name === 'workflow_call') workflowCall = value;
      if (name === 'workflow_dispatch') workflowDispatch = value;
      if (name === 'push') push = value;
    }
  }
  return { triggers, workflowCall, workflowDispatch, push, start };
}

function parseInputValues(dispatch) {
  if (!dispatch) return new Map();
  const values = new Map();
  const lines = dispatch.lines;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s{6}([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
    if (!match) continue;
    const name = match[1];
    values.set(name, new Map());
    let end = index + 1;
    for (; end < lines.length; end += 1) {
      if (!lines[end].trim() || lines[end].trimStart().startsWith('#')) continue;
      if (indentOf(lines[end]) <= 6) break;
      const property = lines[end].match(/^\s{8}([A-Za-z0-9_-]+):\s*(.*?)\s*(?:#.*)?$/);
      if (property) values.get(name).set(property[1], unquote(property[2]));
    }
    index = end - 1;
  }
  return values;
}

function propertyValue(lines, key, indent = 4) {
  const match = lines.find((line) => new RegExp(`^\\s{${indent}}${key}:\\s*(.*?)\\s*(?:#.*)?$`, 'i').test(line));
  return match ? unquote(match.match(new RegExp(`^\\s{${indent}}${key}:\\s*(.*?)\\s*(?:#.*)?$`, 'i'))[1]) : '';
}

function propertyBlock(lines, key, indent = 4) {
  const start = lines.findIndex((line) => new RegExp(`^\\s{${indent}}${key}:\\s*(?:#.*)?$`, 'i').test(line));
  if (start === -1) return [];
  return lines.slice(start + 1, blockEnd(lines, start + 1, indent));
}

function parseNeeds(jobLines) {
  const inline = propertyValue(jobLines, 'needs');
  if (inline) {
    if (inline.startsWith('[') && inline.endsWith(']')) {
      return inline.slice(1, -1).split(',').map((value) => unquote(value)).filter(Boolean);
    }
    return [inline];
  }
  const block = propertyBlock(jobLines, 'needs');
  return block
    .map((line) => line.match(/^\s{6}-\s*([A-Za-z0-9_-]+)\s*(?:#.*)?$/)?.[1])
    .filter(Boolean);
}

function parseIf(jobLines) {
  const start = jobLines.findIndex((line) => /^\s{4}if:\s*/.test(line));
  if (start === -1) return '';
  let value = jobLines[start].replace(/^\s{4}if:\s*/, '').trim();
  for (let index = start + 1; index < jobLines.length; index += 1) {
    const line = jobLines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (indentOf(line) <= 4) break;
    value += ` ${line.trim()}`;
  }
  return value.replace(/\s+/g, ' ').trim();
}

function parseEnvironment(jobLines) {
  const directLine = jobLines.find((line) => /^\s{4}environment:\s*(.*?)\s*(?:#.*)?$/.test(line));
  if (directLine) {
    const direct = unquote(directLine.match(/^\s{4}environment:\s*(.*?)\s*(?:#.*)?$/)[1]);
    const inlineName = direct.match(/(?:^|[,{]\s*)name\s*:\s*['"]?([^'"}]+)['"]?/i)?.[1]?.trim();
    if (direct) return inlineName || direct;
  }
  const block = propertyBlock(jobLines, 'environment');
  return propertyValue(block, 'name', 6);
}

function parsePermissions(lines) {
  const start = topLevelLine(lines, 'permissions');
  if (start === -1) return null;
  const end = blockEnd(lines, start + 1, 0);
  const result = {};
  for (const line of lines.slice(start + 1, end)) {
    const match = line.match(/^\s{2}([A-Za-z0-9_-]+):\s*([^\s#]+)/);
    if (match) result[match[1]] = unquote(match[2]);
  }
  return result;
}

function parseJobs(lines) {
  const start = topLevelLine(lines, 'jobs');
  if (start === -1) return new Map();
  const starts = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (indentOf(line) === 0) break;
    const match = line.match(/^\s{2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
    if (match) starts.push({ name: match[1], start: index });
  }
  const jobs = new Map();
  for (let index = 0; index < starts.length; index += 1) {
    const current = starts[index];
    const end = index + 1 < starts.length ? starts[index + 1].start : lines.length;
    const body = lines.slice(current.start, end);
    jobs.set(current.name, {
      name: current.name,
      start: current.start,
      end,
      lines: body,
      needs: parseNeeds(body),
      if: parseIf(body),
      environment: parseEnvironment(body),
    });
  }
  return jobs;
}

function isProductionJob(job, strict = false) {
  return hasProductionCommand(job.lines.join('\n'))
    || (strict && (job.environment === 'production' || /^(?:production|prod|deploy|cd)$/i.test(job.name)));
}

function isDispatchOnly(expression) {
  if (!expression || expression.includes('||')) return false;
  const references = expression.match(/github\.event_name/g)?.length ?? 0;
  const comparisons = [...expression.matchAll(/github\.event_name\s*(===|==|!==|!=)\s*(['"])([^'"]+)\2/g)];
  return references > 0
    && references === comparisons.length
    && comparisons.every(([, operator, , event]) =>
      ['==', '==='].includes(operator) && event === 'workflow_dispatch');
}

function pushTriggerCanRunProduction(lines, productionJobs) {
  const trigger = parseTriggers(lines);
  if (!trigger.push || productionJobs.length === 0) return false;
  return productionJobs.some((job) => !isDispatchOnly(job.if) || !STAGING_APPROVAL_INPUT.test(job.if));
}

function envBypassFinding(path, lines, start) {
  let inEnvironment = false;
  let environmentIndent = -1;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    const environmentStart = line.match(/^(\s*)env:\s*(?:#.*)?$/i);
    if (environmentStart) {
      inEnvironment = true;
      environmentIndent = environmentStart[1].length;
      if (/(?:bypass|skip|override)/i.test(line)) return finding(path, index + 1, 'bypass-environment-forbidden');
      continue;
    }
    if (inEnvironment) {
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      if (indentOf(line) <= environmentIndent) {
        inEnvironment = false;
      } else {
        const match = line.match(/^\s*(?:[-]?\s*)?([A-Za-z0-9_.-]+)\s*:/);
        if (match && BYPASS_NAME.test(match[1])) return finding(path, index + 1, 'bypass-environment-forbidden');
        if (/(?:vars|env)\.[A-Za-z0-9_.-]*(?:bypass|skip|override)/i.test(line)) {
          return finding(path, index + 1, 'bypass-environment-forbidden');
        }
      }
    }
    if (/^\s*env:\s*\{/.test(line) && /(?:bypass|skip|override)/i.test(line)) {
      return finding(path, index + 1, 'bypass-environment-forbidden');
    }
  }
  return null;
}

function actionFindings(path, lines) {
  const findings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*-?\s*uses:\s*(['"]?)([^\s#"']+)\1/i);
    if (!match) continue;
    const reference = unquote(match[2]);
    if (!reference.startsWith('.') && !IMMUTABLE_REF.test(reference)) {
      findings.push(finding(path, index + 1, 'immutable-action-required', `pin ${reference} to a reviewed 40-character commit SHA.`));
    }
    if (CHECKOUT.test(reference)) {
      const end = lines.findIndex((line, lineIndex) => lineIndex > index && /^\s*-?\s*(?:uses|run):/.test(line));
      const block = lines.slice(index + 1, end === -1 ? lines.length : end);
      if (!block.some((line) => /persist-credentials\s*:\s*false\b/i.test(line))) {
        findings.push(finding(path, index + 1, 'checkout-persist-credentials-required'));
      }
    }
  }
  return findings;
}

function graphReachable(start, jobs) {
  const seen = new Set();
  const queue = [start];
  while (queue.length > 0) {
    const name = queue.shift();
    if (!name || seen.has(name) || !jobs.has(name)) continue;
    seen.add(name);
    queue.push(...jobs.get(name).needs);
  }
  return seen;
}

function findJobsByKind(jobs) {
  const found = new Map();
  for (const [kind, pattern] of GATE_PATTERNS) {
    const matches = [...jobs.values()].filter((job) => pattern.test(job.name));
    if (matches.length > 0) found.set(kind, matches);
  }
  return found;
}

function functionScanFindings(path, functionJobs, functionNames) {
  const findings = [];
  if (!functionNames || functionNames.length === 0) {
    findings.push(finding(path, 1, 'function-manifest-required'));
    return findings;
  }
  for (const job of functionJobs) {
    const source = withoutComments(job.lines.join('\n'));
    const enumeratesManifest = MANIFEST_FUNCTION_ENUMERATION.test(source);
    const usesFrozenDenoCheck = /deno\s+check[^\n]*--frozen\b/i.test(source);
    const matrixMatch = source.match(/^\s+function:\s*\[([^\]]*)\]\s*(?:#.*)?$/mi);
    const matrixNames = matrixMatch ? matrixMatch[1].split(',').map((value) => unquote(value)).filter(Boolean) : [];
    const usesFunctionMatrix = /\$\{\{\s*matrix\.function\s*\}\}/.test(source);
    const matrixCoversManifest = usesFunctionMatrix && functionNames.every((name) => matrixNames.includes(name));
    if (!usesFrozenDenoCheck) {
      findings.push(finding(path, job.start + 1, 'function-scan-manifest-required', 'function scan must use a frozen Deno check.'));
      continue;
    }
    if (enumeratesManifest || matrixCoversManifest) continue;
    const missing = functionNames.filter((name) => !source.includes(`supabase/functions/${name}/index.ts`) && !matrixNames.includes(name));
    if (missing.length > 0) {
      findings.push(finding(path, job.start + 1, 'function-scan-manifest-required', 'function scan must cover every function in supabase/functions/manifest.json.'));
      for (const name of missing) {
        findings.push(finding(path, job.start + 1, 'function-scan-function-required', `manifest function ${name} is not scanned.`));
      }
    }
  }
  return findings;
}

function analyzeReleaseWorkflow(path, text, functionNames) {
  const lines = normalized(text).split('\n');
  const findings = [];
  const trigger = parseTriggers(lines);
  const jobs = parseJobs(lines);
  const triggerNames = new Set(trigger.triggers);

  if (triggerNames.size !== RELEASE_TRIGGERS.size || [...triggerNames].some((name) => !RELEASE_TRIGGERS.has(name))) {
    findings.push(finding(path, Math.max(trigger.start, 0) + 1, 'release-dispatch-only'));
  }

  for (const triggerName of ['workflowDispatch', 'workflowCall']) {
    const inputs = parseInputValues(trigger[triggerName]);
    const approval = inputs.get('staging_approved');
    const stagingUrl = inputs.get('staging_url');
    if (!approval || approval.get('required') !== 'true' || approval.get('type') !== 'boolean') {
      findings.push(finding(path, Math.max(trigger[triggerName]?.start ?? trigger.start, 0) + 1, 'staging-approval-required'));
    }
    if (!stagingUrl || stagingUrl.get('required') !== 'true' || stagingUrl.get('type') !== 'string') {
      findings.push(finding(path, Math.max(trigger[triggerName]?.start ?? trigger.start, 0) + 1, 'staging-url-required'));
    }
  }

  if (!hasFrozenInstall(text)) findings.push(finding(path, 1, 'frozen-lockfile-required'));

  const permissions = parsePermissions(lines);
  if (!permissions || permissions.contents !== 'read' || Object.values(permissions).some((value) => value === 'write' || value === 'write-all')) {
    findings.push(finding(path, 1, 'least-privilege-permissions-required'));
  }

  const bypass = envBypassFinding(path, lines, 0);
  if (bypass) findings.push(bypass);
  findings.push(...actionFindings(path, lines));

  const productionJobs = [...jobs.values()].filter((job) => isProductionJob(job, true));
  if (productionJobs.length === 0) findings.push(finding(path, 1, 'production-job-required'));

  const foundKinds = findJobsByKind(jobs);
  for (const [kind, rule] of RELEASE_REQUIRED_JOBS) {
    if (!foundKinds.has(kind)) findings.push(finding(path, 1, rule));
  }
  for (const [kind, pattern] of GATE_COMMAND_PATTERNS) {
    const matches = foundKinds.get(kind) ?? [];
    if (matches.length > 0 && !matches.some((job) => pattern.test(withoutComments(job.lines.slice(1).join('\n'))))) {
      findings.push(finding(path, matches[0].start + 1, 'gate-command-required', `${kind} gate must execute its required verification command.`));
    }
  }

  for (const job of productionJobs) {
    const source = withoutComments(job.lines.join('\n'));
    if (!isDispatchOnly(job.if)) findings.push(finding(path, job.start + 1, 'production-dispatch-guard-required'));
    if (!STAGING_APPROVAL_INPUT.test(job.if)) findings.push(finding(path, job.start + 1, 'staging-approval-required'));
    if (job.environment !== 'production') findings.push(finding(path, job.start + 1, 'production-environment-required'));
    if (!/verify-release-evidence\.mjs[^\n]*--verify[^\n]*--require-promotion/i.test(source)) {
      findings.push(finding(path, job.start + 1, 'promotion-evidence-gate-required', 'production must verify signed and attested evidence in promotion mode.'));
    }
    if (!/^\s*RELEASE_ATTESTATION_VERIFIER:\s*\$\{\{\s*vars\.RELEASE_ATTESTATION_VERIFIER\s*\}\}/im.test(source)) {
      findings.push(finding(path, job.start + 1, 'release-attestation-verifier-required', 'production must receive the operator-approved attestation verifier path.'));
    }
    if (!/^\s*PRODUCTION_ENVIRONMENT_VERIFIER:\s*\$\{\{\s*vars\.PRODUCTION_ENVIRONMENT_VERIFIER\s*\}\}/im.test(source)) {
      findings.push(finding(path, job.start + 1, 'production-environment-verifier-required', 'production must receive the operator-approved environment verifier path.'));
    }
  }

  const production = productionJobs.find((job) => job.environment === 'production') ?? productionJobs[0];
  const reachable = production ? graphReachable(production.name, jobs) : new Set();
  for (const [kind] of RELEASE_REQUIRED_JOBS) {
    const matches = foundKinds.get(kind) ?? [];
    if (DIRECT_PROMOTION_KINDS.has(kind) && production && !matches.some((job) => production.needs.includes(job.name))) {
      findings.push(finding(path, production.start + 1, 'promotion-dependency-required', `${kind} must be a direct dependency of production promotion.`));
    }
    for (const job of matches) {
      if (!reachable.has(job.name)) findings.push(finding(path, job.start + 1, 'promotion-dependency-required', `${kind} job ${job.name} is not a dependency of production promotion.`));
      if (kind !== 'staging-approval' && job.if) findings.push(finding(path, job.start + 1, 'gate-bypass-forbidden', `${kind} gate must not be conditionally skipped.`));
    }
  }

  const stagingApproval = (foundKinds.get('staging-approval') ?? []).find((job) => job.environment === 'staging');
  if (!stagingApproval) {
    findings.push(finding(path, 1, 'staging-approval-required'));
  } else if (!STAGING_APPROVAL_INPUT.test(stagingApproval.if)) {
    findings.push(finding(path, stagingApproval.start + 1, 'staging-approval-required'));
  }

  const sbomJobs = foundKinds.get('sbom') ?? [];
  const evidenceJobs = foundKinds.get('evidence') ?? [];
  const sbom = sbomJobs.find((job) => /generate-release-evidence\.mjs[\s\S]*--all/i.test(withoutComments(job.lines.join('\n'))));
  const evidence = evidenceJobs.find((job) => /verify-release-evidence\.mjs[\s\S]*--verify/i.test(withoutComments(job.lines.join('\n'))));
  if (!sbom) findings.push(finding(path, 1, 'sbom-gate-required'));
  if (!evidence) findings.push(finding(path, 1, 'evidence-gate-required'));
  if (evidence) {
    for (const kind of ['sbom', 'sast', 'migration-replay']) {
      if (!(foundKinds.get(kind) ?? []).some((job) => evidence.needs.includes(job.name))) {
        findings.push(finding(path, evidence.start + 1, 'evidence-gate-dependency-required', `${kind} must complete before release evidence verification.`));
      }
    }
  }

  for (const job of jobs.values()) {
    if (job.lines.some((line) => /^\s+continue-on-error\s*:\s*['"]?true['"]?(?:\s|$)/i.test(line))) {
      findings.push(finding(path, job.start + 1, 'gate-bypass-forbidden'));
    }
    if (job.lines.some((line) => /^\s+if\s*:\s*.*(?:always\s*\(|!\s*cancelled\s*\(|failure\s*\()/i.test(line)) || /^\s*false\s*$/i.test(job.if)) {
      findings.push(finding(path, job.start + 1, 'gate-bypass-forbidden'));
    }
  }

  findings.push(...functionScanFindings(path, foundKinds.get('function-scan') ?? [], functionNames));

  const unique = new Map(findings.map((item) => [`${item.path}:${item.line}:${item.rule}`, item]));
  return [...unique.values()].sort((left, right) =>
    left.line - right.line || left.rule.localeCompare(right.rule));
}

function analyzeDeployWorkflow(path, text) {
  const lines = normalized(text).split('\n');
  const findings = [];
  const trigger = parseTriggers(lines);
  const jobs = parseJobs(lines);
  const deploymentWorkflow = isDeploymentWorkflow(path);
  const releaseCalls = [...jobs.values()].filter((job) => reusableReleasePath(job));
  const productionEnvironmentStrict = deploymentWorkflow || !/backup\.ya?ml$/i.test(path);
  const productionJobs = [...jobs.values()].filter((job) => isProductionJob(job, productionEnvironmentStrict));
  const directProductionJobs = productionJobs.filter((job) => !reusableReleasePath(job));
  const inputs = parseInputValues(trigger.workflowDispatch);
  const approvedInput = [...inputs.entries()].find(([name]) => APPROVAL_INPUTS.has(name));
  const requiresProductionPath = deploymentWorkflow || productionJobs.length > 0 || releaseCalls.length > 0;

  if (requiresProductionPath && !trigger.triggers.includes('workflow_dispatch')) findings.push(finding(path, Math.max(trigger.start, 0) + 1, 'production-dispatch-guard-required'));
  if (requiresProductionPath && (!approvedInput || approvedInput[1].get('required') !== 'true' || approvedInput[1].get('type') !== 'boolean')) {
    findings.push(finding(path, Math.max(trigger.start, 0) + 1, 'production-approval-input-required'));
  }
  if (!hasFrozenInstall(text)) findings.push(finding(path, 1, 'frozen-lockfile-required'));
  if (productionJobs.length === 0 && releaseCalls.length === 0 && deploymentWorkflow) {
    findings.push(finding(path, 1, 'production-job-required'));
  }
  if (pushTriggerCanRunProduction(lines, directProductionJobs)) {
    findings.push(finding(path, Math.max(trigger.push?.start ?? 0, 0) + 1, 'production-push-trigger'));
  }

  for (const job of jobs.values()) {
    if (hasProductionCommand(job.lines.join('\n'))) {
      findings.push(finding(path, job.start + 1, 'independent-production-command-forbidden', 'independent workflows may not execute production deployment commands.'));
    }
  }

  for (const job of directProductionJobs) {
    findings.push(finding(path, job.start + 1, 'independent-production-job-forbidden', 'independent workflows may not define a production deployment job.'));
    if (!isDispatchOnly(job.if)) findings.push(finding(path, job.start + 1, 'production-dispatch-guard-required'));
    if (!STAGING_APPROVAL_INPUT.test(job.if)) findings.push(finding(path, job.start + 1, 'production-approval-guard-required'));
  }

  for (const job of releaseCalls) {
    if (!isDispatchOnly(job.if)) findings.push(finding(path, job.start + 1, 'production-dispatch-guard-required'));
    if (!STAGING_APPROVAL_INPUT.test(job.if)) findings.push(finding(path, job.start + 1, 'production-approval-guard-required'));
    if (!reusableReleaseInput(job, 'staging_approved') || !reusableReleaseInput(job, 'staging_url')) {
      findings.push(finding(path, job.start + 1, 'release-delegation-input-required', 'reusable release calls must pass staging_approved and staging_url explicitly.'));
    }
    if (!job.lines.some((line) => /^\s{4}secrets\s*:\s*inherit\s*(?:#.*)?$/i.test(line))) {
      findings.push(finding(path, job.start + 1, 'release-delegation-secrets-required', 'reusable release calls must inherit repository secrets explicitly.'));
    }
  }

  if (deploymentWorkflow && releaseCalls.length === 0) {
    findings.push(finding(path, 1, 'canonical-release-delegation-required', 'production workflows must delegate to .github/workflows/release.yml.'));
  }
  findings.push(...actionFindings(path, lines));
  return findings;
}

export function analyzeReleasePath({ release = {}, deployments = {}, functionManifest } = {}) {
  const findings = [];
  const releaseEntries = release instanceof Map ? [...release.entries()] : Object.entries(release);
  const releaseEntry = releaseEntries.find(([path]) => path === RELEASE_WORKFLOW) ?? releaseEntries[0];
  const manifestSource = functionManifest === undefined
    ? (() => {
      try {
        return readFileSync(resolve(ROOT, FUNCTION_MANIFEST), 'utf8');
      } catch {
        return null;
      }
    })()
    : functionManifest;
  const manifest = parseManifest(manifestSource);
  if (!releaseEntry || !releaseEntry[1]) {
    findings.push(finding(RELEASE_WORKFLOW, 1, 'release-workflow-required'));
    findings.push(finding(RELEASE_WORKFLOW, 1, 'release-dispatch-only'));
  } else {
    if (manifest.error) findings.push(finding(FUNCTION_MANIFEST, 1, 'function-manifest-invalid', manifest.error));
    findings.push(...analyzeReleaseWorkflow(releaseEntry[0], releaseEntry[1], manifest.names));
  }

  const deploymentEntries = deployments instanceof Map ? [...deployments.entries()] : Object.entries(deployments);
  for (const [path, text] of deploymentEntries) {
    if (path === RELEASE_WORKFLOW) continue;
    if (text) findings.push(...analyzeDeployWorkflow(path, text));
    else if (DEPLOY_WORKFLOWS.includes(path)) findings.push(finding(path, 1, 'workflow-unreadable'));
  }
  return [...new Map(findings.map((item) => [`${item.path}:${item.line}:${item.rule}`, item])).values()]
    .sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.rule.localeCompare(right.rule));
}

function manifestSourceFindings(rootDirectory, manifestSource) {
  const { names } = parseManifest(manifestSource);
  if (!names) return [];
  return names
    .filter((name) => !existsSync(resolve(rootDirectory, 'supabase', 'functions', name, 'index.ts')))
    .map((name) => finding(`supabase/functions/${name}/index.ts`, 1, 'function-source-missing', `manifest function ${name} has no index.ts source.`));
}

export function checkRepository(rootDirectory = ROOT) {
  let releaseText = null;
  try {
    releaseText = readFileSync(resolve(rootDirectory, RELEASE_WORKFLOW), 'utf8');
  } catch {
    releaseText = null;
  }
  const deployments = {};
  const workflowDirectory = resolve(rootDirectory, '.github', 'workflows');
  if (existsSync(workflowDirectory)) {
    for (const name of readdirSync(workflowDirectory).filter((entry) => /\.ya?ml$/i.test(entry))) {
      const path = `.github/workflows/${name}`;
      if (path === RELEASE_WORKFLOW) continue;
      try {
        deployments[path] = readFileSync(resolve(rootDirectory, path), 'utf8');
      } catch {
        deployments[path] = null;
      }
    }
  }
  for (const path of DEPLOY_WORKFLOWS) {
    if (!(path in deployments)) deployments[path] = null;
  }
  let functionManifest = null;
  try {
    functionManifest = readFileSync(resolve(rootDirectory, FUNCTION_MANIFEST), 'utf8');
  } catch {
    functionManifest = null;
  }
  const findings = analyzeReleasePath({
    release: releaseText ? { [RELEASE_WORKFLOW]: releaseText } : {},
    deployments,
    functionManifest,
  });
  findings.push(...manifestSourceFindings(rootDirectory, functionManifest));
  return [...new Map(findings.map((item) => [`${item.path}:${item.line}:${item.rule}`, item])).values()]
    .sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.rule.localeCompare(right.rule));
}

function main() {
  const findings = checkRepository();
  if (findings.length > 0) {
    for (const item of findings) console.error(`${item.path}:${item.line}:${item.rule}${item.message ? `: ${item.message}` : ''}`);
    process.exitCode = 1;
    return;
  }
  console.log('single-release-path-pass');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
