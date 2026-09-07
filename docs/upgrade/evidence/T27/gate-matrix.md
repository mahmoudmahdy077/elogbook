# T27 Evidence — Release qualification (aggregator + matrix)

Ticket: T27 (depends on T00–T26). Fault-injection drills, load/soak,
browser matrix, and G8 need VPS/humans and are NOT claimed here.
Status: AGGREGATOR + HONEST MATRIX (fast subset green locally)

## `scripts/release-qualify.mjs`

Single command producing `docs/upgrade/evidence/T27/latest.{json,md}`:
9 fast gates, 3 unit groups (security-core 16 suites, ops, shared),
optional `--full` (typecheck/lint/full unit), and 9 BLOCKED entries
with named prerequisites. Debugged in: Windows shell quoting for pnpm
shims, package-relative suite paths. Exit non-zero on any failure.

## Gate status (de-identified release line)

| Gate | Local | CI/owner |
|---|---|---|
| G0 provenance | BLOCKED (no signed release yet; T13-full/T28) | — |
| G1 build+tests | partial (fast green; full via `--full`/CI) | CI typecheck/lint/test/build/db/deno/docker-boot |
| G2 authorization | unit + live probes green; pgTAP via CI | db-tests (now 15 suites) |
| G3 installation | BLOCKED (VPS; T11-full) | — |
| G4 recovery/update | shell/unit green; drills BLOCKED | VPS drills |
| G5 UI/a11y | BLOCKED (browsers/manual) | e2e job + manual pass |
| G6 content/theme | unit + API green; cache proof BLOCKED | VPS |
| G7 perf/ops | baselines recorded; soak BLOCKED | T26-full |
| G8 identifiable | BLOCKED (governance + assessment, T19b+) | owner |

## Incidental fix in this batch

Gate A (now scanning 43 service-role files) flagged two true items:
`assign-role` target lookup/update gained `.eq('tenant_id', …)`
(hardened pattern; post-hoc check retained), and the platform guard's
own-profile lookup carries the documented user-scoped exemption.
