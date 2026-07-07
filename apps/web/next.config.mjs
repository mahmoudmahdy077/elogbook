import bundleAnalyzer from '@next/bundle-analyzer';
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  compress: true,
  transpilePackages: ['@elogbook/shared'],
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60 * 60 * 24, // 24 hours
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.posthog.com",
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co https://*.posthog.com https://sentry.io",
              "frame-src 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
      // Cache static assets aggressively
      {
        source: '/:file.(jpg|jpeg|png|gif|ico|webp|avif|svg|woff|woff2|ttf|eot)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/:file.(js|css)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
      {
        source: '/sw-register.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400' },
        ],
      },
      // Preconnect via Link headers (supplemental to HTML hints)
      {
        source: '/',
        headers: [
          {
            key: 'Link',
            value: [
              '<https://fonts.googleapis.com>; rel=preconnect',
              '<https://fonts.gstatic.com>; rel=preconnect; crossorigin',
            ].join(', '),
          },
        ],
      },
    ];
  },
};

const sentryBuildOptions = {
  // Org and project slugs — set via SENTRY_ORG / SENTRY_PROJECT env vars
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Suppress Sentry build logs in CI unless debugging
  silent: process.env.SENTRY_SILENT !== 'false',
  // Suppress Sentry client-side logger output in production
  disableLogger: true,
  telemetry: false,
  // P5.4: Source map configuration
  widenClientFileUpload: true,
  sourcemaps: {
    // Upload all JS and map artifacts generated during build
    assets: ['.next/**/*.js', '.next/**/*.map'],
    // Delete source maps after upload to prevent exposing source in production
    deleteSourcemapsAfterUpload: true,
  },
  // Automatically instrument server functions, middleware, and app directory
  webpack: {
    autoInstrumentServerFunctions: true,
    autoInstrumentMiddleware: true,
    autoInstrumentAppDirectory: true,
  },
};

const baseExport = withBundleAnalyzer(withNextIntl(nextConfig));

// Only apply Sentry config when a DSN is configured (opt-in per environment)
export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(baseExport, sentryBuildOptions)
  : baseExport;
