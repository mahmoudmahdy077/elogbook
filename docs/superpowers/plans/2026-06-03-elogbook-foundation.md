# E-Logbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-tenant SaaS electronic logbook for junior doctors — Supabase backend, Next.js web app, Expo mobile app with HeroUI design.

**Architecture:** Monorepo with shared types/schemas. Supabase handles auth, database (PostgreSQL + RLS), storage, Edge Functions, and realtime. Next.js App Router for web. Expo Router for mobile. Payment gateway-agnostic with adapter pattern.

**Tech Stack:** TypeScript, Next.js 14 (App Router), Expo SDK 52, HeroUI v2, NativeWind, Supabase, Zod, Stripe/Paddle/LemonSqueezy, Prisma (optional — direct Supabase client preferred)

---

## Phase 1: Foundation

### Task 1: Initialize Monorepo

**Files:**
- Create: `package.json` (root)
- Create: `turbo.json`
- Create: `tsconfig.json` (root)
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.js`
- Create: `apps/mobile/package.json`
- Create: `apps/mobile/tsconfig.json`
- Create: `apps/mobile/app.json`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/supabase/package.json`
- Create: `.gitignore`

- [ ] **Step 1: Create root package.json**

```bash
mkdir -p G:\elogbook\apps\web G:\elogbook\apps\mobile G:\elogbook\packages\shared\src G:\elogbook\packages\supabase
```

Write `G:\elogbook\package.json`:
```json
{
  "name": "elogbook",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev:web": "turbo run dev --filter=@elogbook/web",
    "dev:mobile": "turbo run start --filter=@elogbook/mobile",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create turbo.json**

Write `G:\elogbook\turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] }
  }
}
```

- [ ] **Step 3: Create apps/web/package.json**

Write `G:\elogbook\apps\web\package.json`:
```json
{
  "name": "@elogbook/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@heroui/react": "^2.5.0",
    "@supabase/ssr": "^0.4.0",
    "@supabase/supabase-js": "^2.43.0",
    "zod": "^3.23.0",
    "date-fns": "^3.6.0",
    "framer-motion": "^11.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.4.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0"
  }
}
```

- [ ] **Step 4: Create apps/web/next.config.js**

Write `G:\elogbook\apps\web\next.config.js`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@elogbook/shared'],
};

module.exports = nextConfig;
```

- [ ] **Step 5: Create apps/web/tailwind.config.ts**

Write `G:\elogbook\apps\web\tailwind.config.ts`:
```ts
import { heroui } from '@heroui/react';
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}',
  ],
  theme: { extend: {} },
  darkMode: 'class',
  plugins: [heroui()],
};

export default config;
```

- [ ] **Step 6: Create apps/mobile/package.json**

Write `G:\elogbook\apps\mobile\package.json`:
```json
{
  "name": "@elogbook/mobile",
  "version": "0.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "lint": "expo lint",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "expo": "~52.0.0",
    "expo-router": "~4.0.0",
    "expo-camera": "~16.0.0",
    "expo-image-picker": "~16.0.0",
    "expo-notifications": "~0.29.0",
    "expo-file-system": "~18.0.0",
    "react": "18.3.1",
    "react-native": "0.76.0",
    "react-native-safe-area-context": "~4.12.0",
    "react-native-screens": "~4.0.0",
    "@supabase/supabase-js": "^2.43.0",
    "@react-native-async-storage/async-storage": "^2.0.0",
    "nativewind": "^4.1.0",
    "zod": "^3.23.0",
    "date-fns": "^3.6.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "typescript": "^5.4.0",
    "tailwindcss": "^3.4.0"
  }
}
```

- [ ] **Step 7: Create packages/shared/package.json**

Write `G:\elogbook\packages\shared\package.json`:
```json
{
  "name": "@elogbook/shared",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 8: Create .gitignore**

Write `G:\elogbook\.gitignore`:
```
node_modules/
.next/
dist/
.expo/
.env
.env.local
.superpowers/
```

- [ ] **Step 9: Install dependencies**

Run: `npm install`

- [ ] **Step 10: Commit**

```bash
git init && git add -A && git commit -m "feat: initialize monorepo with Next.js, Expo, shared packages"
```

---

### Task 2: Shared Types & Validation Schemas

**Files:**
- Create: `packages/shared/src/types/database.ts`
- Create: `packages/shared/src/schemas/cases.ts`
- Create: `packages/shared/src/schemas/auth.ts`
- Create: `packages/shared/src/schemas/subscriptions.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Write database types**

Write `G:\elogbook\packages\shared\src\types\database.ts`:
```ts
export type TenantType = 'individual' | 'institution';
export type UserRole = 'resident' | 'supervisor' | 'director' | 'institution_admin' | 'admin';
export type CaseStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export interface Institution {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  tier: string;
  created_at: string;
  updated_at: string;
}

export interface Tenant {
  id: string;
  institution_id: string | null;
  name: string;
  slug: string;
  tenant_type: TenantType;
  plan_id: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  tenant_id: string;
  user_id: string;
  role: UserRole;
  full_name: string;
  specialty: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseTemplate {
  id: string;
  tenant_id: string;
  specialty: string;
  name: string;
  fields: TemplateField[];
  required_fields: string[];
  created_at: string;
  updated_at: string;
}

export interface TemplateField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'date' | 'checkbox';
  options?: string[];
  required?: boolean;
}

export interface CaseEntry {
  id: string;
  tenant_id: string;
  resident_id: string;
  template_id: string;
  patient_mrn: string;
  patient_dob: string;
  case_date: string;
  field_values: Record<string, unknown>;
  status: CaseStatus;
  created_at: string;
  updated_at: string;
}

export interface CaseAttachment {
  id: string;
  entry_id: string;
  file_path: string;
  file_type: string;
  uploaded_at: string;
}

export interface ApprovalRequest {
  id: string;
  entry_id: string;
  supervisor_id: string;
  status: 'pending' | 'approved' | 'rejected';
  comment: string | null;
  requested_at: string;
  resolved_at: string | null;
}

export interface AuditLog {
  id: string;
  tenant_id: string;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  changes: Record<string, unknown> | null;
  ip_address: string;
  created_at: string;
}

export interface AIConfig {
  id: string;
  tenant_id: string;
  provider: 'openai' | 'anthropic' | 'azure' | 'openrouter' | 'custom';
  model: string;
  encrypted_api_key: string;
  endpoint_url: string | null;
  is_active: boolean;
}

export interface ProgramGoal {
  id: string;
  tenant_id: string;
  director_id: string;
  resident_id: string;
  title: string;
  target_count: number;
  specialty: string | null;
  deadline: string;
  description: string | null;
  created_at: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  price_monthly: number;
  features: Record<string, unknown>;
  tenant_type: TenantType;
  max_residents: number | null;
}

export interface PaymentGatewayConfig {
  id: string;
  tenant_id: string;
  provider: 'stripe' | 'paddle' | 'lemonsqueezy' | 'custom';
  publishable_key: string;
  encrypted_secret_key: string;
  encrypted_webhook_secret: string;
  endpoint_url: string | null;
  is_active: boolean;
}
```

- [ ] **Step 2: Write Zod schemas**

Write `G:\elogbook\packages\shared\src\schemas\cases.ts`:
```ts
import { z } from 'zod';

export const templateFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'textarea', 'select', 'number', 'date', 'checkbox']),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
});

export const caseTemplateSchema = z.object({
  specialty: z.string().min(1),
  name: z.string().min(1),
  fields: z.array(templateFieldSchema).min(1),
  required_fields: z.array(z.string()),
});

export const caseEntrySchema = z.object({
  template_id: z.string().uuid(),
  patient_mrn: z.string().min(1).max(50),
  patient_dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  case_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  field_values: z.record(z.unknown()),
});

export const approvalActionSchema = z.object({
  entry_id: z.string().uuid(),
  action: z.enum(['approve', 'reject']),
  comment: z.string().max(500).optional(),
});

export const programGoalSchema = z.object({
  resident_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  target_count: z.number().int().min(1),
  specialty: z.string().nullable().optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(1000).nullable().optional(),
});
```

Write `G:\elogbook\packages\shared\src\schemas\auth.ts`:
```ts
import { z } from 'zod';

export const profileSchema = z.object({
  full_name: z.string().min(1).max(100),
  specialty: z.string().max(100).nullable().optional(),
});

export const inviteUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(['resident', 'supervisor', 'director', 'institution_admin', 'admin']),
  full_name: z.string().min(1),
  specialty: z.string().optional(),
});
```

Write `G:\elogbook\packages\shared\src\schemas\subscriptions.ts`:
```ts
import { z } from 'zod';

export const subscriptionPlanSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  price_monthly: z.number().min(0),
  features: z.record(z.unknown()),
  tenant_type: z.enum(['individual', 'institution']),
  max_residents: z.number().int().nullable().optional(),
});

export const paymentGatewayConfigSchema = z.object({
  provider: z.enum(['stripe', 'paddle', 'lemonsqueezy', 'custom']),
  publishable_key: z.string().min(1),
  encrypted_secret_key: z.string().min(1),
  encrypted_webhook_secret: z.string().min(1),
  endpoint_url: z.string().url().nullable().optional(),
  is_active: z.boolean(),
});
```

- [ ] **Step 3: Write barrel export**

Write `G:\elogbook\packages\shared\src\index.ts`:
```ts
export * from './types/database';
export * from './schemas/cases';
export * from './schemas/auth';
export * from './schemas/subscriptions';
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --project packages/shared/tsconfig.json`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add packages/shared/
git commit -m "feat: add shared types, Zod schemas for database, auth, cases, subscriptions"
```

---

### Task 3: Supabase Project & Database Schema

**Files:**
- Create: `supabase/migrations/00001_schema.sql`
- Create: `supabase/migrations/00002_rls_policies.sql`
- Create: `supabase/migrations/00003_triggers.sql`
- Create: `supabase/seed.sql`

- [ ] **Step 1: Create initial schema migration**

Write `G:\elogbook\supabase\migrations\00001_schema.sql`:
```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Institutions
CREATE TABLE institutions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  settings JSONB DEFAULT '{}',
  tier TEXT DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tenants (programs or individual accounts)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  tenant_type TEXT NOT NULL CHECK (tenant_type IN ('individual', 'institution')) DEFAULT 'institution',
  plan_id UUID,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Profiles (linked to auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin')),
  full_name TEXT NOT NULL,
  specialty TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Case templates
CREATE TABLE case_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  specialty TEXT NOT NULL,
  name TEXT NOT NULL,
  fields JSONB NOT NULL,
  required_fields JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Case entries
CREATE TABLE case_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES case_templates(id) ON DELETE RESTRICT,
  patient_mrn TEXT NOT NULL,
  patient_dob DATE NOT NULL,
  case_date DATE NOT NULL DEFAULT CURRENT_DATE,
  field_values JSONB DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'approved', 'rejected')) DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_case_entries_tenant ON case_entries(tenant_id);
CREATE INDEX idx_case_entries_resident ON case_entries(resident_id);
CREATE INDEX idx_case_entries_status ON case_entries(status);
CREATE INDEX idx_case_entries_field_values ON case_entries USING GIN (field_values);

-- Case attachments
CREATE TABLE case_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id UUID NOT NULL REFERENCES case_entries(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Approval requests
CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id UUID NOT NULL REFERENCES case_entries(id) ON DELETE CASCADE,
  supervisor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  comment TEXT,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Audit logs
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  changes JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- Program goals
CREATE TABLE program_goals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  director_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  target_count INTEGER NOT NULL CHECK (target_count > 0),
  specialty TEXT,
  deadline DATE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Goal progress (computed)
CREATE TABLE goal_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  goal_id UUID NOT NULL REFERENCES program_goals(id) ON DELETE CASCADE UNIQUE,
  resident_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  current_count INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Subscription plans
CREATE TABLE subscription_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  price_monthly NUMERIC(10,2) NOT NULL,
  features JSONB DEFAULT '{}',
  tenant_type TEXT NOT NULL CHECK (tenant_type IN ('individual', 'institution')),
  max_residents INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subscriptions
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'unpaid', 'trialing')) DEFAULT 'active',
  gateway_subscription_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'usd',
  gateway_payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- One-time purchases (AI reports, etc.)
CREATE TABLE one_time_purchases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  resident_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  purchase_type TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  gateway_payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  consumed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI config
CREATE TABLE ai_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'azure', 'openrouter', 'custom')),
  model TEXT NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  endpoint_url TEXT,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Resident AI toggle
CREATE TABLE resident_ai_toggle (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT FALSE,
  quota_limit INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, resident_id)
);

-- AI query logs
CREATE TABLE ai_query_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  response TEXT,
  tokens_used INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payment gateway config
CREATE TABLE payment_gateway_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'paddle', 'lemonsqueezy', 'custom')),
  publishable_key TEXT NOT NULL,
  encrypted_secret_key TEXT NOT NULL,
  encrypted_webhook_secret TEXT NOT NULL,
  endpoint_url TEXT,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
        'institutions', 'tenants', 'profiles', 'case_templates', 'case_entries',
        'subscriptions', 'ai_config', 'payment_gateway_config'
      )
  LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()',
      t
    );
  END LOOP;
END;
$$;
```

- [ ] **Step 2: Write RLS policies**

Write `G:\elogbook\supabase\migrations\00002_rls_policies.sql`:
```sql
-- Enable RLS on all tables
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE one_time_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE resident_ai_toggle ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_query_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_gateway_config ENABLE ROW LEVEL SECURITY;

-- Helper: get tenant_id from JWT
CREATE OR REPLACE FUNCTION get_tenant_id()
RETURNS UUID AS $$
BEGIN
  RETURN (auth.jwt()->>'tenant_id')::UUID;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Helper: get user role from JWT
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
BEGIN
  RETURN auth.jwt()->>'user_role';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Profiles: users can read own profile; supervisors+ can read tenant profiles
CREATE POLICY "profiles_read_own" ON profiles
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "profiles_read_tenant" ON profiles
  FOR SELECT USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT WITH CHECK (tenant_id = get_tenant_id());

-- Case entries: residents read own, supervisors+ read tenant
CREATE POLICY "case_entries_read_own" ON case_entries
  FOR SELECT USING (resident_id IN (
    SELECT id FROM profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "case_entries_read_tenant" ON case_entries
  FOR SELECT USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

CREATE POLICY "case_entries_insert" ON case_entries
  FOR INSERT WITH CHECK (
    tenant_id = get_tenant_id()
    AND resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "case_entries_update_own" ON case_entries
  FOR UPDATE USING (
    resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND status = 'draft'
  );

-- Approvals: supervisors manage their tenant's approvals
CREATE POLICY "approvals_read_tenant" ON approval_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM case_entries ce
      WHERE ce.id = approval_requests.entry_id
      AND ce.tenant_id = get_tenant_id()
    )
  );

CREATE POLICY "approvals_insert_supervisor" ON approval_requests
  FOR INSERT WITH CHECK (TRUE); -- handled at app layer

CREATE POLICY "approvals_update_supervisor" ON approval_requests
  FOR UPDATE USING (
    supervisor_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    OR get_user_role() IN ('director', 'institution_admin', 'admin')
  );

-- Audit logs: read by admin roles only
CREATE POLICY "audit_logs_read_admin" ON audit_logs
  FOR SELECT USING (
    get_user_role() IN ('director', 'institution_admin', 'admin')
  );

CREATE POLICY "audit_logs_insert" ON audit_logs
  FOR INSERT WITH CHECK (tenant_id = get_tenant_id());

-- Goals: directors write, residents read own
CREATE POLICY "goals_read_tenant" ON program_goals
  FOR SELECT USING (tenant_id = get_tenant_id());

CREATE POLICY "goals_insert_director" ON program_goals
  FOR INSERT WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'admin')
  );

-- Admin-only tables
CREATE POLICY "admin_read" ON ai_config
  FOR SELECT USING (get_user_role() = 'admin');

CREATE POLICY "admin_write" ON ai_config
  FOR ALL USING (get_user_role() = 'admin');

CREATE POLICY "admin_read_gateway" ON payment_gateway_config
  FOR SELECT USING (get_user_role() IN ('admin', 'director'));

CREATE POLICY "admin_write_gateway" ON payment_gateway_config
  FOR ALL USING (get_user_role() = 'admin');
```

- [ ] **Step 3: Write triggers**

Write `G:\elogbook\supabase\migrations\00003_triggers.sql`:
```sql
-- Function: log audit entries on case_entries changes
CREATE OR REPLACE FUNCTION audit_case_entry()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
  VALUES (
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    auth.uid(),
    CASE
      WHEN TG_OP = 'INSERT' THEN 'create'
      WHEN TG_OP = 'UPDATE' THEN 'update'
      WHEN TG_OP = 'DELETE' THEN 'delete'
    END,
    'case_entry',
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP = 'UPDATE' THEN
      jsonb_build_object('old', row_to_json(OLD)::jsonb, 'new', row_to_json(NEW)::jsonb)
    ELSE NULL END,
    NULL
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER audit_case_entry_trigger
  AFTER INSERT OR UPDATE OR DELETE ON case_entries
  FOR EACH ROW EXECUTE FUNCTION audit_case_entry();

-- Function: auto-approve for individual tenants
CREATE OR REPLACE FUNCTION auto_approve_individual()
RETURNS TRIGGER AS $$
DECLARE
  t_type TEXT;
BEGIN
  SELECT tenant_type INTO t_type FROM tenants WHERE id = NEW.tenant_id;
  IF t_type = 'individual' AND NEW.status = 'pending' THEN
    NEW.status := 'approved';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_approve_individual_trigger
  BEFORE INSERT OR UPDATE ON case_entries
  FOR EACH ROW EXECUTE FUNCTION auto_approve_individual();

-- Function: update goal progress on case insert
CREATE OR REPLACE FUNCTION update_goal_progress()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' THEN
    UPDATE goal_progress gp
    SET current_count = (
      SELECT COUNT(*) FROM case_entries ce
      WHERE ce.resident_id = NEW.resident_id
        AND ce.status = 'approved'
        AND (gp.goal_id IN (
          SELECT pg.id FROM program_goals pg
          WHERE pg.resident_id = NEW.resident_id
            AND (pg.specialty IS NULL OR ce.field_values->>'specialty' = pg.specialty)
        ))
    ),
    last_updated = NOW()
    WHERE gp.resident_id = NEW.resident_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_goal_progress_trigger
  AFTER INSERT OR UPDATE OR DELETE ON case_entries
  FOR EACH ROW EXECUTE FUNCTION update_goal_progress();
```

- [ ] **Step 4: Write seed data**

Write `G:\elogbook\supabase\seed.sql`:
```sql
-- Default subscription plans
INSERT INTO subscription_plans (name, slug, price_monthly, features, tenant_type, max_residents) VALUES
  ('Free', 'free', 0, '{"ai_insights": false, "pdf_export": false, "max_cases": 20}', 'individual', 1),
  ('Individual Premium', 'individual-premium', 9.99, '{"ai_insights": true, "pdf_export": true, "max_cases": null, "goals": true}', 'individual', 1),
  ('Institution Basic', 'institution-basic', 49.99, '{"ai_insights": false, "pdf_export": true, "approval_workflow": true}', 'institution', 10),
  ('Institution Pro', 'institution-pro', 149.99, '{"ai_insights": true, "pdf_export": true, "approval_workflow": true, "goals": true, "audit": true}', 'institution', 50),
  ('Institution Enterprise', 'institution-enterprise', 0, '{"ai_insights": true, "pdf_export": true, "approval_workflow": true, "goals": true, "audit": true, "sso": true}', 'institution', NULL);

-- Default case templates
INSERT INTO case_templates (tenant_id, specialty, name, fields, required_fields) VALUES
  ('00000000-0000-0000-0000-000000000000', 'surgery', 'Surgical Procedure',
   '[{"key":"procedure_name","label":"Procedure Name","type":"text","required":true},{"key":"anesthesia_type","label":"Anesthesia Type","type":"select","options":["General","Regional","Local","Sedation"],"required":true},{"key":"supervision_level","label":"Supervision Level","type":"select","options":["Observed","Assisted","Performed Supervised","Performed Independently"],"required":true},{"key":"complications","label":"Complications","type":"textarea"}]',
   '["procedure_name","anesthesia_type","supervision_level"]'),
  ('00000000-0000-0000-0000-000000000000', 'radiology', 'Radiology Study',
   '[{"key":"modality","label":"Modality","type":"select","options":["X-Ray","CT","MRI","Ultrasound","Nuclear Medicine","Mammography"],"required":true},{"key":"body_part","label":"Body Part","type":"text","required":true},{"key":"findings","label":"Findings","type":"textarea","required":true},{"key":"contrast_used","label":"Contrast Used","type":"checkbox"}]',
   '["modality","body_part","findings"]');
```

- [ ] **Step 5: Commit**

```bash
git add supabase/
git commit -m "feat: add full database schema, RLS policies, triggers, seed data"
```

---

### Task 4: Supabase Client Setup & Auth (Web)

**Files:**
- Create: `apps/web/lib/supabase/client.ts`
- Create: `apps/web/lib/supabase/server.ts`
- Create: `apps/web/lib/supabase/middleware.ts`
- Create: `apps/web/middleware.ts`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/login/page.tsx`
- Create: `apps/web/app/auth/callback/route.ts`
- Create: `apps/web/.env.local.example`

- [ ] **Step 1: Create Supabase browser client**

Write `G:\elogbook\apps\web\lib\supabase\client.ts`:
```ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 2: Create Supabase server client**

Write `G:\elogbook\apps\web\lib\supabase\server.ts`:
```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}
```

- [ ] **Step 3: Create middleware**

Write `G:\elogbook\apps\web\lib\supabase\middleware.ts`:
```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Redirect unauthenticated users to login
  if (!user && !request.nextUrl.pathname.startsWith('/login') && !request.nextUrl.pathname.startsWith('/auth')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Redirect authenticated users away from login
  if (user && request.nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return supabaseResponse;
}
```

Write `G:\elogbook\apps\web\middleware.ts`:
```ts
import { updateSession } from '@/lib/supabase/middleware';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

- [ ] **Step 4: Create root layout with HeroUI provider**

Write `G:\elogbook\apps\web\app\layout.tsx`:
```tsx
import { HeroUIProvider } from '@heroui/react';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'E-Logbook',
  description: 'Electronic logbook for medical residents',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <HeroUIProvider>{children}</HeroUIProvider>
      </body>
    </html>
  );
}
```

Write `G:\elogbook\apps\web\app\globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 5: Create login page**

Write `G:\elogbook\apps\web\app\login\page.tsx`:
```tsx
'use client';

import { createClient } from '@/lib/supabase/client';
import { Button, Card, CardBody, CardHeader, Input } from '@heroui/react';
import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleLogin = async () => {
    setLoading(true);
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setSent(true);
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex-col gap-1">
          <h1 className="text-2xl font-bold">E-Logbook</h1>
          <p className="text-sm text-default-500">Sign in to your account</p>
        </CardHeader>
        <CardBody className="gap-4">
          {sent ? (
            <div className="text-center text-success">
              <p>Check your email for a magic link!</p>
            </div>
          ) : (
            <>
              <Input
                type="email"
                label="Email"
                value={email}
                onValueChange={setEmail}
                placeholder="doctor@hospital.org"
              />
              <Button
                color="primary"
                isLoading={loading}
                onPress={handleLogin}
                isDisabled={!email}
              >
                Send Magic Link
              </Button>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: Create auth callback route**

Write `G:\elogbook\apps\web\app\auth\callback\route.ts`:
```ts
import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
```

- [ ] **Step 7: Create env template**

Write `G:\elogbook\apps\web\.env.local.example`:
```
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 8: Verify build compiles**

Run: `npx next build` in `apps/web`
Expected: build succeeds (pages will be mostly empty)

- [ ] **Step 9: Commit**

```bash
git add apps/web/
git commit -m "feat: add Supabase auth, middleware, login page with HeroUI"
```

---

### Task 5: Auth Profile Creation (Auto on Signup)

**Files:**
- Create: `supabase/migrations/00004_auth_triggers.sql`
- Create: `apps/web/app/(authenticated)/layout.tsx`
- Create: `apps/web/app/(authenticated)/dashboard/page.tsx`

- [ ] **Step 1: Create auth trigger for profile auto-creation**

Write `G:\elogbook\supabase\migrations\00004_auth_triggers.sql`:
```sql
-- Auto-create profile + tenant on first signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_tenant_id UUID;
  role_text TEXT;
BEGIN
  role_text := COALESCE(NEW.raw_user_meta_data->>'role', 'resident');

  -- Create personal tenant for the user
  INSERT INTO tenants (name, slug, tenant_type)
  VALUES (NEW.email, 'user-' || NEW.id, 'individual')
  RETURNING id INTO new_tenant_id;

  -- Create profile
  INSERT INTO profiles (tenant_id, user_id, role, full_name)
  VALUES (
    new_tenant_id,
    NEW.id,
    role_text,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );

  -- Set tenant_id and role in JWT claims
  UPDATE auth.users
  SET raw_app_meta_data = jsonb_build_object(
    'tenant_id', new_tenant_id,
    'user_role', role_text
  )
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

- [ ] **Step 2: Create authenticated layout (with tenant check + navigation)**

Write `G:\elogbook\apps\web\app\(authenticated)\layout.tsx`:
```tsx
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Navbar, NavbarBrand, NavbarContent, NavbarItem, Button } from '@heroui/react';
import Link from 'next/link';

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, tenants(slug, tenant_type)')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');

  const tenantSlug = profile.tenants?.slug ?? 'me';

  return (
    <div className="min-h-screen bg-background">
      <Navbar isBordered>
        <NavbarBrand>
          <Link href={`/${tenantSlug}/dashboard`} className="font-bold text-xl">
            E-Logbook
          </Link>
        </NavbarBrand>
        <NavbarContent justify="end">
          <NavbarItem>
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="light" size="sm">Sign Out</Button>
            </form>
          </NavbarItem>
        </NavbarContent>
      </Navbar>
      <main className="p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Create dashboard page (stub)**

Write `G:\elogbook\apps\web\app\(authenticated)\dashboard\page.tsx`:
```tsx
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, CardBody, CardHeader } from '@heroui/react';

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  const { count: draftCount } = await supabase
    .from('case_entries')
    .select('*', { count: 'exact', head: true })
    .eq('resident_id', user!.id)
    .eq('status', 'draft');

  const { count: approvedCount } = await supabase
    .from('case_entries')
    .select('*', { count: 'exact', head: true })
    .eq('resident_id', user!.id)
    .eq('status', 'approved');

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>Draft Cases</CardHeader>
          <CardBody><p className="text-3xl font-bold">{draftCount ?? 0}</p></CardBody>
        </Card>
        <Card>
          <CardHeader>Approved Cases</CardHeader>
          <CardBody><p className="text-3xl font-bold">{approvedCount ?? 0}</p></CardBody>
        </Card>
        <Card>
          <CardHeader>Pending Review</CardHeader>
          <CardBody><p className="text-3xl font-bold">0</p></CardBody>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: auto-create profile on signup, authenticated layout, dashboard stub"
```

---

## Phase 2: Core Case Logging

### Task 6: Case Entry CRUD (API + Page)

**Files:**
- Create: `apps/web/app/(authenticated)/[tenant]/cases/page.tsx`
- Create: `apps/web/app/(authenticated)/[tenant]/cases/new/page.tsx`
- Create: `apps/web/app/(authenticated)/[tenant]/cases/[id]/page.tsx`
- Create: `apps/web/components/CaseForm.tsx`
- Create: `apps/web/components/CaseCard.tsx`

- [ ] **Step 1: Case form component**

Write `G:\elogbook\apps\web\components\CaseForm.tsx`:
```tsx
'use client';

import { createClient } from '@/lib/supabase/client';
import { Button, Input, Select, SelectItem, Textarea, DatePicker } from '@heroui/react';
import type { CaseTemplate } from '@elogbook/shared';
import { caseEntrySchema } from '@elogbook/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { parseDate } from '@internationalized/date';

interface Props {
  tenantId: string;
  tenantSlug: string;
  initialStatus?: 'draft' | 'pending';
}

export default function CaseForm({ tenantId, tenantSlug, initialStatus = 'draft' }: Props) {
  const [templates, setTemplates] = useState<CaseTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<CaseTemplate | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [patientMrn, setPatientMrn] = useState('');
  const [patientDob, setPatientDob] = useState('');
  const [caseDate, setCaseDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    supabase
      .from('case_templates')
      .select('*')
      .eq('tenant_id', tenantId)
      .then(({ data }) => { if (data) setTemplates(data as CaseTemplate[]); });
  }, [tenantId]);

  const handleSubmit = async () => {
    setErrors([]);
    const parsed = caseEntrySchema.safeParse({
      template_id: selectedTemplate?.id,
      patient_mrn: patientMrn,
      patient_dob: patientDob,
      case_date: caseDate,
      field_values: fieldValues,
    });

    if (!parsed.success) {
      setErrors(parsed.error.errors.map(e => e.message));
      return;
    }

    setLoading(true);
    const { error } = await supabase.from('case_entries').insert({
      tenant_id: tenantId,
      template_id: selectedTemplate!.id,
      patient_mrn: patientMrn,
      patient_dob: patientDob,
      case_date: caseDate,
      field_values: fieldValues,
      status: initialStatus,
    });

    if (error) {
      setErrors([error.message]);
      setLoading(false);
      return;
    }

    router.push(`/${tenantSlug}/cases`);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {templates.length === 0 ? (
        <Card><CardBody><p>No templates available. Ask your admin to create one.</p></CardBody></Card>
      ) : (
        <>
          <Select
            label="Case Template"
            placeholder="Select a template"
            onSelectionChange={(keys) => {
              const key = Array.from(keys)[0] as string;
              setSelectedTemplate(templates.find(t => t.id === key) ?? null);
              setFieldValues({});
            }}
          >
            {templates.map(t => (
              <SelectItem key={t.id}>{t.specialty} — {t.name}</SelectItem>
            ))}
          </Select>

          <Input label="Patient MRN" value={patientMrn} onValueChange={setPatientMrn} />
          <Input label="Patient DOB" type="date" value={patientDob} onValueChange={setPatientDob} />
          <Input label="Case Date" type="date" value={caseDate} onValueChange={setCaseDate} />

          {selectedTemplate?.fields.map((field) => {
            const value = fieldValues[field.key] as string ?? '';
            if (field.type === 'textarea') {
              return (
                <Textarea
                  key={field.key}
                  label={field.label}
                  value={value}
                  onValueChange={(v) => setFieldValues({ ...fieldValues, [field.key]: v })}
                />
              );
            }
            if (field.type === 'select' && field.options) {
              return (
                <Select
                  key={field.key}
                  label={field.label}
                  onSelectionChange={(keys) =>
                    setFieldValues({ ...fieldValues, [field.key]: Array.from(keys)[0] })
                  }
                >
                  {field.options.map(opt => (
                    <SelectItem key={opt}>{opt}</SelectItem>
                  ))}
                </Select>
              );
            }
            return (
              <Input
                key={field.key}
                label={field.label}
                value={value}
                onValueChange={(v) => setFieldValues({ ...fieldValues, [field.key]: v })}
              />
            );
          })}

          {errors.length > 0 && (
            <div className="text-danger text-sm">
              {errors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}

          <div className="flex gap-3">
            <Button color="default" onPress={() => router.back()}>Cancel</Button>
            <Button
              color="primary"
              isLoading={loading}
              isDisabled={!selectedTemplate}
              onPress={handleSubmit}
            >
              Save as {initialStatus === 'draft' ? 'Draft' : 'Submit'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Case list page**

Write `G:\elogbook\apps\web\app\(authenticated)\[tenant]\cases\page.tsx`:
```tsx
import { createServerSupabase } from '@/lib/supabase/server';
import { Button, Chip, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@heroui/react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function CasesPage({ params }: { params: { tenant: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, tenants!inner(slug, tenant_type)')
    .eq('user_id', user.id)
    .single();

  if (!profile || profile.tenants.slug !== params.tenant) notFound();

  const { data: cases } = await supabase
    .from('case_entries')
    .select('*, case_templates(name, specialty)')
    .eq('resident_id', profile.id)
    .order('created_at', { ascending: false });

  const statusColor = (s: string) => {
    switch (s) {
      case 'draft': return 'warning' as const;
      case 'pending': return 'primary' as const;
      case 'approved': return 'success' as const;
      case 'rejected': return 'danger' as const;
      default: return 'default' as const;
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">My Cases</h1>
        <Link href={`/${params.tenant}/cases/new`}>
          <Button color="primary">Log New Case</Button>
        </Link>
      </div>
      <Table aria-label="Cases">
        <TableHeader>
          <TableColumn>Date</TableColumn>
          <TableColumn>Template</TableColumn>
          <TableColumn>MRN</TableColumn>
          <TableColumn>Status</TableColumn>
          <TableColumn>Actions</TableColumn>
        </TableHeader>
        <TableBody>
          {(cases ?? []).map((c) => (
            <TableRow key={c.id}>
              <TableCell>{c.case_date}</TableCell>
              <TableCell>{c.case_templates?.specialty} / {c.case_templates?.name}</TableCell>
              <TableCell>{c.patient_mrn}</TableCell>
              <TableCell><Chip color={statusColor(c.status)} size="sm">{c.status}</Chip></TableCell>
              <TableCell>
                <Link href={`/${params.tenant}/cases/${c.id}`}>
                  <Button size="sm" variant="light">View</Button>
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 3: Case detail page**

Write `G:\elogbook\apps\web\app\(authenticated)\[tenant]\cases\[id]\page.tsx`:
```tsx
import { createServerSupabase } from '@/lib/supabase/server';
import { Chip, Card, CardBody, CardHeader, Button } from '@heroui/react';
import { notFound } from 'next/navigation';

export default async function CaseDetailPage({ params }: { params: { tenant: string; id: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: entry } = await supabase
    .from('case_entries')
    .select('*, case_templates(name, specialty, fields), profiles!case_entries_resident_id_fkey(full_name)')
    .eq('id', params.id)
    .single();

  if (!entry) notFound();

  const statusColor = (s: string) => {
    switch (s) {
      case 'draft': return 'warning' as const;
      case 'pending': return 'primary' as const;
      case 'approved': return 'success' as const;
      case 'rejected': return 'danger' as const;
      default: return 'default' as const;
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader className="flex justify-between">
          <div>
            <h1 className="text-xl font-bold">{entry.case_templates?.specialty} — {entry.case_templates?.name}</h1>
            <p className="text-sm text-default-500">Logged by {entry.profiles?.full_name}</p>
          </div>
          <Chip color={statusColor(entry.status)}>{entry.status}</Chip>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm text-default-500">Patient MRN</label><p>{entry.patient_mrn}</p></div>
            <div><label className="text-sm text-default-500">Patient DOB</label><p>{entry.patient_dob}</p></div>
            <div><label className="text-sm text-default-500">Case Date</label><p>{entry.case_date}</p></div>
          </div>
          <div>
            <label className="text-sm text-default-500 block mb-2">Case Details</label>
            {Array.isArray(entry.case_templates?.fields) && entry.case_templates.fields.map((f: Record<string, unknown>) => (
              <div key={f.key as string} className="flex justify-between py-1 border-b border-divider">
                <span className="text-sm">{f.label as string}</span>
                <span className="text-sm font-medium">
                  {String((entry.field_values as Record<string, unknown>)[f.key as string] ?? '—')}
                </span>
              </div>
            ))}
          </div>
          {entry.status === 'draft' && (
            <div className="flex gap-3 pt-4">
              <Button color="primary">Submit for Approval</Button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: New case page**

Write `G:\elogbook\apps\web\app\(authenticated)\[tenant]\cases\new\page.tsx`:
```tsx
import { createServerSupabase } from '@/lib/supabase/server';
import ClientCaseForm from '@/components/CaseForm';
import { notFound } from 'next/navigation';

export default async function NewCasePage({ params }: { params: { tenant: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, tenants!inner(slug, tenant_type)')
    .eq('user_id', user.id)
    .single();

  if (!profile) notFound();

  // For individual tenants, initial status is 'pending' (auto-approved via trigger)
  const isIndividual = profile.tenants.tenant_type === 'individual';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Log New Case</h1>
      <ClientCaseForm
        tenantId={profile.tenant_id}
        tenantSlug={params.tenant}
        initialStatus={isIndividual ? 'pending' : 'draft'}
      />
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat: case entry CRUD — list, create, detail pages with template-driven forms"
```

---

## Phase 3: Approval Workflow

### Task 7: Supervisor Approval Queue

**Files:**
- Create: `apps/web/app/(authenticated)/[tenant]/approvals/page.tsx`
- Create: `apps/web/components/ApprovalActions.tsx`
- Create: `apps/web/app/(authenticated)/[tenant]/cases/[id]/submit/route.ts`

- [ ] **Step 1: Submit case for approval (server action)**

Write `G:\elogbook\apps\web\app\(authenticated)\[tenant]\cases\[id]\submit\route.ts`:
```ts
import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: entry } = await supabase
    .from('case_entries')
    .select('id, tenant_id, status')
    .eq('id', params.id)
    .single();

  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (entry.status !== 'draft') return NextResponse.json({ error: 'Can only submit drafts' }, { status: 400 });

  // Update status to pending
  const { error: updateError } = await supabase
    .from('case_entries')
    .update({ status: 'pending' })
    .eq('id', params.id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  // Get tenant type
  const { data: tenant } = await supabase
    .from('tenants')
    .select('tenant_type')
    .eq('id', entry.tenant_id)
    .single();

  // For individual tenants, trigger auto-approves — no approval_request needed
  if (tenant?.tenant_type === 'individual') {
    return NextResponse.json({ success: true, auto_approved: true });
  }

  // Create approval request for institution tenants
  const { data: supervisors } = await supabase
    .from('profiles')
    .select('id')
    .eq('tenant_id', entry.tenant_id)
    .in('role', ['supervisor', 'director']);

  if (supervisors && supervisors.length > 0) {
    await supabase.from('approval_requests').insert(
      supervisors.map(s => ({
        entry_id: params.id,
        supervisor_id: s.id,
        status: 'pending',
      }))
    );
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Approval queue page (supervisor view)**

Write `G:\elogbook\apps\web\app\(authenticated)\[tenant]\approvals\page.tsx`:
```tsx
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, CardBody, CardHeader, Chip, Button, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@heroui/react';
import { notFound } from 'next/navigation';
import ApprovalActions from '@/components/ApprovalActions';

export default async function ApprovalsPage({ params }: { params: { tenant: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, tenant_id')
    .eq('user_id', user.id)
    .single();

  if (!profile || !['supervisor', 'director', 'admin'].includes(profile.role)) notFound();

  const { data: requests } = await supabase
    .from('approval_requests')
    .select('*, case_entries(*, case_templates(name, specialty), profiles!case_entries_resident_id_fkey(full_name))')
    .eq('supervisor_id', profile.id)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Pending Approvals</h1>
      {(!requests || requests.length === 0) ? (
        <Card><CardBody><p className="text-default-500">No pending approvals.</p></CardBody></Card>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => (
            <Card key={r.id}>
              <CardHeader className="flex justify-between">
                <div>
                  <h3 className="font-semibold">
                    {r.case_entries?.case_templates?.specialty} — {r.case_entries?.case_templates?.name}
                  </h3>
                  <p className="text-sm text-default-500">
                    Resident: {r.case_entries?.profiles?.full_name} | Date: {r.case_entries?.case_date}
                  </p>
                </div>
                <Chip color="primary" size="sm">Pending</Chip>
              </CardHeader>
              <CardBody>
                <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
                  <div><span className="text-default-500">MRN:</span> {r.case_entries?.patient_mrn}</div>
                  <div><span className="text-default-500">DOB:</span> {r.case_entries?.patient_dob}</div>
                </div>
                {r.case_entries?.field_values && typeof r.case_entries.field_values === 'object' && (
                  <div className="space-y-1 mb-4 text-sm">
                    {Object.entries(r.case_entries.field_values as Record<string, unknown>).map(([k, v]) => (
                      <div key={k} className="flex justify-between border-b border-divider py-1">
                        <span className="text-default-500">{k.replace(/_/g, ' ')}</span>
                        <span>{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <ApprovalActions requestId={r.id} entryId={r.case_entries!.id} tenant={params.tenant} />
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Approval action component**

Write `G:\elogbook\apps\web\components\ApprovalActions.tsx`:
```tsx
'use client';

import { createClient } from '@/lib/supabase/client';
import { Button, Textarea } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  requestId: string;
  entryId: string;
  tenant: string;
}

export default function ApprovalActions({ requestId, entryId, tenant }: Props) {
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const supabase = createClient();
  const router = useRouter();

  const handleAction = async (action: 'approve' | 'reject') => {
    setLoading(action);

    const { error: reqError } = await supabase
      .from('approval_requests')
      .update({ status: action === 'approve' ? 'approved' : 'rejected', comment, resolved_at: new Date().toISOString() })
      .eq('id', requestId);

    if (reqError) { setLoading(null); return; }

    if (action === 'approve') {
      await supabase
        .from('case_entries')
        .update({ status: 'approved' })
        .eq('id', entryId);
    } else {
      await supabase
        .from('case_entries')
        .update({ status: 'rejected' })
        .eq('id', entryId);
    }

    router.refresh();
    setLoading(null);
  };

  return (
    <div className="space-y-3">
      <Textarea
        label="Comment (optional)"
        value={comment}
        onValueChange={setComment}
        placeholder="Add feedback..."
      />
      <div className="flex gap-3">
        <Button
          color="danger"
          variant="flat"
          isLoading={loading === 'reject'}
          onPress={() => handleAction('reject')}
        >
          Reject
        </Button>
        <Button
          color="success"
          isLoading={loading === 'approve'}
          onPress={() => handleAction('approve')}
        >
          Approve
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update case detail page to include submit button and approval history**

Update `G:\elogbook\apps\web\app\(authenticated)\[tenant]\cases\[id]\page.tsx` — add submit action and display existing approval history. Replace the existing page:

```tsx
import { createServerSupabase } from '@/lib/supabase/server';
import { Chip, Card, CardBody, CardHeader, Button } from '@heroui/react';
import { notFound } from 'next/navigation';

export default async function CaseDetailPage({ params }: { params: { tenant: string; id: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: entry } = await supabase
    .from('case_entries')
    .select('*, case_templates(name, specialty, fields), profiles!case_entries_resident_id_fkey(full_name), tenants(tenant_type)')
    .eq('id', params.id)
    .single();

  if (!entry) notFound();

  const { data: approvals } = await supabase
    .from('approval_requests')
    .select('*, profiles(full_name)')
    .eq('entry_id', params.id)
    .order('requested_at', { ascending: false });

  const statusColor = (s: string) => {
    switch (s) {
      case 'draft': return 'warning' as const;
      case 'pending': return 'primary' as const;
      case 'approved': return 'success' as const;
      case 'rejected': return 'danger' as const;
      default: return 'default' as const;
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader className="flex justify-between">
          <div>
            <h1 className="text-xl font-bold">{entry.case_templates?.specialty} — {entry.case_templates?.name}</h1>
            <p className="text-sm text-default-500">Logged by {entry.profiles?.full_name}</p>
          </div>
          <Chip color={statusColor(entry.status)}>{entry.status}</Chip>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm text-default-500">Patient MRN</label><p>{entry.patient_mrn}</p></div>
            <div><label className="text-sm text-default-500">Patient DOB</label><p>{entry.patient_dob}</p></div>
            <div><label className="text-sm text-default-500">Case Date</label><p>{entry.case_date}</p></div>
          </div>
          <div>
            <label className="text-sm text-default-500 block mb-2">Case Details</label>
            {Array.isArray(entry.case_templates?.fields) && entry.case_templates.fields.map((f: Record<string, unknown>) => (
              <div key={f.key as string} className="flex justify-between py-1 border-b border-divider">
                <span className="text-sm">{f.label as string}</span>
                <span className="text-sm font-medium">
                  {String((entry.field_values as Record<string, unknown>)[f.key as string] ?? '—')}
                </span>
              </div>
            ))}
          </div>
          {entry.status === 'draft' && (
            <form action={`/${params.tenant}/cases/${params.id}/submit`} method="POST">
              <Button type="submit" color="primary">Submit for Approval</Button>
            </form>
          )}
        </CardBody>
      </Card>

      {approvals && approvals.length > 0 && (
        <Card>
          <CardHeader><h2 className="text-lg font-semibold">Approval History</h2></CardHeader>
          <CardBody>
            <div className="space-y-3">
              {approvals.map((a) => (
                <div key={a.id} className="flex justify-between items-center border-b border-divider pb-2">
                  <div>
                    <p className="font-medium">{a.profiles?.full_name}</p>
                    <p className="text-sm text-default-500">{a.comment || 'No comment'}</p>
                  </div>
                  <Chip color={a.status === 'approved' ? 'success' : a.status === 'rejected' ? 'danger' : 'primary'} size="sm">
                    {a.status}
                  </Chip>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat: approval workflow — submit, supervisor queue, accept/reject with comments"
```

---

## Phase 4: Goals & Milestones

### Task 8: Program Goals Management

**Files:**
- Create: `apps/web/app/(authenticated)/[tenant]/goals/page.tsx`
- Create: `apps/web/components/GoalForm.tsx`
- Create: `apps/web/components/GoalProgressBar.tsx`

- [ ] **Step 1: Goals page (director + resident views)**

Write `G:\elogbook\apps\web\app\(authenticated)\[tenant]\goals\page.tsx`:
```tsx
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, CardBody, CardHeader, Progress, Button } from '@heroui/react';
import { notFound } from 'next/navigation';
import GoalForm from '@/components/GoalForm';
import { type ProgramGoal } from '@elogbook/shared';

export default async function GoalsPage({ params }: { params: { tenant: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, tenant_id')
    .eq('user_id', user.id)
    .single();

  if (!profile) notFound();

  const isDirector = ['director', 'admin'].includes(profile.role);

  // For directors: get all residents in tenant
  const { data: residents } = isDirector
    ? await supabase.from('profiles').select('id, full_name').eq('tenant_id', profile.tenant_id).eq('role', 'resident')
    : { data: [{ id: profile.id, full_name: profile.full_name ?? 'Me' }] };

  // Get goals
  const goalsQuery = supabase
    .from('program_goals')
    .select('*, goal_progress(current_count), profiles!program_goals_resident_id_fkey(full_name)')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false });

  if (!isDirector) {
    goalsQuery.eq('resident_id', profile.id);
  }

  const { data: goals } = await goalsQuery;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{isDirector ? 'Resident Goals' : 'My Goals'}</h1>
        {isDirector && <GoalForm tenantId={profile.tenant_id} directorId={profile.id} residents={residents ?? []} />}
      </div>
      {(!goals || goals.length === 0) ? (
        <Card><CardBody><p className="text-default-500">No goals set yet.</p></CardBody></Card>
      ) : (
        <div className="space-y-4">
          {goals.map((goal) => {
            const current = (goal as any).goal_progress?.current_count ?? 0;
            const target = goal.target_count;
            const pct = Math.min(Math.round((current / target) * 100), 100);
            const isOverdue = new Date(goal.deadline) < new Date() && pct < 100;

            return (
              <Card key={goal.id}>
                <CardHeader className="flex justify-between">
                  <div>
                    <h3 className="font-semibold">{goal.title}</h3>
                    <p className="text-sm text-default-500">
                      Resident: {goal.profiles?.full_name} {goal.specialty ? `• ${goal.specialty}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm ${isOverdue ? 'text-danger' : 'text-default-500'}`}>
                      Due: {goal.deadline}
                    </p>
                  </div>
                </CardHeader>
                <CardBody>
                  <Progress
                    value={pct}
                    color={pct >= 100 ? 'success' : isOverdue ? 'danger' : 'primary'}
                    label={`${current} / ${target}`}
                    showValueLabel
                  />
                  {pct >= 100 && <p className="text-success text-sm mt-2">Goal completed!</p>}
                  {isOverdue && <p className="text-danger text-sm mt-2">Overdue</p>}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Goal form component (modal)**

Write `G:\elogbook\apps\web\components\GoalForm.tsx`:
```tsx
'use client';

import { createClient } from '@/lib/supabase/client';
import { Button, Input, Select, SelectItem, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, Textarea } from '@heroui/react';
import { programGoalSchema } from '@elogbook/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  tenantId: string;
  directorId: string;
  residents: { id: string; full_name: string }[];
}

export default function GoalForm({ tenantId, directorId, residents }: Props) {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [residentId, setResidentId] = useState('');
  const [title, setTitle] = useState('');
  const [targetCount, setTargetCount] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [deadline, setDeadline] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const supabase = createClient();
  const router = useRouter();

  const handleSubmit = async () => {
    setError('');
    const parsed = programGoalSchema.safeParse({
      resident_id: residentId,
      title,
      target_count: parseInt(targetCount),
      specialty: specialty || null,
      deadline,
      description: description || null,
    });

    if (!parsed.success) {
      setError(parsed.error.errors[0].message);
      return;
    }

    setLoading(true);
    const { error: insertError } = await supabase.from('program_goals').insert({
      tenant_id: tenantId,
      director_id: directorId,
      resident_id: residentId,
      title,
      target_count: parseInt(targetCount),
      specialty: specialty || null,
      deadline,
      description: description || null,
    });

    if (insertError) {
      // Check if trigger created progress record; if not, insert one
      setError(insertError.message);
      setLoading(false);
      return;
    }

    // Ensure goal_progress record exists
    const { data: goal } = await supabase
      .from('program_goals')
      .select('id')
      .eq('resident_id', residentId)
      .eq('title', title)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (goal) {
      await supabase.from('goal_progress').insert({
        goal_id: goal.id,
        resident_id: residentId,
        current_count: 0,
      }).select(); // may fail if already exists — ignore
    }

    setLoading(false);
    onClose();
    router.refresh();
  };

  return (
    <>
      <Button color="primary" onPress={onOpen}>Set Goal</Button>
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalContent>
          <ModalHeader>Set Resident Goal</ModalHeader>
          <ModalBody className="gap-4">
            <Select label="Resident" onSelectionChange={(keys) => setResidentId(Array.from(keys)[0] as string)}>
              {residents.map(r => <SelectItem key={r.id}>{r.full_name}</SelectItem>)}
            </Select>
            <Input label="Goal Title" value={title} onValueChange={setTitle} placeholder="e.g. Laparoscopic Procedures" />
            <Input label="Target Count" type="number" value={targetCount} onValueChange={setTargetCount} />
            <Input label="Specialty (optional)" value={specialty} onValueChange={setSpecialty} />
            <Input label="Deadline" type="date" value={deadline} onValueChange={setDeadline} />
            <Textarea label="Description (optional)" value={description} onValueChange={setDescription} />
            {error && <p className="text-danger text-sm">{error}</p>}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose}>Cancel</Button>
            <Button color="primary" isLoading={loading} onPress={handleSubmit}>Create Goal</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/
git commit -m "feat: goals & milestones — set targets, auto-track progress, progress bars"
```

---

## Phase 5: Admin Panel

### Task 9: Admin — Templates, Users, Roles

**Files:**
- Create: `apps/web/app/(authenticated)/[tenant]/admin/page.tsx`
- Create: `apps/web/components/TemplateEditor.tsx`
- Create: `apps/web/components/UserManager.tsx`
- Create: `apps/web/components/AIConfigPanel.tsx`
- Create: `apps/web/components/PaymentGatewayPanel.tsx`

- [ ] **Step 1: Admin page with tabbed sections**

Write `G:\elogbook\apps\web\app\(authenticated)\[tenant]\admin\page.tsx`:
```tsx
import { createServerSupabase } from '@/lib/supabase/server';
import { Tabs, Tab, Card, CardBody } from '@heroui/react';
import { notFound } from 'next/navigation';
import TemplateEditor from '@/components/TemplateEditor';
import UserManager from '@/components/UserManager';
import AIConfigPanel from '@/components/AIConfigPanel';
import PaymentGatewayPanel from '@/components/PaymentGatewayPanel';

export default async function AdminPage({ params }: { params: { tenant: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, tenant_id, tenants!inner(slug, tenant_type)')
    .eq('user_id', user.id)
    .single();

  if (!profile || !['admin', 'director', 'institution_admin'].includes(profile.role)) notFound();

  const { data: templates } = await supabase
    .from('case_templates')
    .select('*')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false });

  const { data: users } = await supabase
    .from('profiles')
    .select('*')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false });

  const { data: aiConfig } = await supabase
    .from('ai_config')
    .select('*')
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle();

  const { data: gatewayConfig } = await supabase
    .from('payment_gateway_config')
    .select('*')
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Admin Panel</h1>
      <Tabs aria-label="Admin sections">
        <Tab key="templates" title="Case Templates">
          <Card><CardBody>
            <TemplateEditor tenantId={profile.tenant_id} templates={templates ?? []} />
          </CardBody></Card>
        </Tab>
        <Tab key="users" title="Users & Roles">
          <Card><CardBody>
            <UserManager tenantId={profile.tenant_id} users={users ?? []} currentUserRole={profile.role} />
          </CardBody></Card>
        </Tab>
        <Tab key="ai" title="AI Config">
          <Card><CardBody>
            <AIConfigPanel tenantId={profile.tenant_id} config={aiConfig} />
          </CardBody></Card>
        </Tab>
        <Tab key="gateway" title="Payment Gateway">
          <Card><CardBody>
            <PaymentGatewayPanel tenantId={profile.tenant_id} config={gatewayConfig} />
          </CardBody></Card>
        </Tab>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Template editor component**

Write `G:\elogbook\apps\web\components\TemplateEditor.tsx`:
```tsx
'use client';

import { createClient } from '@/lib/supabase/client';
import { Button, Input, Select, SelectItem, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Chip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from '@heroui/react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CaseTemplate } from '@elogbook/shared';

interface Props { tenantId: string; templates: CaseTemplate[]; }

export default function TemplateEditor({ tenantId, templates }: Props) {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [name, setName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [fieldsJson, setFieldsJson] = useState('[{"key":"","label":"","type":"text"}]');
  const [requiredFields, setRequiredFields] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const supabase = createClient();
  const router = useRouter();

  const handleCreate = async () => {
    setError('');
    try {
      const fields = JSON.parse(fieldsJson);
      const required = requiredFields ? requiredFields.split(',').map(s => s.trim()) : [];
      setLoading(true);
      const { error: e } = await supabase.from('case_templates').insert({
        tenant_id: tenantId, name, specialty, fields, required_fields: required,
      });
      if (e) { setError(e.message); return; }
      onClose(); router.refresh();
    } catch {
      setError('Invalid JSON in fields');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from('case_templates').delete().eq('id', id);
    router.refresh();
  };

  return (
    <div>
      <div className="flex justify-between mb-4">
        <h2 className="text-lg font-semibold">Case Templates</h2>
        <Button color="primary" size="sm" onPress={onOpen}>New Template</Button>
      </div>
      <Table aria-label="Templates" removeWrapper>
        <TableHeader>
          <TableColumn>Name</TableColumn>
          <TableColumn>Specialty</TableColumn>
          <TableColumn>Fields</TableColumn>
          <TableColumn>Required</TableColumn>
          <TableColumn>Actions</TableColumn>
        </TableHeader>
        <TableBody>
          {templates.map(t => (
            <TableRow key={t.id}>
              <TableCell>{t.name}</TableCell>
              <TableCell><Chip size="sm">{t.specialty}</Chip></TableCell>
              <TableCell>{t.fields.length} fields</TableCell>
              <TableCell>{(t.required_fields as string[]).join(', ')}</TableCell>
              <TableCell>
                <Button color="danger" variant="light" size="sm" onPress={() => handleDelete(t.id)}>Delete</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalContent>
          <ModalHeader>Create Case Template</ModalHeader>
          <ModalBody className="gap-4">
            <Input label="Template Name" value={name} onValueChange={setName} />
            <Input label="Specialty" value={specialty} onValueChange={setSpecialty} placeholder="surgery" />
            <div>
              <label className="text-sm text-default-500 block mb-1">Fields (JSON)</label>
              <textarea
                className="w-full bg-default-100 rounded-lg p-3 text-sm font-mono h-40"
                value={fieldsJson}
                onChange={e => setFieldsJson(e.target.value)}
              />
              <p className="text-xs text-default-400 mt-1">
                Example: [{"key":"procedure","label":"Procedure","type":"text"},{"key":"level","label":"Level","type":"select","options":["A","B","C"]}]
              </p>
            </div>
            <Input label="Required Fields (comma-separated keys)" value={requiredFields} onValueChange={setRequiredFields} placeholder="procedure,level" />
            {error && <p className="text-danger text-sm">{error}</p>}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose}>Cancel</Button>
            <Button color="primary" isLoading={loading} onPress={handleCreate}>Create</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 3: User manager component**

Write `G:\elogbook\apps\web\components\UserManager.tsx`:
```tsx
'use client';

import { createClient } from '@/lib/supabase/client';
import { Button, Select, SelectItem, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Chip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, Input } from '@heroui/react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Profile } from '@elogbook/shared';

interface Props { tenantId: string; users: Profile[]; currentUserRole: string; }

const roleColors: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger'> = {
  resident: 'primary', supervisor: 'secondary', director: 'warning', institution_admin: 'danger', admin: 'success',
};

export default function UserManager({ tenantId, users, currentUserRole }: Props) {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('resident');
  const [specialty, setSpecialty] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const supabase = createClient();
  const router = useRouter();

  const handleInvite = async () => {
    setError('');
    setLoading(true);
    const { error: e } = await supabase.auth.signInWithOtp({
      email,
      options: {
        data: { full_name: fullName, role, specialty, tenant_id: tenantId },
      },
    });
    if (e) { setError(e.message); setLoading(false); return; }
    onClose(); router.refresh();
    setLoading(false);
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
    router.refresh();
  };

  return (
    <div>
      <div className="flex justify-between mb-4">
        <h2 className="text-lg font-semibold">Users</h2>
        <Button color="primary" size="sm" onPress={onOpen}>Invite User</Button>
      </div>
      <Table aria-label="Users" removeWrapper>
        <TableHeader>
          <TableColumn>Name</TableColumn>
          <TableColumn>Role</TableColumn>
          <TableColumn>Specialty</TableColumn>
        </TableHeader>
        <TableBody>
          {users.map(u => (
            <TableRow key={u.id}>
              <TableCell>{u.full_name}</TableCell>
              <TableCell>
                {currentUserRole === 'admin' ? (
                  <Select
                    size="sm"
                    defaultSelectedKeys={[u.role]}
                    onSelectionChange={(keys) => handleRoleChange(u.id, Array.from(keys)[0] as string)}
                    className="w-40"
                  >
                    <SelectItem key="resident">Resident</SelectItem>
                    <SelectItem key="supervisor">Supervisor</SelectItem>
                    <SelectItem key="director">Director</SelectItem>
                    <SelectItem key="institution_admin">Institution Admin</SelectItem>
                  </Select>
                ) : (
                  <Chip color={roleColors[u.role]} size="sm">{u.role}</Chip>
                )}
              </TableCell>
              <TableCell>{u.specialty || '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          <ModalHeader>Invite User</ModalHeader>
          <ModalBody className="gap-4">
            <Input label="Email" type="email" value={email} onValueChange={setEmail} />
            <Input label="Full Name" value={fullName} onValueChange={setFullName} />
            <Select label="Role" defaultSelectedKeys={['resident']} onSelectionChange={(keys) => setRole(Array.from(keys)[0] as string)}>
              <SelectItem key="resident">Resident</SelectItem>
              <SelectItem key="supervisor">Supervisor</SelectItem>
              <SelectItem key="director">Director</SelectItem>
            </Select>
            <Input label="Specialty (optional)" value={specialty} onValueChange={setSpecialty} />
            {error && <p className="text-danger text-sm">{error}</p>}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose}>Cancel</Button>
            <Button color="primary" isLoading={loading} onPress={handleInvite}>Send Invite</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 4: AI config panel**

Write `G:\elogbook\apps\web\components\AIConfigPanel.tsx`:
```tsx
'use client';

import { createClient } from '@/lib/supabase/client';
import { Button, Input, Select, SelectItem, Switch } from '@heroui/react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface AIConfigData { id: string; provider: string; model: string; is_active: boolean; endpoint_url?: string | null; }
interface Props { tenantId: string; config: AIConfigData | null; }

export default function AIConfigPanel({ tenantId, config }: Props) {
  const [provider, setProvider] = useState(config?.provider ?? 'openai');
  const [model, setModel] = useState(config?.model ?? 'gpt-4o');
  const [apiKey, setApiKey] = useState('');
  const [endpointUrl, setEndpointUrl] = useState(config?.endpoint_url ?? '');
  const [isActive, setIsActive] = useState(config?.is_active ?? false);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const supabase = createClient();
  const router = useRouter();

  const providerModelDefaults: Record<string, string> = {
    openai: 'gpt-4o', anthropic: 'claude-3-5-sonnet-20241022', azure: 'gpt-4', openrouter: 'anthropic/claude-3-opus', custom: '',
  };

  const handleSave = async () => {
    setError(''); setSaved(false); setLoading(true);
    const payload = {
      tenant_id: tenantId, provider, model,
      encrypted_api_key: apiKey || config?.encrypted_api_key || '',
      endpoint_url: provider === 'custom' ? endpointUrl : null,
      is_active: isActive,
    };
    const { error: e } = config
      ? await supabase.from('ai_config').update(payload).eq('id', config.id)
      : await supabase.from('ai_config').insert(payload);
    if (e) { setError(e.message); setLoading(false); return; }
    setSaved(true); setLoading(false);
    router.refresh();
  };

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">AI Provider Configuration</h2>
      <div className="space-y-4 max-w-md">
        <Select label="Provider" defaultSelectedKeys={[provider]} onSelectionChange={(keys) => {
          const p = Array.from(keys)[0] as string;
          setProvider(p);
          setModel(providerModelDefaults[p] ?? '');
        }}>
          <SelectItem key="openai">OpenAI</SelectItem>
          <SelectItem key="anthropic">Anthropic</SelectItem>
          <SelectItem key="azure">Azure OpenAI</SelectItem>
          <SelectItem key="openrouter">OpenRouter</SelectItem>
          <SelectItem key="custom">Custom Endpoint</SelectItem>
        </Select>
        <Input label="Model" value={model} onValueChange={setModel} />
        <Input label="API Key" type="password" value={apiKey} onValueChange={setApiKey} placeholder={config ? '(leave blank to keep existing)' : 'sk-...'} />
        {provider === 'custom' && <Input label="Endpoint URL" value={endpointUrl} onValueChange={setEndpointUrl} placeholder="https://..." />}
        <Switch isSelected={isActive} onValueChange={setIsActive}>Enable AI Insights</Switch>
        {error && <p className="text-danger text-sm">{error}</p>}
        {saved && <p className="text-success text-sm">Configuration saved.</p>}
        <Button color="primary" isLoading={loading} onPress={handleSave}>Save Configuration</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Payment gateway panel**

Write `G:\elogbook\apps\web\components\PaymentGatewayPanel.tsx`:
```tsx
'use client';

import { createClient } from '@/lib/supabase/client';
import { Button, Input, Select, SelectItem, Switch } from '@heroui/react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface GatewayConfig { id: string; provider: string; publishable_key: string; is_active: boolean; endpoint_url?: string | null; }
interface Props { tenantId: string; config: GatewayConfig | null; }

export default function PaymentGatewayPanel({ tenantId, config }: Props) {
  const [provider, setProvider] = useState(config?.provider ?? 'stripe');
  const [publishableKey, setPublishableKey] = useState(config?.publishable_key ?? '');
  const [secretKey, setSecretKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [endpointUrl, setEndpointUrl] = useState(config?.endpoint_url ?? '');
  const [isActive, setIsActive] = useState(config?.is_active ?? false);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const supabase = createClient();
  const router = useRouter();

  const handleSave = async () => {
    setError(''); setSaved(false); setLoading(true);
    const payload = {
      tenant_id: tenantId, provider,
      publishable_key: publishableKey,
      encrypted_secret_key: secretKey || config?.encrypted_secret_key || '',
      encrypted_webhook_secret: webhookSecret || config?.encrypted_webhook_secret || '',
      endpoint_url: provider === 'custom' ? endpointUrl : null,
      is_active: isActive,
    };
    const { error: e } = config
      ? await supabase.from('payment_gateway_config').update(payload).eq('id', config.id)
      : await supabase.from('payment_gateway_config').insert(payload);
    if (e) { setError(e.message); setLoading(false); return; }
    setSaved(true); setLoading(false);
    router.refresh();
  };

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Payment Gateway Configuration</h2>
      <div className="space-y-4 max-w-md">
        <Select label="Gateway Provider" defaultSelectedKeys={[provider]} onSelectionChange={(keys) => setProvider(Array.from(keys)[0] as string)}>
          <SelectItem key="stripe">Stripe</SelectItem>
          <SelectItem key="paddle">Paddle</SelectItem>
          <SelectItem key="lemonsqueezy">LemonSqueezy</SelectItem>
          <SelectItem key="custom">Custom</SelectItem>
        </Select>
        <Input label="Publishable Key" value={publishableKey} onValueChange={setPublishableKey} placeholder="pk_..." />
        <Input label="Secret Key" type="password" value={secretKey} onValueChange={setSecretKey} placeholder={config ? '(leave blank to keep)' : 'sk_...'} />
        <Input label="Webhook Secret" type="password" value={webhookSecret} onValueChange={setWebhookSecret} placeholder={config ? '(leave blank to keep)' : 'whsec_...'} />
        {provider === 'custom' && <Input label="Custom Endpoint URL" value={endpointUrl} onValueChange={setEndpointUrl} placeholder="https://..." />}
        <Switch isSelected={isActive} onValueChange={setIsActive}>Enable Payments</Switch>
        {error && <p className="text-danger text-sm">{error}</p>}
        {saved && <p className="text-success text-sm">Configuration saved.</p>}
        <Button color="primary" isLoading={loading} onPress={handleSave}>Save Configuration</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/
git commit -m "feat: admin panel — templates, user management, AI config, payment gateway config"
```

---

## Phase 6: Subscriptions & Monetization

### Task 10: Billing Page & Subscription Flow

**Files:**
- Create: `apps/web/app/(authenticated)/[tenant]/billing/page.tsx`
- Create: `apps/web/components/SubscriptionPlans.tsx`
- Create: `supabase/functions/payment-webhook/index.ts`

- [ ] **Step 1: Billing page**

Write `G:\elogbook\apps\web\app\(authenticated)\[tenant]\billing\page.tsx`:
```tsx
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, CardBody, CardHeader } from '@heroui/react';
import { notFound } from 'next/navigation';
import SubscriptionPlans from '@/components/SubscriptionPlans';

export default async function BillingPage({ params }: { params: { tenant: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, tenants!inner(slug, tenant_type)')
    .eq('user_id', user.id)
    .single();

  if (!profile) notFound();

  const { data: plans } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('tenant_type', profile.tenants.tenant_type)
    .order('price_monthly', { ascending: true });

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*, subscription_plans(name, price_monthly)')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .maybeSingle();

  const { data: gateway } = await supabase
    .from('payment_gateway_config')
    .select('*')
    .eq('tenant_id', profile.tenant_id)
    .eq('is_active', true)
    .maybeSingle();

  const { data: aiReports } = await supabase
    .from('one_time_purchases')
    .select('*')
    .eq('resident_id', profile.id)
    .eq('purchase_type', 'ai_report')
    .order('created_at', { ascending: false });

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">Billing & Subscription</h1>

      {subscription && (
        <Card>
          <CardHeader><h2 className="text-lg font-semibold">Current Plan</h2></CardHeader>
          <CardBody>
            <p className="text-xl font-bold">{subscription.subscription_plans?.name}</p>
            <p className="text-default-500">${subscription.subscription_plans?.price_monthly}/month</p>
            <p className="text-default-400 text-sm mt-2">
              Next billing: {subscription.current_period_end ? new Date(subscription.current_period_end).toLocaleDateString() : 'N/A'}
            </p>
          </CardBody>
        </Card>
      )}

      {plans && plans.length > 0 && (
        <SubscriptionPlans
          plans={plans}
          tenantId={profile.tenant_id}
          gatewayProvider={gateway?.provider ?? 'stripe'}
          publishableKey={gateway?.publishable_key ?? ''}
          currentPlanId={subscription?.plan_id ?? null}
        />
      )}

      <Card>
        <CardHeader><h2 className="text-lg font-semibold">AI Analysis Reports</h2></CardHeader>
        <CardBody>
          <p className="text-default-500 mb-4">Get a comprehensive AI analysis of your case history. One-time fee: $4.99</p>
          {aiReports && aiReports.length > 0 ? (
            <div className="space-y-2">
              {aiReports.map(r => (
                <div key={r.id} className="flex justify-between items-center py-2 border-b border-divider">
                  <span>{new Date(r.created_at).toLocaleDateString()}</span>
                  <span className={`text-sm ${r.consumed ? 'text-success' : 'text-warning'}`}>
                    {r.consumed ? 'Delivered' : 'Pending'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-default-400">No reports purchased yet.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Subscription plans component**

Write `G:\elogbook\apps\web\components\SubscriptionPlans.tsx`:
```tsx
'use client';

import { createClient } from '@/lib/supabase/client';
import { Button, Card, CardBody, CardFooter, CardHeader } from '@heroui/react';
import { loadStripe } from '@stripe/stripe-js';
import type { SubscriptionPlan } from '@elogbook/shared';
import { useState } from 'react';

interface Props {
  plans: SubscriptionPlan[];
  tenantId: string;
  gatewayProvider: string;
  publishableKey: string;
  currentPlanId: string | null;
}

export default function SubscriptionPlans({ plans, tenantId, gatewayProvider, publishableKey, currentPlanId }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const supabase = createClient();

  const handleSubscribe = async (planId: string) => {
    setLoading(planId);
    if (gatewayProvider === 'stripe') {
      const stripe = await loadStripe(publishableKey);
      if (!stripe) return;
      const { data } = await supabase.functions.invoke('create-checkout', {
        body: { tenant_id: tenantId, plan_id: planId, gateway: 'stripe' },
      });
      if (data?.sessionId) {
        await stripe.redirectToCheckout({ sessionId: data.sessionId });
      }
    }
    // Paddle, LemonSqueezy, Custom — similar pattern with their SDKs
    setLoading(null);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {plans.map((plan) => {
        const isCurrent = plan.id === currentPlanId;
        const features = plan.features as Record<string, unknown>;

        return (
          <Card key={plan.id} className={isCurrent ? 'ring-2 ring-primary' : ''}>
            <CardHeader className="flex-col items-start">
              <h3 className="text-lg font-bold">{plan.name}</h3>
              <p className="text-3xl font-bold mt-2">
                ${plan.price_monthly}
                <span className="text-sm text-default-500 font-normal">/mo</span>
              </p>
            </CardHeader>
            <CardBody>
              <ul className="space-y-2 text-sm">
                {features.ai_insights && <li>✅ AI Insights</li>}
                {features.pdf_export && <li>✅ PDF Export</li>}
                {features.approval_workflow && <li>✅ Approval Workflow</li>}
                {features.goals && <li>✅ Goals & Milestones</li>}
                {features.audit && <li>✅ Audit Trail</li>}
                {features.sso && <li>✅ SSO</li>}
                {(plan as any).max_residents && <li>Up to {(plan as any).max_residents} residents</li>}
                {features.max_cases && typeof features.max_cases === 'number' && <li>{features.max_cases} case limit</li>}
                {features.max_cases === null && <li>Unlimited cases</li>}
              </ul>
            </CardBody>
            <CardFooter>
              {isCurrent ? (
                <Button isDisabled className="w-full">Current Plan</Button>
              ) : (
                <Button
                  color="primary"
                  className="w-full"
                  isLoading={loading === plan.id}
                  onPress={() => handleSubscribe(plan.id)}
                >
                  {plan.price_monthly > 0 ? `Subscribe — $${plan.price_monthly}/mo` : 'Contact Sales'}
                </Button>
              )}
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Edge Function — Stripe checkout creation**

Write `G:\elogbook\supabase\functions\create-checkout\index.ts`:
```ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const { tenant_id, plan_id, gateway } = await req.json();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Get plan
  const { data: plan } = await supabase.from('subscription_plans').select('*').eq('id', plan_id).single();
  if (!plan) return new Response(JSON.stringify({ error: 'Plan not found' }), { status: 404, headers: corsHeaders });

  // Get gateway config
  const { data: gwConfig } = await supabase.from('payment_gateway_config').select('*').eq('tenant_id', tenant_id).single();
  if (!gwConfig) return new Response(JSON.stringify({ error: 'Gateway not configured' }), { status: 400, headers: corsHeaders });

  if (gateway === 'stripe') {
    const stripe = new Stripe(gwConfig.encrypted_secret_key, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: `${req.headers.get('origin')}/billing?success=true`,
      cancel_url: `${req.headers.get('origin')}/billing?canceled=true`,
      metadata: { tenant_id, plan_id },
    });

    return new Response(JSON.stringify({ sessionId: session.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: `Gateway ${gateway} not yet implemented` }), { status: 501, headers: corsHeaders });
});
```

- [ ] **Step 4: Edge Function — Payment webhook handler**

Write `G:\elogbook\supabase\functions\payment-webhook\index.ts`:
```ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

serve(async (req) => {
  const signature = req.headers.get('stripe-signature')!;
  const body = await req.text();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Get tenant from event metadata to look up config
  let event: Stripe.Event;
  try {
    // For webhook, we need to find the right tenant's webhook secret.
    // Strategy: try common secrets, or store in a lookup.
    // Simplified: loop tenants with active stripe config
    const { data: configs } = await supabase
      .from('payment_gateway_config')
      .select('*')
      .eq('provider', 'stripe')
      .eq('is_active', true);

    if (!configs || configs.length === 0) {
      return new Response('No active stripe config', { status: 400 });
    }

    let event: Stripe.Event | null = null;
    for (const cfg of configs) {
      try {
        const stripe = new Stripe(cfg.encrypted_secret_key, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });
        event = await stripe.webhooks.constructEventAsync(body, signature, cfg.encrypted_webhook_secret);
        if (event) break;
      } catch { continue; }
    }

    if (!event) return new Response('Invalid signature', { status: 400 });

    // Handle events
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { tenant_id, plan_id } = session.metadata ?? {};
        if (tenant_id && plan_id) {
          await supabase.from('subscriptions').upsert({
            tenant_id,
            plan_id,
            status: 'active',
            gateway_subscription_id: session.subscription as string,
          });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await supabase.from('subscriptions').update({ status: 'canceled' }).eq('gateway_subscription_id', sub.id);
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await supabase.from('subscriptions').update({
            current_period_start: new Date(invoice.period_start * 1000).toISOString(),
            current_period_end: new Date(invoice.period_end * 1000).toISOString(),
          }).eq('gateway_subscription_id', invoice.subscription as string);
        }
        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    return new Response(`Webhook error: ${err.message}`, { status: 400 });
  }
});
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/ supabase/functions/
git commit -m "feat: subscriptions & billing — plans page, Stripe checkout, webhook handler"
```

---

## Phase 7: Analytics, PDF Export & Audit

### Task 11: Reports & Analytics Dashboard

**Files:**
- Create: `apps/web/app/(authenticated)/[tenant]/reports/page.tsx`
- Create: `apps/web/components/CaseChart.tsx`

- [ ] **Step 1: Reports page with charts**

Write `G:\elogbook\apps\web\app\(authenticated)\[tenant]\reports\page.tsx`:
```tsx
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, CardBody, CardHeader, Button, Select, SelectItem } from '@heroui/react';
import { notFound } from 'next/navigation';

export default async function ReportsPage({ params }: { params: { tenant: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, tenant_id')
    .eq('user_id', user.id)
    .single();

  if (!profile) notFound();

  // Aggregate stats
  const { data: stats } = await supabase.rpc('get_case_stats', { p_tenant_id: profile.tenant_id });

  const { count: totalCases } = await supabase
    .from('case_entries')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', profile.tenant_id);

  const { data: bySpecialty } = await supabase
    .from('case_entries')
    .select('case_templates!inner(specialty), id')
    .eq('tenant_id', profile.tenant_id);

  // Group by specialty
  const specialtyCounts: Record<string, number> = {};
  (bySpecialty ?? []).forEach((c: any) => {
    const spec = c.case_templates?.specialty ?? 'unknown';
    specialtyCounts[spec] = (specialtyCounts[spec] || 0) + 1;
  });

  const { data: byStatus } = await supabase
    .from('case_entries')
    .select('status')
    .eq('tenant_id', profile.tenant_id);

  const statusCounts: Record<string, number> = { draft: 0, pending: 0, approved: 0, rejected: 0 };
  (byStatus ?? []).forEach((c) => { statusCounts[c.status] = (statusCounts[c.status] || 0) + 1; });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Reports & Analytics</h1>
        <a href={`/api/${params.tenant}/export-pdf`}>
          <Button color="primary" variant="flat">Export PDF</Button>
        </a>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardBody className="text-center"><p className="text-3xl font-bold">{totalCases ?? 0}</p><p className="text-sm text-default-500">Total Cases</p></CardBody></Card>
        <Card><CardBody className="text-center"><p className="text-3xl font-bold text-success">{statusCounts.approved}</p><p className="text-sm text-default-500">Approved</p></CardBody></Card>
        <Card><CardBody className="text-center"><p className="text-3xl font-bold text-primary">{statusCounts.pending}</p><p className="text-sm text-default-500">Pending</p></CardBody></Card>
        <Card><CardBody className="text-center"><p className="text-3xl font-bold text-warning">{statusCounts.draft}</p><p className="text-sm text-default-500">Drafts</p></CardBody></Card>
      </div>

      <Card>
        <CardHeader><h2 className="text-lg font-semibold">Cases by Specialty</h2></CardHeader>
        <CardBody>
          <div className="space-y-3">
            {Object.entries(specialtyCounts).map(([spec, count]) => (
              <div key={spec} className="flex items-center gap-3">
                <span className="w-24 text-sm capitalize">{spec}</span>
                <div className="flex-1 bg-default-100 rounded-full h-4 overflow-hidden">
                  <div
                    className="bg-primary h-full rounded-full transition-all"
                    style={{ width: `${(count / (totalCases || 1)) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-medium w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><h2 className="text-lg font-semibold">Status Distribution</h2></CardHeader>
        <CardBody>
          <div className="flex gap-4 justify-center">
            {Object.entries(statusCounts).map(([status, count]) => (
              <div key={status} className="text-center">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center text-lg font-bold ${
                  status === 'approved' ? 'bg-success/20 text-success' :
                  status === 'pending' ? 'bg-primary/20 text-primary' :
                  status === 'rejected' ? 'bg-danger/20 text-danger' : 'bg-warning/20 text-warning'
                }`}>
                  {count}
                </div>
                <p className="text-sm text-default-500 mt-1 capitalize">{status}</p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Create stats RPC function**

Append to `G:\elogbook\supabase\migrations\00003_triggers.sql`:
```sql
CREATE OR REPLACE FUNCTION get_case_stats(p_tenant_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'approved', COUNT(*) FILTER (WHERE status = 'approved'),
    'pending', COUNT(*) FILTER (WHERE status = 'pending'),
    'draft', COUNT(*) FILTER (WHERE status = 'draft'),
    'rejected', COUNT(*) FILTER (WHERE status = 'rejected')
  ) INTO result
  FROM case_entries WHERE tenant_id = p_tenant_id;
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;
```

- [ ] **Step 3: PDF export API route**

Write `G:\elogbook\apps\web\app\api\[tenant]\export-pdf\route.ts`:
```ts
import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request, { params }: { params: { tenant: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, full_name')
    .eq('user_id', user.id)
    .single();

  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Invoke Edge Function for PDF generation
  const { data: cases } = await supabase
    .from('case_entries')
    .select('*, case_templates(name, specialty)')
    .eq('resident_id', profile.id)
    .eq('status', 'approved')
    .order('case_date', { ascending: false });

  // Build HTML and return as PDF via edge function
  const { data: pdfData, error } = await supabase.functions.invoke('generate-pdf', {
    body: { cases, resident_name: profile.full_name, tenant: params.tenant },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return new NextResponse(pdfData, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="elogbook-${params.tenant}.pdf"`,
    },
  });
}
```

- [ ] **Step 4: Audit trail page**

Write `G:\elogbook\apps\web\app\(authenticated)\[tenant]\audit\page.tsx`:
```tsx
import { createServerSupabase } from '@/lib/supabase/server';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@heroui/react';
import { notFound } from 'next/navigation';

export default async function AuditPage({ params }: { params: { tenant: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, tenant_id')
    .eq('user_id', user.id)
    .single();

  if (!profile || !['director', 'institution_admin', 'admin'].includes(profile.role)) notFound();

  const { data: logs } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false })
    .limit(200);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Audit Trail</h1>
      <Table aria-label="Audit logs">
        <TableHeader>
          <TableColumn>Date</TableColumn>
          <TableColumn>Action</TableColumn>
          <TableColumn>Resource</TableColumn>
          <TableColumn>User</TableColumn>
          <TableColumn>IP</TableColumn>
        </TableHeader>
        <TableBody>
          {(logs ?? []).map((log) => (
            <TableRow key={log.id}>
              <TableCell>{new Date(log.created_at).toLocaleString()}</TableCell>
              <TableCell>{log.action}</TableCell>
              <TableCell>{log.resource_type}:{log.resource_id.slice(0, 8)}</TableCell>
              <TableCell>{log.user_id?.slice(0, 8) ?? 'system'}</TableCell>
              <TableCell>{log.ip_address ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 5: PDF generation Edge Function**

Write `G:\elogbook\supabase\functions\generate-pdf\index.ts`:
```ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const { cases, resident_name, tenant } = await req.json();

  const rows = (cases ?? []).map((c: any) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #ddd">${c.case_date}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd">${c.case_templates?.specialty} — ${c.case_templates?.name}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd">${c.patient_mrn}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>E-Logbook</title>
<style>
  body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
  h1 { color: #1a56db; margin-bottom: 4px; }
  .header { border-bottom: 2px solid #1a56db; padding-bottom: 16px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f0f0f0; padding: 8px; text-align: left; }
  .footer { margin-top: 40px; font-size: 12px; color: #666; border-top: 1px solid #ddd; padding-top: 16px; }
</style></head><body>
<div class="header">
  <h1>E-Logbook — Case Report</h1>
  <p>Resident: ${resident_name} | Generated: ${new Date().toISOString().split('T')[0]}</p>
</div>
<table>
  <thead><tr><th>Date</th><th>Case</th><th>MRN</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p style="margin-top:12px">Total cases: ${cases.length}</p>
<div class="footer">
  <p>This logbook is self-attested and generated by E-Logbook. For verification, contact your program director.</p>
  <p>Generated at ${new Date().toISOString()}</p>
</div>
</body></html>`;

  // For production, use Puppeteer. For MVP, return HTML as is.
  // Puppeteer approach: const browser = await puppeteer.launch(); const page = await browser.newPage(); await page.setContent(html); const pdf = await page.pdf({ format: 'A4' });

  return new Response(html, {
    headers: { ...corsHeaders, 'Content-Type': 'text/html' },
  });
});
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/ supabase/
git commit -m "feat: analytics dashboard, PDF export, audit trail page"
```

---

## Phase 8: Mobile App (Expo)

### Task 12: Expo Mobile App — Core Screens

**Files:**
- Create: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/app/(tabs)/_layout.tsx`
- Create: `apps/mobile/app/(tabs)/index.tsx`
- Create: `apps/mobile/app/(tabs)/log-case.tsx`
- Create: `apps/mobile/app/(tabs)/my-cases.tsx`
- Create: `apps/mobile/app/(tabs)/approvals.tsx`
- Create: `apps/mobile/app/(tabs)/profile.tsx`
- Create: `apps/mobile/app/login.tsx`
- Create: `apps/mobile/lib/supabase.ts`
- Create: `apps/mobile/components/CaseForm.tsx`
- Create: `apps/mobile/tailwind.config.js`

- [ ] **Step 1: Expo Supabase client + root layout**

Write `G:\elogbook\apps\mobile\lib\supabase.ts`:
```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } }
);
```

Write `G:\elogbook\apps\mobile\tailwind.config.js`:
```js
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: { extend: {} },
  plugins: [],
};
```

Write `G:\elogbook\apps\mobile\app\_layout.tsx`:
```tsx
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import '../global.css';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </>
  );
}
```

- [ ] **Step 2: Login screen**

Write `G:\elogbook\apps\mobile\app\login.tsx`:
```tsx
import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/(tabs)');
    });
  }, []);

  const handleLogin = async () => {
    setLoading(true);
    await supabase.auth.signInWithOtp({ email });
    setSent(true);
    setLoading(false);
  };

  return (
    <View className="flex-1 bg-black justify-center px-6">
      <Text className="text-white text-3xl font-bold text-center mb-2">E-Logbook</Text>
      <Text className="text-gray-400 text-center mb-8">Medical Case Logger</Text>

      {sent ? (
        <Text className="text-green-400 text-center text-lg">Check your email for a magic link!</Text>
      ) : (
        <View className="space-y-4">
          <TextInput
            className="bg-gray-900 text-white rounded-xl px-4 py-3 border border-gray-700"
            placeholder="doctor@hospital.org"
            placeholderTextColor="#666"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TouchableOpacity
            className={`rounded-xl py-3 ${email ? 'bg-blue-600' : 'bg-gray-700'}`}
            onPress={handleLogin}
            disabled={!email || loading}
          >
            {loading ? <ActivityIndicator color="white" /> : <Text className="text-white text-center font-semibold">Send Magic Link</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
```

- [ ] **Step 3: Tab layout + Dashboard**

Write `G:\elogbook\apps\mobile\app\(tabs)\_layout.tsx`:
```tsx
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      tabBarStyle: { backgroundColor: '#0a0a0a', borderTopColor: '#222' },
      tabBarActiveTintColor: '#3b82f6',
      tabBarInactiveTintColor: '#666',
      headerStyle: { backgroundColor: '#0a0a0a' },
      headerTintColor: '#fff',
    }}>
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} /> }} />
      <Tabs.Screen name="log-case" options={{ title: 'Log Case', tabBarIcon: ({ color, size }) => <Ionicons name="add-circle" size={size} color={color} /> }} />
      <Tabs.Screen name="my-cases" options={{ title: 'My Cases', tabBarIcon: ({ color, size }) => <Ionicons name="list" size={size} color={color} /> }} />
      <Tabs.Screen name="approvals" options={{ title: 'Approvals', tabBarIcon: ({ color, size }) => <Ionicons name="checkmark-circle" size={size} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} /> }} />
    </Tabs>
  );
}
```

Write `G:\elogbook\apps\mobile\app\(tabs)\index.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function DashboardScreen() {
  const [stats, setStats] = useState({ draft: 0, pending: 0, approved: 0 });
  const router = useRouter();

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase.from('profiles').select('id').eq('user_id', user.id).single();
    if (!profile) return;

    const [{ count: draft }, { count: pending }, { count: approved }] = await Promise.all([
      supabase.from('case_entries').select('*', { count: 'exact', head: true }).eq('resident_id', profile.id).eq('status', 'draft'),
      supabase.from('case_entries').select('*', { count: 'exact', head: true }).eq('resident_id', profile.id).eq('status', 'pending'),
      supabase.from('case_entries').select('*', { count: 'exact', head: true }).eq('resident_id', profile.id).eq('status', 'approved'),
    ]);

    setStats({ draft: draft ?? 0, pending: pending ?? 0, approved: approved ?? 0 });
  };

  return (
    <ScrollView className="flex-1 bg-black px-4 pt-4">
      <Text className="text-white text-2xl font-bold mb-6">Dashboard</Text>
      <View className="flex-row flex-wrap gap-4">
        {[
          { label: 'Drafts', count: stats.draft, color: 'bg-yellow-600' },
          { label: 'Pending', count: stats.pending, color: 'bg-blue-600' },
          { label: 'Approved', count: stats.approved, color: 'bg-green-600' },
        ].map((item) => (
          <View key={item.label} className={`${item.color} rounded-xl p-4 flex-1 min-w-[100px]`}>
            <Text className="text-white text-3xl font-bold">{item.count}</Text>
            <Text className="text-white/70 text-sm mt-1">{item.label}</Text>
          </View>
        ))}
      </View>
      <TouchableOpacity
        className="bg-blue-600 rounded-xl py-4 mt-6"
        onPress={() => router.push('/log-case')}
      >
        <Text className="text-white text-center font-bold text-lg">Log New Case</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
```

- [ ] **Step 4: Log Case screen**

Write `G:\elogbook\apps\mobile\app\(tabs)\log-case.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';

interface Template { id: string; specialty: string; name: string; fields: any[]; }

export default function LogCaseScreen() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [patientMrn, setPatientMrn] = useState('');
  const [patientDob, setPatientDob] = useState('');
  const [caseDate, setCaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => { loadTemplates(); }, []);

  const loadTemplates = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('user_id', user!.id).single();
    if (!profile) return;
    const { data } = await supabase.from('case_templates').select('*').eq('tenant_id', profile.tenant_id);
    if (data) setTemplates(data as Template[]);
  };

  const handleSubmit = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from('profiles').select('id, tenant_id, tenants!inner(tenant_type)').eq('user_id', user!.id).single();
    if (!profile) return;

    const { error } = await supabase.from('case_entries').insert({
      tenant_id: profile.tenant_id,
      resident_id: profile.id,
      template_id: selected!.id,
      patient_mrn: patientMrn,
      patient_dob: patientDob,
      case_date: caseDate,
      field_values: fieldValues,
      status: profile.tenants?.tenant_type === 'individual' ? 'pending' : 'draft',
    });

    setLoading(false);
    if (!error) router.push('/my-cases');
  };

  return (
    <ScrollView className="flex-1 bg-black px-4 pt-4">
      <Text className="text-white text-2xl font-bold mb-6">Log New Case</Text>

      {!selected ? (
        <View className="space-y-3">
          {templates.map(t => (
            <TouchableOpacity key={t.id} className="bg-gray-900 rounded-xl p-4 border border-gray-700" onPress={() => setSelected(t)}>
              <Text className="text-white font-semibold">{t.specialty} — {t.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View className="space-y-4">
          <TextInput className="bg-gray-900 text-white rounded-xl px-4 py-3 border border-gray-700" placeholder="Patient MRN" placeholderTextColor="#666" value={patientMrn} onChangeText={setPatientMrn} />
          <TextInput className="bg-gray-900 text-white rounded-xl px-4 py-3 border border-gray-700" placeholder="Patient DOB (YYYY-MM-DD)" placeholderTextColor="#666" value={patientDob} onChangeText={setPatientDob} />
          <TextInput className="bg-gray-900 text-white rounded-xl px-4 py-3 border border-gray-700" placeholder="Case Date" placeholderTextColor="#666" value={caseDate} onChangeText={setCaseDate} />

          {selected.fields.map((f: any) => (
            <View key={f.key}>
              <Text className="text-gray-400 text-sm mb-1 ml-1">{f.label}</Text>
              {f.type === 'select' && f.options ? (
                <View className="flex-row flex-wrap gap-2">
                  {f.options.map((opt: string) => (
                    <TouchableOpacity
                      key={opt}
                      className={`rounded-lg px-4 py-2 border ${fieldValues[f.key] === opt ? 'bg-blue-600 border-blue-600' : 'border-gray-700'}`}
                      onPress={() => setFieldValues({ ...fieldValues, [f.key]: opt })}
                    >
                      <Text className="text-white text-sm">{opt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <TextInput
                  className="bg-gray-900 text-white rounded-xl px-4 py-3 border border-gray-700"
                  placeholderTextColor="#666"
                  value={fieldValues[f.key] || ''}
                  onChangeText={(v) => setFieldValues({ ...fieldValues, [f.key]: v })}
                  multiline={f.type === 'textarea'}
                  numberOfLines={f.type === 'textarea' ? 3 : 1}
                />
              )}
            </View>
          ))}

          <View className="flex-row gap-3 pt-4">
            <TouchableOpacity className="flex-1 bg-gray-700 rounded-xl py-3" onPress={() => setSelected(null)}>
              <Text className="text-white text-center">Back</Text>
            </TouchableOpacity>
            <TouchableOpacity className="flex-1 bg-blue-600 rounded-xl py-3" onPress={handleSubmit} disabled={loading}>
              {loading ? <ActivityIndicator color="white" /> : <Text className="text-white text-center font-bold">Save Case</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 5: My Cases screen**

Write `G:\elogbook\apps\mobile\app\(tabs)\my-cases.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { supabase } from '../../lib/supabase';

export default function MyCasesScreen() {
  const [cases, setCases] = useState<any[]>([]);

  useEffect(() => { loadCases(); }, []);

  const loadCases = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from('profiles').select('id').eq('user_id', user!.id).single();
    if (!profile) return;
    const { data } = await supabase
      .from('case_entries')
      .select('*, case_templates(name, specialty)')
      .eq('resident_id', profile.id)
      .order('created_at', { ascending: false });
    if (data) setCases(data);
  };

  const statusColor = (s: string) => {
    switch (s) { case 'approved': return 'text-green-400'; case 'pending': return 'text-blue-400'; case 'draft': return 'text-yellow-400'; case 'rejected': return 'text-red-400'; default: return 'text-gray-400'; }
  };

  return (
    <ScrollView className="flex-1 bg-black px-4 pt-4">
      <Text className="text-white text-2xl font-bold mb-6">My Cases</Text>
      {cases.map(c => (
        <View key={c.id} className="bg-gray-900 rounded-xl p-4 mb-3 border border-gray-800">
          <View className="flex-row justify-between mb-1">
            <Text className="text-white font-semibold">{c.case_templates?.specialty} — {c.case_templates?.name}</Text>
            <Text className={statusColor(c.status)}>{c.status}</Text>
          </View>
          <Text className="text-gray-400 text-sm">MRN: {c.patient_mrn} | {c.case_date}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
```

- [ ] **Step 6: Profile screen**

Write `G:\elogbook\apps\mobile\app\(tabs)\profile.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function ProfileScreen() {
  const [profile, setProfile] = useState<any>(null);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from('profiles').select('*').eq('user_id', user.id).single();
      setProfile(data);
    });
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  if (!profile) return <View className="flex-1 bg-black" />;

  return (
    <View className="flex-1 bg-black px-4 pt-4">
      <Text className="text-white text-2xl font-bold mb-6">Profile</Text>
      <View className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
        <View className="w-16 h-16 bg-blue-600 rounded-full items-center justify-center mb-4 mx-auto">
          <Text className="text-white text-2xl font-bold">{profile.full_name?.charAt(0)}</Text>
        </View>
        <Text className="text-white text-xl font-bold text-center">{profile.full_name}</Text>
        <Text className="text-gray-400 text-center mt-1 capitalize">{profile.role}</Text>
        {profile.specialty && <Text className="text-gray-400 text-center">{profile.specialty}</Text>}
      </View>
      <TouchableOpacity className="bg-red-600/20 rounded-xl py-4 border border-red-600" onPress={handleSignOut}>
        <Text className="text-red-400 text-center font-semibold">Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/
git commit -m "feat: Expo mobile app — login, dashboard, case logging, profile"
```

---

## Phase 9: AI Insights & Final Touches

### Task 13: AI Insights Edge Function

**Files:**
- Create: `supabase/functions/ai-insights/index.ts`
- Create: `apps/web/components/AIInsightsPanel.tsx`

- [ ] **Step 1: AI insights Edge Function**

Write `G:\elogbook\supabase\functions\ai-insights\index.ts`:
```ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const { tenant_id, resident_id, query } = await req.json();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Check if AI is enabled and resident has access
  const { data: toggle } = await supabase.from('resident_ai_toggle').select('*').eq('tenant_id', tenant_id).eq('resident_id', resident_id).eq('enabled', true).maybeSingle();
  if (!toggle) return new Response(JSON.stringify({ error: 'AI not enabled for this resident' }), { status: 403, headers: corsHeaders });

  // Get AI config
  const { data: config } = await supabase.from('ai_config').select('*').eq('tenant_id', tenant_id).eq('is_active', true).single();
  if (!config) return new Response(JSON.stringify({ error: 'AI not configured' }), { status: 400, headers: corsHeaders });

  // Get resident's cases for context
  const { data: cases } = await supabase
    .from('case_entries')
    .select('*, case_templates(name, specialty)')
    .eq('resident_id', resident_id)
    .eq('status', 'approved')
    .order('case_date', { ascending: false })
    .limit(50);

  // Build prompt
  const caseSummary = cases?.map(c => `- ${c.case_date}: ${c.case_templates?.specialty} — ${c.case_templates?.name}, MRN: ${c.patient_mrn}`).join('\n') ?? 'No cases found';

  const systemPrompt = `You are an AI medical logbook assistant. Analyze the resident's case history and provide insights.`;

  const userPrompt = query
    ? `The resident asks: "${query}". Here are their cases:\n${caseSummary}`
    : `Analyze this resident's case history and identify: 1) Strengths, 2) Areas for improvement/gaps, 3) Trends. Cases:\n${caseSummary}`;

  // Route to appropriate provider
  let response: string;
  let tokensUsed = 0;

  const apiKey = config.encrypted_api_key; // In production, decrypt from Vault
  const model = config.model;
  const provider = config.provider;

  try {
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
      });
      const json = await res.json();
      response = json.choices?.[0]?.message?.content ?? 'No response';
      tokensUsed = json.usage?.total_tokens ?? 0;
    } else if (provider === 'openrouter') {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'HTTP-Referer': Deno.env.get('SUPABASE_URL')! },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
      });
      const json = await res.json();
      response = json.choices?.[0]?.message?.content ?? 'No response';
      tokensUsed = json.usage?.total_tokens ?? 0;
    } else if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 1024, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
      });
      const json = await res.json();
      response = json.content?.[0]?.text ?? 'No response';
      tokensUsed = json.usage?.input_tokens + json.usage?.output_tokens ?? 0;
    } else if (provider === 'azure') {
      const endpoint = config.endpoint_url || `https://${apiKey}.openai.azure.com/openai/deployments/${model}/chat/completions?api-version=2024-02-01`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
      });
      const json = await res.json();
      response = json.choices?.[0]?.message?.content ?? 'No response';
    } else if (provider === 'custom') {
      const res = await fetch(config.endpoint_url!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
      });
      const json = await res.json();
      response = typeof json === 'string' ? json : (json.choices?.[0]?.message?.content ?? JSON.stringify(json));
    } else {
      return new Response(JSON.stringify({ error: `Unsupported provider: ${provider}` }), { status: 400, headers: corsHeaders });
    }

    // Log the AI query
    await supabase.from('ai_query_logs').insert({
      tenant_id, resident_id, query: userPrompt, response, tokens_used: tokensUsed,
    });

    return new Response(JSON.stringify({ response, tokens_used: tokensUsed }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
```

- [ ] **Step 2: AI Insights UI component (web)**

Write `G:\elogbook\apps\web\components\AIInsightsPanel.tsx`:
```tsx
'use client';

import { createClient } from '@/lib/supabase/client';
import { Button, Card, CardBody, CardHeader, Textarea, Spinner } from '@heroui/react';
import { useState } from 'react';

interface Props { tenantId: string; residentId: string; }

export default function AIInsightsPanel({ tenantId, residentId }: Props) {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const supabase = createClient();

  const handleQuery = async () => {
    setLoading(true); setError(''); setResponse('');
    const { data, error: fnError } = await supabase.functions.invoke('ai-insights', {
      body: { tenant_id: tenantId, resident_id: residentId, query: query || null },
    });
    if (fnError) { setError(fnError.message); setLoading(false); return; }
    setResponse(data.response);
    setLoading(false);
  };

  return (
    <Card>
      <CardHeader><h3 className="font-semibold">AI Insights</h3></CardHeader>
      <CardBody className="space-y-4">
        <Textarea
          label="Ask about your cases (optional)"
          placeholder="e.g. What are my most common procedures?"
          value={query}
          onValueChange={setQuery}
        />
        <Button color="secondary" isLoading={loading} onPress={handleQuery}>
          {query ? 'Ask AI' : 'Analyze My Cases'}
        </Button>
        {error && <p className="text-danger text-sm">{error}</p>}
        {loading && <Spinner />}
        {response && (
          <div className="bg-default-100 rounded-lg p-4 whitespace-pre-wrap text-sm">
            {response}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/ai-insights/ apps/web/components/AIInsightsPanel.tsx
git commit -m "feat: AI insights — multi-provider LLM integration, query UI"
```

---

### Task 14: Final Assembly & Route Wiring

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/layout.tsx`
- Create: `apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx`

- [ ] **Step 1: Tenant layout with navigation sidebar**

Write `G:\elogbook\apps\web\app\(authenticated)\[tenant]\layout.tsx`:
```tsx
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function TenantLayout({ children, params }: { children: React.ReactNode; params: { tenant: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, tenants!inner(slug, tenant_type)')
    .eq('user_id', user.id)
    .single();

  if (!profile || profile.tenants?.slug !== params.tenant) redirect('/login');

  const role = profile.role;
  const tenant = params.tenant;

  const links: { href: string; label: string; roles: string[] }[] = [
    { href: `/${tenant}/dashboard`, label: 'Dashboard', roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'] },
    { href: `/${tenant}/cases`, label: 'Cases', roles: ['resident', 'supervisor'] },
    { href: `/${tenant}/approvals`, label: 'Approvals', roles: ['supervisor', 'director', 'admin'] },
    { href: `/${tenant}/goals`, label: 'Goals', roles: ['resident', 'director', 'admin'] },
    { href: `/${tenant}/reports`, label: 'Reports', roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'] },
    { href: `/${tenant}/billing`, label: 'Billing', roles: ['resident', 'admin'] },
    { href: `/${tenant}/audit`, label: 'Audit', roles: ['director', 'institution_admin', 'admin'] },
    { href: `/${tenant}/admin`, label: 'Admin', roles: ['director', 'institution_admin', 'admin'] },
  ];

  const visibleLinks = links.filter(l => l.roles.includes(role));

  return (
    <div className="flex min-h-[calc(100vh-64px)]">
      <aside className="w-56 border-r border-divider p-4 shrink-0">
        <nav className="space-y-1">
          {visibleLinks.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="block px-3 py-2 rounded-lg text-sm hover:bg-default-100 transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Tenant dashboard page (move from root dashboard)**

Write `G:\elogbook\apps\web\app\(authenticated)\[tenant]\dashboard\page.tsx`:
```tsx
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, CardBody, CardHeader, Button } from '@heroui/react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import AIInsightsPanel from '@/components/AIInsightsPanel';

export default async function TenantDashboardPage({ params }: { params: { tenant: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, tenant_id, tenants!inner(slug, tenant_type)')
    .eq('user_id', user.id)
    .single();

  if (!profile) notFound();

  const { count: draftCount } = await supabase
    .from('case_entries')
    .select('*', { count: 'exact', head: true })
    .eq('resident_id', profile.id)
    .eq('status', 'draft');

  const { count: approvedCount } = await supabase
    .from('case_entries')
    .select('*', { count: 'exact', head: true })
    .eq('resident_id', profile.id)
    .eq('status', 'approved');

  const { count: pendingCount } = profile.role === 'supervisor' || profile.role === 'director'
    ? await supabase.from('approval_requests').select('*', { count: 'exact', head: true }).eq('supervisor_id', profile.id).eq('status', 'pending')
    : { count: null };

  // Check if AI is enabled
  const { data: aiToggle } = await supabase
    .from('resident_ai_toggle')
    .select('*')
    .eq('tenant_id', profile.tenant_id)
    .eq('resident_id', profile.id)
    .eq('enabled', true)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link href={`/${params.tenant}/cases/new`}>
          <Button color="primary">Log New Case</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardHeader>Draft Cases</CardHeader><CardBody><p className="text-3xl font-bold">{draftCount ?? 0}</p></CardBody></Card>
        <Card><CardHeader>Approved Cases</CardHeader><CardBody><p className="text-3xl font-bold">{approvedCount ?? 0}</p></CardBody></Card>
        {pendingCount !== null && (
          <Card><CardHeader>Pending Reviews</CardHeader><CardBody><p className="text-3xl font-bold">{pendingCount}</p></CardBody></Card>
        )}
      </div>

      {aiToggle && <AIInsightsPanel tenantId={profile.tenant_id} residentId={profile.id} />}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/
git commit -m "feat: tenant layout with sidebar navigation, dashboard with AI insights widget"
```

---

### Task 15: Supabase Config & Deploy Preparation

**Files:**
- Create: `supabase/config.toml`
- Create: `apps/web/.env.local`
- Create: `apps/mobile/.env`
- Create: `package.json` script updates

- [ ] **Step 1: Create Supabase config**

Write `G:\elogbook\supabase\config.toml`:
```toml
project_id = "elogbook"

[db]
port = 54322

[auth]
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/auth/callback", "elogbook://auth/callback"]

[functions]
[functions.generate-pdf]
[functions.ai-insights]
[functions.payment-webhook]
[functions.create-checkout]
```

- [ ] **Step 2: Add deploy scripts to root package.json**

Edit `G:\elogbook\package.json` to add:
```json
{
  "scripts": {
    "dev:web": "turbo run dev --filter=@elogbook/web",
    "dev:mobile": "turbo run start --filter=@elogbook/mobile",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "db:migrate": "supabase db push",
    "db:seed": "supabase db seed",
    "functions:deploy": "supabase functions deploy generate-pdf && supabase functions deploy ai-insights && supabase functions deploy payment-webhook && supabase functions deploy create-checkout"
  }
}
```

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete e-logbook — 15 tasks, full system ready for deployment"
```

