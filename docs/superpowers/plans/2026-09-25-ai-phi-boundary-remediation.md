# AI PHI Boundary Remediation Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in the current dirty worktree. Do not commit, reset, revert, or stash.

**Goal:** Make every AI prompt, response, log, and cache entry pass a server-controlled structured PHI boundary.

**Architecture:** `ai-guard.ts` owns the canonical normalized field contract, DLP scan, request validation, and output validation. `ai-insights` accepts only server-built structured clinical context, rejects streaming requests before provider egress, buffers and validates complete model output, and sanitizes all persistence. `ai-quality` applies the same output DLP before logging/returning. The shared Zod schema and SQL trigger mirror the TS key normalization and allowed value classes.

**Tech Stack:** TypeScript, Deno Edge Functions, Supabase client/Postgres, Zod 4, Vitest, Node test runner, pnpm.

---

### Task 1: Add failing regression tests before production edits

**Files:**
- Modify: `apps/web/lib/__tests__/ai-guard.test.ts`
- Modify: `packages/shared/src/schemas/__tests__/ai-boundaries.test.ts`
- Modify: `supabase/functions/ai-insights/index.test.ts`
- Modify: `apps/web/lib/__tests__/ai-quality-boundary.test.ts`

- [ ] Add guard tests proving a structured `age_group` value is accepted, unknown keys are rejected, free-text narrative values are rejected, and `is_deidentified: true` does not bypass validation.
- [ ] Add DLP cases for names, email, phone, street address, formatted MRN, SSN, and accepted `age_group`.
- [ ] Add a model-output regression case that echoes PHI and a split-token stream case where the identifier crosses two provider chunks.
- [ ] Add static assertions that insights rejects `stream` before provider/cache/log work and that no output is sent before full validation.
- [ ] Add assertions that cache/log payloads contain only sanitized values and the cache hash input includes tenant, resident/profile, provider, model, and policy.
- [ ] Add SQL normalization assertions for `age_group`, `anesthesia_type`, and rejection of a non-allowlisted key.
- [ ] Run the focused tests and verify they fail for the missing behavior, not for syntax/import errors.

### Task 2: Implement the canonical structured input contract and conservative DLP

**Files:**
- Modify: `supabase/functions/_shared/ai-guard.ts`
- Modify: `packages/shared/src/schemas/ai.ts`

- [ ] Export the normalized allowlist and use one normalization function for every key in TS: lowercase and remove non-alphanumeric characters.
- [ ] Replace free-text acceptance with per-field value rules: bounded categorical labels, booleans, and bounded non-negative integers/arrays; reject narrative, contact, identifier, and nested arbitrary values by default.
- [ ] Ensure `age_group` is a recognized structured field and is not mistaken for a PHI field name.
- [ ] Scan keys and scalar values recursively with conservative DLP patterns for names, email, phone, address, formatted MRN, SSN, dates, and long numeric identifiers; reject rather than redact at the input boundary.
- [ ] Add full-response output validation using the same DLP and reject unsafe/executable content, over-budget output, and PHI before any caller can use it.
- [ ] Keep the shared Zod schema behavior aligned with the edge guard and make its tests cover the same structured values.

### Task 3: Mirror the contract in PostgreSQL

**Files:**
- Modify: `supabase/migrations/20260925000004_phi_boundary_reassert.sql`

- [ ] Normalize every SQL key with the same lowercase alphanumeric operation used by TS.
- [ ] Store the allowlist in normalized form so snake_case keys such as `age_group` and `anesthesia_type` compare correctly.
- [ ] Reject non-allowlisted keys before recursively scanning values, while allowing only the same bounded scalar/category/array classes as the server contract.
- [ ] Apply the same DLP regexes for names, email, phone, address, formatted MRN, SSN, dates, and long numeric identifiers.
- [ ] Keep the trigger fail-closed when `is_deidentified = true`; do not use the flag as proof that values are safe.
- [ ] Add/update static SQL tests without starting a live database.

### Task 4: Harden AI insights buffering, streaming, and persistence

**Files:**
- Modify: `supabase/functions/ai-insights/index.ts`
- Modify: `supabase/functions/ai-insights/index.test.ts`

- [ ] Replace arbitrary client `query` clinical content with a server-built structured context object and allow only the guarded contract; do not use `is_deidentified` as authority.
- [ ] Return HTTP 400/501 for any `stream: true` request before quota consumption, provider fetch, cache access, or any SSE response.
- [ ] Remove token callbacks and early client emission; accumulate the complete provider response, run the same DLP/structured output validator, and only then return JSON.
- [ ] Redact/sanitize the final response before memory cache, database cache, query logs, or client response; store metadata-only log fields.
- [ ] Include tenant, resident/profile, provider, model, and policy version in the cache hash; validate the key and require identity fields.
- [ ] Ensure cache reads are revalidated and invalid entries are not returned or reinserted.

### Task 5: Harden AI quality output and logging

**Files:**
- Modify: `supabase/functions/ai-quality/index.ts`
- Modify: `apps/web/lib/__tests__/ai-quality-boundary.test.ts`

- [ ] Build the prompt from validated structured fields only; do not interpolate unvalidated template text or client-provided deidentification flags.
- [ ] Validate the complete parsed model response with `validateStructuredOutput`/the shared DLP before constructing the result.
- [ ] Sanitize result values before `ai_query_logs` insertion and keep only bounded categorical suggestions/metadata.
- [ ] Reject unsafe output before logging or returning it.

### Task 6: Verify all requested surfaces

**Files:**
- No additional production files expected.

- [ ] Run the focused Vitest suites and Deno tests.
- [ ] Run `deno check` for the Edge Function files.
- [ ] Run the Node AI/security tests and the static agent-boundary check.
- [ ] Run `pnpm typecheck` and `pnpm lint`.
- [ ] Run the repository static checks available for AI/PHI and record any unrelated pre-existing failures separately.
- [ ] Inspect `git diff --` and `git status --short` to confirm only intended AI boundary files changed; do not commit.
