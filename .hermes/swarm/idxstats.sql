SELECT relname,
       seq_scan AS seq_scans,
       seq_tup_read,
       idx_scan,
       n_live_tup
FROM pg_stat_user_tables
WHERE schemaname='public' AND n_live_tup > 100
ORDER BY seq_scan DESC LIMIT 12;
