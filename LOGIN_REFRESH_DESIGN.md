# Login Page Refresh — Design

## Scope
Full rework of the web login experience: visual redesign, auth UX improvements, component extraction to shared package, SSO page update.

## Architecture

### Shared Package Components (new)
| Component | File (web) | File (native) | API |
|-----------|-----------|---------------|-----|
| `FormField` | `packages/shared/src/components/FormField.web.tsx` | `FormField.native.tsx` | `{id, label, type, value, onChange, placeholder, autoComplete, required, className, rightElement?}` |
| `FormDivider` | `packages/shared/src/components/FormDivider.web.tsx` | `FormDivider.native.tsx` | `{label, className?}` |
| `Spinner` | `packages/shared/src/components/Spinner.web.tsx` | `Spinner.native.tsx` | `{size?}` |

Components accept a `className` prop for responsive Tailwind overrides from the consumer (matching HeroUI's pattern). Base styles use clinicalTokens via CSS variables or inline styles.

### Login-Local Components (stay in `apps/web/app/login/`)
- `SuccessState` — too specific (magic link sent state with email display)
- `LoginPage` (default export) — composition of shared + local components

## Auth UX

### Password Visibility Toggle
- Eye icon on the right side of the password input
- Click toggles `type="password"` ↔ `type="text"`
- Uses `rightElement` prop on `FormField`
- SVG eye/eye-off icons inline

### Forgot Password
- "Forgot password?" link below the password field
- Calls `supabase.auth.resetPasswordForEmail(email)` with redirect URL
- Shows success toast "Check your email for reset instructions"
- Link is `text-primary` (teal), subtle underline on hover

### Error Handling
- Inline validation: email format check before submit
- Password empty → treat as magic link request (existing behavior)
- Auth errors displayed in the error banner (existing)
- Network errors caught and shown

## Visual Design

### Layout
- Single centered card on dark backdrop (`#060814`)
- No icon box above heading (saves ~52px, APP_NAME is sufficient branding)
- Card: `bg-surface-solid` (`#0F172A`), `border-border` (indigo tint), `rounded-xl`
- Card padding: `p-6 sm:p-8` (tighter than current `p-5 sm:p-10`)
- Max width: `w-full max-w-sm sm:max-w-md` (remove lg/xl scaling — form doesn't need 672px)

### Typography
- Heading: `text-xl sm:text-2xl font-heading font-bold text-text-primary`
- Subtitle: `text-sm text-text-muted`
- Labels: `text-sm font-medium text-text-primary`
- Input text: `text-sm`
- Helper text: `text-xs text-text-muted`

### Responsive
- Base: compact mobile layout
- `sm:` (640px+): slightly more spacious
- `landscape:`: compact (existing pattern, refined)
- Remove the 4-tier (sm/lg/xl) proportional scaling — 2 tiers is enough for a login form

### Button
- Teal (`bg-primary`), full width
- Hover: `bg-primary-hover`
- Disabled: `opacity-40`
- Loading state: spinner + "Signing in..."
- No shadow/lift effect — flat, clean

## SSO Page Redesign
- Match main login card styling (same `bg-surface-solid`, `border-border`, `rounded-xl`, padding)
- Replace `.panel` CSS class usage with Tailwind utilities
- Remove HeroUI `Button` import — use native `<button>` styled with same classes as main login
- Keep same form layout: institution slug input + submit

## Files Modified
| File | Change |
|------|--------|
| `packages/shared/src/components/FormField.web.tsx` | New |
| `packages/shared/src/components/FormField.native.tsx` | New |
| `packages/shared/src/components/FormDivider.web.tsx` | New |
| `packages/shared/src/components/FormDivider.native.tsx` | New |
| `packages/shared/src/components/Spinner.web.tsx` | New |
| `packages/shared/src/components/Spinner.native.tsx` | New |
| `packages/shared/src/components/index.ts` | Add exports |
| `apps/web/app/login/page.tsx` | Rewrite — use shared components, add password toggle + forgot password, tighter spacing |
| `apps/web/app/login/sso/page.tsx` | Rewrite — match new login styling, remove HeroUI dependency |

## Out of Scope
- Mobile login page refresh (separate task)
- Theme toggle on login page
- Social login providers (Google, Apple)
- MFA enrollment page changes
