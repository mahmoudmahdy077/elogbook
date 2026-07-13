# Role Model & Authorization Contract

## Roles

| Role | Scope | Description |
|------|-------|-------------|
| `resident` | Tenant | Logs clinical cases, views own data, manages own drafts |
| `supervisor` | Tenant | Reviews/approves/rejects cases, reads tenant analytics |
| `director` | Tenant | Manages templates, goals, evaluations; full tenant read access |
| `institution_admin` | Tenant | Manages users, billing, SSO config, AI config, data retention |
| `admin` | Global | Platform administration across all tenants |

## Access by Resource

| Resource | resident | supervisor | director | institution_admin | admin |
|----------|----------|------------|----------|-------------------|-------|
| Own cases | CRUD (draft) | R | R | R | R |
| Tenant cases | - | R | R | R | R |
| Case templates | R | R | CRUD | CRUD | CRUD |
| Approval requests | C (own) | CRUD | R | R | R |
| Profiles | R (own) | R (tenant) | R (tenant) | CRUD (tenant) | CRUD |
| Audit logs | - | - | R (tenant) | R (tenant) | R |
| Program goals | R | R | CRUD | CRUD | CRUD |
| Subscriptions | R (own) | R | R | CRUD | CRUD |
| AI config | - | - | R | CRUD | CRUD |
| SSO config | - | - | - | CRUD | CRUD |
| Webhooks | - | - | - | CRUD | CRUD |
| Billing | - | - | R | CRUD | CRUD |

## MFA Requirements

- MFA is enforced for: `institution_admin`, `admin` roles
- Step-up MFA for: changing SSO config, webhook secrets, billing configuration

## Authorization Enforcement

1. **Server boundary** — route handlers validate tenant_id matches session, role is sufficient
2. **Database/RLS** — Postgres RLS enforces tenant isolation at row level
3. **Service role** — only used after application-level authorization, tenant-id asserted
4. **Edge Functions** — authenticate via JWT, re-validate role/tenant per request

## Break-Glass Policy

In emergencies, `admin` role can temporarily:
- Impersonate a tenant via audited time-bound token
- Access audit logs cross-tenant
- Modify tenant configuration

All break-glass actions are logged with actor, reason, duration, and tenant id.
