# Judge Rubric (orchestrator synthesis across all 10 cycles)

Score each proposal 0–10 per axis, weighted:
1. Emotional hook / memorability (×2) — does it stop the scroll?
2. Conversion architecture (×2) — clear path to signup + director-track.
3. Hidden-CTA ingenuity (×3) — non-obvious, truthful, implementable, graceful no-JS degrade.
4. Craft feasibility in this stack (×1) — Tailwind v4 tokens only, CSS motion, AA a11y.
5. Backend integration truthfulness (×2) — uses real data/endpoints; zero invented stats.
6. Clinical credibility (×2) — Apple-Health premium, no gamer glow, suits PHI-sensitive buyers.

## Hard bans
purple/neon glow · drop shadows on cards · fake metrics · heavy anim libs ·
emoji-dump marketing · AI-slop gradient mesh · autoplaying video hero.

## Real wiring available
- `/` authed → redirect /{tenant}/dashboard (session-aware)
- `/signup`, `/login`, `/pricing` (live subscription_plans read)
- `POST /api/contact` {name,email,message} → contact_submissions, rate-limited 5/IP
- Feature facts: SHA-256 deidentification, offline AES sync + LWW, milestones,
  atomic approvals + immutable audit trail, MFA, RBAC×5, PDF exports, Stripe

## Phase plan
C1 divergence → C2 convergence pressure → C3 hybrid kill-round →
C4 CTA deepening → C5 copy sharpening → C6 systemization →
C7 implementation v1 → C8 audit+fix → C9 live polish → C10 ship freeze.
