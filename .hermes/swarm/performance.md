# Performance Audit — elogbook

**Date:** 2026-08-25 · **Role:** resident@demo.com · **Tenant:** `9cd50d60-febe-4adf-be0f-a36bf82762f6`
**Method:** Node 22 fetch() full-roundtrip timing from local dev machine (incl. network RTT ≈90–110 ms floor). DB benchmarks n=5 (auth & borderline items re-confirmed with a second n=5/n=3 set; combined stats below). Prod TTFB = time until response headers (`fetch()` resolve), redirect-manual. Logins paced ≥3 s. Raw data: `perf_results*.json` alongside this file.

## Verdict summary: 9 PASS / 4 FAIL (all 4 failures are cold-start/p95 tails; every median passes its budget)

## Database / API (resident session)

| # | Endpoint | Budget | n | p50 | p95 (nearest-rank) | Verdict |
|---|----------|--------|---|-----|--------------------|---------|
| 1 | auth login (`POST /auth/v1/token`) | <500 ms | 10 | 224 ms | **1024 ms** | **FAIL (cold-start)** — first call after idle ~1.0 s both rounds; steady-state p50 221 / p95 253 PASS |
| 2 | rpc `get_dashboard_data(tenant, resident, 'resident')` | <800 ms | 5 | 137 ms | 199 ms | PASS |
| 3 | `case_entries` list limit 20 | <250 ms | 5 | 108 ms | 116 ms | PASS |
| 4 | `case_templates` search (`name=ilike.*a*`, limit 10) | <200 ms | 10 | 139 ms | **388 ms** | **FAIL (p95)** — 101–388 ms spread, jittery tail |
| 5 | rpc `hash_patient_mrn` | <150 ms | 5 | 109 ms | 122 ms | PASS |
| 6 | rpc `check_case_quota` | <150 ms | 5 | 109 ms | 127 ms | PASS |
| 7 | evaluations list (`faculty_evaluations`, limit 20)* | <250 ms | 10 | 142 ms | **311 ms** | **FAIL (p95, marginal)** — median comfortable, tail 274–311 ms |
| 8 | notifications list (user-scoped, limit 20) | <250 ms | 5 | 124 ms | 128 ms | PASS |
| 9 | rpc `sync_push_batch` 10-row batch | <400 ms | 5 | 120 ms | 142 ms | PASS |

\* No `evaluations` table exists in prod schema (PostgREST 404); the app lists `faculty_evaluations` (apps\web\app\(authenticated)\[tenant]\resident\evaluations\page.tsx:15) — measured that. `notifications` has `read_at`, not `is_read`.

**sync_push_batch caveat:** timed as update-path batches ({id, tenant_id, field_values}) because the tenant sits at free-plan quota (14/20 used at test start): a 10-row *insert* batch fails atomically with `P0001: Free plan limit reached (20)` — see Finding F6.

## Production web (elogbook-web.vercel.app)

| Page | Budget | n | p50 | p95 | Verdict |
|------|--------|---|-----|-----|---------|
| `/login` | <800 ms | 6 | 281 ms | **2267 ms** | **FAIL (cold-start)** — cold TTFB 2082/2267 ms; one warm-ish run 813 ms also over budget |
| `/pricing` | <800 ms | 6 | 571 ms | **857 ms** | **FAIL (p95, marginal)** — slowest page; 2/6 runs >800 ms (828, 857) |
| `/` | <800 ms | 3 | 223 ms | 230 ms | PASS |

## Edge functions (POST, empty body)

| Function | Budget | Latency | Status | Verdict |
|----------|--------|---------|--------|---------|
| payment-webhook | <3000 ms | 353 ms | 400 | PASS (fast, correctly rejects bad payload) |
| create-checkout | <3000 ms | 422 ms | 401 | PASS (rejects anon caller) |
| list-invoices | <3000 ms | 223 ms | 405 | PASS (method guard) |
| ai-quality | <3000 ms | 262 ms | 401 | PASS (rejects anon caller) |

All four respond well under budget with >=400 statuses (acceptable per brief) — no hangs, no 5xx, no timeouts.

## Findings

| ID | Sev | Finding |
|----|-----|---------|
| F1 | **P2** | Supabase GoTrue cold start: first password-grant after idle costs ~1.0–1.3 s vs 500 ms budget (reproduced in both rounds). Steady state 206–253 ms. Consider keeping auth instance warm or accept ~1 s first-login. |
| F2 | **P2** | `/login` page cold TTFB ~2.1–2.3 s vs 800 ms budget (serverless cold start on the pre-auth entry page — worst placement; every new visitor hits it). |
| F3 | P3 | `case_templates` ILIKE search tail 254–388 ms vs 200 ms budget; unanchored `ILIKE %…%` likely seq-scanning without trigram index. |
| F4 | P3 | `faculty_evaluations` list p95 ~311 ms vs 250 ms budget; marginal, high jitter (92–311 ms). |
| F5 | P3 | `/pricing` TTFB 437–857 ms; median passes but it is the slowest route and breaches at p95. |
| F6 | P3 | Product/sync bug adjacent to perf: `sync_push_batch` is atomic, so when a free-plan tenant nears the 20-case cap, an offline catch-up push containing more inserts than remaining headroom fails entirely (`Free plan limit reached`), not just the overflowing rows. Mobile users near cap cannot sync any batch >headroom. |

## Hygiene

- Repo files untouched; all artifacts confined to `.hermes/swarm/`.
- Rows created: 10 `case_entries` (patient_mrn `PERF-AUDIT-TOMBSTONE`). All 10 tombstoned via `sync_push_batch` soft-delete; verified `deleted_at IS NOT NULL` semantics via quota count drop (20→13) and zero undeleted matches visible to the role. No demo data modified; logins create no rows.
