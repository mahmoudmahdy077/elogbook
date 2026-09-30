/**
 * Shared response headers for user-triggered exports.
 *
 * A CSV/XML/PDF export is a disclosure of tenant data. It must never be stored
 * by a CDN, a service worker or the browser cache, and the disclosure itself has
 * to be recorded before the bytes leave the process.
 */
export const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
} as const;
