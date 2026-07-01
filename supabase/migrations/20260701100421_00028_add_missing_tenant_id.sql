-- Add missing tenant_id columns to tables that need them
-- This is a critical security fix for multi-tenant isolation

-- Add tenant_id to approval_requests if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'approval_requests' 
      AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE public.approval_requests ADD COLUMN tenant_id UUID;
    
    -- Backfill existing records from case_entries
    UPDATE approval_requests ar
    SET tenant_id = ce.tenant_id
    FROM case_entries ce
    WHERE ar.entry_id = ce.id;
    
    -- Make NOT NULL after backfill
    ALTER TABLE public.approval_requests ALTER COLUMN tenant_id SET NOT NULL;
  END IF;
END $$;

-- Add foreign key constraint if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'approval_requests_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.approval_requests 
    ADD CONSTRAINT approval_requests_tenant_id_fkey 
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
  END IF;
END $$;

-- Create index for RLS performance
CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant_id ON public.approval_requests(tenant_id);