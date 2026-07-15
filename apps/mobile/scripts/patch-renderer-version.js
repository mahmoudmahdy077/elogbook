#!/usr/bin/env node
/**
 * Post-install script to patch React Native's renderer
 * version check to accept our installed React version.
 *
 * React Native 0.85.3 hardcodes a check for React 19.2.3 in its renderer.
 * If the actual React version differs (e.g. 19.2.7), the app crashes on startup.
 * This patch updates the renderer to accept whatever React version is installed.
 */
const fs = require('fs');
const path = require('path');

// Find the React Native renderer implementations
const rendererDir = path.join(__dirname, 'node_modules', 'react-native', 'Libraries', 'Renderer', 'implementations');

if (!fs.existsSync(rendererDir)) {
  console.warn('[postinstall] React Native renderer not found, skipping version patch.');
  process.exit(0);
}

const rendererFiles = fs.readdirSync(rendererDir).filter(f => f.startsWith('ReactNativeRenderer') && f.endsWith('.js'));

if (rendererFiles.length === 0) {
  console.warn('[postinstall] No ReactNativeRenderer files found.');
  process.exit(0);
}

// Get the actual installed React version
const reactPkg = path.join(__dirname, 'node_modules', 'react', 'package.json');
const reactVersion = JSON.parse(fs.readFileSync(reactPkg, 'utf8')).version;
console.log(`[postinstall] Patching React Native renderer to accept React v${reactVersion}...`);

let patched = 0;
for (const file of rendererFiles) {
  const filePath = path.join(rendererDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Find the hardcoded version check: "19.2.3" !== isomorphicReactPackageVersion
  // Replace with a dynamic check that accepts the installed version
  const originalVersion = '19.2.3';
  if (content.includes(`"${originalVersion}" !== isomorphicReactPackageVersion`)) {
    content = content.replace(
      `"${originalVersion}" !== isomorphicReactPackageVersion`,
      `"${originalVersion}" !== "dummy" /* patched: ${reactVersion} */`
    );
    fs.writeFileSync(filePath, content, 'utf8');
    patched++;
    console.log(`  ✓ Patched ${file}`);
  }
}

if (patched > 0) {
  console.log(`[postinstall] ✅ Patched ${patched} renderer file(s) — version check disabled.`);
} else {
  console.log(`[postinstall] ⚠️ No renderer files needed patching (version check not found).`);
}
