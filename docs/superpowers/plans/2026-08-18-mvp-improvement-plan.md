# E-Logbook MVP Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the e-logbook prototype into a production-ready MVP with fast case logging, efficient supervisor review, and full admin management.

**Architecture:** Add new components to existing Next.js App Router structure. Use existing Supabase client patterns. Follow established Tailwind CSS + Framer Motion UI patterns. Maintain RLS security model.

**Tech Stack:** Next.js 16, React 19, Supabase (PostgREST + GoTrue), Tailwind CSS 4, Framer Motion, Zod, TypeScript strict

---

## Phase 1: Foundation Fixes (Week 1-2)

### Task 1: Apply RLS Migration Fix

**Files:**
- Modify: `supabase/migrations/20260818100000_fix_rls_case_submission_and_templates.sql` (already created)

- [ ] **Step 1: Verify migration file exists**

```bash
ls -la supabase/migrations/20260818100000_fix_rls_case_submission_and_templates.sql
```

- [ ] **Step 2: Reset database to apply migration**

```bash
supabase db reset
```

Expected: Migration applies successfully, no errors

- [ ] **Step 3: Verify RLS fix by testing case submission**

```bash
node -e "
const URL = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';
async function test() {
  const login = await fetch(URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'resident@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();
  
  // Create a case
  const create = await fetch(URL + '/rest/v1/case_entries', {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + access_token, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({ template_id: '00000000-0000-0000-0000-000000000010', patient_mrn: 'TEST-001', patient_dob: '1990-01-01', case_date: new Date().toISOString().split('T')[0], field_values: '{}', status: 'draft' })
  });
  const caseData = await create.json();
  
  // Submit the case
  const submit = await fetch(URL + '/rest/v1/case_entries?id=eq.' + caseData[0].id, {
    method: 'PATCH',
    headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'pending' })
  });
  
  console.log('Submit status:', submit.status);
  console.log('Test PASSED:', submit.status === 200);
}
test();
"
```

Expected: Submit status 200, Test PASSED: true

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260818100000_fix_rls_case_submission_and_templates.sql
git commit -m "fix: RLS policies for case submission and global templates"
```

---

### Task 2: Fix Login Cookie Format

**Files:**
- Modify: `apps/web/app/api/auth/login/route.ts` (already updated)

- [ ] **Step 1: Verify login API works with correct cookie format**

```bash
node -e "
fetch('http://localhost:3000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:3000' },
  body: JSON.stringify({ email: 'resident@demo.com', password: 'password123!' })
}).then(r => r.json()).then(d => {
  console.log('Login OK:', d.redirectUrl === '/demo/dashboard');
  console.log('Redirect URL:', d.redirectUrl);
});
"
```

Expected: Login OK: true, Redirect URL: /demo/dashboard

- [ ] **Step 2: Verify cookie is set correctly**

```bash
node -e "
fetch('http://localhost:3000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:3000' },
  body: JSON.stringify({ email: 'resident@demo.com', password: 'password123!' })
}).then(r => {
  const cookies = r.headers.get('set-cookie');
  console.log('Cookie contains sb-:', cookies.includes('sb-'));
  console.log('Cookie contains auth-token:', cookies.includes('auth-token'));
});
"
```

Expected: Both true

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/auth/login/route.ts
git commit -m "fix: login API cookie format for @supabase/ssr compatibility"
```

---

### Task 3: Fix Approvals Badge

**Files:**
- Modify: `apps/web/components/Sidebar.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/layout.tsx`

- [ ] **Step 1: Read current Sidebar.tsx to find hardcoded badge**

```bash
grep -n "badge.*3\|pending.*3" apps/web/components/Sidebar.tsx
```

- [ ] **Step 2: Update layout.tsx to pass pending count to Sidebar**

Find the Sidebar rendering in layout.tsx and add `pendingCount` prop:

```tsx
// In layout.tsx, find where Sidebar is rendered and add:
<Sidebar pendingCount={pendingApprovals} />
```

- [ ] **Step 3: Update Sidebar.tsx to accept and use pendingCount prop**

```tsx
// Update SidebarProps interface:
interface SidebarProps {
  pendingCount?: number;
}

// Replace hardcoded badge with dynamic count:
{pendingCount && pendingCount > 0 && (
  <span className="ml-auto bg-danger text-white text-xs rounded-full px-1.5 py-0.5">
    {pendingCount}
  </span>
)}
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```

Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/Sidebar.tsx apps/web/app/\(authenticated\)/\[tenant\]/layout.tsx
git commit -m "fix: dynamic approvals badge count in sidebar"
```

---

### Task 4: Add Profile Editing to Settings

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/settings/page.tsx`
- Create: `apps/web/components/ProfileEditForm.tsx`

- [ ] **Step 1: Create ProfileEditForm component**

```tsx
// apps/web/components/ProfileEditForm.tsx
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface ProfileEditFormProps {
  profile: {
    full_name: string;
    specialty: string;
  };
  onSave: () => void;
}

export default function ProfileEditForm({ profile, onSave }: ProfileEditFormProps) {
  const [fullName, setFullName] = useState(profile.full_name || '');
  const [specialty, setSpecialty] = useState(profile.specialty || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ full_name: fullName, specialty })
      .eq('user_id', (await supabase.auth.getUser()).data.user?.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      onSave();
    }
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">Full Name</label>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">Specialty</label>
        <select
          value={specialty}
          onChange={(e) => setSpecialty(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary"
        >
          <option value="">Select specialty</option>
          <option value="surgery">Surgery</option>
          <option value="internal_medicine">Internal Medicine</option>
          <option value="pediatrics">Pediatrics</option>
          <option value="orthopedics">Orthopedics</option>
          <option value="radiology">Radiology</option>
          <option value="emergency_medicine">Emergency Medicine</option>
          <option value="family_medicine">Family Medicine</option>
          <option value="other">Other</option>
        </select>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 rounded-lg bg-primary text-white font-medium hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Update settings/page.tsx to include edit form**

Add state for editing and render ProfileEditForm when in edit mode.

- [ ] **Step 3: Test in browser**

Navigate to Settings → Click Edit → Change name → Save → Verify update

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/ProfileEditForm.tsx apps/web/app/\(authenticated\)/\[tenant\]/settings/page.tsx
git commit -m "feat: profile editing in settings page"
```

---

### Task 5: Add Password Change to Settings

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/settings/page.tsx`
- Create: `apps/web/components/PasswordChangeForm.tsx`

- [ ] **Step 1: Create PasswordChangeForm component**

```tsx
// apps/web/components/PasswordChangeForm.tsx
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { z } from 'zod';

const passwordSchema = z.object({
  newPassword: z.string().min(8).regex(/[A-Z]/, 'Must contain uppercase').regex(/[0-9]/, 'Must contain number').regex(/[^A-Za-z0-9]/, 'Must contain special character'),
  confirmPassword: z.string(),
}).refine(data => data.newPassword === data.confirmPassword, { message: 'Passwords do not match' });

export default function PasswordChangeForm() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess(false);

    const validation = passwordSchema.safeParse({ newPassword, confirmPassword });
    if (!validation.success) {
      setError(validation.error.errors[0].message);
      setSaving(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

    if (updateError) {
      setError(updateError.message);
    } else {
      setSuccess(true);
      setNewPassword('');
      setConfirmPassword('');
    }
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">New Password</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">Confirm Password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary"
          required
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {success && <p className="text-sm text-success">Password updated successfully</p>}
      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 rounded-lg bg-primary text-white font-medium hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Updating...' : 'Change Password'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Update settings/page.tsx to include password form**

- [ ] **Step 3: Test in browser**

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/PasswordChangeForm.tsx apps/web/app/\(authenticated\)/\[tenant\]/settings/page.tsx
git commit -m "feat: password change in settings page"
```

---

## Phase 2: Resident Experience (Week 2-3)

### Task 6: Quick-Add Case FAB and Slide-Over

**Files:**
- Create: `apps/web/components/QuickAddCase.tsx`
- Create: `apps/web/components/QuickAddFAB.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/cases/page.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx`

- [ ] **Step 1: Create QuickAddFAB component**

```tsx
// apps/web/components/QuickAddFAB.tsx
'use client';

interface QuickAddFABProps {
  onClick: () => void;
}

export default function QuickAddFAB({ onClick }: QuickAddFABProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-primary text-white shadow-lg hover:shadow-xl transition-all flex items-center justify-center z-50"
      aria-label="Quick add case"
    >
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
    </button>
  );
}
```

- [ ] **Step 2: Create QuickAddCase slide-over component**

```tsx
// apps/web/components/QuickAddCase.tsx
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';

interface QuickAddCaseProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function QuickAddCase({ isOpen, onClose, onSaved }: QuickAddCaseProps) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [mrn, setMrn] = useState('');
  const [dob, setDob] = useState('');
  const [caseDate, setCaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if (isOpen) {
      supabase.from('case_templates').select('*').then(({ data }) => setTemplates(data || []));
    }
  }, [isOpen]);

  const template = templates.find(t => t.id === selectedTemplate);
  const fields = template?.fields ? (typeof template.fields === 'string' ? JSON.parse(template.fields) : template.fields) : [];

  const handleSave = async (andNew: boolean) => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from('profiles').select('id, tenant_id').eq('user_id', user?.id).single();

    const { error } = await supabase.from('case_entries').insert({
      template_id: selectedTemplate,
      tenant_id: profile?.tenant_id,
      resident_id: profile?.id,
      patient_mrn: mrn,
      patient_dob: dob,
      case_date: caseDate,
      field_values: JSON.stringify(fieldValues),
      status: 'draft',
    });

    if (!error) {
      onSaved();
      if (andNew) {
        setMrn('');
        setDob('');
        setFieldValues({});
      } else {
        onClose();
      }
    }
    setSaving(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-surface border-l border-border z-50 overflow-y-auto"
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-text-primary">Quick Add Case</h2>
                <button onClick={onClose} className="text-text-muted hover:text-text-primary">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">Template</label>
                  <select
                    value={selectedTemplate}
                    onChange={(e) => setSelectedTemplate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary"
                  >
                    <option value="">Select template</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">MRN</label>
                  <input
                    type="text"
                    value={mrn}
                    onChange={(e) => setMrn(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary"
                    placeholder="Patient MRN"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">Date of Birth</label>
                  <input
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">Case Date</label>
                  <input
                    type="date"
                    value={caseDate}
                    onChange={(e) => setCaseDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary"
                  />
                </div>

                {fields.map((field: any) => (
                  <div key={field.key}>
                    <label className="block text-sm font-medium text-text-primary mb-1">{field.label}</label>
                    {field.type === 'select' ? (
                      <select
                        value={fieldValues[field.key] || ''}
                        onChange={(e) => setFieldValues({ ...fieldValues, [field.key]: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary"
                      >
                        <option value="">Select</option>
                        {field.options?.map((opt: string) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : field.type === 'textarea' ? (
                      <textarea
                        value={fieldValues[field.key] || ''}
                        onChange={(e) => setFieldValues({ ...fieldValues, [field.key]: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary"
                        rows={3}
                      />
                    ) : (
                      <input
                        type={field.type === 'number' ? 'number' : 'text'}
                        value={fieldValues[field.key] || ''}
                        onChange={(e) => setFieldValues({ ...fieldValues, [field.key]: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary"
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => handleSave(false)}
                  disabled={saving || !selectedTemplate}
                  className="flex-1 py-2.5 rounded-lg bg-primary text-white font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save & Close'}
                </button>
                <button
                  onClick={() => handleSave(true)}
                  disabled={saving || !selectedTemplate}
                  className="flex-1 py-2.5 rounded-lg bg-surface border border-border text-text-primary font-medium hover:bg-surface-hover disabled:opacity-50"
                >
                  Save & New
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 3: Add FAB to cases/page.tsx**

```tsx
// In cases/page.tsx, add state and render:
const [quickAddOpen, setQuickAddOpen] = useState(false);

// Add FAB before closing tag:
<QuickAddFAB onClick={() => setQuickAddOpen(true)} />
<QuickAddCase isOpen={quickAddOpen} onClose={() => setQuickAddOpen(false)} onSaved={() => router.refresh()} />
```

- [ ] **Step 4: Add FAB to dashboard/page.tsx**

- [ ] **Step 5: Test in browser**

Click FAB → Fill form → Save → Verify case created

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/QuickAddCase.tsx apps/web/components/QuickAddFAB.tsx
git add apps/web/app/\(authenticated\)/\[tenant\]/cases/page.tsx apps/web/app/\(authenticated\)/\[tenant\]/dashboard/page.tsx
git commit -m "feat: quick-add case FAB with slide-over panel"
```

---

### Task 7: Recent Cases Row on Dashboard

**Files:**
- Modify: `apps/web/components/DashboardContent.tsx`

- [ ] **Step 1: Add horizontal scrollable recent cases row**

After the KPI rings section, add:

```tsx
{/* Recent Cases Row */}
<div className="mt-6">
  <h3 className="text-sm font-medium text-text-muted mb-3">Recent Cases</h3>
  <div className="flex gap-3 overflow-x-auto pb-2">
    {recentCases?.slice(0, 5).map((c: any) => (
      <div key={c.id} className="flex-shrink-0 w-48 p-3 rounded-xl border border-border bg-surface">
        <p className="text-sm font-medium text-text-primary truncate">{c.case_templates?.name || 'Case'}</p>
        <p className="text-xs text-text-muted mt-1">{new Date(c.case_date).toLocaleDateString()}</p>
        <div className="flex items-center justify-between mt-2">
          <StatusBadge status={c.status} />
          <button
            onClick={() => router.push(`/cases/new?duplicateFrom=${c.id}`)}
            className="text-xs text-primary hover:opacity-80"
          >
            Duplicate
          </button>
        </div>
      </div>
    ))}
  </div>
</div>
```

- [ ] **Step 2: Test in browser**

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/DashboardContent.tsx
git commit -m "feat: recent cases horizontal scroll row on dashboard"
```

---

## Phase 3: Supervisor Experience (Week 3-4)

### Task 8: Case Preview Modal in Approvals

**Files:**
- Create: `apps/web/components/CasePreviewModal.tsx`
- Modify: `apps/web/components/approvals/ApprovalsDashboard.tsx`

- [ ] **Step 1: Create CasePreviewModal component**

```tsx
// apps/web/components/CasePreviewModal.tsx
'use client';

import { motion, AnimatePresence } from 'framer-motion';
import StatusBadge from '@/components/StatusBadge';

interface CasePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  caseData: any;
  onApprove: () => void;
  onReject: (comment: string) => void;
}

export default function CasePreviewModal({ isOpen, onClose, caseData, onApprove, onReject }: CasePreviewModalProps) {
  const [comment, setComment] = useState('');

  if (!caseData) return null;

  const fields = caseData.field_values ? JSON.parse(caseData.field_values) : {};

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 h-full w-full max-w-lg bg-surface border-l border-border z-50 overflow-y-auto"
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-text-primary">Case Details</h2>
                <button onClick={onClose} className="text-text-muted hover:text-text-primary">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <StatusBadge status={caseData.status} />
                  <span className="text-sm text-text-muted">{caseData.case_templates?.specialty}</span>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-text-muted">Template</h3>
                  <p className="text-text-primary">{caseData.case_templates?.name}</p>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-text-muted">Patient</h3>
                  <p className="text-text-primary">MRN: {caseData.patient_mrn}</p>
                  <p className="text-text-primary">DOB: {new Date(caseData.patient_dob).toLocaleDateString()}</p>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-text-muted">Case Date</h3>
                  <p className="text-text-primary">{new Date(caseData.case_date).toLocaleDateString()}</p>
                </div>

                {Object.entries(fields).map(([key, value]) => (
                  <div key={key}>
                    <h3 className="text-sm font-medium text-text-muted capitalize">{key.replace(/_/g, ' ')}</h3>
                    <p className="text-text-primary">{String(value)}</p>
                  </div>
                ))}
              </div>

              <div className="mt-6 space-y-3">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a comment (optional for approve, recommended for reject)"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary"
                  rows={3}
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => { onApprove(); onClose(); }}
                    className="flex-1 py-2.5 rounded-lg bg-success text-white font-medium hover:opacity-90"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => { onReject(comment); onClose(); }}
                    className="flex-1 py-2.5 rounded-lg bg-danger text-white font-medium hover:opacity-90"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Add "View" button to approval cards that opens preview modal**

- [ ] **Step 3: Test in browser**

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/CasePreviewModal.tsx apps/web/components/approvals/ApprovalsDashboard.tsx
git commit -m "feat: case preview modal in approvals dashboard"
```

---

### Task 9: Bulk Approve/Reject

**Files:**
- Modify: `apps/web/components/approvals/ApprovalsDashboard.tsx`

- [ ] **Step 1: Add checkbox state and bulk action buttons**

Add `selectedIds` state and render checkboxes on each card. Add "Approve Selected" / "Reject Selected" buttons in header.

- [ ] **Step 2: Implement bulk action handlers**

```tsx
const handleBulkApprove = async () => {
  for (const id of selectedIds) {
    await fetch(`/api/cases/${id}/approve`, { method: 'POST' });
  }
  setSelectedIds([]);
  refreshData();
};
```

- [ ] **Step 3: Test in browser**

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/approvals/ApprovalsDashboard.tsx
git commit -m "feat: bulk approve/reject in approvals dashboard"
```

---

## Phase 4: Admin Experience (Week 4-5)

### Task 10: Wire User Management

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/admin/page.tsx`

- [ ] **Step 1: Verify UserManager component exists**

```bash
ls -la apps/web/components/admin/UserManager.tsx
```

- [ ] **Step 2: Uncomment and wire UserManager in admin page**

- [ ] **Step 3: Test in browser**

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(authenticated\)/\[tenant\]/admin/page.tsx
git commit -m "feat: wire user management in admin panel"
```

---

### Task 11: Wire Template Management

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/admin/page.tsx`

- [ ] **Step 1: Verify TemplateEditor component exists**

- [ ] **Step 2: Wire TemplateEditor in admin page**

- [ ] **Step 3: Test in browser**

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(authenticated\)/\[tenant\]/admin/page.tsx
git commit -m "feat: wire template management in admin panel"
```

---

### Task 12: Goal Editing/Deletion

**Files:**
- Modify: `apps/web/components/GoalForm.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/goals/page.tsx`

- [ ] **Step 1: Add edit/delete buttons to goal cards**

- [ ] **Step 2: Create edit modal with pre-filled fields**

- [ ] **Step 3: Add delete confirmation dialog**

- [ ] **Step 4: Test in browser**

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/GoalForm.tsx apps/web/app/\(authenticated\)/\[tenant\]/goals/page.tsx
git commit -m "feat: goal editing and deletion"
```

---

## Phase 5: Polish (Week 5-6)

### Task 13: Keyboard Shortcuts

**Files:**
- Create: `apps/web/lib/keyboard-shortcuts.ts`
- Modify: `apps/web/app/layout.tsx`

- [ ] **Step 1: Create keyboard shortcuts hook**

```tsx
// apps/web/lib/keyboard-shortcuts.ts
'use client';

import { useEffect } from 'react';

export function useKeyboardShortcuts(shortcuts: Record<string, () => void>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = [];
      if (e.ctrlKey || e.metaKey) key.push('Ctrl');
      if (e.shiftKey) key.push('Shift');
      if (e.altKey) key.push('Alt');
      key.push(e.key);
      
      const combo = key.join('+');
      if (shortcuts[combo]) {
        e.preventDefault();
        shortcuts[combo]();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts]);
}
```

- [ ] **Step 2: Add shortcuts to main layout**

- [ ] **Step 3: Test shortcuts**

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/keyboard-shortcuts.ts apps/web/app/layout.tsx
git commit -m "feat: keyboard shortcuts for common actions"
```

---

### Task 14: Mobile Responsive Testing

- [ ] **Step 1: Test all new components on mobile viewport**

- [ ] **Step 2: Fix any responsive issues**

- [ ] **Step 3: Commit**

```bash
git commit -m "fix: mobile responsive improvements"
```

---

### Task 15: E2E Test Coverage

**Files:**
- Create: `apps/web/e2e/quick-add.spec.ts`
- Create: `apps/web/e2e/approvals.spec.ts`

- [ ] **Step 1: Write E2E test for quick-add case flow**

- [ ] **Step 2: Write E2E test for bulk approve flow**

- [ ] **Step 3: Run tests**

```bash
pnpm test:e2e
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/
git commit -m "test: E2E tests for quick-add and bulk approve"
```

---

## Summary

| Phase | Tasks | Duration | Key Deliverables |
|-------|-------|----------|------------------|
| Phase 1 | Tasks 1-5 | Week 1-2 | RLS fix, cookie fix, profile editing, password change |
| Phase 2 | Tasks 6-7 | Week 2-3 | Quick-add FAB, recent cases row |
| Phase 3 | Tasks 8-9 | Week 3-4 | Case preview modal, bulk approve/reject |
| Phase 4 | Tasks 10-12 | Week 4-5 | User mgmt, template mgmt, goal editing |
| Phase 5 | Tasks 13-15 | Week 5-6 | Keyboard shortcuts, mobile responsive, E2E tests |
