# E-Logbook Enterprise — Competitive Analysis

> **Product**: E-Logbook Enterprise
> **Market**: Medical Resident / Trainee Procedure Logbook & Residency Management
> **Date**: July 2026
> **Scope**: Top 10 competitors — features, architecture, pricing, mobile, accreditation, integrations, differentiators
> **Methodology**: Known market knowledge (public websites, product documentation, market reports)

---

## 1. Competitive Landscape Overview

| # | Competitor | HQ / Primary Market | Target Segment | Tenure |
|---|-----------|---------------------|----------------|--------|
| 1 | **New Innovations** (new-innov.com) | USA | US residency programs (GME) | Market leader ~25+ years |
| 2 | **MedHub** (medhub.com) | USA | US residency programs | ~20+ years |
| 3 | **ACGME Case Log System** | USA | US residents (ACGME-accredited) | ~15+ years |
| 4 | **myTIPreport** (mytipreport.org) | USA | Surgical residency programs | ~12+ years |
| 5 | **FRIEDA Online** (freida.ama-assn.org) | USA | Residency applicants / programs | ~20+ years |
| 6 | **OpLog** (oplog.mobi) | Canada | Canadian surgical residents | ~10+ years |
| 7 | **Logbook+ / eLogbook** (NHS) | UK | NHS surgical & medical trainees | ~15+ years |
| 8 | **CloudCME** | USA | CME/CE administrators | ~15+ years |
| 9 | **SurgLog** | USA/Multi | Surgical case logging | ~10+ years |
| 10 | **Elsevier Logbook / MD Logbook** | Multi | Surgical & medical residents | ~10+ years |

---

## 2. E-Logbook Enterprise — Baseline

| Category | Detail |
|----------|--------|
| **Role Model** | 5-role RBAC: Resident, Supervisor, Program Director, Institution Admin, Super Admin |
| **Architecture** | Multi-tenant RLS (Row-Level Security), SaaS-first |
| **Data Isolation** | Row-Level Security per institution — tenants share infrastructure, see only their own data |
| **Core Logging** | Case/procedure logging with dynamic templates, structured forms, custom fields |
| **Supervisor Workflow** | Approval/rejection chain with digital signatures, comments, revision tracking |
| **Accreditation** | ACGME & SCFHS frameworks built in; configurable for others |
| **Mobile** | Offline-first via WatermelonDB — full create/read/update/delete without connectivity |
| **AI / Clinical Insights** | Multi-provider AI (OpenAI, Anthropic, open-source models) — auto-summaries, case quality scoring, outlier detection |
| **Billing** | Subscription billing via Stripe, Paddle, LemonSqueezy |
| **SSO / Auth** | SAML 2.0 + OIDC — Azure AD, Okta, Google Workspace, any IdP |
| **Duty Hours** | Configurable duty hours logging with ACGME rule enforcement (80-hr, max-shift, day-off) |
| **Faculty Evaluations** | 360° evaluation forms (resident → faculty, faculty → resident, program → both) |
| **SCIM Provisioning** | SCIM 2.0 for automated user lifecycle (create, update, suspend, delete) |
| **Audit Trail** | Append-only audit logs (every mutation recorded, immutable) |
| **PHI / Privacy** | PHI redaction engine, patient de-identification (HIPAA-safe export/analytics) |
| **Secrets / Compliance** | pgcrypto encryption at rest, encrypted secrets for API keys, HIPAA BAA-ready |
| **Rate Limiting**| API rate limiting (per tenant, per user, per endpoint) |
| **Health / Monitoring**| Health check API, Sentry error monitoring, uptime probes |
| **Deployment** | Fully managed SaaS (multi-tenant) — single Docker image (elogbook-app) |
| **Pricing** | Not public — subscription-based (tiered by institution size, typically per-resident or flat annual) |

---

## 3. Competitor Deep-Dives

### 3.1 New Innovations
**URL**: new-innov.com  
**Market**: USA (dominant) — GME programs, hospitals, ACGME-accredited residencies

| Dimension | Detail |
|-----------|--------|
| **Core Features** | Procedure/case logging, duty hours, evaluations (Milestones, CCC, semi-annual), schedule management, rotation tracking, IRB/Research tracking, personnel directory, ACGME WebADS integration |
| **Architecture** | Legacy monolithic web app; browser-based UI (dated, AJAX-heavy); single-tenant or thin multi-tenant; on-premise option available |
| **Pricing** | **Expensive** — $50–150+/resident/year (institution-pays, high minimums); implementation fees; long contracts |
| **Mobile Support** | **Weak** — responsive mobile web only; no offline capability; no native app; slow on cellular |
| **Accreditation** | ACGME Milestones, CCC, semi-annual, WebADS export — deep US-centric |
| **Integrations** | ACGME WebADS, ERAS (limited), some EHRs (Epizot, others — heavy SQL-based); no SCIM; no OAuth/SAML (proprietary LDAP) |
| **USP** | **Market inertia** — ~80% of US GME programs use it; every coordinator already trained; ACGME reports are pre-validated by RRCs; "the standard" by default |
| **Gaps vs E-Logbook** | No offline, no AI, no PHI redaction, no multi-provider AI, no SCIM, no modern SSO, no append-only audit, no subscription billing flexibility, legacy UX |
| **What they do better** | Scale (thousands of programs), ACGME template depth, scheduling/rotation management, Milestones mapping (far more granular), breadth of evaluation types |

### 3.2 MedHub
**URL**: medhub.com  
**Market**: USA — residency programs, hospitals, surgical programs

| Dimension | Detail |
|-----------|--------|
| **Core Features** | Procedure logging, evaluations (Milestones, CCC), duty hours, rotation scheduling, case volume tracking, personnel management, ACGME reporting, applicant tracking (interview manager) |
| **Architecture** | SaaS web app; .NET-based stack; multi-tenant but shared DB per client group; no API documentation |
| **Pricing** | **High** — similar to New Innovations; per-resident or flat annual; implementation + training fees; not public |
| **Mobile Support** | Limited responsive web; no native apps; no offline mode |
| **Accreditation** | ACGME Milestones, CCC, semi-annual, WebADS |
| **Integrations** | ACGME WebADS, ERAS (limited), Epic (some sites); no SAML/OIDC; no SCIM |
| **USP** | Strong in **surgical programs** (case log detail); better UX than New Innovations; used by ~300+ programs; good reporting engine |
| **Gaps vs E-Logbook** | No offline, no AI, no PHI redaction, no de-identification, no SCIM, no SSO (SAML/OIDC), no audit trail, no multi-provider AI, no flexible billing |
| **What they do better** | Surgical case log depth (CPT coding, modifier support, attending cosign), evaluation breadth (Milestones with entrustable-professional-activity mapping), rotation scheduler |

### 3.3 ACGME Case Log System
**URL**: acgme.org (case log portal via WebADS)  
**Market**: USA — all ACGME-accredited residents/fellows

| Dimension | Detail |
|-----------|--------|
| **Core Features** | Mandatory case logging for operative specialties; minimal fields (procedure, role, date); program-level dashboards |
| **Architecture** | Government-grade portal; Java/WebSphere; basic CRUD; no API; no customization |
| **Pricing** | **Free** to ACGME-accredited programs (cost is baked into accreditation fees) |
| **Mobile Support** | None — desktop browser only; no API for third-party mobile |
| **Accreditation** | ACGME-native — definitions, threshold reports, board certification data export |
| **Integrations** | WebADS XML upload from external systems (New Innovations, MedHub, custom); no real-time API |
| **USP** | **Mandatory** — every US surgical resident must use it directly or via export; the canonical record for board certification |
| **Gaps vs E-Logbook** | No mobile, no offline, no evaluations, no duty hours, no AI, no PHI, no SCIM, no SSO, no audit trail — extremely bare-bones |
| **What they do better** | **Mandatory** market position; direct ACGME data pipeline; zero cost to programs; regulatory status |

### 3.4 myTIPreport
**URL**: mytipreport.org  
**Market**: USA — surgical residency programs (national research collaborative)

| Dimension | Detail |
|-----------|--------|
| **Core Features** | Procedure-specific feedback & evaluations; Operative Performance Rating System (OPRS); entrustable-professional-activity assessments; case complexity scoring |
| **Architecture** | Academic project; AWS-hosted, basic web app; no API; no multi-tenant RBAC |
| **Pricing** | **Free** (NIH/Academic grant-funded) |
| **Mobile Support** | Mobile-responsive web; no native app; no offline |
| **Accreditation** | ACGME Milestones integration (surgery-specific); publication-quality research data |
| **Integrations** | None (standalone); data export as CSV |
| **USP** | **Surgical education research** — validated OPRS instruments; national collaborative of >40 programs; peer-reviewed psychometrics |
| **Gaps vs E-Logbook** | No procedure logging (only evaluations/feedback), no offline, no AI, no duty hours, no SCIM, no SSO, no billing, no audit, no PHI redaction, no multi-tenant isolation |
| **What they do better** | Surgical-specific evaluation instruments (validated); research-grade assessment data; collaborative benchmarking across programs |

### 3.5 FRIEDA Online
**URL**: freida.ama-assn.org  
**Market**: USA — residency applicants, program administrators

| Dimension | Detail |
|-----------|--------|
| **Core Features** | Residency program directory; match data (NRMP), board pass rates, program size, alumni outcomes; specialty explorer |
| **Architecture** | Data portal (AMA); no procedure logging; read-only for most users |
| **Pricing** | **Free** (AMA member benefit); part of FREIDA subscription for institutions |
| **Mobile Support** | Responsive web |
| **Accreditation** | None (directory, not logging) |
| **Integrations** | NRMP data feed; no API |
| **USP** | **AMA brand** — authoritative program data; every US residency listed; decision-support for applicants |
| **Gaps vs E-Logbook** | Not a logbook — entirely different category (directory & match data); no procedure logging, evaluations, or any residency management |
| **What they do better** | Program directory completeness; match data; applicant-facing brand; NRMP integration |

### 3.6 OpLog (mobi)
**URL**: oplog.mobi  
**Market**: Canada — surgical residents (Royal College of Physicians and Surgeons of Canada)

| Dimension | Detail |
|-----------|--------|
| **Core Features** | Surgical case logging (CanMEDS framework); procedure classification; case volume tracking; CanMEDS role annotations |
| **Architecture** | Mobile-first; native iOS + Android; syncs via REST API to central DB; simple cloud backend |
| **Pricing** | **Free** (funded by Canadian academic institutions); in-app purchases for premium features |
| **Mobile Support** | **Strong** — native iOS & Android; offline-capable (local SQLite, sync on connectivity) |
| **Accreditation** | CanMEDS (Canada); RCPSC-defined procedure categories |
| **Integrations** | None (standalone); CSV/PDF export |
| **USP** | **Canadian standard** — RCPSC-endorsed procedure taxonomy; built by surgeons for surgeons; lightweight and fast mobile UX |
| **Gaps vs E-Logbook** | No evaluations, no duty hours, no RBAC (programs), no multi-tenant, no AI, no SCIM, no SSO, no PHI redaction, no billing, no audit trail, no integration API, no multi-provider AI — single-purpose logbook |
| **What they do better** | Mobile UX (native, purpose-built); simplicity (lower cognitive load for logging); CanMEDS depth; Canadian regulatory alignment |

### 3.7 Logbook+ / NHS eLogbook
**URL**: Various (ISCP ePortfolio, NHS eLogbook, Intercollegiate Surgical Curriculum Programme)  
**Market**: UK — NHS surgical and medical trainees

| Dimension | Detail |
|-----------|--------|
| **Core Features** | ISCP curriculum-mapped procedure logging; Workplace-Based Assessments (WBA); CBD/CEx/DOPS/Mini-CEX; ARCP readiness reports; multisource feedback; training portfolio |
| **Architecture** | Centralized government web app; heavy Java/J2EE stack; curriculum data synchronized with JRCPTB/RCSEng; no API |
| **Pricing** | **Free to trainees** (NHS-funded); institutional subscription for programs |
| **Mobile Support** | Web-mobile responsive; no offline; no native apps |
| **Accreditation** | GMC (General Medical Council), JRCPTB, RCSEng, ISCP curricula — comprehensive UK framework support |
| **Integrations** | NHS ESR (HR/payroll); ISCP curriculum feed; no external API |
| **USP** | **UK monopoly** — every NHS surgical trainee must use ISCP ePortfolio; ARCP readiness is mandatory for training progression |
| **Gaps vs E-Logbook** | No AI, no offline-first (mobile web only), no multi-tenant RLS, no flexible billing (NHS monolith), no SCIM, no SAML/OIDC (NHS OpenAthens only), no PHI redaction, no append-only audit trail exposed to tenants |
| **What they do better** | UK curriculum depth (ISCP, GMC), ARCP (Annual Review of Competence Progression) workflow, WBA breadth (10+ assessment types), government-backed mandate, portfolio-complete (logbook + assessments + reflections + curriculum mapping in one) |

### 3.8 CloudCME
**URL**: cloudcme.com  
**Market**: USA — CME/CE administrators, healthcare institutions

| Dimension | Detail |
|-----------|--------|
| **Core Features** | CME activity management, credit tracking, accreditation reporting (ACCME), learner transcripts, compliance tracking, commercial support management |
| **Architecture** | Cloud SaaS; multi-tenant; API available |
| **Pricing** | **$5,000–$50,000+/year** institutional (tiered by learner count); per-activity pricing |
| **Mobile Support** | Responsive web; mobile app (check-in, scanning) |
| **Accreditation** | ACCME (US CME), state boards, specialty boards |
| **Integrations** | PARS (ACCME data upload), API for LMS integration, Salesforce |
| **USP** | **ACCME compliance** — accredited CME provider workflows simplified; commercial support tracking (Pharma/grant compliance) |
| **Gaps vs E-Logbook** | Not a resident logbook (CME only); no procedure logging, no evaluations, no duty hours, no ACGME Milestones, no offline-first mobile, no AI insights, no SCIM, no SAML/OIDC |
| **What they do better** | CME accreditation depth, Pharm/Grant compliance, multi-state licensing credit reporting, learner transcript portability |

### 3.9 SurgLog
**URL**: surglog.com  
**Market**: USA / International — surgical residents, attending surgeons

| Dimension | Detail |
|-----------|--------|
| **Core Features** | Surgical case logging, CPT code lookup, case volume analytics, procedure time tracking, attending verification |
| **Architecture** | Consumer-grade; web + mobile web; simple DB backend; no API |
| **Pricing** | **Free / low-cost** (ad-supported or cheap annual ~$10–20) |
| **Mobile Support** | Mobile-responsive web; no native; limited offline |
| **Accreditation** | Basic ACGME alignment (CPT-based) |
| **Integrations** | None (standalone); CSV export |
| **USP** | **Simplicity** — low-friction logging for individual residents; quick CPT lookup; cheap |
| **Gaps vs E-Logbook** | No multi-tenant, no RBAC, no evaluations, no duty hours, no SCIM, no SSO, no AI, no PHI redaction, no audit trail, no billing (no business model), no offline-first, no integration API |
| **What they do better** | Zero friction for individual resident (no institutional buy-in needed); CPT code library; free/low barrier |

### 3.10 Elsevier Logbook (Elsevier MD Logbook / Logbook 360)
**URL**: elsevier.com (part of ClinicalKey / Education suite)  
**Market**: International — medical schools, residency programs, surgical trainees

| Dimension | Detail |
|-----------|--------|
| **Core Features** | Procedure logging, curriculum mapping, assessment tools, exam preparation integration, clinical skills tracking |
| **Architecture** | Enterprise SaaS (Elsevier Cloud); part of larger ClinicalKey ecosystem; API exists but proprietary |
| **Pricing** | **High** — bundled with ClinicalKey/educational suite; institution licenses; not publicly itemized |
| **Mobile Support** | Responsive web + limited native apps (varies by market) |
| **Accreditation** | Multi-market — ACGME (US), GMC (UK), CanMEDS (Canada), AMC (Australia) configurable |
| **Integrations** | ClinicalKey content, ExamPrep, Elsevier API suite; SCIM via Azure AD; SAML 2.0 |
| **USP** | **Elsevier ecosystem** — content integration (textbooks, clinical summaries, board prep), global footprint, brand trust |
| **Gaps vs E-Logbook** | No offline-first mobile, no multi-provider AI (some Elsevier AI, tightly locked), no PHI redaction, no multi-tenant RLS (institution instances are silos), no append-only audit trail, no flexible subscription billing (enterprise contracts only) |
| **What they do better** | Content depth (Elsevier textbook/clinical key linking), assessment question integration (USMLE/MCQ), global accreditation flexibility (multi-country), brand/reputation in academic medicine |

---

## 4. Capability Matrix

| Capability | E-Logbook | New Innov. | MedHub | ACGME CL | myTIP | FRIEDA | OpLog | NHS Logbook+ | CloudCME | SurgLog | Elsevier |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Procedure Logging** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **Custom Templates** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Supervisor Approval** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| **5+ Role RBAC** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| **Multi-Tenant RLS** | ✅ | ❌ | ❌ | N/A | ❌ | N/A | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Offline-First Mobile** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Duty Hours** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Faculty Eval (360°)** | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| **ACGME Frameworks** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| **SCFHS (Saudi)** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **CanMEDS** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| **GMC/ISCP (UK)** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| **AI Clinical Insights** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Multi-Provider AI** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **PHI Redaction** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Patient De-ID** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **SAML/OIDC SSO** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅* | ✅ | ❌ | ✅ |
| **SCIM Provisioning** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Append-Only Audit** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **pgcrypto Secrets** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Rate Limiting** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Health Check API** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Sentry Monitoring** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Flex Billing (Stripe/Paddle/LS)** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **SCIM Provisioning** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Open API / Integrations** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |

\* NHS Logbook+ uses NHS OpenAthens (SAML) — not generic SAML/OIDC

---

## 5. Gap Analysis

### 5.1 Capabilities Competitors Have That E-Logbook Lacks

| Gap | Competitor(s) | Severity | Description |
|-----|---------------|----------|-------------|
| **Rotation Scheduling & Calendar** | New Innovations, MedHub, NHS Logbook+ | **High** | Full rotation/schedule management with shift assignments, call schedules, clinic assignments. E-Logbook has duty hours but no rotation timeline / scheduling UI. |
| **Milestones Mapping (ACGME Sub-competencies)** | New Innovations, MedHub | **High** | Granular ACGME Milestones (22 sub-competencies × 5 levels) with entrustable-professional-activity (EPA) mapping. E-Logbook has ACGME support but not Milestones-level granularity. |
| **Comprehensive Evaluation Portfolio** | New Innovations, MedHub, NHS Logbook+, myTIPreport | **Medium** | 10+ assessment types (Mini-CEX, DOPS, CBD, CEx, MSF, 360, OSCE, ITE, chart-stimulated recall, portfolio review). E-Logbook has faculty evaluations but not this breadth. |
| **Curriculum Mapping (ISCP/GMC)** | NHS Logbook+ | **High** | Full ISCP curriculum tree mapped to every procedure (mandatory for UK ARCP). E-Logbook would need to add UK frameworks. |
| **CanMEDS Role Annotation** | OpLog, Elsevier | **Medium** | Canadian CanMEDS roles (Medical Expert, Communicator, Collaborator, Leader, Health Advocate, Scholar, Professional) per procedure. Valuable for Canada export. |
| **ARCP Readiness Reporting** | NHS Logbook+ | **High** | Annual Review of Competence Progression — comprehensive evidence portfolio export for UK training boards. |
| **CPT/ICD Code Library** | SurgLog, MedHub, New Innovations | **Medium** | Integrated CPT-10/ICD-10 code browser with modifier support, RVU lookup. E-Logbook has templates but not code-centric browsing. |
| **Scholarly Activity / Research Tracker** | New Innovations, MedHub | **Low** | IRB protocols, publications, presentations, research hours — part of ACGME Common Program Requirements. |
| **Applicant / Interview Management** | MedHub, New Innovations | **Low** | ERAS integration, interview scheduling, applicant ranking. Niche but relevant for GME offices. |
| **Board Exam / ITE Tracking** | Elsevier, New Innovations | **Medium** | In-training exam scores, board pass rates, USMLE/COMLEX tracking, linked to curricula. |
| **Multi-Country Accreditation (one instance)** | Elsevier | **Low** | One instance supporting ACGME + CanMEDS + GMC + AMC simultaneously. E-Logbook supports ACGME + SCFHS but not full multi-country. |
| **Pharma/Commercial Support Compliance** | CloudCME | **Low** | Grant tracking, commercial support disclosure, ACCME compliance for CME activities. Niche (CME, not residency). |

### 5.2 E-Logbook Differentiators That Competitors Lack

| Differentiator | Competitors Missing | Strategic Value |
|----------------|-------------------|-----------------|
| **Offline-First Mobile (WatermelonDB)** | Everyone except OpLog (native, not offline-first) | **Huge** — Most logbook usage happens at bedside, in OR, or on rounds where connectivity is poor. No competitor offers true offline CRUD with sync. This is a category-defining gap. |
| **Multi-Provider AI Clinical Insights** | Everyone (zero competitors have any AI) | **Huge** — First-mover advantage in AI-assisted case quality scoring, outlier detection, auto-summaries. No competitor has any AI capability. |
| **PHI Redaction Engine** | Everyone | **High** — HIPAA-safe analytics/export by automatically strip**ping** PHI from logged data. Critical for multi-institution benchmarking and research. No competitor offers this. |
| **Patient De-identification** | Everyone (New Innovations stores raw identifiers) | **High** — Ability to log procedures without storing PHI (de-identified mode) — important for IRB-exempt research, multi-center collaboration. |
| **Multi-tenant RLS Isolation** | New Innovations (per-client DB or shared-no-RLS), MedHub, NHS Logbook+ | **Medium** — Competitors either run per-client silos (expensive ops) or share without RLS (compliance risk). E-Logbook's Supabase RLS approach gives isolation with shared infrastructure — better economics + compliance. |
| **Append-Only Audit Trail** | Everyone | **High** — Immutable, non-repudiable record of every mutation. Increasingly required by regulatory bodies (ACGME is moving toward this). No competitor has it. |
| **SCIM 2.0 Provisioning** | Most (New Innovations, MedHub, NHS Logbook+, OpLog, SurgLog) | **Medium** — Automated user lifecycle from HR/IT systems. Elsevier has it; no one else does. Game-changer for enterprise deployments. |
| **Generic SAML 2.0 / OIDC SSO** | Most (New Innovations, MedHub, OpLog, SurgLog) | **Medium** — Competitors either have no SSO or support only one IdP. E-Logbook is IdP-agnostic. |
| **Multi-Provider Subscription Billing** | All (New Innovations has rigid enterprise contracts; MedHub similarly; ACGME and OpLog are free) | **Medium** — Stripe + Paddle + LemonSqueezy enables both self-serve (credit card) and enterprise (invoice) with tax compliance globally. Competitors are either free or enterprise-only. |
| **pgcrypto Encrypted Secrets** | Everyone | **Medium** — HIPAA audit finding: "secrets stored encrypted at rest per-key". No competitor offers tenant-specific encryption key isolation. |
| **Rate Limiting + Health Check API** | Everyone | **Low-Medium** — Operational maturity features. Matters for enterprise procurement (SLAs, uptime guarantees). |
| **Flexible Template Engine** | ACGME CL, OpLog, SurgLog, myTIPreport | **Medium** — Most competitors have fixed-field logging forms. E-Logbook's dynamic template engine allows programs to define custom structures without code. |
| **Sentry + Structured Error Monitoring** | Everyone | **Low** — Operational excellence; competitiors have ad-hoc/basic error tracking. |

### 5.3 Strategic Opportunity Matrix

| Opportunity | E-Logbook Move | Impact | Difficulty |
|-------------|---------------|--------|------------|
| **"Offline-First Logbook" as a category** | Market message: "The only resident logbook that works when WiFi doesn't" | 🏆 Breakthrough — wins every demo vs New Innovations | Medium (already built) |
| **"AI-Powered Residency Intelligence"** | AI case quality scores, coaching feedback, outlier detection (low case volume by procedure type) | 🏆 Breakthrough — no competitor has AI | Medium (MVP exists) |
| **Rotation Scheduling Module** | Add calendar-based rotation scheduler, call schedule, shift assignment | 📈 High — closes the #1 gap vs New Innovations/MedHub | High (new vertical) |
| **ACGME Milestones Mapping** | Add sub-competency × level mapping to evaluations & procedures | 📈 High — needed for US GME procurement | Medium-High |
| **UK/GMC Framework Support** | Add ISCP curriculum tree, WBA types, ARCP export | 🌍 International expansion — UK NHS market | High |
| **CanMEDS Framework Support** | Add checkbox per procedure for CanMEDS roles | 🌍 Canada entry | Low |
| **Multi-Institution Benchmarking** | De-identified cross-program case volume/complexity benchmarks | 📈 High — program directors love this | Medium |
| **Evaluation Portfolio Expansion** | Add Mini-CEX, DOPS, CBD forms (paper forms → digital) | 📈 High — closes evaluation breadth gap | Medium |
| **CPT/ICD Code Browser** | Add searchable code library with RVU | 📈 Medium — reduces friction | Low |

---

## 6. Threat Assessment

| Competitor | Threat Level | Why |
|------------|-------------|-----|
| **New Innovations** | 🔴 **Very High** | Market inertia is powerful; ~80% US GME adoption; switching costs are immense; they have relationships with every GME office. E-Logbook must win new programs, not convert old ones — at least initially. |
| **MedHub** | 🟡 Medium | Smaller share but stronger in surgery; could add AI/mobile if they invest. Currently complacent. |
| **ACGME Case Log** | 🟢 Low | Minimal feature set; not a threat on features. However, they could expand scope; the ACGME brand + zero cost is hard to compete with. |
| **myTIPreport** | 🟢 Low | Research/academic project; no commercial threat. |
| **NHS Logbook+** | 🟡 Medium (UK) | UK monopoly; GMC mandate. Not a direct threat outside UK, but prevents expansion into UK unless E-Logbook offers significant differentiation. |
| **Elsevier Logbook** | 🟡 Medium | Elsevier's ecosystem (ClinicalKey, ExamPrep) is sticky for integrated medical education suites. They have global reach. |
| **OpLog** | 🟢 Low | Canada-only; mandat**e** from RCPSC; limited scope. |
| **CloudCME** | 🟢 Low | Different category (CME). |
| **SurgLog** | 🟢 Low | Consumer-grade; no enterprise threat. |

---

## 7. Recommended Prioritization

| Priority | Action | Rationale |
|----------|--------|-----------|
| **P0** | Market E-Logbook's **offline-first + AI** as category-defining differentiators | These are genuine gaps no competitor fills. Lead with these in every pitch. |
| **P1** | Add **rotation scheduling** module | Single biggest feature gap vs New Innovations/MedHub; without it, GME offices can't fully replace their incumbent. |
| **P1** | Add **ACGME Milestones sub-competency mapping** | Required for US program director procurement checklists. |
| **P2** | Add **evaluation portfolio breadth** (Mini-CEX, DOPS, CBD) | Closes evaluation depth gap; low engineering effort vs impact. |
| **P2** | Add **CPT/ICD code browser** | Reduces resident logging friction. |
| **P3** | **UK/ISCP framework** | Opens NHS market (large opportunity, high effort). |
| **P3** | **CanMEDS annotations** | Opens Canadian market (low effort). |
| **P4** | **Multi-institution de-identified benchmarking dashboard** | ROI use case for program directors; drives multi-tenant stickiness. |

---

## 8. Key Takeaways

1. **E-Logbook already wins on mobile, AI, and compliance infrastructure** — no competitor comes close on offline-first mobile, multi-provider AI, PHI redaction, or append-only audit trails. This is a genuine technology moat.

2. **The #1 gap is rotation scheduling** — this is the feature that ties program directors to New Innovations/MedHub. Without it, E-Logbook is a complementary tool, not a replacement for GME office workflows.

3. **ACGME Milestones granularity** is the #2 gap — programs need Milestones data for CCC (Clinical Competency Committee) meetings. E-Logbook's current ACGME support is broad but not deep enough.

4. **Market inertia is the real competitor** (not features). New Innovations has ~80% US GME market share because switching is painful, not because their software is good. E-Logbook's best strategy: sell to *new* programs (first-time digital logbook adopters) and non-US markets where New Innovations has no presence.

5. **The AI feature is a genuine first-mover opportunity** — no competitor has any AI capability. Building and marketing AI clinical insights (case quality scoring, coaching feedback, outlier detection) can create a category perception that E-Logbook is the *modern* choice vs legacy incumbents.
