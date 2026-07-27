/* eslint-disable @typescript-eslint/no-require-imports */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativewind } = require('nativewind/metro');
const config = getDefaultConfig(__dirname);
module.exports = withNativewind(config);
