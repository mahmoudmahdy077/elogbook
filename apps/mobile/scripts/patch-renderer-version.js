#!/usr/bin/env node
/**
 * Post-install script to patch React Native's renderer
 * version check. Replaces the version-mismatch throw with a
 * no-op so the app loads regardless of which React version
 * is actually installed.
 */
const fs = require('fs');
const path = require('path');
const cwd = process.cwd();

const rendererDir = path.join(cwd, 'node_modules', 'react-native', 'Libraries', 'Renderer', 'implementations');

if (!fs.existsSync(rendererDir)) {
  console.warn('[patch-renderer] React Native renderer not found, skipping.');
  process.exit(0);
}

const rendererFiles = fs.readdirSync(rendererDir).filter(f => f.startsWith('ReactNativeRenderer') && f.endsWith('.js'));
if (rendererFiles.length === 0) {
  console.warn('[patch-renderer] No ReactNativeRenderer files found.');
  process.exit(0);
}

const reactPkg = path.join(cwd, 'node_modules', 'react', 'package.json');
const reactVersion = JSON.parse(fs.readFileSync(reactPkg, 'utf8')).version;
console.log(`[patch-renderer] Patching renderer to accept React v${reactVersion}...`);

let patched = 0;
for (const file of rendererFiles) {
  const filePath = path.join(rendererDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes('PATCH_RENDERER_DISABLED')) {
    console.log(`  ${file}: already patched ✓`);
    continue;
  }

  // Match: if ("X.Y.Z" !== isomorphicReactPackageVersion)
  const regex = /if\s*\(\s*"(\d+\.\d+\.\d+)"\s*!==\s*(\w+)\s*\)/;
  const match = content.match(regex);

  if (match) {
    const hardcodedVersion = match[1];
    const fullMatch = match[0];

    // Replace the condition with `if (false)` so the version check
    // never throws. This effectively disables the version mismatch check.
    const replacement = `if (false/*PATCH_RENDERER_DISABLED*/)`;
    content = content.replace(fullMatch, replacement);

    fs.writeFileSync(filePath, content, 'utf8');
    patched++;
    console.log(`  ${file}: patched ✓ (was ${hardcodedVersion}, installed ${reactVersion})`);
  } else {
    // Try the already-patched-from-old-versions pattern
    // The previous script version used: "dummy" /* patched: 19.2.3 */
    const legacyRegex = /if\s*\(\s*"(\d+\.\d+\.\d+)"\s*!==\s*"dummy"\s*\/\*\s*patched:/;
    const legacyMatch = content.match(legacyRegex);
    if (legacyMatch) {
      content = content.replace(legacyMatch[0], `if (false/*PATCH_RENDERER_DISABLED*/)`);
      fs.writeFileSync(filePath, content, 'utf8');
      patched++;
      console.log(`  ${file}: re-patched from legacy format ✓`);
    } else {
      console.log(`  ${file}: no version check found, skipping`);
    }
  }
}

if (patched > 0) {
  console.log(`[patch-renderer] ✅ ${patched} file(s) patched.`);
} else {
  console.log(`[patch-renderer] ⚠️ No files needed patching.`);
}
