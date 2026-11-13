-- Intentionally a no-op.
--
-- Part of the 2026-08-25 temporary swarm diagnostics (conjunct bisection v5).
-- It impersonated the authenticated role and swapped case_entries RLS
-- policies whose predicates read public.profiles, which authenticated cannot
-- select on a fresh install (SQLSTATE 42501). Removed from replay with its
-- sibling experiments; see 20260825200000_temp_iso_p3.sql for the full note.
SELECT 1;
