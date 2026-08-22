# E-Logbook — Competitive Gap-Mapping Analysis

> **Scope**: Map the 13 swarm-identified must-have features + 10 market gaps against the **actual E-Logbook codebase** (web + mobile + Supabase), not the SWOT docs.
> **Key framing finding**: The existing `analysis/competitive-analysis.md` and four research reports **substantially understate the product.** The current codebase already ships rotations, ACGME sub-competency milestones + EPA mapping, Mini-CEX/DOPS/CBD forms, CPT/ICD procedure-code browser, notifications/push, an onboarding wizard, GMC + CanMEDS framework scaffolding, and offline-first sync — none of which the SWOT marks as built. Every status below is **verified against files**, not inferred from docs.

**Evidence baseline (verified file inventory):**
- **Web routes** (`apps/web/app/(authenticated)/[tenant]/`): rotations, milestones, evaluations, evaluate, cases, approvals, analytics, compliance, goals, reports (duty-hours/evaluations/specialty/status CSV), audit/export, admin (templates/scim/sso/webhooks), onboarding, dashboard.
- **Mobile screens** (`apps/mobile/app/(tabs)/`): index, log-case, my-cases, case-detail, approvals, evaluations, milestones, rotations, duty-hours, analytics, ai-insights, profile.
- **Shared schemas** (`packages/shared/src/schemas/`): ai, auth, cases, consent, payments, subscriptions. **Types** (`types/database.ts`): Tenant, CaseEntry, DutyPeriod, FacultyEvaluation, AccreditationMapping/Framework/Milestone (FrameworkType acgme|scfhs|gmc|canmeds|custom, procedure_role observed/assisted/performed/supervised), ApprovalRequest, CaseAttachment, AuditLog, AIConfig, ProgramGoal, Subscription/Payment.
- **Migrations** (`supabase/migrations/`): 00079 rotations+shifts, 00080 milestones+epa_mappings, 00081 evaluation_forms, 00082 procedure_codes (CPT/ICD), 00083 notifications+onboarding_steps, 00089 gmc_framework, 00090 canmeds, 00091 scholarly_activity, 00092 benchmark_data/benchmark_mv, 20260812160000 push_tokens, 20260818140000 admin_user_management.

---

## (A) Coverage Matrix — 13 Must-Have Features

Legend: **IMPLEMENTED** = shipped & wired in real code | **PARTIAL** = exists but incomplete/limited scope | **MISSING** = no functional implementation (schema-scaffold only or absent) | **N/A** = not applicable to that platform

| # | Must-Have Feature | Web | Mobile | Evidence (verified) |
|---|---|---|---|---|
| 1 | **<30s fast case entry** | **PARTIAL** | **PARTIAL** | `components/QuickAddFAB.tsx`, `QuickAddCase.tsx`, `case-form/TemplateStep.tsx`, e2e `quick-add.spec.ts`. Quick-add exists but no <30s telemetry, no template favorites, multi-step form. Mobile `log-case.tsx`. |
| 2 | **Mobile-first design** | **IMPLEMENTED** | **IMPLEMENTED** | Native Expo app, 13 tab screens `apps/mobile/app/(tabs)/`; web fully responsive. |
| 3 | **Procedure/case counting by role** | **PARTIAL** | **PARTIAL** | `AnalyticsDashboard` (monthly_volume, specialty_breakdown, approval_rate, supervisor_workload); `CaseCountWidget.tsx` (today's count). `procedure_role` captured on `AccreditationMapping` (observed/assisted/performed/supervised) but **no dedicated by-role count view**. |
| 4 | **Excel/CSV export** | **PARTIAL** | **PARTIAL** | CSV+PDF: `api/[tenant]/reports/{specialty,status,duty-hours,evaluations}.csv`, `compliance/export`, `audit/export`, `export-pdf`. **Native Excel (.xlsx) absent** (`xlsx`/`ms-excel` = 0 hits). No export surfaced in mobile. |
| 5 | **Specialty templates** | **IMPLEMENTED** | **IMPLEMENTED** | `admin/templates` (template.specialty, usage_count, template builder `template_builder_fix`), `TemplateStep.tsx`. Mobile offline `db/models/CaseTemplate.ts` + `log-case` specialty. |
| 6 | **Statistics / analytics** | **IMPLEMENTED** | **IMPLEMENTED** | `analytics/page.tsx` + `AnalyticsDashboard` (volume, specialty breakdown, approval rate, supervisor workload); mobile `analytics.tsx`, `CaseCountWidget`, `DashboardContent` duty-hour stats. |
| 7 | **Supervisor sign-off** | **IMPLEMENTED** | **IMPLEMENTED** | `approvals`,`cases/[id]/{submit,request-verification}`, `ApprovalRequest` table, `AttachmentSignature`/`verified_at`, concurrent-approval lock (mig 00009); mobile `approvals.tsx` + `case-detail`. |
| 8 | **Reflective practice** | **MISSING** | **MISSING** | No reflections table/module. Only an AI ad-hoc "clinical reflection query" in mobile `ai-insights.tsx`. No structured reflective-practice entries, no portfolio reflections. |
| 9 | **Offline capability** | N/A | **IMPLEMENTED** | WatermelonDB + `lib/sync` (`syncService.initSync`, `local_sync_status`, conflict callback); offline models: CaseEntry, CaseTemplate, Rotation, Shift, Milestone, EvaluationForm, ProgramGoal, Comment. |
| 10 | **Portfolio / CV generation** | **PARTIAL** | **MISSING** | `api/[tenant]/export-pdf` builds a case PDF. No structured CV/portfolio builder (sections, gaps, logbook summary). Not exposed on mobile. |
| 11 | **Certification / compliance tracking** | **PARTIAL** | N/A | `compliance/page.tsx` + `ComplianceReports.tsx` (HIPAA/GDPR/SCFHS overview, data-retention, consent). **Board-certification / license-expiry / ITE tracking absent.** Compliance is web-only. |
| 12 | **Image / attachment upload** | **MISSING** | **MISSING** | `case_attachments` table + audit columns (mig 00030) and `CaseAttachment` type exist, **but no storage wiring**: 0 hits for `createSignedUrl`/`storage.from(`/`.upload(`/`getPublicUrl` across real code. No photo/image attach path. (`CaseImport.tsx` is CSV import, not media.) |
| 13 | **Program-director dashboard** | **IMPLEMENTED** | N/A | `[tenant]/dashboard` + `DashboardContent.tsx`: residents list, totalResidents, pendingApprovals, Program Goals (target_count/progress), duty-hour violations (resident + director), goal recalc RPC. Not a mobile tab. |

**Summary of 13 must-haves:** 6 fully shipped (2,5,6,7,9,13), 5 partial (1,3,4,10,11), **2 truly missing (8 reflective practice, 12 image upload)**.

---

## (B) Ranked — Critical Market Gaps Still Open

Ranked by market impact × confirmed open status (verified against code).

1. **🖼️ Image / Photo upload** (must-have #12) — **MISSING both platforms.** Every competitor and the ACGME case-log world allows surgical/photo evidence on a case. `case_attachments` schema + PHI audit exist but there is **zero storage wiring** (no signed-URL/bucket code). Highest-effort-high-value gap for surgical specialties.
2. **📓 Reflective-practice module** (must-have #8) — **MISSING.** Only an AI ad-hoc query. NHS/ISCP and modern portfolios treat structured reflections as core; this also blocks UK ARCP-style portfolio completeness.
3. **📊 Multi-institution de-identified benchmarking dashboard** — **MISSING UI (DB is ready).** `benchmark_data` + `benchmark_mv` (mig 00092) exist; **no admin/program-director UI consumes them.** This is the top "program directors love it" moat feature and is one of the few true differentiators.
4. **🎓 Scholarly / research tracker** — **MISSING UI (DB is ready).** `scholarly_activities` (mig 00091) exists; **no CRUD UI/route**. Required by ACGME Common Program Requirements (IRB, publications, presentations).
5. **📝 Portfolio/CV builder** — **PARTIAL.** PDF export exists but no structured CV/portfolio generator (residency application–ready). Competitors (New Innovations/ISCP) ship portfolio-complete views.
6. **🏷️ Role-based case counting surfaced as a dedicated view** — **PARTIAL.** `procedure_role` is stored but not displayed as counts (performed/assisted/supervised vs milestones) — a core surgeon/resident daily-use expectation.
7. **🛂 ITE / Board-exam tracking** — **MISSING** (no ite/usmle/board-exam hits). Elsevier/New Innovations track this; closes US GME procurement checklist.
8. **🇬🇧 UK/ISCP ARCP-readiness & curriculum tree** — **PARTIAL.** GMC framework + CanMEDS scaffolding exist; **no full ISCP procedure→curriculum mapping and no ARCP export** (`arcp` = 0). Blocks the NHS market.
9. **📗 Native Excel (.xlsx) export** — **PARTIAL** (CSV/PDF only). Low effort; buyers still ask for Excel.
10. **📱 Mobile parity gaps** — CPT/ICD `ProcedureCodePicker` is **web-only**; no CSV export or role-count on mobile; no PD dashboard tab.

---

## (C) Prioritized Upgrade Recommendations

**P0 — Ship now (blocks must-haves or the flagship moat):**
1. **Attachment/image upload** — Wire Supabase Storage with RLS per-tenant buckets, signed URLs, and per-file PHI redaction/scan (reuse the existing append-only `case_attachments` audit). Add camera/gallery attach on mobile `log-case` + `case-detail`. This is the #1 missing must-have and removes the biggest surgical-workflow objection. *(2-3 sprints.)*
2. **Reflective-practice module** — Add a `reflections` table + web & mobile entry screens (free-text + linked case + milestones) and reuse the existing AI layer for structured prompts. Cheap to ship, high portfolio/NHS value, closes must-have #8.
3. **Multi-institution benchmarking dashboard** — Build the program-director/admin UI on top of the already-present `benchmark_mv` (de-identified case volume & complexity vs peers). No schema work needed — pure front-end + RPC; immediately monetizable as a P0 differentiator.

**P1 — Close competitor-parity gaps (moderate effort, high procurement impact):**
4. **Scholarly/research tracker UI** — Expose CRUD + CSV for the existing `scholarly_activities` table (IRB/publications/presentations) with ACGME alignment. Schema is done; add routes + screens.
5. **Structured Portfolio/CV generator** — Upgrade `export-pdf` into a sectioned, residency/CV-ready PDF (logbook summary, role counts, milestone progress, evaluations, reflections). 
6. **ITE/board-exam & certification tracking** — Extend the compliance module with exam-score, license-expiry, and board-status tracking (US and SCFHS). Closes a documented competitor gap and US GME checklist item.
7. **Mobile parity pack** — Port the CPT/ICD `ProcedureCodePicker` + CSV export to mobile; add a role-count breakdown to mobile `analytics.tsx` and a lightweight PD overview screen.

**P2 — Polish & market-extend (lower urgency):**
8. **Fast-entry friction (<30s)** — Add template favorites, last-used quick default, and a true single-field quick-add that bypasses the wizard; instrument entry-time telemetry so you can *claim* <30s.
9. **Dedicated role-count view** — Surface performed/assisted/supervised vs milestone targets in both analytics dashboards using the already-captured `procedure_role`.
10. **Native Excel (.xlsx) export** — Add an xlsx generator alongside the existing CSV/PDF report routes.
11. **UK/ISCP ARCP-readiness export** — Map procedures to the ISCP curriculum tree and produce an ARCP-style readiness report (GMC scaffolding already exists) to open the NHS market.
