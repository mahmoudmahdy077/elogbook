BEGIN;
SELECT plan(12);

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'pending_role'
  ),
  'profiles stores the requested role separately from the resident bootstrap role'
);
SELECT ok(
  to_regprocedure('public.promote_pending_profile(uuid)') IS NOT NULL,
  'AAL2 promotion RPC exists'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'trg_pending_profile_guard'
  ),
  'pending profile authorization guard exists'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Pending users can read own profile'
  ),
  'pending users can read their own onboarding profile'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tenants' AND policyname = 'Pending users can read assigned tenant'
  ),
  'pending users can resolve their assigned tenant'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.promote_pending_profile(uuid)', 'EXECUTE'),
  'anonymous callers cannot promote profiles'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.promote_pending_profile(uuid)', 'EXECUTE'),
  'authenticated callers can invoke the promotion RPC'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Pending profile promotion'
  ),
  'promotion update policy is constrained to the pending self-profile flow'
);
SELECT ok(
  to_regprocedure('public.protect_tenant_invite_authority()') IS NOT NULL,
  'tenant invite authority guard exists'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.tenant_invites'::regclass
      AND tgname = 'trg_protect_tenant_invite_authority'
  ),
  'tenant invite authority trigger exists'
);
SELECT ok(
  position('status = ''pending''' IN lower(pg_get_functiondef(to_regprocedure('public.promote_pending_profile(uuid)')))) > 0
  AND position('role = ''resident''' IN lower(pg_get_functiondef(to_regprocedure('public.promote_pending_profile(uuid)')))) > 0,
  'promotion is restricted to pending resident bootstrap profiles'
);
SELECT ok(
  position('auth.role() is distinct from ''authenticated''' IN lower(pg_get_functiondef(to_regprocedure('public.promote_pending_profile(uuid)')))) > 0
  AND position('has_aal2()' IN lower(pg_get_functiondef(to_regprocedure('public.promote_pending_profile(uuid)')))) > 0,
  'promotion requires an authenticated AAL2 principal'
);

ROLLBACK;
