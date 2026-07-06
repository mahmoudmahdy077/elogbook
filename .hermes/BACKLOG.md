# E-Logbook Enterprise — Production Backlog

> Auto-prioritized task queue for the daily cron. Highest priority at top.

## 🔴 P0 — Launch Blockers

- [ ] **P0.1** Finish UI redesign across all screens — ApprovalsDashboard, CaseForm, CaseList, AIInsights, Reports, Billing, Admin panels (match Apple Health prototype)
- [ ] **P0.2** Redesign login page — Apple Health aesthetic, frosted glass, blue accent
- [ ] **P0.3** Fix mobile duplicate components — delete local ProgressRing, StatusBadge, GlassPanel; switch all imports to `@elogbook/shared`
- [ ] **P0.4** Light theme is default — verify dark mode toggle still works, test all screens in both modes
- [ ] **P0.5** Fix known issues from PROJECT_ANALYSIS.md — HeroUI GlassPanel web import, missing Suspense boundaries in dashboard

## 🟠 P1 — Production Readiness

- [ ] **P1.1** Add rate limiting to approve/reject RPCs (currently browser-callable, no rate limit)
- [ ] **P1.2** Add CSRF protection to all mutation endpoints
- [ ] **P1.3** Tenant-slug URL validation on submit route
- [ ] **P1.4** API response time optimization — add missing indexes, query plan analysis
- [ ] **P1.5** Bundle size optimization — lazy load heavy components, code splitting
- [ ] **P1.6** Image optimization — next/image for all static assets
- [ ] **P1.7** Error boundary coverage — ensure every route has proper error boundaries
- [ ] **P1.8** Loading states — skeleton screens for every data-fetching route

## 🟡 P2 — Enterprise Features

- [ ] **P2.1** SSO integration (SAML/OIDC) — currently has migration scaffolding, needs implementation
- [ ] **P2.2** SCIM provisioning — migration exists, needs endpoint implementation
- [ ] **P2.3** Audit log export — CSV/PDF with date range filters
- [ ] **P2.4** Compliance report generation — HIPAA/GDPR audit report auto-generation
- [ ] **P2.5** Multi-language i18n — Arabic, French, Spanish (critical for MENA market)
- [ ] **P2.6** Advanced analytics dashboard — case volume trends, specialty breakdown, supervisor workload
- [ ] **P2.7** Webhook system — tenant-configurable webhooks for case events
- [ ] **P2.8** API documentation — OpenAPI/Swagger spec for all endpoints

## 🟢 P3 — Performance & Polish

- [ ] **P3.1** Increase test coverage from 66.5% → 85%+
- [ ] **P3.2** Add Playwright E2E tests for critical paths (login → dashboard → log case → submit)
- [ ] **P3.3** Lighthouse score: Performance 90+, Accessibility 100, SEO 100
- [ ] **P3.4** PWA support — offline web access, install prompt
- [ ] **P3.5** Mobile push notifications for approval status changes
- [ ] **P3.6** PDF export redesign — professional templates with hospital branding
- [ ] **P3.7** Keyboard shortcuts — cmd+k search, cmd+n new case, j/k navigation

## 🔵 P4 — Mobile (Expo)

- [ ] **P4.1** Sync all mobile screens with new Apple Health design
- [ ] **P4.2** Offline sync reliability — test WatermelonDB→Supabase sync edge cases
- [ ] **P4.3** Mobile deep linking — open case from notification
- [ ] **P4.4** Biometric auth — FaceID/TouchID for quick re-auth
- [ ] **P4.5** Mobile widget — today's case count on home screen

## ⚪ P5 — DevOps & Infra

- [ ] **P5.1** CI/CD pipeline — GitHub Actions: typecheck, lint, test, build on every PR
- [ ] **P5.2** Staging environment — deploy previews for PRs
- [ ] **P5.3** Production deployment — Vercel (web) + EAS (mobile) setup
- [ ] **P5.4** Monitoring — Sentry error tracking, performance monitoring
- [ ] **P5.5** Database backups — automated Supabase backup schedule
- [ ] **P5.6** Load testing — verify 1000+ concurrent users

---

**Total:** 35 tasks | **Completed:** 0 | **Next:** P0.1 — Finish UI redesign across all screens
