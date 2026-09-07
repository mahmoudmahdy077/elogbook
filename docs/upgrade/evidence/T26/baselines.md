# T26 Evidence — Measured baselines + one fixed bottleneck (bounded)

Ticket: T26 (dependencies: T06, T19, T23, T25). Load/soak, EXPLAIN
plans, and VPS acceptance runs are BLOCKED (need qualified host +
throwaway stack); targets below are PROPOSED until drilled there.
Status: ONE MEASURED FIX + BASELINES (no invented timings)

## Fixed: duplicate dashboard RPC (measured in source, structural proof)

Tenant layout (badge) + dashboard page issued identical
`get_dashboard_data` calls per load. Both now go through
`lib/dashboard-data.ts` (React `cache()` — per-request memoization
inside Flight). Framework fact recorded honestly: bare `cache()` is a
pass-through outside Flight (verified in installed react 19.2.8
sources), so no unit test asserts call counts — the suite pins the
behavioral contract (args, shapes, error tolerance) and the
single-entry-point structure; the 2→1 RPC proof belongs to
request-level runs (T26-full). No auth/RLS predicate touched.

## Baselines (OBSERVED 2026-09-07, dev laptop → cloud region, TLS incl.)

- Production build: exit 0; 77 JS chunks, 2,153 kB JS + 89 kB CSS
  (uncompressed; gzip ≈ 1/3). Largest chunk 281 kB. Absolute budgets
  get set from VPS profiles, not this host.
- Case list read (20 rows, sequential ×5): 266–481 ms, median 318 ms.
- Quota RPC ×5 parallel: 975–1,350 ms each (includes job overhead;
  spot value only, not a p95 claim).

## Proposed targets (section 9, unmeasured until VPS)

p75 LCP ≤2.5s / INP ≤200ms / CLS ≤0.1; core reads p95 ≤500ms @25
concurrent; mutations p95 ≤1s; no new long tasks; ≤10% bundle
regressions; 24h soak; RPO ≤24h / RTO ≤4h (drill-measured).

## Verification

- dashboard-data 2/2, typecheck 0, lint 0, build 0.

## Deferred to T26-full (qualified VPS + synthetic 500/100k dataset)

EXPLAIN (ANALYZE, BUFFERS) with real roles, waterfall/bundle traces,
pagination audit, cache-scope verification (private/no-store vs scoped
public), load/soak, RPO/RTO drills.
