SELECT 'notifications->users' AS check_name, count(*)::text AS orphans
FROM public.notifications n
LEFT JOIN auth.users u ON u.id = n.user_id
WHERE n.user_id IS NOT NULL AND u.id IS NULL
UNION ALL
SELECT 'audit_logs->users', count(*)::text
FROM public.audit_logs a
LEFT JOIN auth.users u ON u.id = a.user_id
WHERE a.user_id IS NOT NULL AND u.id IS NULL
UNION ALL
SELECT 'push_tokens->users', count(*)::text
FROM public.push_tokens p
LEFT JOIN auth.users u ON u.id = p.user_id
WHERE p.user_id IS NOT NULL AND u.id IS NULL
UNION ALL
SELECT 'consent_records->users', count(*)::text
FROM public.consent_records c
LEFT JOIN auth.users u ON u.id = c.user_id
WHERE c.user_id IS NOT NULL AND u.id IS NULL;

SELECT conrelid::regclass::text AS table_with_fk, confrelid::regclass::text AS references_table
FROM pg_constraint
WHERE contype = 'f'
  AND confrelid IN ('public.case_entries'::regclass, 'public.program_goals'::regclass, 'public.rotations'::regclass)
ORDER BY 1;
