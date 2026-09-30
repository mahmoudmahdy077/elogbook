import { NextResponse } from 'next/server';

/**
 * Response constructor for the setup/backup/update/uninstall control plane.
 *
 * These endpoints report host-wide state — backup inventory, restore outcomes,
 * teardown results — to a platform operator. Nothing about them may be stored
 * by a browser, an intermediary cache, or the Next.js data cache, so every
 * response (success, denial, and error alike) is emitted through here with an
 * explicit `no-store` policy. Routing them through one constructor is what
 * makes "every control-plane response is no-store" a checkable property
 * instead of a per-route convention.
 */
export const CONTROL_PLANE_CACHE_CONTROL =
  'no-store, no-cache, must-revalidate, private, max-age=0';

export function withControlPlaneHeaders<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', CONTROL_PLANE_CACHE_CONTROL);
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

export function controlPlaneJson(body: unknown, status = 200): NextResponse {
  return withControlPlaneHeaders(NextResponse.json(body, { status }));
}

export function controlPlaneError(error: string, status: number): NextResponse {
  return controlPlaneJson({ error }, status);
}
