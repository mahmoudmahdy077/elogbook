# Demo Accounts Design

## Purpose

Create pre-seeded demo accounts for testing the E-Logbook platform without needing magic link emails.

## Accounts

All accounts share one institution tenant ("Demo Hospital").

| Email | Password | Role | Display Name |
|---|---|---|---|
| resident@demo.com | demo1234 | resident | Dr. Alex Resident |
| supervisor@demo.com | demo1234 | supervisor | Dr. Sam Supervisor |
| director@demo.com | demo1234 | director | Dr. Dana Director |
| admin@demo.com | demo1234 | institution_admin | Dr. Admin User |
| platform@demo.com | demo1234 | admin | Platform Admin |

## Approach

### 1. Database Migration (`00006_demo_accounts.sql`)

- Create institution tenant "Demo Hospital" with slug `demo`
- Use `supabase_auth.create_user()` to create 5 auth users with email + password + metadata (role, full_name)
- The existing `handle_new_user()` trigger will auto-create tenants/profiles, but since we create institution users first, we handle profiles manually:
  - Insert profiles linked to the institution tenant with assigned roles
  - Update each user's `raw_app_meta_data` with `tenant_id` and `user_role`
  - Delete the auto-created individual tenant for each user (cleanup)

### 2. Login Page Update (`apps/web/app/login/page.tsx`)

- Add a password field below email
- When password is filled, call `signInWithPassword()` instead of `signInWithOtp()`
- Default behavior remains magic link (no password = OTP)
- Add a subtle "or sign in with password" toggle link

### 3. Apply Migration

Run `npx supabase db push` to push the migration to the linked Supabase project.
