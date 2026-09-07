# T11 Evidence — Bundle provisioning core (bounded substep)

Ticket: T11 (dependencies: T07–T10). Host execution, image pulls, and
two-VPS runs are BLOCKED (no Docker/VPS on this host) and belong to
T11-full after the T09 review sign-off.
Status: IMPLEMENTED (pure core below)

## Implemented (`apps/ops/src/`)

- `release-pin.ts`: pin-shape validation — non-empty digest-pinned
  service map, pinned (non-main/master/latest) source. Rejects tags,
  short digests, empty maps. (Signature verification itself is T13.)
- `preflight.ts`: honest preflight over measured facts — missing env,
  disk/RAM/CPU shortfalls, occupied ports, unreachable registry all
  fail; unknown is never a pass. Probing I/O stays in the executor.
- `config-merge.ts`: three-way KEY=VALUE merge (base/upstream/operator)
  for staged config preview: clean fast-forwards apply, true conflicts
  (incl. upstream-delete vs operator-edit) are reported with the operator
  value kept behind a marker comment — the executor must block on any
  conflict (shared primitive for T15).

## Tests

- `provision.test.ts`, 10/10 (package 27/27 with prior suites).
- Two test/implementation corrections from failing assertions: 64-hex
  fixture digests (validator was right) and allowing registry-less
  `postgres@sha256:` references (validator was too strict).

## Verification

- ops suite 27/27, ops typecheck 0 (run before commit).

## Deferred to T11-full (review-gated, needs VPS)

Pinned adapter wiring to real upstream metadata, key-generation tooling,
SMTP/Auth/API routing, Functions + migration orchestration, two fresh
VPS runs, private-service reachability proof, volume preservation proof.
