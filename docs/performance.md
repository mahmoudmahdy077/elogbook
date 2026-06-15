# Performance Validation

## SC-012: Institution Dashboard Render Time (<3s for 500 residents)

1. Ensure Supabase is running locally:
   ```bash
   supabase start
   ```
2. Replace `:tenant_id` in `scripts/seed-500-residents.sql` with a real tenant UUID.
3. Run the seed script via the Supabase SQL Editor or psql.
4. Start the web dev server:
   ```bash
   pnpm dev:web
   ```
5. Open `http://localhost:3000/{tenant}/reports` and `http://localhost:3000/{tenant}/admin/overview`.
6. Check the browser console / network tab for `measurePageLoad` beacon timings.
7. If either page exceeds 3 seconds, optimize the underlying Supabase queries (add indexes, reduce joins, paginate) and repeat.

## SC-014: API Concurrency (5K users, 10K burst, p95 <500ms)

1. Install k6: https://k6.io/docs/get-started/installation/
2. Obtain a valid resident auth token.
3. Run:
   ```bash
   K6_HOST=http://localhost:3000 K6_TOKEN=<token> K6_TENANT=<tenant> k6 run scripts/load-test.js
   ```
4. Review the summary output. If p95 exceeds 500ms, document bottlenecks and add caching, connection pooling, or rate-limiting tasks.
