# Verified marketing facts (ONLY these may appear on the landing page)

## Product truth
- Name: Elogbook (APP_NAME from @elogbook/shared)
- For: medical residents; program directors/supervisors; institutions
- Frameworks: SCFHS, ACGME, GMC + custom accreditation mapping w/ milestone tracking
- Case logging: multi-step wizard, template-driven fields, draft→pending→approved flow
- De-identification: SHA-256 hashed MRN, fail-closed behavior
- Offline: offline-first capture, AES-256-CBC encrypted local store, background sync, LWW conflict resolution, tombstones
- Verification: atomic supervisor approve/reject, immutable SHA-256 audit trail
- Security: MFA enrollment/verify, 5-role RBAC, rate limiting, CSP-hardened headers, PHI screenshot blocking (mobile), biometric auth (mobile)
- Exports: PDF compliance exports
- Billing: Stripe subscriptions, plans served live from subscription_plans

## Live wiring on landing page (must actually function)
1. Session-aware: authed visitor at `/` → auto-redirect /{tenant}/dashboard
2. Primary CTA → /signup ; secondary → /login ; nav → /pricing
3. Pricing link block reflects real free/institution tiers (do not restate prices here — pricing page is source of truth)
4. Hidden-CTA capture form → POST /api/contact {name,email,message} — rate-limited 5/IP, rows land in contact_submissions; success = 200/202; errors handled inline
5. No fake counters, no testimonial inventions, no customer logos we don't have

## Copy tone
Confident, clinical, zero hype-words ('revolutionary','game-changing' banned).
Sentence case headers ok; no exclamation marks.
