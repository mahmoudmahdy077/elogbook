# MASTER SPEC — "Chain of Custody" v1.0 (orchestrator synthesis of C3, pre-hardening)

Locks: rail spine · craft floor (IMP) · motion tokens (EMIL) · intent engine (NOVA) · narrative arc (VERA).

## Tokens & system
- Canvas #F2F2F7; frost rgba(255,255,255,.72); ink #000 → #3C3C43 → #6B6B70; accent #007AFF action/rail-active only.
- Easing: --ease-out cubic-bezier(.23,1,.32,1) · --ease-inout cubic-bezier(.77,0,.175,1) · --ease-drawer cubic-bezier(.32,.72,0,1).
- Enter ≤400ms / exit ≤240ms; stagger 45ms; press scale(.97) 160ms; one moving element per viewport; reduced-motion pins end-states.
- Grid 12-col/24px gutters/maxw 1200/pad 32; 8px rhythm; section gaps 112px desktop / 64px mobile; radii 8/14; hairline rgba(60,60,67,.14) on whole pixels.
- Type: mono kicker .6875rem/+0.14em/#6B6B70 · H1 clamp(2.75rem,6vw,4.25rem)/1.05/650/−0.035em · H2 clamp(1.75rem,3vw,2.25rem)/600/−0.02em · body 1.125/1.65 max 46ch · facts .8125rem mono tabular.

## Sections (8)
1. **Nav** — sticky, bottom hairline, top-edge 2px #007AFF scroll-progress (honest scroll). Logo left, Sign in + Start free right.
2. **Hero** — lg split: copy cols 1–9 (kicker `ELECTRONIC LOGBOOK · SCFHS · ACGME · GMC`; H1 TBD from C4; sub ≤17 words; primary signup/ghost login), spec col 10–12 = **Hash Lab**: paste-any-MRN → live SHA-256 via Web Crypto, CTA opacity .4→1 on first keystroke; dwell pill @25s idle once. Right/below: **Verifying Card** loop — draft→pending→approved wipe beats, MRN→`a3f9…e21b` blur-crossfade, check line-draw; plays 2×, freezes approved, re-arm visibilitychange only.
3. **The Cost** — 3 hairline rows w/ tabular figures (records scattered/unverifiable exports/hours lost); dry register; tick on entry.
4. **Log · Map · Sign** — three verbs as segments ON the rail; stamps [scale .4→1] 180ms; data-milestone labels.
5. **Custody demo** — SAMPLE DATA review queue; approve both → audit-entry artifact renders REAL client sha256 digest of click timestamps + your times; headline rewrites blur-crossfade 240ms "That took two clicks."
6. **Trust Vault** — mono two-col `<dl>`: MFA, 5-role RBAC, AES-256-CBC offline store, CSP headers, rate limits, PHI screenshot block (mobile); row-expand reveals immutable chain fragment + **sample compliance PDF** link (static /public asset, SAMPLE-labeled); director-weighted ticks (+2).
7. **Milestones** — static responsive mapping table (frameworks × requirements), tabular numerals; chips <md; NO pinning.
8. **Choose + Pricing + Attestation** — role picker (resident/director; localStorage + ?role=), live plans strip (server-read names+tiers only, link /pricing), self-signing attestation: digest of visit timestamp type-on 380ms; CTA inherits state ("Start logging"→"Continue where you left off").

## Rail
lg+: fixed left 20px hairline in reserved 48px margin; SF Mono tick+verb per section; IO registration 280ms; ticks ARE the endowed progress meter. <1024px: top-edge hairline progress + inline `[✓ 03 · SIGN]` chips per heading; no floating chrome.

## Intent engine (hidden CTA)
Signals: section registered +1 each (hero pre-endowed) · hash ≥12 chars +1 · both demo approvals +1 · vault expand/PDF +2 (weighted for directors).
Sheet at ≥6 total (early lane: ≥4 if hash OR demo done) — frosted glass-panel-sheet translateY(420ms drawer), focus-trap, Esc 180ms exit. Copy states progress truthfully ("6 of 8 sections reviewed"). Capture POST /api/contact {name,email,message} (5/IP, inline errors incl 429), success unlocks sample PDF + routes /signup?role=. Dwell pill once. No-JS: static CTAs remain.

## Hard truths (from FACTS.md)
Authed redirect intact · force-dynamic · zero invented metrics/testimonials/logos · banned words absent · sentence case, no exclamation marks.

## Open items resolved in C4/C5
H1 final pick · spacing-token additions · any craft-floor exceptions · sheet copy line.
