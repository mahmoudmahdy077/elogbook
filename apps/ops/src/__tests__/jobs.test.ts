import { describe, it, expect } from 'vitest';
import {
  createOperation,
  applyTransition,
  acceptIdempotent,
  createMemoryJournal,
  redactSecrets,
  type OperationType,
} from '../jobs';

// T10 (bounded): durable-job core semantics. No transport, no Docker, no
// host execution here — those stay behind the T09 review gate.
describe('operation state machine (T10)', () => {
  it('walks the happy path through every validating state', () => {
    let op = createOperation({ type: 'install', installationId: 'i1', idempotencyKey: 'k1', now: 0 });
    expect(op.status).toBe('queued');
    for (const next of [
      'validating',
      'acquiring_lock',
      'backing_up',
      'backup_verified',
      'staging',
      'maintenance',
      'migrating',
      'switching',
      'verifying',
      'succeeded',
    ] as const) {
      op = applyTransition(op, next, { now: op.updatedAt + 1, fencingToken: op.fencingToken });
    }
    expect(op.status).toBe('succeeded');
  });

  it('rejects skipped states and backward jumps', () => {
    const op = createOperation({ type: 'install', installationId: 'i1', idempotencyKey: 'k1', now: 0 });
    expect(() => applyTransition(op, 'staging', { now: 1, fencingToken: op.fencingToken })).toThrow(
      /invalid transition/,
    );
  });

  it('terminal states are immutable', () => {
    let op = createOperation({ type: 'backup', installationId: 'i1', idempotencyKey: 'k1', now: 0 });
    op = applyTransition(op, 'failed', { now: 1, fencingToken: op.fencingToken, error: 'boom' });
    expect(() => applyTransition(op, 'queued', { now: 2, fencingToken: op.fencingToken })).toThrow(
      /terminal/,
    );
  });

  it('a stale fencing token cannot advance a taken-over operation', () => {
    const op = createOperation({ type: 'backup', installationId: 'i1', idempotencyKey: 'k1', now: 0 });
    expect(() =>
      applyTransition(op, 'validating', { now: 1, fencingToken: op.fencingToken + 1 }),
    ).toThrow(/fencing/);
  });

  it('cancel is allowed before mutation and forbidden after', () => {
    const early = createOperation({ type: 'backup', installationId: 'i1', idempotencyKey: 'k1', now: 0 });
    const cancelled = applyTransition(early, 'cancelled', { now: 1, fencingToken: early.fencingToken });
    expect(cancelled.status).toBe('cancelled');

    let op = createOperation({ type: 'backup', installationId: 'i1', idempotencyKey: 'k2', now: 0 });
    for (const s of [
      'validating',
      'acquiring_lock',
      'backing_up',
      'backup_verified',
      'staging',
      'maintenance',
      'migrating',
    ] as const) {
      op = applyTransition(op, s, { now: op.updatedAt + 1, fencingToken: op.fencingToken });
    }
    expect(op.status).toBe('migrating');
    expect(() => applyTransition(op, 'cancelled', { now: 99, fencingToken: op.fencingToken })).toThrow(
      /cancel/,
    );
    expect(() => applyTransition(op, 'failed', { now: 99, fencingToken: op.fencingToken })).toThrow(
      /recovering/,
    );
  });

  it('failure after mutation routes to recovering, not failed', () => {
    let op = createOperation({ type: 'update', installationId: 'i1', idempotencyKey: 'k1', now: 0 });
    for (const s of [
      'validating',
      'acquiring_lock',
      'backing_up',
      'backup_verified',
      'staging',
      'maintenance',
      'migrating',
    ] as const) {
      op = applyTransition(op, s, { now: op.updatedAt + 1, fencingToken: op.fencingToken });
    }
    const rec = applyTransition(op, 'recovering', { now: 99, fencingToken: op.fencingToken, error: 'x' });
    expect(rec.status).toBe('recovering');
    const done = applyTransition(rec, 'recovered', { now: 100, fencingToken: rec.fencingToken });
    expect(done.status).toBe('recovered');
  });
});

describe('idempotent acceptance (T10)', () => {
  it('duplicate submission returns the same operation, never a second job', () => {
    const journal = createMemoryJournal();
    const a = acceptIdempotent(journal, {
      type: 'backup' as OperationType,
      installationId: 'i1',
      idempotencyKey: 'same-key',
      now: 0,
    });
    const b = acceptIdempotent(journal, {
      type: 'backup' as OperationType,
      installationId: 'i1',
      idempotencyKey: 'same-key',
      now: 50,
    });
    expect(b.id).toBe(a.id);
    expect(journal.list('i1')).toHaveLength(1);
  });

  it('conflicting operations are rejected while one holds the lock', () => {
    const journal = createMemoryJournal();
    acceptIdempotent(journal, {
      type: 'update' as OperationType,
      installationId: 'i1',
      idempotencyKey: 'k-update',
      now: 0,
    });
    expect(() =>
      acceptIdempotent(journal, {
        type: 'restore' as OperationType,
        installationId: 'i1',
        idempotencyKey: 'k-restore',
        now: 1,
      }),
    ).toThrow(/conflict|locked/i);
  });
});

describe('redactSecrets (T10)', () => {
  it('masks bearer tokens, passwords, and key assignments', () => {
    expect(redactSecrets('Authorization: Bearer abcdef123456')).not.toContain('abcdef123456');
    expect(redactSecrets('PGPASSWORD=hunter2 pg_dump')).not.toContain('hunter2');
    expect(redactSecrets('api_key=sk-live-12345')).not.toContain('sk-live-12345');
  });

  it('leaves ordinary log lines intact', () => {
    expect(redactSecrets('backup step 3/9 complete')).toBe('backup step 3/9 complete');
  });
});
