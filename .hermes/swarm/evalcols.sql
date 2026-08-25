SELECT string_agg(column_name || ' ' || data_type, E'\n' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='evaluation_forms';
