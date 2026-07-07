# E-Logbook Enterprise — Production Backlog

> Auto-prioritized task queue for the daily cron. Highest priority at top.

## 🔴 P0 — Launch Blockers

- [x] **P0.1** Finish UI redesign across all screens — ApprovalsDashboard, CaseForm, CaseList, AIInsights, Reports, Billing, Admin panels (match Apple Health prototype)
- [x] **P0.2** Redesign login page — Apple Health aesthetic, frosted glass, blue accent
- [x] **P0.3** Fix mobile duplicate components — delete local ProgressRing, StatusBadge, GlassPanel; switch all imports to `@elogbook/shared`
- [x] **P0.4** Light theme is default — verify dark mode toggle still works, test all screens in both modes
- [x] **P0.5** Fix known issues from PROJECT_ANALYSIS.md — HeroUI GlassPanel web import, missing Suspense boundaries in dashboard

## 🟠 P1 — Production Readiness

- [x] **P1.1** Fix `duty_periods` RLS — `WITH CHECK (true)` bypasses tenant isolation for write operations (see RLS_AUDIT.md)
- [x] **P1.2** Fix `duty_weekly_violations` view — add `security_invoker = true` to enforce RLS on base tables (see RLS_AUDIT.md)
- [x] **P1.3** Fix `faculty_evaluations` RLS — asymmetric USING/WITH CHECK allows cross-tenant resident assignment (see RLS_AUDIT.md)
- [x] **P1.4** Add rate limiting to approve/reject RPCs (currently browser-callable, no rate limit)
- [x] **P1.5** Add CSRF protection to all mutation endpoints
- [x] **P1.6** Tenant-slug URL validation on submit route
- [x] **P1.7** Add missing database indexes for query performance (partial, covering, compound — 16 new indexes)
- [x] **P1.8** Bundle size optimization — lazy load heavy components, code splitting
- [x] **P1.9** Image optimization — next/image for all static assets
- [x] **P1.10** Error boundary coverage — ensure every route has proper error boundaries
- [x] **P1.11** Loading states — skeleton screens for every data-fetching route

## 🟡 P2 — Enterprise Features

- [x] **P2.1** SSO integration (SAML/OIDC) — admin UI + login wiring + API
- [x] **P2.2** SCIM provisioning — admin UI + token management + IdP config
- [x] **P2.3** Audit log export — CSV/PDF with date range filters
- [x] **P2.4** Compliance report generation — HIPAA/GDPR data access, PHI inventory, consent tracking, export
- [x] **P2.5** Multi-language i18n — English, Arabic (RTL), French — next-intl
- [x] **P2.6** Advanced analytics dashboard — case volume trends, specialty breakdown, supervisor workload
- [x] **P2.7** Webhook system — tenant-configurable webhooks for case events
- [x] **P2.8** API documentation — OpenAPI 3.0 spec + live Swagger UI at /api-docs

## 🟢 P3 — Performance & Polish

- [ ] **P3.1** Increase test coverage from 66.5% → 85%+ (timed out 2× — needs separate sprint)
- [x] **P3.2** Add Playwright E2E tests for critical paths (login → dashboard → log case → submit)
- [x] **P3.3** Lighthouse score: Performance 90+, Accessibility 100, SEO 100
- [x] **P3.4** PWA support — manifest.json, service worker, install prompt, offline fallback
- [ ] **P3.5** Mobile push notifications for approval status changes (timed out — needs separate sprint)
- [x] **P3.6** PDF export redesign — professional templates with hospital branding (45 tests)
- [x] **P3.7** Keyboard shortcuts — Cmd+K palette, G+X navigation, J/K, ? help

## 🔵 P4 — Mobile (Expo)

- [ ] **P4.1** Sync all mobile screens with new Apple Health design
- [ ] **P4.2** Offline sync reliability — test WatermelonDB→Supabase sync edge cases
- [ ] **P4.3** Mobile deep linking — open case from notification
- [x] **P4.4** Biometric auth — FaceID/TouchID gate with SecureStore, AppState integration
- [ ] **P4.5** Mobile widget — today's case count on home screen

## ⚪ P5 — DevOps & Infra

- [x] **P5.1** CI/CD pipeline — GitHub Actions: typecheck, lint, test, build on every PR
- [ ] **P5.2** Staging environment — deploy previews for PRs
- [x] **P5.3** Production deployment — Vercel (web) + EAS (mobile) setup
- [ ] **P5.4** Monitoring — Sentry error tracking, performance monitoring
- [x] **P5.5** Database backups — automated Supabase backup schedule
- [ ] **P5.6** Load testing — verify 1000+ concurrent users

---

**Total:** 35 tasks | **Completed:** 0 | **Next:** P0.1 — Finish UI redesign across all screens
