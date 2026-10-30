#!/usr/bin/env node
// Detect dead exports in packages/shared: export names never referenced
// outside shared/src (nor inside it outside their own decl/export site).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/root/elogbook';
const SHARED = path.join(ROOT, 'packages/shared');

function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some(x => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

// 1. Only these files are entry points / barrels. Other files inside shared/src can
// be REEXPORTED via wildcards (export * from) — so first, which src files are actually
// reachable as imports?
const srcFiles = walk(path.join(SHARED, 'src'), ['.ts', '.tsx']);
const barrels = ['index.ts', 'browser.ts', 'native.ts'].map(f => path.join(SHARED, 'src', f));

// Which files inside shared/src IMPORT another shared/src file?
const importsOf = new Map(); // file -> set of imported paths (absolute)
for (const f of [...barrels, ...srcFiles]) {
  let text = '';
  try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const set = new Set();
  for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    let spec = m[1];
    let abs = null;
    if (spec.startsWith('.')) abs = path.resolve(path.dirname(f), spec);
    else if (spec.startsWith('@elogbook/shared/')) abs = path.join(SHARED, 'src', spec.replace('@elogbook/shared/', ''));
    if (abs) {
      // resolve extension-less
      const cands = [abs, abs + '.ts', abs + '.tsx', abs + '.native.tsx', abs + '.web.tsx', path.join(abs, 'index.ts')];
      for (const c of cands) if (fs.existsSync(c) && !fs.statSync(c).isDirectory()) set.add(c);
    }
  }
  if (set.size) importsOf.set(f, set);
}

// BFS from entry files (barrels) to find reachable files
const visited = new Set(barrels);
const queue = [...barrels];
while (queue.length) {
  const f = queue.pop();
  const deps = importsOf.get(f);
  if (!deps) continue;
  for (const d of deps) if (!visited.has(d)) { visited.add(d); queue.push(d); }
}
const orphanFiles = srcFiles.filter(f => !visited.has(f));

// 2. Collect exported names per reachable file (names, not types of export)
const EXPORT_RE = /export\s+(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z0-9_]+)/g;
const EXPORT_LIST_RE = /export\s*{([^}]*)}/g;
const STAR_RE = /export\s+(?:type\s+)?\*\s+from\s+['"]([^'"]+)['"]/g;

const exported = new Map(); // file -> { names: Set, hasStar: [spec] }
for (const f of srcFiles) {
  let text = ''; try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (!visited.has(f) && !importsOf.get(f)?.size) { /* still scan, keep info */ }
  const names = new Set();
  for (const m of text.matchAll(EXPORT_RE)) names.add(m[1]);
  for (const m of text.matchAll(EXPORT_LIST_RE)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
      if (n && n !== 'default') names.add(n);
    }
  }
  const stars = [...text.matchAll(STAR_RE)].map(m => m[1]);
  exported.set(f, { names, stars, hasDefault: /export\s+default/.test(text) });
}

// Spread: reachable files reached via wildcard should map their names to nearest
// reexporting file. Simpler approach: compute usage globally.
// 3. Consumer corpus: apps, packages other than shared, plus shared itself.
function readSafe(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

const consumerFiles = [];
for (const top of ['apps/web', 'apps/mobile', 'packages', 'supabase', 'e2e', 'tests']) {
  const base = path.join(ROOT, top);
  if (!fs.existsSync(base)) continue;
  const files = walk(base, ['.ts', '.tsx'], []);
  for (const f of files) {
    if (f.includes('/node_modules/')) continue;
    if (!f.startsWith(path.join(SHARED, 'src/test'))) consumerFiles.push(f);
  }
}
// shared itself: everything except node_modules
const sharedAll = walk(SHARED, ['.ts', '.tsx', '.js', '.cjs'], []).filter(f => !f.includes('/node_modules/'));
// shared's own non-source callers (tests, configs)

const consumerText = new Map();
for (const f of [...new Set([...consumerFiles, ...sharedAll])]) consumerText.set(f, readSafe(f));

// files fully outside shared/src = unambiguous consumers
const outside = [...consumerText.entries()].filter(([f]) => !f.startsWith(path.join(SHARED, 'src')));

// 4. For each exported name in reachable files, check usage in outside files.
const dead = [], used = {}, testOnly = [];
const filesByReach = new Map();
for (const f of srcFiles) filesByReach.set(f, visited.has(f));

for (const [f, { names }] of exported) {
  const reachable = filesByReach.get(f);
  for (const n of names) {
    if (used[n]) { used[n].files.push(path.relative(ROOT, f)); continue; }
    const word = new RegExp(`\\b${n}\\b`);
    const hits = [];
    for (const g of outside) if (g[1].match(word)) hits.push(g[0]);
    // consider reachable: a file reachable only via another file's named import of unrelated
    // names is still an orphan file — mark files with zero named usage
    used[n] = { onlySelf: hits.length === 0 ? !reachable : false, files: [f], hits };
  }
}

// 5. Report: orphan files (not importable from barrels) — these ARE the dead mass unless
// they are imported directly from apps via subpath exports.
// Check direct imports from outside into shared/src subpaths other than the barrels.
const subpathImports = new Set();
for (const [f, text] of outside) {
  for (const m of text.matchAll(/(?:from|import)\s+['"](@elogbook\/shared\/[a-zA-Z0-9/._-]+)['"]/g)) {
    subpathImports.add(m[1]);
  }
}
console.log('SUBPATH IMPORTS USED BY APPS:', [...subpathImports].join(', ') || '(none)');

// For each outside-level consumer file, compute which shared src files it reaches;
// then a file is live if some outside consumer reaches it (directly or via barrel).
// Build import graph over shared/src (all specifier kinds incl 'shared/components/...').
console.log('--- REACHABLE FILES (from barrels):', visited.size, 'of', srcFiles.length);
console.log('--- ORPHAN FILES:');
for (const f of orphanFiles) console.log('  ', path.relative(ROOT, f));

// 6. Dead names inside reachable files (exported but unused outside and unused within shared/src logic itself)
console.log('--- EXPORTED NAMES UNUSED OUTSIDE SHARED:');
const nameUnused = [];
for (const [f, { names }] of exported) {
  for (const n of names) {
    const { hits } = used[n];
    if (hits.length) continue;
    // check usage within shared/src excluding the declaring file
    let internal = false;
    for (const [g, text] of consumerText) {
      if (g.startsWith(path.join(SHARED, 'src')) && g !== f && new RegExp(`\\b${n}\\b`).test(text)) { internal = true; break; }
    }
    if (internal) continue;
    nameUnused.push(`${path.relative(ROOT, f)} :: ${n}`);
  }
}
console.log(nameUnused.length ? nameUnused.join('\n') : '(none)');
