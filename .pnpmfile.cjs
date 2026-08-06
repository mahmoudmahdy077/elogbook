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
  return pkg
}

module.exports = { hooks: { readPackage } }
