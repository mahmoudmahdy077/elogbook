# E-Logbook Mobile App — Exhaustive Codebase Reference

> **Generated**: 2026-07-08  
> **Stack**: Expo SDK 56 · React Native 0.85 · NativeWind v4 · WatermelonDB · Supabase  
> **Purpose**: Every export, prop, state variable, data flow, sync operation, and UI state — structured by file path so agents can code against this without re-reading source.

---

## Table of Contents

1. [Global Config & Theme](#1-global-config--theme)
2. [App Root](#2-app-root)
3. [Tabs Layout & Screens](#3-tabs-layout--screens)
4. [Components](#4-components)
5. [Lib: Core Services](#5-lib-core-services)
6. [Lib: Database & Models](#6-lib-database--models)
7. [Lib: Sync Engine](#7-lib-sync-engine)
8. [Lib: Security & Auth](#8-lib-security--auth)
9. [Lib: Notifications & Deep Linking](#9-lib-notifications--deep-linking)
10. [Lib: Utilities](#10-lib-utilities)
11. [Hooks](#11-hooks)

---

## 1. Global Config & Theme

### `global.css`

**Tailwind / NativeWind theme definition** — imported in `_layout.tsx` line 1 via `import '../global.css'`.

**Custom theme tokens** (`@theme` block):
| Variable | Value |
|---|---|
| `--color-backdrop` | `#F2F2F7` |
| `--color-panel` | `#FFFFFF` |
| `--color-primary` | `#007AFF` |
| `--color-secondary` | `#5856D6` |
| `--color-amber` | `#FF9500` |
| `--color-emerald` | `#34C759` |
| `--color-crimson` | `#FF3B30` |
| `--color-neutral-light` | `#E5E5EA` |
| `--color-neutral-dark` | `#F2F2F7` |
| `--font-heading` | `'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display'` |
| `--font-body` | `'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text'` |
| `--font-mono` | `'SF Mono', 'JetBrains Mono', ui-monospace, monospace` |

**Utility class**: `.glass-panel-mobile` — translucent white background with frosted border.

**Scan paths**: `@source "./app"` and `@source "./components"` so NativeWind scans all screen and component files.

---

### `theme/design-tokens.ts`

**React Native–friendly design tokens** that mirror `@elogbook/shared`'s `clinicalTokens`.

**Exports**:
| Export | Type | Description |
|---|---|---|
| `colors` | object | backdrop, surface, primary, primaryHover, primaryGlow, secondary, success, warning, danger, pending, approved, rejected, textPrimary, textSecondary, textMuted, textOnPrimary, border, borderActive, borderGlow, borderStrong, neutralLight, neutralDark, successBg, warningBg, dangerBg |
| `fontSizes` | object | largeTitle(34)…caption2(10) SF-style type scale |
| `fonts` | object | heading('System'/'Roboto'), body('System'/'Roboto'), mono('Menlo'/'monospace') — platform-aware |
| `spacing` | object | xs(4), sm(8), md(16), lg(24), xl(32), '2xl'(48) |
| `radius` | object | sm(8), md(10), lg(14), xl(18), '2xl'(16), full(9999) |
| `shadows` | object | card (subtle), elevated (modal), glow (primary accent) — shadowColor/Offset/Opacity/Radius + elevation |
| `glass` | object | light: `rgba(255,255,255,0.72)` + border `rgba(255,255,255,0.6)` |
| `mobileTokens` | object | Composite object grouping all of the above |
| `MobileTokens` | type | TypeScript type for `mobileTokens` |

**Data flow**: The `AppleCard` component imports these directly. Most screens use `clinicalTokens` from `@elogbook/shared` instead (the web-shared token set, which is semantically equivalent).

---

## 2. App Root

### `app/_layout.tsx` — Root Layout (209 lines)

**Role**: Error boundary, font loading, auth guard, biometric gate, deep linking, notification navigation, sync init, screenshot protection.

**Exports**: `default function RootLayout()`

**Internal types**:
- `ErrorBoundaryProps`: `{ children: ReactNode }`
- `ErrorBoundaryState`: `{ hasError: boolean; error: Error | null }`

**Internal components**:
- `class ErrorBoundary` (class component): catches render errors, shows "Something went wrong" UI with "Try again" button. Renders `this.props.children` when no error.
- `function ScreenshotAwareLayout`: calls `usePreventScreenCapture()` hook. Registers `onScreenshotAttempt` callback that shows ToastAndroid (Android) or Alert (iOS) — "Screenshots are disabled to protect patient data."

**State variables** (all in `RootLayout`):
| State | Type | Purpose |
|---|---|---|
| `fontsLoaded` | boolean | From `useFonts()` — loads Outfit (Regular/Bold/SemiBold), Inter (Regular/Medium/SemiBold), GeistMono (Regular/Medium) |
| `showBiometricGate` | boolean | Controls overlay visibility |
| `lastBackgroundTime` | Ref<number\|null> | Tracks when app went to background |
| `skipWindowRef` | Ref<number> | Seconds before gate re-triggers (default 30, loaded from `getEffectiveSkipWindow()`) |

**Data flows**:
1. `useAuthGuard()` → `isAuthenticated`, `authLoading` — gates auth state
2. `useSyncInit()` — attaches auth listener + starts periodic sync
3. `AppState.addEventListener('change')` — detects foreground transitions → checks elapsed time → if ≥ skipWindow → calls `clearBiometricAuthCache()` + shows gate
4. `Linking.addEventListener('url')` — parses deep links → `navigateToDeepLink`
5. `useNotificationNavigation()` — handles notification tap navigation + cold-start

**Layout tree**:
```
ErrorBoundary
  SafeAreaProvider
    StatusBar (style="light")
    ScreenshotAwareLayout
      Stack (headerShown: false)
        Stack.Screen name="login"
        Stack.Screen name="(tabs)"
      BiometricGate (overlays entire app when visible)
```

**Biometric gate callbacks**:
- `handleBiometricAuthed()` → `setShowBiometricGate(false)`
- `handleBiometricFallback()` → `setShowBiometricGate(false)` + `router.replace('/login')`

**Key**: The biometric gate at root level handles *app coming from background*. The tab-level gate (in `(tabs)/_layout.tsx`) handles the *first unlock* when entering tabs.

**Edge case**: When auth resolves to unauthenticated, gate is hidden (`showBiometricGate = false`).

---

### `app/login.tsx` — Login Screen (110 lines)

**Role**: Magic-link authentication with email input.

**Exports**: `default function LoginScreen()`

**State variables**:
| State | Type | Purpose |
|---|---|---|
| `email` | string | Controlled email input |
| `loading` | boolean | Loading indicator for auth request |
| `sent` | boolean | True after magic link is sent (shows confirmation) |
| `error` | string\|null | Validation/auth error message |
| `cooldown` | boolean | 5s cooldown after send to prevent spam |

**Data flow**:
1. On mount: `supabase.auth.getSession()` — if session exists, `router.replace('/(tabs)')`
2. `handleSendLink()`:
   - Validates email via regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
   - Calls `supabase.auth.signInWithOtp({ email: trimmed })`
   - On success: `setSent(true)`, `setCooldown(true)` (auto-clears after 5s)
   - On error: shows error message

**UI states**:
1. **Loading**: ActivityIndicator in button
2. **Sent**: "Check your email" card with email address shown
3. **Error**: Red banner with error message
4. **Cooldown**: Button disabled, shows "Please wait..."
5. **Default**: Email input + "Send Magic Link" button

**Validation helper**: `isValidEmail(e)` — local regex test.

---

## 3. Tabs Layout & Screens

### `app/(tabs)/_layout.tsx` — Tab Navigator (221 lines)

**Role**: Role-based tab bar with biometric gate on first unlock.

**Exports**: `default function TabLayout()`

**State variables**:
| State | Type | Purpose |
|---|---|---|
| `role` | UserRole\|null | Current user's role |
| `loading` | boolean | Profile loading |
| `biometricUnlocked` | boolean | Tabs gated behind biometric auth |
| `biometricError` | string\|null | Error message from biometric attempt |

**Data flows**:
1. On mount: `supabase.auth.getUser()` → `supabase.from('profiles').select('role')` → sets role
2. Biometric gate effect (deps: `isAuthenticated`):
   - If not authenticated → `biometricUnlocked = false`
   - If `isBiometricSessionValid()` → unlock immediately (5-min cache)
   - Otherwise → `authenticateWithBiometrics('Unlock E-Logbook')`
   - `authed` or `unavailable` → unlock; anything else → show error
3. `AppState.addEventListener('change')` → on background → `setBiometricUnlocked(false)` (forces re-prompt)

**Role-based tab visibility**:
| Tab | Icon | Visible for |
|---|---|---|
| Dashboard (index) | `home` | All |
| Log Case | `add-circle` | `role === 'resident'` only (disabled via `tabPress` listener otherwise) |
| My Cases | `list` | All |
| Approvals | `checkmark-circle` | `role === 'supervisor' \\| 'director' \\| 'admin'` |
| AI Insights | `sparkles` | `role === 'resident' \\| 'director' \\| 'admin'` |
| Case Detail | — | Hidden (`href: null`) |
| Profile | `person` | All |

**UI states**:
1. **Loading**: Full-screen ActivityIndicator
2. **Not authenticated**: Redirect to `/login`
3. **Locked**: Lock icon + "Authenticate to view your cases" + Unlock button
4. **Biometric error**: Shows error string in locked state
5. **Unlocked**: Tab bar with role-filtered tabs

**Biometric locked UI**:
- Lock icon (Ionicons `lock-closed`, 56px, primary color)
- Title: "Locked"
- Subtitle: `biometricError ? `Authentication required (${error})` : 'Authenticate to view your cases'`
- "Unlock" button — retries biometric auth

---

### `app/(tabs)/index.tsx` — Dashboard Screen (287 lines)

**Role**: Home dashboard with stats cards, goal progress rings, today's case widget, sync status.

**Exports**: `default function DashboardScreen()`

**Internal types**:
- `Stats`: `{ draft: number; pending: number; approved: number }`
- `GoalData`: `{ id: string; title: string; current: number; target: number; specialty: string | null }`

**State variables**:
| State | Type | Purpose |
|---|---|---|
| `stats` | Stats | Counts: draft/pending/approved — loaded from local DB or Supabase |
| `todayStats` | TodayStats | Today's case counts (total/pending/approved/rejected/draft) |
| `goals` | GoalData[] | Resident's program goals with progress |
| `loading` | boolean | Initial data load |
| `refreshing` | boolean | Pull-to-refresh |
| `isOffline` | boolean | NetInfo connectivity |
| `lastSyncAgo` | string | Human-readable "Xm ago" / "Just now" / "Never" |

**Data flows**:
1. `loadData()` on mount:
   - Gets `user` → `profile` (id, tenant_id)
   - **If online**: queries `program_goals` with `goal_progress(current_count)` subquery via Supabase
   - **If offline**: calls `getAllGoalsForResident(profile.id)` from local WatermelonDB
   - Always queries local `getAllCasesForResident(profile.id)` for stats
   - Falls back to Supabase `case_entries` query if local is empty + online
   - Calls `fetchTodayStats()` → `setTodayStats`
2. **Network listener**: `NetInfo.addEventListener` → `setIsOffline`
3. **Sync listener**: `syncService.onStatusChange` → re-loads data when `'synced'` or `'idle'`
4. **AppState listener**: Re-loads on foreground
5. **Last sync label**: Updates every 60s via `setInterval`
6. `updateLastSyncLabel()`: Reads `getLastSyncTimestamp()` from AsyncStorage → computes human-readable diff

**UI states & layout**:
1. **Loading**: Full-screen ActivityIndicator
2. **Default**: ScrollView with RefreshControl
   - Header: "Dashboard" title + "Last synced: {ago}"
   - Offline banner (red): "Offline — showing cached data"
   - CaseCountWidget (if `todayStats.total > 0`)
   - Stats cards (3 columns): Drafts (blue/white), Pending (amber), Approved (emerald)
   - Goal Progress section: ProgressRing components (from @elogbook/shared)
   - Summary bar: "X of Y goals on track"
   - "Log New Case" CTA button (teal)

**Goal data transformation**: Supabase response field `goal_progress[0].current_count` → `current`. Local uses `g.currentCount`.

---

### `app/(tabs)/log-case.tsx` — Case Logging Wizard (830 lines)

**Role**: Multi-step case logging — template selection → form → submit with offline fallback. Supports editing, duplicating, and repeating last entry.

**Exports**: `default function LogCaseScreen()`

**Route params** (via `useLocalSearchParams`):
| Param | Type | Purpose |
|---|---|---|
| `editCaseId` | string? | Hydrate form from existing case (UPDATE path) |
| `duplicateCaseId` | string? | Clone existing case (INSERT + clear PHI) |
| `repeatLastEntry` | string? | Auto-fill from most recent case |

**Constants**:
- `SPECIALTY_ICONS`: `Record<string, Ionicons.glyphMap key>` — maps specialty names to icon names

**State variables** (major):
| State | Type | Purpose |
|---|---|---|
| `templates` | CaseTemplate[] | All templates for tenant |
| `selectedTemplate` | CaseTemplate\|null | Currently selected template |
| `selectedTemplateId` | string | String ID for hydration |
| `favoriteIds` | Set<string> | User's favorited template IDs |
| `step` | number | Auto-save step tracking |
| `loading` | boolean | Initial templates loading |
| `fetchError` | boolean | Template fetch failure |
| `submitting` | boolean | Submit in progress |
| `showConfirmation` | boolean | Modal visible after submit |
| `confirmationSuccess` | boolean | True=submitted, False=offline saved |
| `validationError` | string\|null | Zod validation error |
| `isDeidentified` | boolean | Toggle: de-identified vs identified mode |
| `patientMrn` | string | MRN (identified mode) |
| `patientDob` | string | Date of birth (identified mode) |
| `patientAge` | string | Age in years (de-identified mode) |
| `caseDate` | string | ISO date string |
| `fieldValues` | Record<string, string> | Template field values keyed by field.key |
| `syncStatus` | SyncStatus | From syncService |

**Refs**:
| Ref | Type | Purpose |
|---|---|---|
| `templatesRef` | CaseTemplate[] | Mutable copy for async access |
| `isSubmitting` | boolean | Mutex against double-submit |
| `editEntryRef` | CaseEntry\|null | Local DB entry being edited |
| `confirmationTypeRef` | 'offline'\|'submitted'\|null | Tracks outcome type |

**Data flows**:

1. **Template loading** (`loadTemplates()`):
   - Gets `user` → `profile` (id, tenant_id)
   - Fetches `case_templates` for tenant
   - Fetches `template_favorites` for user
   - Fetches personal template usage counts from `case_entries` (for sorting)
   - `sortTemplates(allTemplates, favIds, personalCounts, new Map())` → sorted + favorited templates

2. **Edit hydration** (`editCaseId` param):
   - Attempts local DB find first (`db.get<CaseEntry>('case_entries').find(editCaseId)`)
   - Falls back to Supabase `case_entries` select
   - Sets all form fields from entry data
   - Submit path uses **UPDATE** (`editEntryRef`)

3. **Duplicate hydration** (`duplicateCaseId` param):
   - Fetches source case from Supabase
   - Clears PHI fields (MRN, DOB)
   - Sets `patientAge` from source
   - Sets `caseDate` to today
   - Submit path uses **INSERT**

4. **Repeat last entry** (`repeatLastEntry='true'`):
   - Gets most recent case from Supabase (ordered by `created_at` DESC, limit 1)
   - Same as duplicate — clears PHI, sets date to today

5. **Auto-save draft**:
   - Debounced (1500ms) save to AsyncStorage at key `case_form_draft`
   - Saves: selectedTemplateId, patientMrn, patientDob, fieldValues, isDeidentified, step
   - On mount: checks for existing draft, prompts "Recover?" or "Discard"
   - Cleared on successful submit

6. **Submit flow** (`handleSubmit()`):
   - Builds `entryData` based on `isDeidentified` flag (different required fields)
   - Validates against `caseEntrySchema` (Zod)
   - Gets `user` → `profile` (id, tenant_id)
   - Gets `tenant` → checks `tenant_type` → `'individual'` = 'pending', else 'draft'
   - **Edit path** (editCaseId):
     - Try Supabase update → if succeeds, `updateSyncStatus(entry, 'synced', serverId)`
     - On failure → `updateSyncStatus(entry, 'modified')` (marks for next push)
   - **Insert path** (new/duplicate):
     - Try Supabase insert → if fails → `saveDraftCase()` to local WatermelonDB with `localSyncStatus: 'draft'`
     - Generates `patientHash` for de-identified mode

7. **Template selection** (`selectTemplate(t)`):
   - Sets selected template
   - Initializes field values with empty strings for each field

8. **Sync status listener**: `syncService.onStatusChange(setSyncStatus)` — renders sync banner

**Template favoriting** (`toggleFavorite`):
- Immediate UI update (optimistic) + Supabase `template_favorites` insert/delete
- Updates both `favoriteIds` set and `templates` array's `is_favorite` field

**`renderField(field: TemplateField)`**:
- **`select` type**: Button chips grid — `field.options` mapped to touchable chips
- **`textarea` type**: Multiline TextInput with `min-h-[100px]`
- **Default**: Single-line TextInput with `keyboardType={field.type === 'number' ? 'numeric' : 'default'}`

**`renderSyncBanner()`**:
- Maps syncStatus to: syncing (blue), error (red), offline (amber), synced (emerald)
- Returns null when status is 'idle'

**`renderConfirmation()`**: Modal with success/offline icon + status message

**`renderTemplateCard()`**: Template grid card with specialty icon, name, field count badge, favorite star

**UI states**:
1. **Loading templates**: Skeleton cards (4 placeholder cards)
2. **Template grid**: FlatList, 2 columns, pull-to-refresh via loadTemplates
3. **No templates**: "No templates available" or "Unable to load" + Retry button
4. **Form view**: Back arrow + template name + Change Template link
   - De-identification Switch toggle
   - PHI section (conditional on isDeidentified):
     - De-identified: Age (years) input
     - Identified: MRN + DOB DateField
   - Case Date field (always visible)
   - Template fields (rendered via `renderField`)
   - Validation error banner (red)
   - Submit button (bottom, absolute): "Submit for Verification" / "Resubmit for Verification"
5. **Submitting**: ActivityIndicator in button, button disabled
6. **Confirmation modal**: Success or Offline-saved acknowledgment (auto-dismisses 2s)

---

### `app/(tabs)/my-cases.tsx` — My Cases List (248 lines)

**Role**: Filterable list of resident's cases with sync status, offline badge, and conflict detection.

**Exports**: `default function MyCasesScreen()`

**Internal types**:
- `CaseData`: `{ id, patient_mrn, patient_dob, case_date, status, template_name, template_specialty, is_deidentified, local_sync_status }`
- `FilterType`: `'all' | 'draft' | 'pending' | 'approved' | 'rejected' | 'conflict'`

**Constants**:
- `FILTER_CHIPS`: 6 filter categories with labels
- `SYNC_STATUS_LABELS`: Maps `draft`→'Offline', `modified`→'Modified', `conflict`→'Conflict', `synced`→''

**Internal component**: `CaseCard` — memoized card showing specialty-name, MRN/age, date, StatusBadge, sync status label, "Duplicate" button

**State variables**:
| State | Type | Purpose |
|---|---|---|
| `cases` | CaseData[] | All local case entries mapped to UI format |
| `loading` | boolean | Initial load |
| `filter` | FilterType | Active filter chip |
| `conflictDrafts` | {entryId, residentId}[] | Cases in conflict state |
| `isOffline` | boolean | NetInfo |
| `refreshing` | boolean | Pull-to-refresh |

**Data flows**:
1. `loadCases()`:
   - Gets user → profile
   - `getAllCasesForResident(profile.id)` from WatermelonDB
   - `db.get<CaseTemplate>('case_templates').query().fetch()` → builds templateMap
   - `getConflictedCases()` → conflictDrafts
   - Maps local CaseEntry → CaseData (resolving template names)
2. **Network listener**: `NetInfo.addEventListener` → `setIsOffline`
3. **Conflict callback**: `syncService.setConflictCallback` → adds to conflictDrafts + re-loads
4. **Filtering** (`filteredCases` via `useMemo`):
   - `'all'`: all cases
   - `'conflict'`: cases where conflictDrafts includes entryId
   - Others: `c.status === filter`
5. **Case tap** (`handleCaseTap`): If `status === 'rejected'` → navigate to `/log-case?editCaseId={id}`

**UI states**:
1. **Loading**: Full-screen ActivityIndicator
2. **Offline banner**: Red — "Offline — showing cached data"
3. **Conflict banner**: Amber — "Case updated by supervisor — offline edits saved as new draft" + "View" button
4. **Filter chips**: Horizontal ScrollView of rounded chips, active chip is teal
5. **Case list**: FlatList with RefreshControl
6. **Empty**: "No cases found." card
7. **Case card**: Shows template specialty-name, patient info, date, StatusBadge, sync label, "Duplicate" button

**Navigation**:
- Tapping a rejected case → edit mode in log-case
- "Duplicate" button → `router.push({ pathname: '/log-case', params: { duplicateCaseId: item.id } })`

---

### `app/(tabs)/case-detail.tsx` — Case Detail Screen (421 lines)

**Role**: Full case read-only view with approve/reject actions for supervisors.

**Exports**: `default function CaseDetailScreen()`

**Route params**: `{ caseId: string }` (from `useLocalSearchParams`)

**Internal types**:
- `CaseDetail`: `{ id, resident_name, specialty, template_name, case_date, status, is_deidentified, patient_mrn, patient_dob, patient_age_years, patient_hash, field_values, rejection_comment, created_at, updated_at }`

**State variables**:
| State | Type | Purpose |
|---|---|---|
| `caseDetail` | CaseDetail\|null | The loaded case |
| `loading` | boolean | Initial load |
| `isOffline` | boolean | NetInfo |
| `role` | UserRole\|null | Current user's role |
| `processing` | boolean | Approve/reject in progress |
| `rejectModalOpen` | boolean | Rejection comment modal |
| `rejectComment` | string | Multiline rejection reason |

**Data flows**:
1. `loadCase()`:
   - Gets user → profile (id, role, tenant_id) → `setRole`
   - Tries local DB first: `db.get<CaseEntry>('case_entries').find(caseId)` → partial data (no resident_name/template_name/specialty)
   - Falls back to Supabase: joins `case_templates(name, specialty)`, `profiles(full_name)`, `approval_requests(comment, status)`
   - Finds rejection request by filtering `approval_requests` array for `status === 'rejected'`
   - On network fetch success: `upsertCaseEntry(entry)` to update local cache
2. **Approve action** (`handleApprovalAction`):
   - Calls `supabase.rpc('approve_case', { p_entry_id: caseId })` or `supabase.rpc('reject_case', { p_entry_id: caseId, p_comment })`
   - On success: haptics + re-loads case
   - On error: Alert
3. **Approve confirm**: Alert with Cancel/Approve
4. **Reject confirm**: Opens modal → requires non-empty reason → `handleApprovalAction('reject', trimmed)`

**UI states**:
1. **Loading**: ActivityIndicator
2. **Not found**: "Case not found." + "Go Back" button
3. **Default view**: ScrollView
   - Offline banner (red): "Offline — actions require a connection"
   - Header: specialty + template_name + StatusBadge
   - GlassPanel: Patient Info — conditional:
     - De-identified: "Age: X", "Hash: abc123..."
     - Identified: "MRN: X", "DOB: X"
   - GlassPanel: Case Data — date, resident name, created/updated timestamps
   - GlassPanel: Fields — key-value rows from `field_values`
   - GlassPanel: Rejection Comment (only if rejected + has comment)
   - Edit Case button (if `status === 'draft' || 'rejected'`)
   - Duplicate Case button (always)
   - Approve/Reject buttons (if `canApprove && status === 'pending'`)
   - Resubmit Case button (if `status === 'rejected'`)
4. **Reject modal**: TextInput (multiline) + Cancel/Reject buttons

**Permissions**:
- `canApprove`: `role === 'supervisor' | 'director' | 'admin'`
- `canEdit`: `status === 'draft' | 'rejected'`

---

### `app/(tabs)/approvals.tsx` — Approvals Dashboard (345 lines)

**Role**: Verification dashboard for supervisors — list of approval requests with approve/reject inline.

**Exports**: `default function ApprovalsScreen()`

**Internal types**:
- `ApprovalItem`: `{ id, entry_id, resident_name, specialty, case_date, status: 'pending'|'approved'|'rejected', comment }`

**Internal component**: `ApprovalCard` — memoized GlassPanel card showing resident name, specialty, date, comment, StatusBadge, inline Approve/Reject buttons (only for pending)

**State variables**:
| State | Type | Purpose |
|---|---|---|
| `approvals` | ApprovalItem[] | All approval requests for tenant |
| `loading` | boolean | Initial load |
| `refreshing` | boolean | Pull-to-refresh |
| `isOffline` | boolean | NetInfo |
| `role` | UserRole\|null | Current user's role |
| `processingIds` | Set<string> | Currently processing approval IDs |
| `rejectTarget` | {approvalId, entryId}\|null | Target for rejection modal |
| `rejectComment` | string | Multiline rejection reason |

**Data flows**:
1. `loadProfileAndApprovals()`:
   - Gets user → profile → `setRole`
   - Role check: supervisor/director/admin only
   - `supabase.from('approval_requests').select('id, entry_id, status, comment, requested_at, case_entries(...), profiles!supervisor_id(full_name)')`
   - Filters by tenant_id via `case_entries.tenant_id`
   - Maps response to `ApprovalItem[]`
2. **Approve/reject** (`handleAction`):
   - `supabase.rpc('approve_case'/'reject_case', { p_entry_id: entryId, p_comment? })`
   - On success: removes from local list + haptics
   - On error: Alert
3. **Reject confirm**: Modal → non-empty reason required

**UI states**:
1. **Loading**: ActivityIndicator
2. **No permission**: "You do not have permission to view approvals."
3. **Offline banner**: Red — "Offline — approvals require a connection"
4. **Default**: Header "Approvals" + pending count
5. **List**: FlatList with RefreshControl
6. **Empty**: "No approval requests found."
7. **ApprovalCard**: GlassPanel with inline Approve/Reject for pending items
8. **Processing**: Shows "..." on the active approve/reject button, disabled state
9. **Reject modal**: TextInput + Cancel/Reject

---

### `app/(tabs)/ai-insights.tsx` — AI Clinical Reflection (243 lines)

**Role**: AI-powered clinical query interface with daily quota.

**Exports**: `default function AIInsightsScreen()`

**Constants**: `MAX_QUERIES = 20` (daily limit)

**State variables**:
| State | Type | Purpose |
|---|---|---|
| `query` | string | Text input (max 500 chars) |
| `response` | string | AI response text |
| `loading` | boolean | Profile/setup loading |
| `submitting` | boolean | Query in progress |
| `isOffline` | boolean | NetInfo |
| `role` | UserRole\|null | Current user's role |
| `quotaUsed` | number | Today's query count |
| `error` | string\|null | Error message |

**Data flows**:
1. `loadProfile()`:
   - Gets user → profile → `setRole`
   - Checks role: resident/director/admin only
   - Counts today's queries via `supabase.from('ai_query_logs').select('*', { count: 'exact', head: true }).gte('created_at', today)`
2. `handleSubmit()`:
   - Validates with `aiQuerySchema`
   - Calls `supabase.functions.invoke('ai-insights', { body: validation.data })`
   - On success: `setResponse`, increments quota
   - On error: `setError`

**UI states**:
1. **Loading**: ActivityIndicator
2. **No access**: "AI Insights is available for residents and directors only."
3. **Default**: ScrollView
   - Title + quota used display
   - Offline banner (red): "Offline — AI insights require a connection"
   - Educational disclaimer (amber): "AI-generated insights are for educational purposes only"
   - GlassPanel: TextInput (multiline, 500 char limit)
   - Character counter
   - "Ask" button (teal, disabled when quota exhausted)
4. **Error**: Red banner
5. **Response**: GlassPanel with "Response" header + response text
6. **Quota exhausted**: "You have reached your daily query limit."

**Permissions**:
- `canAccess`: `role === 'director' | 'resident' | 'admin'`
- `quotaRemaining`: `MAX_QUERIES - quotaUsed`

---

### `app/(tabs)/profile.tsx` — Profile Screen (214 lines)

**Role**: User profile display, subscription info, sign out.

**Exports**: `default function ProfileScreen()`

**Internal types**:
- `ProfileData`: `{ id, full_name, role, specialty, tenant_id }`
- `PlanData`: `{ name, slug }`

**Helper**: `titleCase(str)` — converts snake_case to Title Case

**State variables**:
| State | Type | Purpose |
|---|---|---|
| `profile` | ProfileData\|null | User profile |
| `plan` | PlanData\|null | Subscription plan |
| `subscriptionStatus` | string\|null | Subscription status |
| `loading` | boolean | Initial load |
| `loadError` | boolean | Profile fetch failure |

**Data flows**:
1. `loadProfile()`:
   - Gets user → `profiles` (id, full_name, role, specialty, tenant_id)
   - Gets `tenants` → `plan_id`
   - Gets `subscription_plans` → name, slug
   - Gets `subscriptions` → status
2. `handleSignOut()`: `supabase.auth.signOut()` → `router.replace('/login')`

**UI states**:
1. **Loading**: ActivityIndicator
2. **Error**: "Unable to load profile." + Retry button
3. **Default**: ScrollView
   - Avatar circle (initial letter in teal circle)
   - Full name + role (title-cased) + specialty
   - Subscription GlassPanel: plan name + status (active=emerald, trialing=amber, otherwise=red) + "Manage Subscription" button (shows "Coming Soon" alert)
   - Account GlassPanel: Role, Specialty, ID rows
   - Sign Out button (red outline)

---

### `app/(tabs)/duty-hours.tsx` — Duty Hours Tracker (130 lines)

**Role**: Simple form to log duty hours to Supabase.

**Exports**: `default function DutyHoursScreen()`

**Constants**: `SHIFT_TYPES` — 5 shift type options: call, clinic, vacation, weekend, regular

**State variables**:
| State | Type | Purpose |
|---|---|---|
| `date` | Date | Selected shift date |
| `showDatePicker` | boolean | Date picker visibility |
| `hours` | string | Hours input (numeric) |
| `shiftType` | string | Selected shift type key |
| `notes` | string | Optional notes |
| `saving` | boolean | Save in progress |

**Data flow**:
1. `handleSave()`:
   - Validates hours is a valid number
   - Gets user → profile
   - `supabase.from('duty_periods').insert({ tenant_id, resident_id, shift_date, hours_worked, shift_type, notes })`
   - On success: Alert + clears hours and notes
   - On error: Alert with error.message

**UI states**:
1. **Default**: View
   - Date selector (TouchableOpacity + DateTimePicker)
   - Hours TextInput (numeric keyboard)
   - Shift type chips (TouchableOpacity grid)
   - Notes TextInput (optional)
   - Save button (teal, disabled when saving)
2. **Saving**: Opacity on save button

---

## 4. Components

### `components/AccessibleText.tsx` (38 lines)

**Role**: Drop-in replacement for `<Text>` with enhanced accessibility.

**Exports**: `AccessibleTextProps` (type), `AccessibleText` (function component)

**Props**:
| Prop | Type | Default | Description |
|---|---|---|---|
| `accessibilityLabel` | `string?` | `children` (if string) | Screen-reader label |
| `accessibilityRole` | `'text'\|'header'\|'link'\|'summary'` | `'text'` | ARIA role |
| `maxFontSizeMultiplier` | `number` | `1.6` | Max Dynamic Type scale |
| `allowFontScaling` | `boolean` | `true` | Respect OS font size |
| All other TextProps | — | — | Spread onto `<Text>` |

**Usage**: Used in DashboardScreen for stats numbers (draft/pending/approved counts).

---

### `components/AppleCard.tsx` (169 lines)

**Role**: Apple Health–inspired card component — white rounded card with shadow and optional header.

**Exports**: `AppleCardProps` (type), `AppleCard` (function component)

**Props**:
| Prop | Type | Default | Description |
|---|---|---|---|
| `children` | `ReactNode` | required | Card content |
| `title` | `string?` | — | Card header title |
| `subtitle` | `string?` | — | Card header subtitle |
| `headerRight` | `ReactNode?` | — | Right-aligned header element |
| `onPress` | `() => void?` | — | Makes card tappable |
| `style` | `ViewStyle?` | — | Extra card styles |
| `variant` | `'default'\|'frosted'\|'accent'` | `'default'` | Card variant |
| `accessibilityLabel` | `string?` | — | Accessibility |

**Variants**:
- `default`: White background, shadow, hairline border
- `frosted`: Translucent white (`rgba(255,255,255,0.72)`)
- `accent`: Primary glow border + glow shadow

**Styles** imported from `theme/design-tokens`: `colors`, `radius`, `shadows`, `fonts`, `fontSizes`, `spacing`

---

### `components/BiometricGate.tsx` (444 lines)

**Role**: Full-screen biometric auth overlay — Apple Health design language. Frosted-glass backdrop with lock icon, auto-triggers platform biometric prompt, provides fallback after 3 attempts.

**Exports**: `BiometricGateProps` (type), `BiometricGate` (function component)

**Props**:
| Prop | Type | Description |
|---|---|---|
| `onAuthenticated` | `() => void` | User authenticated successfully |
| `onFallbackToPasscode` | `() => void` | User tapped "Use Passcode" |
| `visible` | `boolean` | Gate visibility |

**Constants**: `MAX_ATTEMPTS = 3`, `FADE_DURATION = 350`

**State variables**:
| State | Type | Purpose |
|---|---|---|
| `biometricType` | `'face'\|'fingerprint'\|null` | Device's available biometric |
| `attempts` | number | Failed attempts counter |
| `statusMessage` | string\|null | Error/warning message |
| `isVerifying` | boolean | Verification in progress |
| `isHidden` | boolean | True when fully faded out |
| `fadeAnim` | Animated.Value | Opacity animation (0→1, 1→0) |
| `verifyingRef` | boolean | Mutex ref |
| `mountedRef` | boolean | Cleanup flag |

**Data flows**:
1. On mount: detects `biometricType` via `getBiometricType()`
2. When `visible` becomes true: after 400ms delay, auto-triggers `triggerBiometric()`
3. `triggerBiometric()`:
   - Calls `authenticateBiometric(promptMessage)` — "Scan your Face ID…" / "Use your fingerprint…"
   - On success: resets attempts, calls `onAuthenticated()`
   - On failure: increments attempts, shows status message
   - At `>= MAX_ATTEMPTS`: shows "Too many attempts. Use your passcode." + fallback button
4. Visibility animation: fade-in (350ms) when visible, fade-out when not
5. Accessibility: announces "Biometric authentication required"

**UI layers**:
1. Frosted-glass backdrop (absolute fill)
2. Lock icon ring (96px circle)
3. Biometric badge (Face ID / Touch ID icon)
4. Title: "Authenticate to continue"
5. Subtitle: contextual biometric instruction
6. Status message (with warning/error icon)
7. Verify button (manual trigger, shows "Try Again" / "Use Face ID")
8. Verifying indicator ("Verifying…")
9. "Use Passcode" fallback (shown after ≥1 attempt)
10. Attempts indicator (3 dots, filled = failed)

**Styles**: `StyleSheet.create` with platform shadows, Apple color palette via `clinicalTokens`.

---

### `components/CaseCountWidget.tsx` (224 lines)

**Role**: Apple Health–inspired daily case count card with SVG progress ring and status breakdown.

**Exports**: `CaseCountWidgetProps` (type), `CaseCountWidget` (function component)

**Props**:
| Prop | Type | Default | Description |
|---|---|---|---|
| `stats` | `TodayStats` | required | total, pending, approved, rejected, draft counts |
| `dailyGoal` | `number` | `10` | Target daily case count |

**Internal sub-components**:
- `ProgressRing({ percentage, size, strokeWidth })`: SVG circular progress ring (background track + foreground arc + percentage label)
- `StatRow({ label, value, color })`: Colored label + value row

**Layout**:
- Header: "Today's Cases"
- Body row: SVG progress ring (left) + stats breakdown (right)
- Footer: Daily goal progress bar

**Styles**: Card uses white background, subtle shadow, from `clinicalTokens` radii/spacing.

---

### `components/DateField.tsx` (107 lines)

**Role**: Cross-platform date input — uses native DateTimePicker where available, falls back to TextInput.

**Exports**: `DateFieldProps` (type), `DateField` (function component)

**Props**:
| Prop | Type | Description |
|---|---|---|
| `value` | `string` | ISO date string (YYYY-MM-DD) |
| `onChange` | `(iso: string) => void` | Called with new ISO date |
| `label` | `string` | Field label |
| `accessibilityLabel` | `string` | Accessibility |
| `maximumDate` | `Date?` | Max selectable date |
| `minimumDate` | `Date?` | Min selectable date |

**Internal logic**:
- DateTimePicker is lazy-loaded via try/catch `require('@react-native-community/datetimepicker')` — returns null in test environments
- `parseISODate(iso)`: accepts YYYY-MM-DD or full ISO → returns Date
- `toISODate(d)`: Date → YYYY-MM-DD
- Fallback TextInput: shows format hint when non-conforming input is focused

**UI states**:
1. Native picker available: Label + touchable showing value → opens native picker (inline on iOS)
2. No native picker: Label + TextInput (max 10 chars, numbers-and-punctuation keyboard) + format hint when focused

---

### `components/ScreenErrorBoundary.tsx` (74 lines)

**Role**: Class-based error boundary wrapping tab content.

**Exports**: `ScreenErrorBoundaryProps` (type), `ScreenErrorBoundary` (class component)

**Props**:
| Prop | Type | Description |
|---|---|---|
| `children` | `ReactNode` | Content to protect |
| `onError` | `(error: Error, info: React.ErrorInfo) => void?` | Error reporting callback (Sentry/Crashlytics) |
| `screenName` | `string?` | Human-readable screen label |

**State**: `{ hasError: boolean; error: Error | null }`

**UI on error**: "{screenName} could not be displayed" + error message + "Try again" button (calls `this.reset()` → re-renders children)

**Used in**: Tab layout (`ScreenErrorBoundary screenName="Tabs"` wrapping all tabs)

---

## 5. Lib: Core Services

### `lib/supabase.ts` (23 lines)

**Role**: Singleton Supabase client with SecureStore-backed auth persistence.

**Exports**: `supabase` (client instance)

**Implementation**:
- Reads config from `Constants.expoConfig?.extra` (app.json extra) or `process.env.EXPO_PUBLIC_SUPABASE_*`
- Throws if URL or anon key missing
- `ExpoSecureStoreAdapter`: wraps SecureStore getItem/setItem/removeItem for auth session persistence
- Client creation: `createClient(url, anonKey, { auth: { storage, autoRefreshToken: true, detectSessionInUrl: true } })`

---

### `lib/analytics.ts` (59 lines)

**Role**: PostHog analytics integration with consent management.

**Exports**:
| Export | Type | Description |
|---|---|---|
| `AnalyticsEvent` | type | Union: `'case_logged'\|'case_submitted'\|'case_approved'\|'case_rejected'\|'ai_query'\|'subscription_started'\|'mfa_enrolled'` |
| `initAnalytics()` | async fn | Reads consent → creates PostHog instance |
| `grantConsent()` | async fn | Sets consent → re-inits analytics |
| `denyConsent()` | async fn | Sets denied → opts out |
| `hasConsent()` | async fn | Returns boolean |
| `trackEvent(event, properties?)` | fn | Captures event |
| `setUserContext(userId, tenantId)` | fn | Identifies + registers properties |
| `resetUserContext()` | fn | Resets PostHog session |

**Data flow**: Consent stored in AsyncStorage under `analytics_consent`. PostHog instance stashed on `globalThis` for introspection.

---

### `lib/performance.ts` (133 lines)

**Role**: Performance instrumentation with metrics collection.

**Exports**:
| Export | Type | Description |
|---|---|---|
| `measureAsync(name, fn, options?)` | async fn | Wraps async operation, records duration |
| `startTimer(name, metadata?)` | fn | Returns stop function |
| `measureCaseLogging<T>(fn)` | async fn | Wraps with threshold 60s |
| `measureSync<T>(fn)` | async fn | Wraps with threshold 30s |
| `getMetrics()` | fn | Returns all recorded metrics |
| `clearMetrics()` | fn | Clears metrics |
| `getMetricStats(pattern)` | fn | Returns count/avg/p50/p95/max/min |

**Implementation**: In-memory array of `PerformanceMetric` objects, capped at 500. Uses `performance.now()`.

---

### `lib/today-stats.ts` (77 lines)

**Role**: Fetch today's case counts for the dashboard widget.

**Exports**: `TodayStats` (type), `fetchTodayStats()` (async fn)

**Interface `TodayStats`**: `{ total: number; pending: number; approved: number; rejected: number; draft: number }`

**Data flow**:
1. Gets user → profile
2. **If online**: `supabase.from('case_entries').select('status').eq('resident_id', profile.id).eq('case_date', today)`
3. **If offline**: `getAllCasesForResident(profile.id)` → filter `caseDate.startsWith(today)`
4. Counts by status via `countByStatus(statuses: string[])`

---

## 6. Lib: Database & Models

### `lib/db/schema.ts` (54 lines)

**Role**: WatermelonDB schema definition (v3).

**Tables**:

**`case_entries`**:
| Column | Type | Optional | Description |
|---|---|---|---|
| `tenant_id` | string | — | Tenant UUID |
| `resident_id` | string | — | Resident profile UUID |
| `template_id` | string | — | Case template UUID |
| `patient_mrn` | string | ✓ | Medical record number |
| `patient_dob` | string | ✓ | Date of birth |
| `patient_age_years` | number | ✓ | De-identified age |
| `patient_hash` | string | ✓ | SHA-256 hash |
| `case_date` | string | — | ISO date |
| `field_values` | string | — | JSON string |
| `accreditation_mappings` | string | — | JSON string |
| `is_deidentified` | boolean | — | De-identification flag |
| `status` | string | — | draft/pending/approved/rejected |
| `local_sync_status` | string | — | draft/synced/modified/conflict |
| `server_id` | string | ✓ | Server-assigned UUID (v3) |
| `created_at` | number | — | Unix ms timestamp |
| `updated_at` | number | — | Unix ms timestamp |

**`case_templates`**:
| Column | Type | Optional | Description |
|---|---|---|---|
| `tenant_id` | string | — | Tenant UUID |
| `specialty` | string | — | Specialty name |
| `name` | string | — | Template name |
| `fields` | string | — | JSON array of TemplateField |
| `required_fields` | string | — | JSON array of field keys |
| `created_at` | number | — | Unix ms |
| `updated_at` | number | — | Unix ms |

**`program_goals`**:
| Column | Type | Optional | Description |
|---|---|---|---|
| `tenant_id` | string | — | Tenant UUID |
| `resident_id` | string | — | Resident UUID |
| `title` | string | — | Goal title |
| `target_count` | number | — | Target count |
| `current_count` | number | — | Current progress |
| `specialty` | string | ✓ | Specialty filter |
| `local_sync_status` | string | — | synced |
| `created_at` | number | — | Unix ms |
| `updated_at` | number | — | Unix ms |

---

### `lib/db/migrations.ts` (19 lines)

**Role**: Schema migration from v2 → v3.

**Migration v3**: Adds `server_id` column (string, optional) to `case_entries` table. Purpose: track the server-assigned UUID after a successful push so subsequent `modified` updates use the real server ID instead of the local UUID.

---

### `lib/db/encryption-key.ts` (43 lines)

**Role**: Per-install database encryption key generation and storage.

**Exports**:
| Export | Type | Description |
|---|---|---|
| `generateDbEncryptionKeyHex()` | async fn | Generates 256-bit random key from `expo-crypto` |
| `getOrCreateDbEncryptionKey()` | async fn | Returns cached key, creates if not in SecureStore |
| `resetDbEncryptionKeyCacheForTests()` | fn | Clears in-memory cache |

**Key**: Hex-encoded (64 chars), stored in SecureStore under `elogbook.db.encryption_key.v1`, cached in module variable.

---

### `lib/db/database.ts` (53 lines)

**Role**: WatermelonDB singleton with SQLite adapter.

**Exports**:
| Export | Type | Description |
|---|---|---|
| `getDbEncryptionKey()` | async fn | Returns cached encryption key |
| `getDatabase()` | fn | Returns singleton Database instance |
| `database` | Database | Module-level singleton (calls `getDatabase()`) |

**Implementation**:
- Adapter: `SQLiteAdapter` with JSI enabled
- Schema: v3, migrations: v2→v3
- Model classes: `[CaseEntry, CaseTemplate, ProgramGoal]`
- SQLCipher support: gated behind `process.env.EXPO_PUBLIC_ENABLE_SQLCIPHER === 'true'`

---

### `lib/db/models/CaseEntry.ts` (23 lines)

**Role**: WatermelonDB model for `case_entries` table.

**Decorators**:
| Field | Decorator | Column |
|---|---|---|
| `tenantId` | `@text` | `tenant_id` |
| `residentId` | `@text` | `resident_id` |
| `templateId` | `@text` | `template_id` |
| `patientMrn` | `@text` | `patient_mrn` (nullable) |
| `patientDob` | `@text` | `patient_dob` (nullable) |
| `patientAgeYears` | `@field` | `patient_age_years` (nullable) |
| `patientHash` | `@text` | `patient_hash` (nullable) |
| `caseDate` | `@text` | `case_date` |
| `fieldValues` | `@json` | `field_values` → `Record<string, unknown>` |
| `accreditationMappings` | `@json` | `accreditation_mappings` → `unknown[]` |
| `isDeidentified` | `@field` | `is_deidentified` |
| `status` | `@text` | `status` |
| `localSyncStatus` | `@text` | `local_sync_status` |
| `serverId` | `@text` | `server_id` (nullable) |
| `createdAt` | `@date` | `created_at` |
| `updatedAt` | `@date` | `updated_at` |

---

### `lib/db/models/CaseTemplate.ts` (15 lines)

**Role**: WatermelonDB model for `case_templates` table.

**Decorators**:
| Field | Decorator | Column |
|---|---|---|
| `tenantId` | `@text` | `tenant_id` |
| `specialty` | `@text` | `specialty` |
| `name` | `@text` | `name` |
| `fields` | `@json` | `fields` → `TemplateField[]` |
| `requiredFields` | `@json` | `required_fields` → `string[]` |
| `createdAt` | `@date` | `created_at` |
| `updatedAt` | `@date` | `updated_at` |

---

### `lib/db/models/ProgramGoal.ts` (15 lines)

**Role**: WatermelonDB model for `program_goals` table.

**Decorators**:
| Field | Decorator | Column |
|---|---|---|
| `tenantId` | `@text` | `tenant_id` |
| `residentId` | `@text` | `resident_id` |
| `title` | `@text` | `title` |
| `targetCount` | `@field` | `target_count` |
| `currentCount` | `@field` | `current_count` |
| `specialty` | `@text` | `specialty` (nullable) |
| `localSyncStatus` | `@text` | `local_sync_status` |
| `createdAt` | `@date` | `created_at` |
| `updatedAt` | `@date` | `updated_at` |

---

### `lib/db/storage.ts` (452 lines)

**Role**: Full CRUD + batch operations for WatermelonDB — the offline data access layer.

**Exports** (24 functions):

| Export | Description |
|---|---|
| `saveDraftCase(data)` | Creates local case entry with `localSyncStatus: 'draft'`. Returns `CaseEntry`. |
| `getDraftCases()` | Returns all entries with localSyncStatus in ['draft', 'conflict', 'modified'] |
| `getConflictedCases()` | Returns all entries with localSyncStatus = 'conflict' |
| `removeAllDrafts()` | Marks all draft cases as deleted |
| `removeDraft(entry)` | Marks single entry as deleted |
| `updateSyncStatus(entry, status, serverId?)` | Updates localSyncStatus + optionally sets serverId |
| `markCaseAsModified(entry)` | Sets localSyncStatus='modified', bumps updatedAt |
| `markCaseAsConflict(entry)` | Sets localSyncStatus='conflict' |
| `getAllCasesForResident(residentId)` | All non-deleted entries for resident |
| `getAllGoalsForResident(residentId)` | All non-deleted goals for resident |
| `upsertCaseEntry(serverData)` | Upsert from server data — **skips** if local is draft/modified/created |
| `upsertTemplate(serverData)` | Upsert template |
| `upsertProgramGoal(serverData)` | Upsert program goal |
| `batchUpsertCaseEntries(serverDataList)` | Batch upsert with conflict skip — uses `prepareCreate`/`prepareUpdate` + `db.batch()` |
| `batchUpsertTemplates(serverDataList)` | Batch upsert templates |
| `batchUpsertGoals(serverDataList)` | Batch upsert goals |
| `getLastSyncTimestamp()` | Reads from AsyncStorage key `last_sync_timestamp` |
| `setLastSyncTimestamp(ts)` | Writes to AsyncStorage |
| `getPreference(key)` | AsyncStorage get |
| `setPreference(key, value)` | AsyncStorage set |

**Key offline patterns**:
- All writes go through `db.write()` transactions
- Batch operations use `prepareCreate`/`prepareUpdate` + `db.batch()` for performance
- `upsertCaseEntry` (and batch variant) **protects local unsynced changes**: if a record has `localSyncStatus` of 'draft', 'modified', or 'created', the server update is skipped to avoid overwriting pending uploads
- JSON fields (`field_values`, `accreditation_mappings`) are stored as strings in SQLite, parsed/stringified via `readJsonField()`
- Dates stored as Unix ms timestamps (numbers)
- `_status` column used for WatermelonDB soft-delete filtering (`Q.notEq('deleted')`)

---

## 7. Lib: Sync Engine

### `lib/sync.ts` — SyncService (485 lines)

**Role**: Core sync engine — pull/push/conflict resolution with retry, periodic sync, and event listeners.

**Exports**:
| Export | Type | Description |
|---|---|---|
| `SyncService` | class | Full sync engine |
| `syncService` | instance | Singleton instance |
| `attachSyncAuthListener(sb, svc)` | fn | Attaches Supabase auth listener → starts periodic sync |
| `useSyncInit()` | hook | React hook that attaches sync auth listener on mount |

**SyncService internal state**:
| Property | Type | Description |
|---|---|---|
| `status` | SyncStatus | 'idle'\|'syncing'\|'error'\|'offline'\|'synced' |
| `listeners` | Set\<(SyncStatus) => void\> | Status change subscribers |
| `conflictCallbacks` | Set\<ConflictCallback\> | Conflict notification subscribers |
| `intervalId` | Timer\|null | Periodic sync interval |
| `retryIndex` | number | Current retry delay index |
| `retryCount` | number | Total retry attempts |
| `pushMutex` | boolean | Mutex preventing concurrent pushes |
| `syncing` | boolean | Mutex preventing concurrent syncs |
| `tenantId` | string\|null | Current tenant ID |
| `MAX_RETRIES` | 10 | Max retry count before giving up |
| `partialFailureMessage` | string\|null | Message for partial failures |

**`initSync(tenantId?)`** — main sync orchestrator:
1. Checks `syncing` mutex → returns if already syncing
2. Checks retry count → if >= MAX_RETRIES, sets 'error' and stops
3. Checks network connectivity → if offline, sets 'offline' and returns
4. Sets status 'syncing'
5. Parallel pulls: `Promise.all([pullCases, pullTemplates, pullGoals])` 
6. Then `pushCases()` → then `handleConflicts()`
7. On success: 'synced' → auto-reverts to 'idle' after 3 seconds
8. On error: increments retry, schedules retry with exponential backoff

**`pullCases(tenantId)`**:
- Reads `lastSyncTimestamp` from AsyncStorage
- Queries `case_entries` with `.gt('updated_at', lastSync)`
- Batch upserts to local DB
- Advances cursor via `pickMaxServerUpdatedAt()`

**`pullTemplates(tenantId)`**:
- Pulls all templates for tenant (no incremental — full pull)
- Batch upserts to local DB

**`pullGoals(tenantId)`**:
- Pulls goals for tenant with current_count (flat, no subquery)
- Batch upserts to local DB

**`pushCases()`**:
- Gets all draft cases (localSyncStatus in ['draft', 'modified', 'conflict'])
- **New drafts** (status='draft'): batch upsert with `.select('id')` → maps returned IDs back to local rows → marks 'synced'
- **Modified drafts** (status='modified'): per-row updates → marks 'synced' or flags 'conflict' on 409
- Conflict handling on 409 errors: marks as 'conflict', fires conflict callbacks
- Partial failures: sets `partialFailureMessage` (e.g., "2 of 5 cases failed to sync")

**`handleConflicts()`**:
- Gets all conflicted entries
- For each: fetches server `updated_at` → if server is newer, overwrites local with server data
- Otherwise: keeps local as conflict (fire callbacks for UI notification)

**Network listener** (`initNetworkListener`):
- On reconnect: resets retry bookkeeping, sets 'idle', triggers `initSync()`
- On disconnect: sets 'offline'

**AppState listener** (`initAppStateListener`):
- On foreground: starts periodic sync (60s), triggers immediate sync
- On background: stops periodic sync

**Event system**:
- `onStatusChange(fn)` → returns unsubscribe function
- `setConflictCallback(fn)` → returns unsubscribe function
- `onPartialFailure(fn)` → for partial failure notifications

**`attachSyncAuthListener`**:
- Listens to Supabase auth state changes
- On SIGNED_OUT: clears tenant, cleans up sync
- On SIGNED_IN: resolves tenantId from profile, starts periodic sync

---

### `lib/sync-incremental.ts` (16 lines)

**Role**: Utility for incremental sync cursor advancement.

**Exports**:
| Export | Description |
|---|---|
| `pickMaxServerUpdatedAt(rows)` | Returns max `updated_at` from an array of server records (supports number or string dates) |

**Logic**: Iterates rows, parses `updated_at` (number or string), returns max timestamp (ms). Ensures cursor moves forward based on server clock, not local clock.

---

### `lib/sync-retry.ts` (12 lines)

**Role**: Exponential backoff with jitter for sync retries.

**Exports**:
| Export | Value/Description |
|---|---|
| `RETRY_DELAYS_MS` | `[30000, 60000, 120000, 300000]` — 30s, 1min, 2min, 5min |
| `MAX_RETRY_DELAY_MS` | `5 * 60 * 1000` — 5 minutes |
| `JITTER_MAX_MS` | `30000` — 30s jitter window |
| `computeRetryDelayMs(retryIndex, random?)` | Returns base delay + random jitter, capped at MAX_RETRY_DELAY_MS |

---

## 8. Lib: Security & Auth

### `lib/auth-guard.ts` (52 lines)

**Role**: Auth state subscription and hook.

**Exports**:
| Export | Type | Description |
|---|---|---|
| `AuthGuardState` | type | `{ isAuthenticated: boolean; isLoading: boolean }` |
| `AuthStateListener` | type | `(state: AuthGuardState) => void` |
| `subscribeToAuth(supabaseClient?, listener?)` | fn | Returns unsubscribe function |
| `useAuthGuard()` | hook | Returns `AuthGuardState` — tracks loading + authenticated |

**Data flow**: `subscribeToAuth()` calls `supabase.auth.getSession()` immediately + subscribes to `onAuthStateChange`. Uses `isActive` flag to prevent state updates after unmount.

---

### `lib/biometric-gate.ts` (106 lines)

**Role**: Low-level module wrapping `expo-local-authentication` with in-memory session cache.

**Exports**:
| Export | Type | Description |
|---|---|---|
| `AuthOutcome` | type | `'unavailable'\|'authed'\|'failed'\|'canceled'\|'error'` |
| `AuthResult` | type | `{ outcome: AuthOutcome; reason?: string }` |
| `isBiometricAvailable()` | async fn | Returns boolean |
| `authenticateWithBiometrics(prompt)` | async fn | Returns `AuthResult` |
| `markBiometricAuthed()` | fn | Sets `lastAuthedAt = Date.now()` |
| `clearBiometricAuthCache()` | fn | Resets `lastAuthedAt = null` |
| `isBiometricSessionValid(now?)` | fn | Checks 5-min TTL |
| `BIOMETRIC_CACHE_TTL_MS` | constant | `5 * 60 * 1000` |

**Module detection**: Wraps native module in a namespace check — falls back to stubs if not linked (CI/tests).

**Error mapping**: `authenticateWithBiometrics` maps `res.error` to:
- `'user_cancel'`, `'system_cancel'`, `'app_cancel'` → 'canceled'
- Other → 'failed'
- Exception → 'error'

---

### `lib/biometric-auth.ts` (137 lines)

**Role**: Higher-level biometric auth service — combines gate + secure-store preferences.

**Exports**:
| Export | Type | Description |
|---|---|---|
| `markBiometricAuthed` | fn | Re-export from biometric-gate |
| `clearBiometricAuthCache` | fn | Re-export from biometric-gate |
| `isBiometricSessionValid` | fn | Re-export from biometric-gate |
| `AuthResult` | type | Re-export from biometric-gate |
| `BiometricGateResult` | type | `{ needsAuth: false }` or `{ needsAuth: true; outcome; reason? }` |
| `getBiometricType()` | async fn | Detects face/fingerprint/iris/null via `expo-local-authentication` |
| `authenticateBiometric(promptMessage?)` | async fn | Returns boolean success |
| `checkBiometricGate()` | async fn | Full gate check — preference → availability → cached session → result |
| `getEffectiveSkipWindow()` | async fn | Returns skip window seconds from SecureStore |

---

### `lib/secure-store.ts` (104 lines)

**Role**: `expo-secure-store` wrapper with in-memory fallback for CI/tests.

**Exports**:
| Export | Description |
|---|---|
| `getSecureItem(key)` | Read from secure store |
| `setSecureItem(key, value)` | Write to secure store (best-effort) |
| `removeSecureItem(key)` | Delete from secure store (best-effort) |
| `getBiometricPreference()` | Returns boolean — whether biometric re-auth is enabled |
| `setBiometricPreference(enabled)` | Enable/disable biometric re-auth |
| `getBiometricSkipWindow()` | Returns seconds (default 30) |
| `setBiometricSkipWindow(seconds)` | Persist skip window |

**Fallback**: If native `getItemAsync` is not available (CI), uses `Map<string, string>` in-memory.

---

### `lib/screenshot-guard.ts` (50 lines)

**Role**: `expo-screen-capture` wrapper with native module detection.

**Exports**:
| Export | Description |
|---|---|
| `usePreventScreenCapture()` | Hook — calls `preventScreenCaptureAsync` on mount, returns cleanup fn that calls `allowScreenCaptureAsync` |
| `onScreenshotAttempt(listener)` | Returns unsubscribe — registers screenshot detection listener |

---

### `lib/patient-hash.ts` (20 lines)

**Role**: Tenant-scoped SHA-256 hash for patient de-identification.

**Exports**:
| Export | Description |
|---|---|
| `generatePatientHash(tenantId, mrn, dob)` | Returns SHA-256 hex digest of `"${tenantId}:${mrn}:${dob}"` |

**Usage**: Called in `log-case.tsx` when submitting de-identified case offline.

---

## 9. Lib: Notifications & Deep Linking

### `lib/notifications.ts` (72 lines)

**Role**: Polling-based case notification checker (P5.17 — deferred push notification implementation).

**Exports**: `useCaseNotifications(residentId, onRejection?)` — React hook

**Return**: `{ badgeCount: Ref<number> }`

**Data flow**:
1. Checks `approval_requests` table filtered by `case_entries.resident_id` and `resolved_at` > last check
2. Counts new approvals + rejections
3. Calls `onRejection(entryId, comment)` if any rejections found
4. Stores `last_notification_check` timestamp in AsyncStorage
5. Polls every 60 seconds

**Note**: File documents the P5.17 decision to defer push notifications — reasoning documented inline.

---

### `lib/linking.ts` (135 lines)

**Role**: Deep linking config — maps URL patterns to screen paths.

**Exports**:
| Export | Description |
|---|---|
| `DeepLinkRoute` | type: `{ screen: string; params?: Record<string, string> }` |
| `parseDeepLink(url)` | Parses URL → `DeepLinkRoute` or null |
| `linkingConfig` | Expo Router linking config object |
| `navigateToDeepLink(route)` | Navigates using `router.navigate()` |

**Supported URL patterns**:
| URL | Screen |
|---|---|
| `elogbook://case/{id}` | `/(tabs)/case-detail?caseId={id}` |
| `elogbook://approvals` | `/(tabs)/approvals` |
| `elogbook://dashboard` | `/(tabs)` (index) |
| `elogbook://profile` | `/(tabs)/profile` |
| `elogbook://log-case` | `/(tabs)/log-case` |
| `elogbook://my-cases` | `/(tabs)/my-cases` |
| `elogbook://ai-insights` | `/(tabs)/ai-insights` |
| `elogbook://duty-hours` | `/(tabs)/duty-hours` |

**Also supports**: Universal links pattern `https://elogbook.app/...`

**Regex**: `/^(?:elogbook:\/\/|https:\/\/elogbook\.app\/)([a-z-]+)(?:\/([^?#]+))?/i`

---

### `lib/notification-handler.ts` (136 lines)

**Role**: Maps notification payloads to deep-link routes.

**Exports**:
| Export | Description |
|---|---|
| `handleNotificationResponse(response)` | Handles tapped notification |
| `registerNotificationHandler()` | Registers expo-notifications listener |
| `handleColdStartNotification()` | Handles cold-start notification |

**Payload types → navigation**:
| type | Screen |
|---|---|
| `case.approved` / `case.rejected` / `case.commented` / `new.rejection` (+ caseId) | `/(tabs)/case-detail?caseId=...` |
| `case.approved` / `case.rejected` / `case.commented` / `new.rejection` (no caseId) | `/(tabs)/my-cases` |
| `approval.pending` / `approval.requested` | `/(tabs)/approvals` |
| `deep.link` (+ url) | Parsed via `parseDeepLink(url)` |

---

## 10. Lib: Utilities

### `lib/haptics.ts` (60 lines)

**Role**: Haptic feedback controller with reduce-motion respect.

**Exports**:
| Export | Description |
|---|---|
| `isReduceMotionEnabled()` | Returns boolean from cached accessibility state |
| `useReduceMotion()` | Hook returning current reduce-motion state |
| `HapticsController` | type: `{ submitSuccess, submitError, offlineSave, approvalAction, selection }` — all async fns |
| `createHapticsController(shouldHaptic)` | Factory: returns controller gated by predicate |
| `useHaptics()` | Hook: returns controller that respects reduce-motion |

**Haptic mappings**:
| Method | expo-haptics call |
|---|---|
| `submitSuccess()` | `notificationAsync(Success)` |
| `submitError()` | `notificationAsync(Error)` |
| `offlineSave()` | `notificationAsync(Warning)` |
| `approvalAction()` | `impactAsync(Heavy)` |
| `selection()` | `selectionAsync()` |

---

## 11. Hooks

### `hooks/useNotificationNavigation.ts` (213 lines)

**Role**: React hook wrapping expo-notifications for navigation on notification tap.

**Exports**:
| Export | Description |
|---|---|
| `NotificationPayload` | type — same as in notification-handler.ts |
| `LastNavigatedRoute` | type — `{ pathname, timestamp, payload }` |
| `useNotificationNavigation(options?)` | Hook — returns `{ lastNavigatedRoute }` |

**Options** (`UseNotificationNavigationOptions`):
| Option | Default | Description |
|---|---|---|
| `handleColdStart` | `true` | Check for cold-start notification on mount |
| `navigationDelay` | `100` | ms delay before navigating |
| `onNavigate` | — | Callback after every notification-driven navigation |

**Internal**: Same payload-to-route mapping as `notification-handler.ts`. Uses `handledColdStart` ref to prevent double-navigation in StrictMode.

---

## Architecture Summary

### Offline-first flow:
```
User Submits → Save to WatermelonDB (localSyncStatus='draft')
              → Try Supabase insert
                → Success: mark 'synced'
                → Failure: leave as 'draft' for next push

SyncService.initSync():
  → Pull cases (incremental via updated_at cursor)
  → Pull templates (full)
  → Pull goals (full)
  → Push cases (batch upsert drafts, per-row update modified)
  → Handle conflicts (server-wins if newer)
```

### Auth + biometric flow:
```
RootLayout:
  useAuthGuard() → session check
  AppState → background → elapsed check → biometric gate overlay

TabLayout:
  isBiometricSessionValid()? → skip : authenticateWithBiometrics()
  AppState → background → invalidate cache
```

### Data persistence layers:
1. **Supabase** (remote source of truth)
2. **WatermelonDB** (local SQLite with encrypted key support)
3. **AsyncStorage** (sync timestamps, preferences, form drafts)
4. **SecureStore** (auth session, encryption keys, biometric preferences)

### Role-based access:
| Feature | resident | supervisor | director | admin |
|---|---|---|---|---|
| Dashboard | ✓ | ✓ | ✓ | ✓ |
| Log Case | ✓ | ✗ | ✗ | ✗ |
| My Cases | ✓ | ✓ | ✓ | ✓ |
| Approvals | ✗ | ✓ | ✓ | ✓ |
| AI Insights | ✓ | ✗ | ✓ | ✓ |
| Case Approve/Reject | ✗ | ✓ | ✓ | ✓ |
