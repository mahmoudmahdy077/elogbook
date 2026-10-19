-- 20260922000001_email_retention.sql
DELETE FROM public.email_logs WHERE created_at < now() - interval '90 days';
