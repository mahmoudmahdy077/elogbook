# Runbook: Install (self-hosted, single VPS)

Audience: installation owner with VPS root/SSH. Topology: Ubuntu 24.04
x86_64, Docker Engine + Compose pinned (see release record), Caddy on
80/443, Supabase self-hosted alongside the app.

> Status: MANUAL procedure. The one-step GUI installer (T12-full) does
> not exist yet; do not improvise one from the production-disabled
> `/api/setup/*` routes (they 404 in production by design).

## 1. Prepare the host

```bash
docker --version && docker compose version
df -h / && free -g            # need: 80GB disk, 8GB RAM provisioned (T11)
ss -ltn | grep -E ':(80|443)' || echo "ports 80/443 free"
```

## 2. Fetch the qualified release (never `main`, never `latest`)

```bash
git clone --branch <QUALIFIED_TAG> https://github.com/mahmoudmahdy077/elogbook.git
cd elogbook
git rev-parse HEAD            # record digest in the install log
```

## 3. Configure (copy, never commit secrets)

```bash
cp .env.example .env.local
# Fill: NEXT_PUBLIC_SUPABASE_URL/ANON_KEY (your Supabase project or the
# self-hosted bundle from T11-full), SUPABASE_SERVICE_ROLE_KEY,
# NEXT_PUBLIC_SITE_URL (https origin), RATE_LIMIT_MODE=single-instance,
# TRUSTED_PROXY_HOPS=1
```

## 4. Start Supabase first, then the app

```bash
supabase start                # local/dev; production uses the T11 bundle
supabase db push              # fail-fast migrator semantics (T08)
docker compose up -d --build  # app + Caddy
curl -fsS http://localhost:3000/api/health     # 200 healthy
curl -fsS http://localhost:3000/api/ready      # 200 ready (503 = not ready)
```

## 5. First operator + tenant (attested, out-of-band)

```bash
psql $DATABASE_URL -v operator_email='boss@example.com' \
  -v granted_by='' -v reason='initial bootstrap operator' \
  -f scripts/grant-platform-admin.sql
# Operator enrolls MFA before first platform use (platform denies without AAL2).
```

## 6. Hand over

Record: release tag + image digests, migration count, backup schedule,
operator roster, and the go/no-go sign-off (rollout.md). Close port 22
to the world or restrict to bastion IPs.
