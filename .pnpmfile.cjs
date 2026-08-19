function readPackage(pkg, context) {
  if (pkg.name === 'next' || pkg.name.startsWith('@sentry/')) {
    if (pkg.dependencies && pkg.dependencies.postcss) {
      pkg.dependencies.postcss = '8.5.24'
      context.log('override postcss to 8.5.24 in ' + pkg.name)
    }
    if (pkg.optionalDependencies && pkg.optionalDependencies.sharp) {
      pkg.optionalDependencies.sharp = '0.35.3'
      context.log('override sharp to 0.35.3 in ' + pkg.name)
    }
  }
  if (pkg.name === 'minimizer-webpack-plugin') {
    if (pkg.dependencies && pkg.dependencies.postcss) {
      pkg.dependencies.postcss = '8.5.24'
      context.log('override postcss to 8.5.24 in minimizer-webpack-plugin')
    }
  }
  if (pkg.name === 'minimatch' && pkg.version && /^3\./.test(pkg.version)) {
    pkg.dependencies = pkg.dependencies || {}
    if (pkg.dependencies['brace-expansion']) {
      pkg.dependencies['brace-expansion'] = 'file:./patches/brace-expansion-patched'
      context.log('override brace-expansion to patched local version in minimatch@' + pkg.version)
    }
  }

  // ── Security patches (audit: pnpm audit --audit-level=high) ────────────
  // Each rule pins a transitive dependency to its patched version. The
  // package.json `overrides` field is ignored in this repo (pnpm 9.15
  // + pnpmfile interplay), so pins live here via readPackage — the
  // established pattern for postcss/sharp/brace-expansion above.

  // fast-uri (ajv chain, webpack) — GHSA-7p8r-x3mc-p8w7
  if (pkg.dependencies && pkg.dependencies['fast-uri'] && /^(\^|~)?3\./.test(pkg.dependencies['fast-uri'])) {
    pkg.dependencies['fast-uri'] = '3.1.5'
    context.log('override fast-uri to 3.1.5 in ' + pkg.name)
  }

  // brace-expansion v5 (minimatch 10 / glob 13) — GHSA-rgw5-rvv9-x895
  if (pkg.name === 'minimatch' && pkg.version && /^10\./.test(pkg.version)) {
    pkg.dependencies = pkg.dependencies || {}
    if (pkg.dependencies['brace-expansion']) {
      pkg.dependencies['brace-expansion'] = '5.0.9'
      context.log('override brace-expansion to 5.0.9 in ' + pkg.name)
    }
  }

  // js-yaml v3 (cosmiconfig) and v4 (@expo/xcpretty) — GHSA-5p4m-2wfm-xmqj
  if (pkg.dependencies && pkg.dependencies['js-yaml']) {
    if (/^(\^|~)?3\./.test(pkg.dependencies['js-yaml'])) {
      pkg.dependencies['js-yaml'] = '3.15.1'
      context.log('override js-yaml to 3.15.1 in ' + pkg.name)
    } else if (/^(\^|~)?4\./.test(pkg.dependencies['js-yaml'])) {
      pkg.dependencies['js-yaml'] = '4.3.1'
      context.log('override js-yaml to 4.3.1 in ' + pkg.name)
    }
  }

  // nanoid v3 (expo-router) — GHSA-28wg-ghj8-5hjv / GHSA-2v37-7h3g-55p8
  if (pkg.dependencies && pkg.dependencies['nanoid'] && /^(\^|~)?3\./.test(pkg.dependencies['nanoid'])) {
    pkg.dependencies['nanoid'] = '3.3.18'
    context.log('override nanoid to 3.3.18 in ' + pkg.name)
  }

  // undici (@sentry/cli ^6, others ^7) — GHSA-8xcm-r25x-g524 / GHSA-1130718
  if (pkg.dependencies && pkg.dependencies['undici']) {
    if (/^(\^|~)?6\./.test(pkg.dependencies['undici'])) {
      pkg.dependencies['undici'] = '6.28.0'
      context.log('override undici to 6.28.0 in ' + pkg.name)
    } else if (/^(\^|~)?7\./.test(pkg.dependencies['undici'])) {
      pkg.dependencies['undici'] = '7.29.0'
      context.log('override undici to 7.29.0 in ' + pkg.name)
    }
  }

  // dompurify (posthog-js) — GHSA-55q2-fjhq-7xh7
  if (pkg.dependencies && pkg.dependencies['dompurify'] && /^(\^|~)?3\./.test(pkg.dependencies['dompurify'])) {
    pkg.dependencies['dompurify'] = '3.4.13'
    context.log('override dompurify to 3.4.13 in ' + pkg.name)
  }

  // @babel/runtime v7 (watermelondb) — GHSA-968p-4wvh-cqc8
  if (pkg.dependencies && pkg.dependencies['@babel/runtime'] && /^(\^|~)?7\./.test(pkg.dependencies['@babel/runtime'])) {
    pkg.dependencies['@babel/runtime'] = '7.26.10'
    context.log('override @babel/runtime to 7.26.10 in ' + pkg.name)
  }

  return pkg
}

module.exports = { hooks: { readPackage } }
