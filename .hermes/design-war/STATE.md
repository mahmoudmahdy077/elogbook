# Elogbook Landing Design War — State

Campaign: 10 cycles · 4 schools · goal = flagship converting landing page, backend-integrated.

## Schools
- NOVA — ui-ux-pro-max (strategy/conversion systems)
- EMIL — emilkowalski set (motion & micro-interaction)
- IMP — pbakaus/impeccable (typographic craft & finish)
- VERA — taste suite (art direction & narrative POV)

## Ground truth
- Current landing: apps/web/app/page.tsx (85 lines, bare hero + 3 features)
- Tokens: globals.css — #007AFF primary, Apple-Health clinical, zero glow/shadow policy
- Pricing page live-reads subscription_plans (free/institution tiers)
- Authed users redirect to /{tenant}/dashboard from `/`
- Backend surface for marketing: deidentified logging, offline AES sync, milestones,
  approvals + audit trail, MFA/RBAC, PDF exports, Stripe billing

## Hidden CTA canon (per brief)
Non-obvious psychological capture mechanism; must be truthful (no invented stats),
a11y AA, no heavy JS libs. Fire paths must degrade gracefully for no-JS.

## Cycle log
- C1 DIVERGENCE ✅ — four full proposals archived:
  - /root/proposals/nova-cycle1-proposal.md — "Proof of Work" (self-score 9): hero typing-hash case card, Milestone Mirror scroll-progress hidden CTA w/ endowed progress + real PDF artifact + role routing
  - /root/proposals/emil-cycle1-landing-proposal.md — "Verify Moment" (8): 3.2s Verifying Card loop choreography, Intent Ledger hidden CTA (localStorage elog_intent, threshold-gated bottom sheet)
  - /root/proposals/imp-cycle1-proposal.md — "Signed Record" (8.5): editorial hairline system, exact type ramp, hidden CTA = live MRN→SHA-256 field + CTA opacity earned by keystroke, scroll-progress bar
  - /root/proposals/cycle1-vera-proposal.md — "Chain of Custody" (8): continuous audit rail signature device, working 2-click approval mini-demo as bait, role picker ?role= passthrough, final attestation signature-block CTA
  - Combined: ALL-cycle1-proposals.md · Convergence signal: SHA-256 deidentification demo chosen by 3+ schools; role-routed signup by 2; audit-rail progress by 2; live plans read by 3
- C2 CROSS-CRITIQUE ✅ — consensus winner: **VERA Chain of Custody** (rail = product claim made spatial).
  Weighted totals: NOVA scores VERA 100/110 top; EMIL scores VERA 104; IMP scores VERA 101; VERA dissents favoring NOVA 97.
  Attack consensus absorbed: mobile rail fragility (<lg), director-path flatness (needs Trust Vault + export state changes), manifesto register distrust, motion fatigue (play-twice-freeze), Intent-Ledger threshold gating risk.
  Merged canon for C3+: IMP live MRN→SHA-256 early · NOVA endowed-progress AS rail ticks + artifact payoff · EMIL wipe beat w/ reduced-motion end-state · role ?role= routing.
- C3 HYBRID KILL-ROUND ⏳ running (deleg_4423e73c) — four unified execution blueprints; each saves /root/proposals/{school}-cycle3-hybrid.md
  Orchestrator implementation note: sample-PDF payoff for ANON visitors cannot call authed generate-pdf → ship static pre-generated SAMPLE PDF in /public, clearly labeled; capture via /api/contact stays truthful.
