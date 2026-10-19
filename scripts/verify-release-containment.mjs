import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workflowPaths = [
  '.github/workflows/cd.yml',
  '.github/workflows/deploy-web.yml',
  '.github/workflows/deploy-mobile.yml',
];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPROVAL_INPUTS = ['staging_approved', 'staging_approval', 'approved_promotion'];
const APPROVAL_GUARD = /inputs\.(?:staging_approved|staging_approval|approved_promotion)\s*(?:==|===)\s*true\b/i;
const PRODUCTION_COMMANDS = [
  /vercel(?:\s+[^\n]*)?\s+(?:deploy\s+)?[^\n]*--(?:prod|target=production)\b/i,
  /vercel-args\s*:\s*['"]?[^\n#]*--(?:prod|target=production)\b/i,
  /\bsupabase\s+db\s+push\b/i,
  /\bsupabase\s+functions\s+deploy\b/i,
  /\beas\s+build\b[^\n]*--profile(?:\s+|=)\s*production\b/i,
  /\b(?:pnpm|npm|yarn)\s+(?:run\s+)?(?:db:migrate|functions:deploy|deploy:production)\b/i,
  /\b(?:deploy[-_: ]?production|production[-_: ]?deploy)\b/i,
];
const finding = (path, line, rule) => ({ path, line, rule });

function child(lines, name) {
  const parentIndent = lines[0]?.search(/\S/) ?? -1;
  const pattern = new RegExp(`^(\\s+)${name}:\\s*(?:#.*)?$`);
  let start = -1;
  let indent = Number.POSITIVE_INFINITY;

  for (let index = 1; index < lines.length; index += 1) {
    const match = lines[index].match(pattern);
    const candidateIndent = match?.[1].length ?? -1;
    if (candidateIndent > parentIndent && candidateIndent < indent) {
      start = index;
      indent = candidateIndent;
    }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (!lines[index].trim() || lines[index].trimStart().startsWith('#')) continue;
    if (lines[index].search(/\S/) <= indent) {
      end = index;
      break;
    }
  }
  return { start, end, indent, lines: lines.slice(start, end) };
}

function branchMatchesMain(value) {
  if (typeof value !== 'string') return false;
  let pattern = value.trim();
  if (pattern.startsWith('!')) return false;
  pattern = pattern.replace(/^refs\/heads\//, '');
  const wildcard = [...pattern].findIndex((character) => '*?+()[]{}!'.includes(character));
  return 'main'.startsWith(wildcard === -1 ? pattern : pattern.slice(0, wildcard));
}

function pushIncludesMain(on) {
  const push = on && child(on.lines, 'push');
  if (!push) return false;

  const inline = push.lines.find((line) => /^\s+branches:\s*\[(.*)\]\s*(?:#.*)?$/.test(line));
  if (inline) {
    return inline
      .replace(/^.*branches:\s*\[/, '')
      .replace(/\].*$/, '')
      .split(',')
      .map((branch) => branch.trim().replace(/^['"]|['"]$/g, ''))
      .some(branchMatchesMain);
  }

  const branches = push.lines.findIndex((line) => /^\s+branches:\s*(?:#.*)?$/.test(line));
  if (branches === -1) return true;
  return push.lines.slice(branches + 1).some((line) => {
    const branch = line.match(/^\s+-\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/)?.[1];
    return branchMatchesMain(branch);
  });
}

function hasApprovedInput(dispatch) {
  const inputs = dispatch && child(dispatch.lines, 'inputs');
  if (!inputs) return false;
  return APPROVAL_INPUTS.some((name) => {
    const input = child(inputs.lines, name);
    if (!input) return false;
    const value = (property) => {
      const match = input.lines.find((line) =>
        new RegExp(`^\\s{${input.indent + 2}}${property}:\\s*(.*?)\\s*(?:#.*)?$`).test(line));
      return match?.match(new RegExp(`^\\s{${input.indent + 2}}${property}:\\s*(.*?)\\s*(?:#.*)?$`))?.[1]
        .replace(/^['"]|['"]$/g, '');
    };
    return value('required') === 'true' && value('type') === 'boolean';
  });
}

function jobs(lines) {
  const start = lines.findIndex((line) => /^jobs:\s*(?:#.*)?$/.test(line));
  if (start === -1) return [];
  const starts = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
    if (match) starts.push({ name: match[1], start: index });
  }
  return starts.map((job, index) => ({
    ...job,
    end: index + 1 < starts.length ? starts[index + 1].start : lines.length,
  }));
}

function isReleaseCall(jobLines) {
  return jobLines.some((line) => /^\s{4}uses:\s*(['"]?)\.\/\.github\/workflows\/release\.yml\1\s*(?:#.*)?$/i.test(line));
}

function hasFrozenInstall(text) {
  const installs = text.split('\n').filter((line) => /\bpnpm\s+install\b/.test(line));
  return installs.length === 0 || installs.every((line) => /pnpm\s+install\s+[^\n#]*--frozen-lockfile(?:\s|$)/i.test(line));
}

function isProduction(source) {
  return [
    /^ {4}environment:\s*production\s*(?:#.*)?$/m,
    /^ {4}environment:\s*\{[^}]*\bname\s*:\s*['"]?production['"]?/im,
    /^ {6}name:\s*production\s*(?:#.*)?$/m,
    ...PRODUCTION_COMMANDS,
  ].some((pattern) => pattern.test(source));
}

function condition(source) {
  return source.match(/^ {4}if:\s*([^\n]*(?:\n {6,}[^\n]*)*)/m)?.[1]
    .replace(/\s+/g, ' ').trim() ?? '';
}

function dispatchOnly(expression) {
  if (!expression || expression.includes('||')) return false;
  const references = expression.match(/github\.event_name/g)?.length ?? 0;
  const comparisons = [...expression.matchAll(/github\.event_name\s*(===|==|!==|!=)\s*(['"])([^'"]+)\2/g)];
  return references > 0
    && references === comparisons.length
    && comparisons.every(([, operator, , event]) =>
      ['==', '==='].includes(operator) && event === 'workflow_dispatch');
}

function isolatedStep(jobLines, routeIndex) {
  let start = 0;
  for (let index = routeIndex; index >= 0; index -= 1) {
    if (/^ {6}-\s+/.test(jobLines[index])) {
      start = index;
      break;
    }
  }
  const relativeEnd = jobLines.findIndex((line, index) =>
    index > routeIndex && /^ {6}-\s+/.test(line));
  const end = relativeEnd === -1 ? jobLines.length : relativeEnd;
  return jobLines.slice(start, end).some((line) =>
    /^\s*RELEASE_CONTAINMENT_ROUTE\s*:\s*['"]?isolated['"]?\s*(?:#.*)?$/i.test(line));
}

function destructiveRoutes(path, lines, parsedJobs) {
  const findings = [];
  const route = /\bapi\/(?:setup|update|backup)(?:\/|[^A-Za-z0-9_]|$)/i;
  for (const job of parsedJobs) {
    const jobLines = lines.slice(job.start, job.end);
    for (let index = 0; index < jobLines.length; index += 1) {
      if (route.test(jobLines[index]) && !isolatedStep(jobLines, index)) {
        findings.push(finding(path, job.start + index + 1, 'destructive-route-isolation-required'));
      }
    }
  }
  return findings;
}

export function analyzeWorkflow(path, text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const onStart = lines.findIndex((line) => /^on:\s*(?:#.*)?$/.test(line));
  const on = onStart === -1 ? null : { start: onStart, lines: lines.slice(onStart) };
  const push = on && child(on.lines, 'push');
  const dispatch = on && child(on.lines, 'workflow_dispatch');
  const parsedJobs = jobs(lines);
  const releaseCalls = parsedJobs.filter((job) => isReleaseCall(lines.slice(job.start, job.end)));
  const productionJobs = parsedJobs.filter((job) => isProduction(lines.slice(job.start, job.end).join('\n')));
  const directProductionJobs = productionJobs.filter((job) => !releaseCalls.includes(job));
  const findings = [];

  if (productionJobs.length === 0 && releaseCalls.length === 0) findings.push(finding(path, 1, 'production-job-required'));
  if (productionJobs.length > 0 || releaseCalls.length > 0) {
    if (!dispatch) {
      findings.push(finding(path, Math.max(onStart, 0) + 1, 'production-workflow-dispatch-required'));
    } else if (!hasApprovedInput(dispatch)) {
      findings.push(finding(path, onStart + dispatch.start + 1, 'approved-promotion-input-required'));
    }
  }
  if (!hasFrozenInstall(text)) findings.push(finding(path, 1, 'frozen-lockfile-required'));

  for (const job of directProductionJobs) {
    const source = lines.slice(job.start, job.end).join('\n');
    const expression = condition(source);
    if (pushIncludesMain(on) && !dispatchOnly(expression)) {
      findings.push(finding(path, onStart + (push?.start ?? 0) + 1, 'production-main-push-trigger'));
    }
    if (PRODUCTION_COMMANDS.some((pattern) => pattern.test(source))) {
      findings.push(finding(path, job.start + 1, 'independent-production-command-forbidden'));
    }
    findings.push(finding(path, job.start + 1, 'independent-production-job-forbidden'));
    if (!dispatchOnly(expression)) {
      findings.push(finding(path, job.start + 1, 'production-dispatch-guard-required'));
    }
    if (!APPROVAL_GUARD.test(expression)) {
      findings.push(finding(path, job.start + 1, 'production-approval-guard-required'));
    }
  }

  for (const job of releaseCalls) {
    const expression = condition(lines.slice(job.start, job.end).join('\n'));
    if (!dispatchOnly(expression)) findings.push(finding(path, job.start + 1, 'production-dispatch-guard-required'));
    if (!APPROVAL_GUARD.test(expression)) findings.push(finding(path, job.start + 1, 'production-approval-guard-required'));
  }

  findings.push(...destructiveRoutes(path, lines, parsedJobs));
  const unique = new Map(findings.map((item) => [`${item.path}:${item.line}:${item.rule}`, item]));
  return [...unique.values()].sort((left, right) =>
    left.line - right.line || left.rule.localeCompare(right.rule));
}

function main() {
  const findings = [];
  for (const path of workflowPaths) {
    try {
      findings.push(...analyzeWorkflow(path, readFileSync(resolve(root, path), 'utf8')));
    } catch {
      findings.push(finding(path, 1, 'workflow-unreadable'));
    }
  }

  if (findings.length > 0) {
    for (const item of findings) console.log(`${item.path}:${item.line}:${item.rule}`);
    process.exitCode = 1;
  } else {
    for (const path of workflowPaths) console.log(`${path}:1:release-containment-pass`);
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
