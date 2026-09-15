/**
 * M5 — sync mode flags.
 *
 * Qualified release sync mode is PUSH-ONLY RETRY: the durable per-account
 * outbox (`lib/durable-queue.ts`) flushed by `SyncService.initSync`.
 * There is deliberately no pull sync in the qualified path — server truth
 * is read on demand through RLS queries; the full Watermelon SyncEngine
 * (`lib/sync/engine.ts`) is TEST-ONLY unless FULL_SYNC_ENABLED is set,
 * which no production code path sets today.
 */

function readFlag(name: string, fallback: string): string {
  const raw =
    typeof process !== 'undefined'
      ? (process.env as Record<string, string | undefined>)[name]
      : undefined;
  return (raw ?? fallback).toLowerCase();
}

/** Legacy alias: the durable outbox is always the push path. Kept for compat. */
export const LOCAL_FIRST_SYNC = readFlag('LOCAL_FIRST_SYNC', 'true') !== 'false';

/** Full bidirectional engine sync. Default false; test-only boundary. */
export const FULL_SYNC_ENABLED = readFlag('FULL_SYNC_ENABLED', 'false') === 'true';
