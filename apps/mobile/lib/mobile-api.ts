/**
 * Thin client for the web's bearer-authenticated mobile API.
 *
 * The Expo app talks to Supabase directly for reads and the durable queue, but
 * case submission must go through the server path so it matches the web:
 * `submit_case` RPC, supervisor approval rows, `case.submitted` webhook and
 * the pending-approval push. If the web host is unreachable but Supabase is
 * not, we fall back to the RPC alone (case is submitted; the webhook/push are
 * skipped) instead of losing the resident's work.
 */

import Constants from 'expo-constants';
import { supabase } from './supabase';
import { logWarn } from './logger';

const FALLBACK_API = 'https://elogbook-web.vercel.app';

export function mobileApiBase(): string {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const configured =
    (typeof extra?.apiUrl === 'string' && extra.apiUrl) ||
    process.env.EXPO_PUBLIC_API_URL ||
    FALLBACK_API;
  return configured.replace(/\/+$/, '');
}

export type SubmitSavedResult =
  | { ok: true; autoApproved: boolean; usedFallback: boolean }
  | { ok: false; error: string };

export async function submitSavedCase(entryId: string): Promise<SubmitSavedResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    return { ok: false, error: 'Your session expired. Sign in and retry.' };
  }

  const url = `${mobileApiBase()}/api/mobile/v1/cases/${entryId}/submit`;
  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Web host unreachable: submit through the database RPC directly.
    logWarn('mobile-api.submit-fallback');
    const { error } = await supabase.rpc('submit_case', { p_entry_id: entryId });
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true, autoApproved: false, usedFallback: true };
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (!response.ok) {
    const message =
      typeof body.error === 'string' && body.error
        ? body.error
        : 'The server refused this submission.';
    return { ok: false, error: message };
  }

  return { ok: true, autoApproved: body.auto_approved === true, usedFallback: false };
}
