-- Wave 8: hot-path query plans + index usage stats
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM get_dashboard_data('9cd50d60-febe-4adf-be0f-a36bf82762f6',
  (SELECT id FROM public.profiles WHERE user_id='f2a0d3a0-b3a0-4026-bdfa-ba0a4688a783'),
  'resident');
