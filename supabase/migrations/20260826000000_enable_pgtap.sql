-- Enable pgTAP so the cross-tenant/PHI isolation test suites can run
-- against the live project (previously only runnable in local CI docker).
CREATE EXTENSION IF NOT EXISTS pgtap;
