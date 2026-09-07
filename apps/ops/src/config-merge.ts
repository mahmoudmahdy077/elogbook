/**
 * Three-way merge for KEY=VALUE config (T11 provisioning, T15 updates).
 *
 * base = last-applied upstream file; upstream = new bundle file;
 * operator = live file with owner overrides. Rules:
 * - Only upstream changed a key -> take upstream.
 * - Only operator changed a key -> keep operator.
 * - Both changed differently -> CONFLICT (keep operator value, emit a
 *   marker comment; the executor must block automatic application).
 * - Upstream deleted a key the operator edited -> CONFLICT (deletion
 *   could drop an intentional override).
 * - Upstream deleted an untouched key -> drop it.
 * Comments/blank lines from the operator file are preserved; upstream-only
 * comments are not tracked (values are the contract, not comments).
 */

export interface MergeConflict {
  key: string;
  base: string | null;
  upstream: string | null;
  operator: string | null;
}

export interface MergeResult {
  merged: string;
  conflicts: MergeConflict[];
}

function parseEnv(text: string): { order: string[]; values: Map<string, string>; comments: string[] } {
  const order: string[] = [];
  const values = new Map<string, string>();
  const comments: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      comments.push(rawLine);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!order.includes(key)) order.push(key);
    values.set(key, value);
  }
  return { order, values, comments };
}

export function mergeEnvConfig(args: { base: string; upstream: string; operator: string }): MergeResult {
  const b = parseEnv(args.base);
  const u = parseEnv(args.upstream);
  const o = parseEnv(args.operator);
  const conflicts: MergeConflict[] = [];
  const out = new Map<string, string>();
  const conflictKeys = new Set<string>();

  const keys = new Set([...b.order, ...u.order, ...o.order]);
  for (const key of keys) {
    const bv = b.values.has(key) ? b.values.get(key)! : null;
    const uv = u.values.has(key) ? u.values.get(key)! : null;
    const ov = o.values.has(key) ? o.values.get(key)! : null;
    const upstreamChanged = uv !== bv;
    const operatorChanged = ov !== bv;

    if (!upstreamChanged && !operatorChanged) {
      if (ov !== null) out.set(key, ov);
      continue;
    }
    if (upstreamChanged && !operatorChanged) {
      if (uv !== null) out.set(key, uv);
      // Upstream deletion of an untouched key: drop.
      continue;
    }
    if (!upstreamChanged && operatorChanged) {
      if (ov !== null) out.set(key, ov);
      continue;
    }
    // Both changed (including upstream-delete vs operator-edit).
    conflicts.push({ key, base: bv, upstream: uv, operator: ov });
    conflictKeys.add(key);
    if (ov !== null) out.set(key, ov);
  }

  const lines = [...o.comments];
  for (const [key, value] of out) {
    if (conflictKeys.has(key)) lines.push(`# CONFLICT(${key}): operator value kept; resolve before applying`);
    lines.push(`${key}=${value}`);
  }
  return { merged: lines.join('\n') + '\n', conflicts };
}
