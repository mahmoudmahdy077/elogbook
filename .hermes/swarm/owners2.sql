SELECT c.relname, pg_get_userbyid(c.relowner) AS owned_by,
       (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS i_bypassrls,
       has_table_privilege(current_user,'case_entries','UPDATE') AS upd_ok
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname = 'case_entries';
