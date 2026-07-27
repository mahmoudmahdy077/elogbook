# SLO Framework (P3.3)

## Initial Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Web availability | 99.9% uptime (monthly) | Vercel status + health endpoint |
| Authenticated page P95 | < 2 seconds | Vercel analytics + browser Web Vitals |
| Write P95 (case submit) | < 1 second | Server timing header |
| Export completion (CSV < 1K rows) | < 5 seconds | Server timing + Vercel logs |
| Export completion (PDF < 100 cases) | < 10 seconds | Edge Function timing |
| Sync success rate | > 99% | Mobile telemetry |
| Mobile crash-free session rate | > 99.5% | Sentry |
| Background queue age (webhooks) | < 5 minutes | Queue monitoring |

## Error Budgets

- Monthly error budget: 0.1% = 43 minutes downtime
- P95 latency budget: 10% of requests may exceed target
- Alerts at 70% budget consumption (30 minutes/month remaining)

## Instrumentation

- Request ID, actor/tenant (pseudonymous), route, status, duration
- Database query count and duration
- Edge Function invocation and duration
- No PHI in any metric or trace
