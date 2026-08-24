# E-Logbook MVP Improvement Design

**Date:** 2026-08-18
**Status:** Approved
**Scope:** Full MVP (4-6 weeks)

## Executive Summary

This document defines the MVP improvement plan for the E-Logbook Enterprise system. The goal is to transform the current prototype into a production-ready MVP by improving three core workflows: resident case logging, supervisor review, and admin management.

## Current State Audit

### What Exists (Functional)
- 5 user roles with role-based navigation
- 4-step case creation wizard (Template → Patient → Details → Review)
- Case lifecycle: draft → pending → approved/rejected
- Dashboard with KPI rings and recent cases
- Goals tracking with progress bars
- Milestone competency matrix with EPA mappings
- Faculty evaluation (3-domain rating)
- Duty hours tracking
- Admin panel (templates, users, payment, accreditation, webhooks, SSO, SCIM, retention)
- Audit trail with suspicious activity detection
- Compliance reporting (HIPAA/GDPR/SCFHS)
- Billing with subscription management
- Reports with PDF/CSV export
- Analytics with supervisor workload
- Responsive design with mobile nav

### What's Broken
1. **RLS blocks case submission** — `WITH CHECK (status = 'draft')` prevents status changes
2. **Cookie name mismatch** — Login API sets wrong cookie format for `@supabase/ssr`
3. **Global templates invisible** — RLS only allows tenant-specific templates
4. **Approvals badge hardcoded** — Sidebar shows "3" instead of real count
5. **No `.env.local` in app directory** — Next.js can't load env vars

### What's Missing
- No bulk operations (CSV import exists but is unwired)
- No profile editing (read-only settings)
- No notification system
- No goal editing/deletion
- No case preview in approvals
- No quick-add from dashboard
- No password change option
- SSO/SCIM tabs commented out

---

## Design: Pillar 1 — Resident Experience (Fast Case Logging)

### 1.1 Quick-Add Case Button

**Purpose:** Allow residents to log a case in under 30 seconds without the full wizard.

**UI:**
- Floating action button (FAB) in bottom-right corner on Dashboard and Cases pages
- Opens a slide-over panel from the right side
- Contains: Template selector (dropdown), MRN, DOB/Age, Case Date, Key Fields (dynamic from template)
- "Save & New" button to quickly log another case
- "Save & Close" button to return to list

**Data Flow:**
```
FAB Click → Slide-over panel → Template selector → Dynamic fields → Submit → POST /api/cases → Refresh list
```

**Components:**
- `QuickAddCase.tsx` — Slide-over panel component
- `QuickAddFAB.tsx` — Floating action button
- Updates `cases/page.tsx` and `dashboard/page.tsx` to include FAB

### 1.2 Recent Cases Row

**Purpose:** One-tap duplication of recent cases.

**UI:**
- Horizontal scrollable row on Dashboard below KPI rings
- Each card shows: Template name, date, status badge, "Duplicate" button
- Shows last 5 cases sorted by date

**Data Flow:**
```
Dashboard load → Fetch last 5 cases → Render horizontal scroll → Duplicate button → Redirect to /cases/new?duplicateFrom=ID
```

### 1.3 Template Favorites

**Purpose:** Pin frequently used templates to top of list.

**UI:**
- Star icon on each template card in wizard and quick-add
- Favorited templates shown first with "★ Favorites" section header
- Stored in `user_metadata.favorites` array

**Data Flow:**
```
Toggle star → Update user_metadata → Refresh template list → Favorites sorted first
```

### 1.4 Wire CSV Import

**Purpose:** Enable bulk case creation from spreadsheet.

**UI:**
- "Import CSV" button on Cases page (next to "Log New Case")
- Opens existing `CaseImport` modal component
- Drag-and-drop file upload
- Preview table of first 10 rows
- "Import" button with progress indicator

### 1.5 Profile Editing

**Purpose:** Allow residents to update their profile.

**UI:**
- Settings page → Profile section → "Edit" button
- Modal with: Full name, Specialty (dropdown), Email (read-only)
- "Save" button with validation

### 1.6 Password Change

**Purpose:** Security self-service.

**UI:**
- Settings page → Security section → "Change Password" button
- Modal with: Current password, New password, Confirm password
- Zod validation (min 8 chars, uppercase, number, special char)

---

## Design: Pillar 2 — Supervisor Experience (Review Flow)

### 2.1 Dynamic Approvals Badge

**Purpose:** Show real pending count in sidebar.

**Implementation:**
- Pass `pendingApprovals` count from `get_dashboard_data` to `Sidebar` component
- Remove hardcoded "3" badge
- Badge shows actual count, hidden when 0

### 2.2 Case Preview Modal

**Purpose:** Review case details without leaving approvals page.

**UI:**
- Click case card → Slide-over panel from right
- Shows: All case fields, PHI (if authorized), approval history
- Approve/Reject buttons at bottom
- Comment textarea

### 2.3 Bulk Approve/Reject

**Purpose:** Process multiple cases at once.

**UI:**
- Checkbox on each case card
- "Select All" toggle in header
- "Approve Selected" / "Reject Selected" buttons (appear when selections > 0)
- Confirmation dialog for reject

**Data Flow:**
```
Select cases → Click "Approve Selected" → Loop POST /api/cases/{id}/approve → Refresh list
```

### 2.4 Filter by Resident/Specialty

**Purpose:** Narrow down cases to review.

**UI:**
- Dropdown filters above case list
- Resident filter (multi-select)
- Specialty filter (multi-select)
- Clear filters button

### 2.5 Approval Comment Templates

**Purpose:** Speed up feedback.

**UI:**
- Pre-defined comment chips below textarea
- "Good documentation", "Needs more detail", "Missing complications", "Excellent technique"
- Click chip → inserts into textarea

---

## Design: Pillar 3 — Admin Experience (Management)

### 3.1 User Management

**Purpose:** Full user administration.

**UI:**
- Admin → Users tab (wire existing `UserManager` component)
- Table: Name, Email, Role, Status, Last Active, Actions
- Actions: Edit role, Deactivate, Invite new user
- Invite modal: Email, Role, Specialty

### 3.2 Template Management

**Purpose:** Create and edit case templates.

**UI:**
- Admin → Templates tab (wire existing `TemplateEditor` component)
- List of templates with: Name, Specialty, Field count, Usage count
- "New Template" button → Template builder with drag-and-drop fields
- Field types: Text, Select, Textarea, Date, Number, Checkbox

### 3.3 Specialty Settings

**Purpose:** Manage medical specialties.

**UI:**
- Admin → Settings → Specialties tab
- List of specialties with: Name, Template count, Resident count
- "Add Specialty" button
- Edit/Delete actions

### 3.4 Bulk Goal Creation

**Purpose:** Assign goals to multiple residents at once.

**UI:**
- Goals page → "New Goal" → "Assign to multiple residents" checkbox
- Resident multi-select dropdown
- Same goal applied to all selected residents

### 3.5 Goal Editing/Deletion

**Purpose:** Modify existing goals.

**UI:**
- Goal card → "Edit" button → Modal with pre-filled fields
- Goal card → "Delete" button → Confirmation dialog
- Progress auto-recalculated on target change

### 3.6 Resident Management

**Purpose:** View and manage all residents.

**UI:**
- Admin → Residents tab (new)
- Table: Name, Specialty, Cases count, Last active, Supervisor, Status
- Actions: View profile, Assign supervisor, Deactivate

---

## Design: Cross-Cutting Improvements

### Database Fixes
1. **RLS Migration** — Apply case submission fix (`WITH CHECK (status IN ('draft', 'pending'))`)
2. **Global Templates** — Allow residents to see global templates
3. **Cookie Format** — Fix login API to use `sb-<project-ref>-auth-token`

### UI Fixes
1. **Approvals Badge** — Dynamic count from database
2. **Settings Profile Editing** — Add edit functionality
3. **Password Change** — Add security self-service

### New Components
- `QuickAddCase.tsx` — Slide-over quick-add panel
- `QuickAddFAB.tsx` — Floating action button
- `CasePreviewModal.tsx` — Slide-over case preview
- `BulkActions.tsx` — Bulk approve/reject with checkboxes
- `FilterDropdown.tsx` — Reusable filter component
- `CommentChips.tsx` — Pre-defined comment templates

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- Apply all database fixes (RLS, cookies, templates)
- Fix approvals badge
- Wire existing unwired components (CaseImport, UserManager, TemplateEditor)
- Profile editing in Settings
- Password change in Settings

### Phase 2: Resident Experience (Week 2-3)
- Quick-Add Case button and slide-over
- Recent Cases row on Dashboard
- Template favorites
- Quick-Repeat button on Dashboard

### Phase 3: Supervisor Experience (Week 3-4)
- Case Preview Modal in approvals
- Bulk approve/reject
- Filter by resident/specialty
- Approval comment templates

### Phase 4: Admin Experience (Week 4-5)
- User management (invite, edit role, deactivate)
- Template management (create, edit, delete)
- Specialty settings
- Bulk goal creation
- Goal editing/deletion
- Resident management view

### Phase 5: Polish (Week 5-6)
- Keyboard shortcuts
- Dark mode in Settings
- Mobile responsive testing
- Performance optimization
- E2E test coverage

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Time to log a case | ~2 minutes | < 30 seconds |
| Time to approve a case | ~3 minutes | < 1 minute |
| Bulk operations | 0 | 3 (import, approve, goal) |
| Profile editing | Read-only | Full edit |
| User management | Basic | Full CRUD |
| Template management | Basic | Full CRUD with field builder |
