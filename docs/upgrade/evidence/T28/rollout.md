# T28 Evidence — Operator handoff + staged rollout

Ticket: T28 (dependency: T27)
Status: RUNBOOKS + HANDOFF DELIVERED; no production rollout performed
by this session (stated explicitly — a coding model never silently
deploys).

## Delivered

- `docs/upgrade/runbooks/`: install, update, restore, incident-keys.
  Each names what exists vs what is deferred (manager GUI flows).
- Branch protection: `main` is currently UNPROTECTED (verified
  2026-09-07 via read-only API). Owner must require: typecheck, lint,
  test, build-web, db-tests, deno-test, docker-boot, Gates, CodeQL,
  Semgrep, container-scan. Suggested (owner reviews first):
  `gh api repos/mahmoudmahdy077/elogbook/branches/main/protection -X PUT
  -f required_status_checks[strict]=true -f 'required_status_checks[checks][][context]=CI'
  ...` — full check list in the repo settings UI is preferred over CLI.
- Rollout stages: synthetic staging → 1–3 program de-identified pilot
  (LAUNCH_SCOPE, PHI prohibited) → broader deployments after observed
  stability. Go/no-go owners: security, operations, product/data-policy
  (names + dates required before pilot; blank below = not approved).

## Go / no-go (all blank = NO-GO by default)

| Gate | Owner | Date | Verdict |
|---|---|---|---|
| Security review (fixed scope + SLA) | _unassigned_ | — | NO-GO |
| External assessment findings closed | _unassigned_ | — | NO-GO |
| BAA/DPA executed | _unassigned_ | — | NO-GO |
| G8 identifiable-data gate | _unassigned_ | — | NO-GO (de-identified pilot only) |
| Rollback owner named | _unassigned_ | — | NO-GO |

## Support matrix (accurate as of this commit)

- Topology: single-process Compose (app + Caddy) behind 80/443.
- Data: de-identified pilot ONLY. Identifiable mode: code-complete
  policy core, NOT enabled, NOT assessed.
- Mobile offline identifiable workflows: NOT qualified.
- Known limits: RLS-level tenant suspension, E2E browser matrix,
  load/soak, EXPLAIN plans, shareable preview tokens — all deferred
  with tickets named above.
