# Contributing

Thanks for your interest in E-Logbook Enterprise! This project handles Protected Health Information (PHI) under HIPAA, GDPR, SCFHS, GMC, and other regional regulations. Contributions are welcome, but require extra care.

## Branch model

- `main` is the production branch. All PRs target `main`.
- Feature branches: `feat/<short-slug>` (e.g. `feat/case-attachments`)
- Fix branches: `fix/<short-slug>` (e.g. `fix/approve-case-tenant-id`)
- Refactor / cleanup: `chore/<short-slug>`

## PR checklist

Before opening a PR, confirm:

- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm -r typecheck` exits 0
- [ ] `pnpm -r lint` exits 0
- [ ] `pnpm test` is green; new code is covered by tests
- [ ] If you touched DB schema: a new `supabase/migrations/NNNN_*.sql` file is included AND a `supabase/tests/` SQL regression
- [ ] If you touched an Edge Function: a Deno test exists under `supabase/functions/.../__tests__/`
- [ ] No new console.log / console.error left in source (use the structured logger)
- [ ] No secrets in source, comments, or test fixtures
- [ ] No PHI in logs (the logger redacts `patient_mrn`/`patient_dob`/`patient_hash`/`field_values` automatically, but you should still avoid passing them as log arguments)
- [ ] If you touched the mobile app: `pnpm --filter @elogbook/mobile test` passes
- [ ] If you added a dep: justification in the PR description; lockfile regenerated
- [ ] `CHANGELOG.md` updated for any user-facing change
- [ ] Conventional Commits format: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `perf:`, `security:`

## DCO sign-off

All commits must be signed off (DCO) to certify you have the right to contribute the code under the project's license. Use `git commit -s` to add the `Signed-off-by:` line.

```
Signed-off-by: Your Name <your.email@example.com>
```

## Code style

- TypeScript strict mode everywhere. No `any` in shared code (use `unknown` + a type guard if needed).
- Zod for all input validation (shared schemas in `packages/shared/src/schemas/`).
- React: server components by default; client components only when state or browser APIs are required.
- Tailwind: prefer utility classes; for repeated patterns add a component or a CSS class in `globals.css`.
- Error handling: surface meaningful errors to the user; never swallow.
- Security: every state-changing request validates Origin, rate-limits, and has an ownership/role check.
- Tests: every fix is preceded by a failing test that reproduces the bug. Tests live next to the code.

## Pull request template

```markdown
## What
<!-- one-paragraph description -->

## Why
<!-- link to the issue or spec task; e.g. ENTERPRISE_TRANSFORMATION_PLAN.md P2.3 -->

## How
<!-- list of files touched; notable design decisions -->

## Verification
- [ ] `pnpm -r typecheck` green
- [ ] `pnpm -r lint` green
- [ ] `pnpm test` green (list new tests)
- [ ] `supabase db reset` and `supabase test db` green if schema changed
- [ ] manual: <describe the smoke test you ran>

## Security
- [ ] No new console.log in source
- [ ] No secrets in committed code
- [ ] No PHI in logs
- [ ] All new POST/PUT/DELETE routes validate Origin + rate-limit
- [ ] All new RLS policies verified by SQL regression
```

## Reporting security issues

**Do not** file a public issue for security bugs. See [`SECURITY.md`](./SECURITY.md).

## Code of conduct

Be excellent to each other. See [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).
