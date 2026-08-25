# Static Code + Supply-Chain Review — G:\elogbook

- Task: task_0e508eaeb467
- Date: 2026-08-25
- Scope: read-only static review (audit, semgrep, secrets, console.log, TODO census, dead exports)

---

## 1. Supply chain — `pnpm audit --prod --audit-level=high`

**Result: 5 vulnerabilities — 2 HIGH, 2 MODERATE, 1 LOW.**

| Severity | Package | Installed | Advisory | Notes |
|---|---|---|---|---|
| HIGH | `image-size` | 1.2.1 | GHSA-w3rx-r6r6-pgpr — ICNS parser DoS via infinite loop | No patched version (`<0.0.0`) |
| HIGH | `image-size` | 1.2.1 | GHSA-5p2g-fcmc-qvqq — JXL/HEIF parser DoS via infinite loops | No patched version (`<0.0.0`) |
| MODERATE | `@sentry/browser` | 7.81.1 | Sentry SDK prototype-pollution gadget | |
| MODERATE | `uuid` | 7.0.3 | Missing buffer bounds check in v3/v5/v6 when buf provided | |
| LOW | `@sentry/react-native` | 5.17.0 | Potential leakage of Sentry auth tokens with Expo plugin | |

**Paths / exposure:** both HIGH advisories arrive transitively through the Expo toolchain only:
`apps/mobile > @expo/metro-runtime > @expo/log-box > @expo/dom-webview > expo@56.0.20 > @expo/cli@56.1.24 > @expo/metro(-config) > metro@0.84.4 > image-size@1.2.1` (~8,816 paths, all rooted at `apps\mobile`). This is a Metro bundler build-time dependency, not shipped runtime code.

**Severity: P3** — high-labeled but build-tool-scoped DoS with no available fix; track upstream (expo/metro) rather than hotfix.

---

## 2. Semgrep

Binary: `semgrep` available (`C:\Users\mahmo\AppData\Roaming\Python\Python313\Scripts\semgrep.exe`), `.semgrep.yml` present (5 rules).
Command: `semgrep scan --config .semgrep.yml apps packages -j 4` → **452 files scanned, 12 findings (12 blocking per repo exit policy)**. No `hardcoded-secret` and no `sql-string-concat` findings.

### ERROR — jsx-dangerously-set-inner-html (XSS rule)
| Location | Assessment |
|---|---|
| apps/web/app/layout.tsx:129 | Inline theme-bootstrap `<script nonce>`; payload is a static literal string (no user input). Low actual risk — P4; add justification comment per rule policy. |
| apps/web/app/layout.tsx:145 | JSON-LD via `JSON.stringify(jsonLd)` — safe only if `jsonLd` is never user-derived. Verify source of `jsonLd`; P4 pending confirmation. |

### WARNING — console-log-in-source
| Location | Note |
|---|---|
| apps/mobile/lib/security/audit-trail.ts:246 | `console.debug('[AuditTrail] Flushed …')` — count/telemetry only, but use structured logger. P4 |
| apps/web/lib/logger.ts:86 | `console.log(line)` inside logger fallback path itself. Acceptable as terminal sink; consider redaction guarantee. P4 |
| apps/web/public/sw-register.js:9 | `console.log('SW registered:', reg.scope)` — public/static asset, not covered by the app's TS logger. P4 |

### WARNING — shared-package-any-cast (7)
- packages/shared/src/components/GlassPanel.native.tsx:8 — `BlurView as any`
- packages/shared/src/components/ProgressRing.native.tsx:7–12 — six `Svg.* as any` casts

P4 (type-safety debt in shared layer; no runtime leak found).

Note: rule include patterns like `apps/**` trigger Semgrepignore-v2 anchoring deprecation warnings — cosmetic config churn, not a finding.

---

## 3. Secret sweep

Pattern `service_role|SUPABASE_SERVICE_ROLE|sk_live|whsec_` across `apps/`, `packages/`, `supabase/functions/` (excluding node_modules, tests dirs, `.env*`): **31 hits — 0 hardcoded secrets → no P1.**

All hits are benign *references*, not secret material:
- Env-var reads: supabase/functions/_shared/auth.ts:27,29; webads-export/index.ts:102; generate-pdf/index.ts:36; create-checkout/index.ts:38; ai-quality/index.ts:343; payment-webhook/index.ts:37,90; ai-insights/index.ts:209; list-invoices/index.ts:11; apps/web/lib/supabase/admin.ts:7
- Schema/config identifiers: packages/env/src/index.ts:10; supabase/functions/manifest.json:6–66 (`jwt_mode`); apps/web/lib/setup/supabase-installer.ts:45
- Test fixtures with fake values: supabase/functions/payment-webhook/index.test.ts:45–112 (`'test-key'`); apps/web/test-setup.ts:6 (`'test-service-role-key'`)
- Docs/OpenAPI prose: apps/web/public/openapi.yaml:46,2105,2247,2260,2273; apps/web/app/(authenticated)/[tenant]/audit/export/route.ts:82 (comment)

Zero matches for literal `sk_live*`, `whsec_*`, or embedded JWT-shaped service keys.

---

## 4. console.log census — apps/web/app + apps/web/components (production paths)

**0 occurrences** (excl. node_modules/tests/stories). Clean.

---

## 5. TODO/FIXME/HACK census per top-level dir

| Dir | Count |
|---|---|
| .github | 0 |
| .impeccable | 0 |
| .opencode | 5 (skill/command template text, not code) |
| .specify | 1 (template text) |
| analysis | 0 |
| **apps** | **1** |
| config | 0 |
| docs | 5 (plan documents) |
| packages | 0 |
| patches | 0 |
| scripts | 0 |
| specs | 0 |
| supabase | 0 |
| tests | 0 |

Only real-code marker: **apps/web/lib/supabase/auth.ts:106** — `TODO P6.x: add the join table + admin tenant-switcher UI`. Info/P5.

---

## 6. Dead exports spot-check — packages/shared/src

98 named exports scanned; **59 (~60%) are never imported by `apps/*` or `supabase/functions/*`**.

Caveats before deleting anything:
- `packages/shared/src/test/fixtures.ts` exports (`makeProfile`, `makeCaseEntry`, `makeTenant`, `makeTemplate`) serve the shared package's own tests.
- Barrel re-exports (`export *` in index.ts/browser.ts/native.ts) mean namespace consumers could still resolve these; none observed in apps today.
- Verified truly dead repo-wide (zero references outside packages/shared): `clinicalFonts`, `animationTokens`, `isUUID`, `toUUID`, `APP_VERSION`, `paymentSchema`, `PHI_MARKER`, `SPRING_SLIDE_UP`, `KPI_COUNT_UP`.

Full dead list (not imported by apps/supabase): accreditationMappingSchema, accreditationMilestoneSchema, AIConfig, AIConfigServer, AIQueryLog, aiQueryLogSchema, aiQueryLogStatusSchema, aiResponseCacheSchema, animationTokens, APP_VERSION, approvalActionSchema, ApprovalRequest, AttachmentSignature, AuditLog, CARD_EXIT_ANIMATION, CaseAttachment, caseEntryDeidentifiedSchema, caseEntryIdentifiedSchema, clinicalFonts, ClinicalTokens, complianceConfigSchema, ComplianceConfiguration, consentRecordSchema, consentTypeSchema, DateOnlyString, DEFAULT_TRANSITION, DutyShiftType, FacultyEvaluation, FieldValidation, fieldValidationSchema, initiateOneTimePurchaseSchema, InstitutionBilling, inviteUserSchema, IsoDateString, isUUID, KPI_COUNT_UP, makeCaseEntry, makeProfile, makeTemplate, makeTenant, OneTimePurchase, oneTimePurchaseSchema, PaymentGatewayConfig, paymentGatewayConfigSchema, PaymentGatewayConfigServer, paymentSchema, PaymentStatus, paymentStatusSchema, PHI_MARKER, PHIString, profileSchema, recordConsentSchema, ResidentAIToggle, residentAiToggleSchema, SPRING_SLIDE_UP, subscriptionPlanSchema, TemplateFavorite, TenantType, toUUID.

Severity: P5 (maintenance/API-hygiene; prune or mark `@internal`).

---

## Summary

| # | Finding | Severity |
|---|---|---|
| 1 | `image-size@1.2.1` 2× HIGH DoS advisories, transitive via Expo/Metro (apps/mobile), no patch available | P3 |
| 2 | `@sentry/browser` moderate prototype pollution; `uuid@7.0.3` moderate bounds check; `@sentry/react-native` low token-leak | P3–P4 |
| 3 | Semgrep: 12 findings (2 ERROR dangerouslySetInnerHTML, 3 console-log, 7 any-cast); no secrets/SQLi | P4 |
| 4 | Secret sweep: 31 benign refs, 0 hardcoded credentials | No finding |
| 5 | console.log in web app/components production paths: 0 | Clean |
| 6 | TODO markers: 1 real code marker (apps/web/lib/supabase/auth.ts:106) | P5 |
| 7 | Dead exports in packages/shared/src: 59/98 unused by consumers | P5 |

No P1/P2 findings.
