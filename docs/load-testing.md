# Load Testing — E-Logbook Enterprise

## Prerequisites

```bash
# macOS
brew install k6

# Linux (deb/rpm)
sudo apt install k6
# or download from https://k6.io/docs/get-started/installation/

# Verify
k6 version
```

## Quick Start

```bash
# Smoke test (5 concurrent users, 30s)
k6 run tests/load/smoke-test.js --scenario smoke

# Load test (ramp to 200 users, 3 min total)
k6 run tests/load/smoke-test.js --scenario load

# Full suite (smoke → load → stress, ~8 min)
k6 run tests/load/smoke-test.js
```

## Against a Target

```bash
# Local dev server
k6 run tests/load/smoke-test.js -e K6_BASE_URL=http://localhost:3000

# Production
k6 run tests/load/smoke-test.js -e K6_BASE_URL=https://elogbook.vercel.app -e K6_TOKEN=<token>
```

## Scenarios

| Scenario | VUs | Duration | Purpose |
|----------|-----|----------|---------|
| Smoke | 5 | 30s | Quick sanity, single endpoint |
| Load | 0→200→0 | 4m (1m ramp + 2m steady + 1m ramp down) | Sustained traffic |
| Stress | 0→1000→0 | 6m (2m ramp + 3m steady + 1m ramp down) | Breaking point |

## Endpoints Tested

| Endpoint | Method | Auth | Weight |
|----------|--------|------|--------|
| `/api/health` | GET | No | 1 req/s |
| `/api/[tenant]/dashboard` | GET | Yes | 1 req/2s |
| `/api/[tenant]/cases` | GET | Yes | 1 req/2s |
| `/api/[tenant]/approvals/action` | POST | Yes | 1 req/3s |

## Thresholds (Fail Criteria)

| Metric | Threshold |
|--------|-----------|
| P95 response time | < 500ms |
| P99 response time | < 2000ms |
| Error rate | < 1% |

## Interpreting Results

```
✓ health status 200 — endpoint returned 200
✓ dashboard status 200 — dashboard loaded
✗ cases status 200 — if cases endpoint fails under load

checks.........................: 95.45% ✓ 4200  ✗ 200
data_received..................: 12 MB  2.4 MB/s
data_sent......................: 4 MB   800 kB/s
http_req_blocked...............: avg=1.2ms   min=0µs     med=0µs    max=450ms
http_req_connecting............: avg=0.8ms   min=0µs     med=0µs    max=320ms
http_req_duration..............: avg=245ms   min=12ms    med=180ms  max={p(95):450ms, p(99):1200ms}
http_reqs......................: 5000     1000/s
vus............................: 200      min=200 max=200
```

Key metrics:
- `http_req_duration avg/med/max` — response times
- `http_reqs` — throughput
- `checks` — pass/fail ratio
- `vus` — concurrency level

## Performance Budget

| Metric | Budget | Action if exceeded |
|--------|--------|--------------------|
| P95 response time | < 500ms | Optimize slow queries, add indexes |
| Error rate | < 1% | Fix failing endpoints, increase resources |
| Throughput | > 500 req/s | Add connection pooling, scale horizontally |
| Memory leak | < 5% over 5 min | Profile heap, fix retained objects |

## CI Integration

The load test can be run in CI via:
```yaml
- name: Load test
  run: |
    k6 run tests/load/smoke-test.js \
      -e K6_BASE_URL=${{ env.PREVIEW_URL }} \
      --threshold "http_req_duration:p(95)<500"
  continue-on-error: true
```

Add to `ci.yml` as a non-blocking step for preview deployments.

## Notes

- k6 does not run in-browser — it tests HTTP APIs only, not JavaScript rendering
- For full page load testing, use Playwright (see `e2e/` directory)
- Rate limiting and CSRF may cause 429/403 responses under load — these are expected
