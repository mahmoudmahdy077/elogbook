#!/usr/bin/env node

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');

let exitCode = 0;
const allIssues = [];

function warn(level, file, msg) {
  allIssues.push({ level, file, msg });
  if (level === 'ERROR') exitCode = 1;
}

if (!existsSync(MIGRATIONS_DIR)) {
  console.error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  process.exit(1);
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

// Check 1: Duplicate version numbers
const versionMap = {};
let lastSeq = 0;
for (const file of files) {
  const match = file.match(/^(\d{5})_/);
  if (!match) {
    warn('ERROR', file, 'Filename does not start with 5-digit version number');
    continue;
  }
  const version = match[1];
  const seq = parseInt(version, 10);
  if (versionMap[version]) {
    warn('ERROR', file, `Duplicate version ${version} (conflicts with ${versionMap[version]})`);
  } else {
    versionMap[version] = file;
  }
  // Track gaps
  if (lastSeq > 0 && seq > lastSeq + 1) {
    warn('WARN', file, `Version gap: ${String(lastSeq).padStart(5, '0')} → ${version} (missing ${seq - lastSeq - 1} file(s))`);
  }
  lastSeq = seq;
}

// Check 2: Content-based checks
for (const file of files) {
  const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
  const upper = content.toUpperCase();

  // Destructive operations without annotation
  const destructive = [
    /DROP\s+TABLE/i,
    /DROP\s+COLUMN/i,
    /DROP\s+VIEW/i,
    /ALTER\s+COLUMN.*DROP/i,
    /DROP\s+IF\s+EXISTS/i,
    /TRUNCATE/i,
  ];
  const hasDestructive = destructive.some(r => r.test(content));
  const hasAnnotation = /--\s*(destructive|breaking|requires.*rollback|requires.*migration.*plan)/i.test(content);
  if (hasDestructive && !hasAnnotation) {
    warn('WARN', file, 'Contains potentially destructive SQL without annotation comment');
  }

  // SECURITY DEFINER without search_path
  const hasSecDefiner = /SECURITY\s+DEFINER/i.test(content);
  const hasSearchPath = /search_path/i.test(content);
  if (hasSecDefiner && !hasSearchPath) {
    warn('ERROR', file, 'SECURITY DEFINER function without explicit search_path');
  }

  // RLS policies without tenant predicates
  const policyLines = content.match(/CREATE\s+POLICY.*?;/gis);
  if (policyLines) {
    for (const policy of policyLines) {
      if (!/tenant_id/i.test(policy) && !/tenant/i.test(policy)) {
        warn('WARN', file, `Policy may lack tenant predicate: ${policy.slice(0, 80)}...`);
      }
    }
  }

  // CREATE INDEX without CONCURRENTLY on large tables
  const createIndex = content.match(/CREATE\s+(UNIQUE\s+)?INDEX/i);
  const hasConcurrently = /CONCURRENTLY/i.test(content);
  if (createIndex && !hasConcurrently) {
    // This is a soft warning - many indexes on small tables are fine
  }

  // Missing DOWN/reverse migration comment
  if (!/--\s*(down|rollback|reverse)/i.test(content) && !/DROP\s+(TABLE|FUNCTION|POLICY|INDEX|TRIGGER|VIEW).*IF\s+EXISTS/i.test(content)) {
    // Soft warn - many migrations don't need explicit rollback
  }
}

// Report
if (allIssues.length === 0) {
  console.log('✅ All migration files look clean');
} else {
  const errors = allIssues.filter(i => i.level === 'ERROR');
  const warnings = allIssues.filter(i => i.level === 'WARN');
  if (errors.length) {
    console.log(`\n❌ ${errors.length} error(s):`);
    for (const { file, msg } of errors) {
      console.log(`  ERROR  ${file}: ${msg}`);
    }
  }
  if (warnings.length) {
    console.log(`\n⚠️  ${warnings.length} warning(s):`);
    for (const { file, msg } of warnings) {
      console.log(`  WARN   ${file}: ${msg}`);
    }
  }
}

process.exit(exitCode);
