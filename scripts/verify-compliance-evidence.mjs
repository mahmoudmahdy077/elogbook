#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MATRIX_PATH = 'docs/compliance/hipaa-control-matrix.yaml';
const VENDOR_PATH = 'docs/compliance/vendor-register.yaml';
const EXCEPTION_PATH = 'docs/security/exception-register.yaml';
const CLAIM_PATHS = [
  'SECURITY.md',
  'docs/compliance/security-overview.md',
  'docs/compliance/hipaa.md',
  'docs/compliance/gdpr.md',
  'docs/security/threat-model.md',
  'docs/security/access-review.md',
  'docs/security/retention-policy.md',
  'docs/security/operating-cadence.md',
];
const CONTROL_REQUIRED = [
  'id',
  'title',
  'owner',
  'implementation_paths',
  'test_ci_references',
  'evidence_artifacts',
  'review_date',
  'vendor_baa_status',
  'exception_expiry',
];
const VENDOR_REQUIRED = [
  'id',
  'name',
  'service',
  'owner',
  'baa_status',
  'review_date',
  'evidence_artifacts',
  'exception_expiry',
];
const NULLABLE_REQUIRED = new Set(['exception_expiry']);
const EXCEPTION_REQUIRED = [
  'id',
  'title',
  'owner',
  'status',
  'review_date',
  'expires_on',
  'evidence_artifacts',
  'compensating_controls',
];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SECRET_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_JWT|SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY)\s*[:=]\s*[^\s`'" ]+/gi,
  /(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|rk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{10,})/g,
  /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/g,
  /(?:password|passwd|secret|token|api[_ -]?key|access[_ -]?token)\s*[:=]\s*[^\s`'"]{8,}/gi,
];
const CLAIM_RULES = [
  { id: 'hipaa-compliance-claim', label: 'HIPAA compliance', regex: /\bhipaa(?:[- ]+)compliant\b/gi },
  { id: 'certification-claim', label: 'certification', regex: /\b(?:certified|certification)\b/gi },
  { id: 'encryption-claim', label: 'encryption', regex: /\b(?:encrypted|encryption)\b/gi },
  { id: 'sqlcipher-claim', label: 'SQLCipher', regex: /\bSQLCipher\b/gi },
  { id: 'signature-claim', label: 'signature', regex: /\b(?:signed|signature)\b/gi },
];
const NEGATION_PATTERN = /\b(?:not|never|no|without|pending|disabled|unverified|unavailable|unsupported|unsigned|draft|requires?|required|must|cannot|awaiting|blocked|unproven|unconfirmed|before|until)\b/i;

function defaultToday() {
  return process.env.COMPLIANCE_TODAY ?? new Date().toISOString().slice(0, 10);
}

function finding(path, line, rule, message, id = '') {
  return {
    path: redact(normalizePath(path)),
    line: Number.isInteger(line) ? line : 1,
    rule,
    message: redact(message),
    ...(id ? { id: redact(id) } : {}),
  };
}

function normalizePath(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function redact(value) {
  let output = String(value ?? '');
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, '[REDACTED]');
  return output;
}

function shortHash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function stripComment(value) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : quote ?? character;
      continue;
    }
    if (character === '#' && quote === null && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value.trimEnd();
}

function tokenizeYaml(text) {
  const tokens = [];
  const lines = String(text ?? '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;
    if (/^\t/.test(line)) throw new Error(`YAML_TAB_INDENTATION:${index + 1}`);
    const indentation = line.match(/^\s*/)[0].length;
    const content = stripComment(line.slice(indentation));
    if (!content) continue;
    tokens.push({ indentation, content, line: index + 1 });
  }
  return tokens;
}

function splitKeyValue(value) {
  let quote = null;
  let escaped = false;
  let bracketDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : quote ?? character;
      continue;
    }
    if (quote !== null) continue;
    if (character === '[' || character === '{') bracketDepth += 1;
    if (character === ']' || character === '}') bracketDepth -= 1;
    if (character === ':' && bracketDepth === 0 && (index + 1 === value.length || /\s/.test(value[index + 1]))) {
      return { key: value.slice(0, index).trim(), value: value.slice(index + 1).trim() };
    }
  }
  return null;
}

function parseScalar(value) {
  const text = String(value ?? '').trim();
  if (text === '' || text === 'null' || text === '~') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === '[]') return [];
  if (text === '{}') return {};
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replaceAll("''", "'");
  if (text.startsWith('[') && text.endsWith(']')) {
    const content = text.slice(1, -1).trim();
    return content ? content.split(',').map((entry) => parseScalar(entry)) : [];
  }
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function parseYamlBlock(tokens, start, indentation) {
  const first = tokens[start];
  if (!first || first.indentation !== indentation) throw new Error(`YAML_INDENTATION:${first?.line ?? 1}`);
  if (first.content === '-' || first.content.startsWith('- ')) return parseYamlSequence(tokens, start, indentation);
  return parseYamlMapping(tokens, start, indentation);
}

function parseYamlMapping(tokens, start, indentation, initial = null) {
  const result = {};
  let index = start;
  if (initial) {
    const pair = splitKeyValue(initial.content);
    if (!pair) throw new Error(`YAML_MAPPING:${initial.line}`);
    if (Object.prototype.hasOwnProperty.call(result, pair.key)) throw new Error(`YAML_DUPLICATE_KEY:${initial.line}`);
    if (pair.value) {
      result[pair.key] = parseScalar(pair.value);
      index += 1;
    } else {
      const child = tokens[index + 1];
      if (child && child.indentation > indentation) {
        const [value, next] = parseYamlBlock(tokens, index + 1, child.indentation);
        result[pair.key] = value;
        index = next;
      } else {
        result[pair.key] = null;
        index += 1;
      }
    }
  }
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.indentation < indentation) break;
    if (token.indentation > indentation) throw new Error(`YAML_INDENTATION:${token.line}`);
    if (token.content === '-' || token.content.startsWith('- ')) break;
    const pair = splitKeyValue(token.content);
    if (!pair) throw new Error(`YAML_MAPPING:${token.line}`);
    if (Object.prototype.hasOwnProperty.call(result, pair.key)) throw new Error(`YAML_DUPLICATE_KEY:${token.line}`);
    if (pair.value) {
      result[pair.key] = parseScalar(pair.value);
      index += 1;
      continue;
    }
    const child = tokens[index + 1];
    if (child && child.indentation > indentation) {
      const [value, next] = parseYamlBlock(tokens, index + 1, child.indentation);
      result[pair.key] = value;
      index = next;
    } else {
      result[pair.key] = null;
      index += 1;
    }
  }
  return [result, index];
}

function parseYamlSequence(tokens, start, indentation) {
  const result = [];
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.indentation < indentation) break;
    if (token.indentation !== indentation || (token.content !== '-' && !token.content.startsWith('- '))) break;
    const rest = token.content === '-' ? '' : token.content.slice(2).trim();
    index += 1;
    if (!rest) {
      const child = tokens[index];
      if (child && child.indentation > indentation) {
        const [value, next] = parseYamlBlock(tokens, index, child.indentation);
        result.push(value);
        index = next;
      } else {
        result.push(null);
      }
      continue;
    }
    const pair = splitKeyValue(rest);
    if (!pair) {
      result.push(parseScalar(rest));
      continue;
    }
    const item = {};
    if (pair.value) item[pair.key] = parseScalar(pair.value);
    else {
      const child = tokens[index];
      if (child && child.indentation > indentation) {
        const [value, next] = parseYamlBlock(tokens, index, child.indentation);
        item[pair.key] = value;
        index = next;
      } else item[pair.key] = null;
    }
    if (index < tokens.length && tokens[index].indentation > indentation) {
      const childIndentation = tokens[index].indentation;
      const [values, next] = parseYamlMapping(tokens, index, childIndentation);
      Object.assign(item, values);
      index = next;
    }
    result.push(item);
  }
  return [result, index];
}

export function parseYaml(text) {
  const tokens = tokenizeYaml(text);
  if (tokens.length === 0) return null;
  const [value, next] = parseYamlBlock(tokens, 0, tokens[0].indentation);
  if (next !== tokens.length) throw new Error(`YAML_UNPARSED_CONTENT:${tokens[next].line}`);
  return value;
}

function isDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isValidDate(value) {
  return isDate(value);
}

function hasField(object, field) {
  return object !== null && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, field);
}

function valueMissing(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
    || (Array.isArray(value) && value.length === 0);
}

function safeRelativePath(value) {
  const text = normalizePath(value).split('#', 1)[0];
  if (!text || isAbsolute(text) || /^[A-Za-z]:/.test(text) || text.startsWith('/')) return null;
  const parts = text.split('/');
  if (parts.includes('..') || parts.includes('')) return null;
  return text;
}

function pathExists(root, value) {
  const path = safeRelativePath(value);
  if (!path) return false;
  const absolute = resolve(root, path);
  const rootPrefix = resolve(root) + sep;
  if (!absolute.startsWith(rootPrefix)) return false;
  try {
    return lstatSync(absolute).isFile();
  } catch {
    return false;
  }
}

function addRequiredFields(object, fields, path, line, findings, missingRule = 'missing-required-field') {
  for (const field of fields) {
    const missing = !hasField(object, field)
      || (!NULLABLE_REQUIRED.has(field) && valueMissing(object[field]));
    if (missing) findings.push(finding(path, line, missingRule, `${field} is required`, object?.id ?? ''));
  }
}

function addArrayPathFindings(value, root, path, line, rulePrefix, findings, id) {
  if (!Array.isArray(value) || value.length === 0) return;
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string' || !safeRelativePath(entry) || seen.has(entry)) {
      findings.push(finding(path, line, `${rulePrefix}-invalid`, 'reference must be a unique repository-relative path', id));
      continue;
    }
    seen.add(entry);
    if (!pathExists(root, entry)) findings.push(finding(path, line, `${rulePrefix === 'evidence-path' ? 'missing-evidence-path' : `missing-${rulePrefix}`}`, `referenced path is missing: ${entry}`, id));
  }
}

function validateDate(value, path, line, field, findings, id, today) {
  if (!isValidDate(value)) {
    findings.push(finding(path, line, 'invalid-date', `${field} must be an YYYY-MM-DD date`, id));
    return;
  }
  if (today && value > today) findings.push(finding(path, line, 'future-date', `${field} cannot be in the future`, id));
}

function validateExceptionReference(control, exceptionMap, path, line, findings, today) {
  if (!hasField(control, 'exception_expiry')) return;
  const expiry = control.exception_expiry;
  const exceptionId = control.exception_id ?? null;
  if (exceptionId === null || exceptionId === 'none' || exceptionId === '') {
    if (expiry !== null && expiry !== 'none') findings.push(finding(path, line, 'exception-reference-required', 'exception expiry requires an exception id', control.id));
    if (isValidDate(expiry) && expiry < today) findings.push(finding(path, line, 'expired-exception', 'control exception has expired and requires review or closure', control.id));
    return;
  }
  if (!exceptionMap.has(exceptionId)) {
    findings.push(finding(path, line, 'exception-reference-missing', 'referenced exception is not registered', control.id));
  }
  validateDate(expiry, path, line, 'exception_expiry', findings, control.id);
  if (isValidDate(expiry) && expiry < today) findings.push(finding(path, line, 'expired-exception', 'control exception has expired and requires review or closure', control.id));
  const registered = exceptionMap.get(exceptionId);
  if (registered?.expires_on && expiry !== registered.expires_on) findings.push(finding(path, line, 'exception-expiry-mismatch', 'control exception expiry differs from the register', control.id));
}

function validateControl(control, { root, exceptions, findings, today }) {
  const path = MATRIX_PATH;
  const line = 1;
  addRequiredFields(control, CONTROL_REQUIRED, path, line, findings);
  if (!hasField(control, 'owner') || valueMissing(control.owner)) findings.push(finding(path, line, 'ownerless-control', 'control owner is required', control?.id ?? ''));
  if (hasField(control, 'review_date')) validateDate(control.review_date, path, line, 'review_date', findings, control.id, today);
  if (hasField(control, 'vendor_baa_status') && !['pending', 'not_applicable', 'complete', 'accepted', 'rejected'].includes(String(control.vendor_baa_status))) findings.push(finding(path, line, 'invalid-vendor-status', 'vendor/BAA status must use the approved status vocabulary', control.id));
  if (control.vendor_baa_status === 'complete' || control.vendor_baa_status === 'accepted') {
    const evidence = control.vendor_baa_evidence ?? control.evidence_artifacts;
    if (!Array.isArray(evidence) || evidence.length === 0 || !evidence.every((entry) => pathExists(root, entry))) findings.push(finding(path, line, 'unsupported-vendor-status', 'complete vendor status requires an evidence path', control.id));
  }
  addArrayPathFindings(control.implementation_paths, root, path, line, 'implementation-path', findings, control.id);
  addArrayPathFindings(control.test_ci_references, root, path, line, 'test-reference', findings, control.id);
  addArrayPathFindings(control.evidence_artifacts, root, path, line, 'evidence-path', findings, control.id);
  validateExceptionReference(control, exceptions, path, line, findings, today);
}

function validateVendor(vendor, { root, exceptions, findings, today }) {
  const path = VENDOR_PATH;
  const line = 1;
  addRequiredFields(vendor, VENDOR_REQUIRED, path, line, findings);
  if (!hasField(vendor, 'owner') || valueMissing(vendor.owner)) findings.push(finding(path, line, 'ownerless-vendor', 'vendor owner is required', vendor?.id ?? ''));
  if (hasField(vendor, 'review_date')) validateDate(vendor.review_date, path, line, 'review_date', findings, vendor.id, today);
  if (!['pending', 'not_applicable', 'complete', 'accepted', 'rejected'].includes(String(vendor.baa_status))) findings.push(finding(path, line, 'invalid-vendor-status', 'vendor BAA status must use the approved status vocabulary', vendor.id));
  if (vendor.baa_status === 'complete' || vendor.baa_status === 'accepted') {
    if (!Array.isArray(vendor.evidence_artifacts) || vendor.evidence_artifacts.length === 0 || !vendor.evidence_artifacts.every((entry) => pathExists(root, entry))) findings.push(finding(path, line, 'unsupported-vendor-status', 'complete vendor status requires an evidence path', vendor.id));
  }
  addArrayPathFindings(vendor.evidence_artifacts, root, path, line, 'evidence-path', findings, vendor.id);
  if (vendor.exception_id && !exceptions.has(vendor.exception_id)) findings.push(finding(path, line, 'exception-reference-missing', 'referenced vendor exception is not registered', vendor.id));
  if (vendor.exception_id && exceptions.has(vendor.exception_id)) {
    const registered = exceptions.get(vendor.exception_id);
    if (vendor.exception_expiry !== registered.expires_on) findings.push(finding(path, line, 'exception-expiry-mismatch', 'vendor exception expiry differs from the register', vendor.id));
  }
  if (!vendor.exception_id && vendor.exception_expiry !== null && vendor.exception_expiry !== 'none') findings.push(finding(path, line, 'exception-reference-required', 'vendor exception expiry requires an exception id', vendor.id));
  if (vendor.exception_id && !isValidDate(vendor.exception_expiry)) findings.push(finding(path, line, 'invalid-date', 'vendor exception_expiry must be an YYYY-MM-DD date', vendor.id));
  if (isValidDate(vendor.exception_expiry) && vendor.exception_expiry < today) findings.push(finding(path, line, 'expired-exception', 'vendor exception has expired and requires review or closure', vendor.id));
}

function validateException(exception, { root, findings, today }) {
  const path = EXCEPTION_PATH;
  const line = 1;
  addRequiredFields(exception, EXCEPTION_REQUIRED, path, line, findings);
  if (!hasField(exception, 'owner') || valueMissing(exception.owner)) findings.push(finding(path, line, 'ownerless-exception', 'exception owner is required', exception?.id ?? ''));
  if (hasField(exception, 'review_date')) validateDate(exception.review_date, path, line, 'review_date', findings, exception.id, today);
  if (hasField(exception, 'expires_on')) {
    validateDate(exception.expires_on, path, line, 'expires_on', findings, exception.id);
    if (isValidDate(exception.expires_on) && exception.expires_on < today) findings.push(finding(path, line, 'expired-exception', 'exception has expired and requires review or closure', exception.id));
  }
  addArrayPathFindings(exception.evidence_artifacts, root, path, line, 'evidence-path', findings, exception.id);
  if (Array.isArray(exception.compensating_controls) && exception.compensating_controls.some((item) => valueMissing(item))) findings.push(finding(path, line, 'missing-compensating-control', 'every exception requires a compensating control', exception.id));
}

function hasEvidenceReference(text, root, sourcePath, explicitPaths = []) {
  if (explicitPaths.length > 0 && explicitPaths.every((entry) => pathExists(root, entry))) return true;
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].trim().split('#', 1)[0].split('?', 1)[0];
    if (!target || /^(?:[a-z][a-z\d+.-]*:|data:)/i.test(target)) continue;
    const absolute = resolve(root, dirname(normalizePath(sourcePath)), target);
    const candidate = normalizePath(relative(resolve(root), absolute));
    if (candidate && !candidate.startsWith('../') && pathExists(root, candidate)) return true;
  }
  return false;
}

export function scanUnsupportedClaims(path, text, { root = ROOT, evidencePaths = [] } = {}) {
  const findings = [];
  const lines = String(text ?? '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  for (const rule of CLAIM_RULES) {
    const expression = new RegExp(rule.regex.source, rule.regex.flags);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (NEGATION_PATTERN.test(line)) continue;
      expression.lastIndex = 0;
      if (!expression.test(line)) continue;
      if (hasEvidenceReference(line, root, path, evidencePaths)) continue;
      findings.push(finding(path, index + 1, 'unsupported-claim', `${rule.label} claim has no repository evidence link`, rule.id));
    }
  }
  const unique = new Map(findings.map((item) => [`${item.path}:${item.line}:${item.rule}:${item.message}`, item]));
  return [...unique.values()];
}

function sortFindings(findings) {
  return [...findings].sort((left, right) => left.path.localeCompare(right.path)
    || left.line - right.line
    || left.rule.localeCompare(right.rule)
    || (left.id ?? '').localeCompare(right.id ?? '')
    || left.message.localeCompare(right.message));
}

export function validateDocuments({ root = ROOT, today = defaultToday(), matrix, vendors, exceptions, claims = [] }) {
  const findings = [];
  const controls = matrix?.controls;
  const vendorEntries = vendors?.vendors;
  const exceptionEntries = exceptions?.exceptions;
  if (!Array.isArray(controls) || controls.length === 0) findings.push(finding(MATRIX_PATH, 1, 'missing-control-set', 'matrix must contain at least one control'));
  if (!Array.isArray(vendorEntries)) findings.push(finding(VENDOR_PATH, 1, 'missing-vendor-set', 'vendor register must contain a vendors list'));
  if (!Array.isArray(exceptionEntries)) findings.push(finding(EXCEPTION_PATH, 1, 'missing-exception-set', 'exception register must contain an exceptions list'));
  const exceptionMap = new Map();
  if (Array.isArray(exceptionEntries)) {
    for (const exception of exceptionEntries) {
      if (!exception || typeof exception !== 'object') {
        findings.push(finding(EXCEPTION_PATH, 1, 'invalid-exception', 'exception entries must be mappings'));
        continue;
      }
      validateException(exception, { root, findings, today });
      if (exception.id) {
        if (exceptionMap.has(exception.id)) findings.push(finding(EXCEPTION_PATH, 1, 'duplicate-exception-id', 'exception ids must be unique', exception.id));
        exceptionMap.set(exception.id, exception);
      }
    }
  }
  if (Array.isArray(controls)) {
    const ids = new Set();
    for (const control of controls) {
      if (!control || typeof control !== 'object') {
        findings.push(finding(MATRIX_PATH, 1, 'invalid-control', 'control entries must be mappings'));
        continue;
      }
      validateControl(control, { root, exceptions: exceptionMap, findings, today });
      if (control.id) {
        if (ids.has(control.id)) findings.push(finding(MATRIX_PATH, 1, 'duplicate-control-id', 'control ids must be unique', control.id));
        ids.add(control.id);
      }
    }
  }
  if (Array.isArray(vendorEntries)) {
    const ids = new Set();
    for (const vendor of vendorEntries) {
      if (!vendor || typeof vendor !== 'object') {
        findings.push(finding(VENDOR_PATH, 1, 'invalid-vendor', 'vendor entries must be mappings'));
        continue;
      }
      validateVendor(vendor, { root, exceptions: exceptionMap, findings, today });
      if (vendor.id) {
        if (ids.has(vendor.id)) findings.push(finding(VENDOR_PATH, 1, 'duplicate-vendor-id', 'vendor ids must be unique', vendor.id));
        ids.add(vendor.id);
      }
    }
  }
  for (const claim of claims) {
    if (!claim || typeof claim !== 'object') {
      findings.push(finding('<claim>', 1, 'invalid-claim', 'claim entries must be mappings'));
      continue;
    }
    findings.push(...scanUnsupportedClaims(claim.path ?? '<claim>', claim.text ?? '', { root, evidencePaths: claim.evidencePaths ?? [] }));
  }
  const sorted = sortFindings(findings);
  return {
    ok: sorted.length === 0,
    findings: sorted,
    summary: {
      findings: sorted.length,
      controls: Array.isArray(controls) ? controls.length : 0,
      vendors: Array.isArray(vendorEntries) ? vendorEntries.length : 0,
      exceptions: Array.isArray(exceptionEntries) ? exceptionEntries.length : 0,
    },
  };
}

function readYaml(root, path, findings) {
  try {
    return parseYaml(readFileSync(resolve(root, path), 'utf8'));
  } catch (error) {
    findings.push(finding(path, 1, 'invalid-yaml', `YAML could not be parsed: ${error.message}`));
    return null;
  }
}

function collectClaimFiles(root) {
  const paths = new Set(CLAIM_PATHS);
  for (const directory of ['docs/compliance', 'docs/security']) {
    const absolute = resolve(root, directory);
    if (!existsSync(absolute)) continue;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.isFile() && /\.(?:md|markdown)$/i.test(entry.name)) paths.add(normalizePath(`${directory}/${entry.name}`));
    }
  }
  return [...paths].sort();
}

export function validateRepository({ root = ROOT, today = defaultToday() } = {}) {
  const repositoryRoot = resolve(root);
  const findings = [];
  const matrix = readYaml(repositoryRoot, MATRIX_PATH, findings);
  const vendors = readYaml(repositoryRoot, VENDOR_PATH, findings);
  const exceptions = readYaml(repositoryRoot, EXCEPTION_PATH, findings);
  const claims = [];
  for (const path of collectClaimFiles(repositoryRoot)) {
    try {
      claims.push({ path, text: readFileSync(resolve(repositoryRoot, path), 'utf8') });
    } catch {
      findings.push(finding(path, 1, 'claim-file-unreadable', 'claim document could not be read'));
    }
  }
  if (matrix === null || vendors === null || exceptions === null) {
    return { ok: false, findings: sortFindings(findings), summary: { findings: findings.length, controls: 0, vendors: 0, exceptions: 0 } };
  }
  return validateDocuments({ root: repositoryRoot, today, matrix, vendors, exceptions, claims });
}

export function formatFinding(item) {
  const location = `${redact(item.path)}:${item.line}:${redact(item.rule)}`;
  return item.message ? `${location}: ${redact(item.message)}` : location;
}

function parseArguments(argv) {
  const options = { root: ROOT, today: defaultToday() };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root' || argument === '--today') {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === '--root') options.root = resolve(value);
      if (argument === '--today') options.today = value;
      index += 1;
    } else if (argument.startsWith('--root=')) options.root = resolve(argument.slice('--root='.length));
    else if (argument.startsWith('--today=')) options.today = argument.slice('--today='.length);
    else throw new Error(`unknown option: ${argument}`);
  }
  if (!isValidDate(options.today)) throw new Error('--today must be an YYYY-MM-DD date');
  return options;
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArguments(argv);
    const result = validateRepository(options);
    for (const item of result.findings) console.error(formatFinding(item));
    if (!result.ok) {
      process.exitCode = 1;
      return;
    }
    console.log(`compliance-evidence: pass controls=${result.summary.controls} vendors=${result.summary.vendors} exceptions=${result.summary.exceptions}`);
  } catch {
    process.stderr.write('compliance-evidence: validation failed\n');
    process.exitCode = 2;
  }
}

export { CLAIM_RULES, CONTROL_REQUIRED, EXCEPTION_PATH, EXCEPTION_REQUIRED, MATRIX_PATH, VENDOR_PATH, VENDOR_REQUIRED, defaultToday, isValidDate, redact, shortHash, sortFindings, validateVendor, validateException };

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
