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

The setup profile requires a pre-created external `supabase_default` network. If
`docker network inspect supabase_default` fails, stop and run
`docker network create supabase_default` as the host Docker administrator
before starting the setup profile; the setup container must not start against
a missing network.

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

## 4. Run the isolated setup profile (when using the GUI installer)

Set the build commit once; the setup image rejects a missing or non-SHA value.
The setup profile is non-production, joins `supabase_default`, and publishes
only loopback. Do not publish it on a public interface.

```bash
export APP_RELEASE_COMMIT="$(git rev-parse HEAD)"
docker compose -f setup.docker-compose.yml up -d --build
ssh -N -L 3000:127.0.0.1:3000 <operator>@<host>
# Open http://127.0.0.1:3000/setup from the operator workstation.
```

For any reverse-proxied remote access, terminate TLS at the proxy and pass
`x-forwarded-proto: https`; the setup guard rejects remote HTTP requests.
The production `docker-compose.yml` never mounts the Docker socket and does
not enable setup mode.

## 5. Start Supabase first, then the app

```bash
supabase start                # local/dev; production uses the T11 bundle
supabase db push              # fail-fast migrator semantics (T08)
docker compose up -d --build  # app + Caddy
curl -fsS http://localhost:3000/api/health     # 200 healthy
curl -fsS http://localhost:3000/api/ready      # 200 ready (503 = not ready)
```

## 6. First operator + tenant (attested, out-of-band)

```bash
psql $DATABASE_URL -v operator_email='boss@example.com' \
  -v granted_by='' -v reason='initial bootstrap operator' \
  -f scripts/grant-platform-admin.sql
# Operator enrolls MFA before first platform use (platform denies without AAL2).
```

## 7. Email (GoTrue SMTP mapping + Resend domain)

The installer (`apps/web/lib/setup/supabase-installer.ts`
`writeSupabaseEnv`) carries real SMTP values into the self-hosted
Supabase `.env` and fails closed when `SMTP_HOST` is empty — it throws
instead of writing silently-broken config. Auth mails stay
GoTrue-owned; the platform queue (Resend primary + SMTP fallback) never
sends auth mails.

SMTP → GoTrue mirror mapping written by the installer:

| Compose `.env` key | GoTrue mirror | Notes |
| --- | --- | --- |
| `SMTP_HOST` | `GOTRUE_MAILER_SMTP_HOST` | Required; empty fails the deploy step |
| `SMTP_PORT` | `GOTRUE_MAILER_SMTP_PORT` | Default `587` (STARTTLS); `465` for implicit TLS |
| `SMTP_USER` | `GOTRUE_MAILER_SMTP_USER` | SMTP auth user |
| `SMTP_PASS` | `GOTRUE_MAILER_SMTP_PASS` | SMTP auth secret; copy, never commit |
| `SMTP_ADMIN_EMAIL` | `GOTRUE_MAILER_SMTP_ADMIN_EMAIL` | GoTrue sender identity |
| `SMTP_SENDER_NAME` | (display name only) | e.g. `E-Logbook` |

After `docker compose up`, confirm GoTrue picked up the mailer:

```bash
docker compose -f /opt/supabase/docker-compose.yml config | grep -E 'MAILER_SMTP|SMTP_'
docker logs supabase-auth-1 2>&1 | grep -i mailer | Select-Object -First 10
```

### GoTrue template overrides

Auth mail copy (invite, confirmation, recovery, magic link) is GoTrue
template territory, not the platform `email_templates` table. To
override, set the `GOTRUE_MAILER_TEMPLATES_*` / `GOTRUE_MAILER_SUBJECTS_*`
keys (or mount custom template files) in the pinned Supabase bundle and
restart `auth`:

```bash
# Example overrides in /opt/supabase/.env (verify key names against the
# pinned bundle's docker-compose.yml — they drift between releases):
# GOTRUE_MAILER_SUBJECTS_CONFIRMATION="Confirm your E-Logbook account"
# GOTRUE_MAILER_TEMPLATES_CONFIRMATION=/path/to/confirmation.html
# GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify
docker compose -f /opt/supabase/docker-compose.yml up -d auth
```

Keep `ENABLE_EMAIL_AUTOCONFIRM=false` in production; with it `false`,
signup/login mails only flow when the SMTP mapping above is correct.
Smoke-test with a real signup confirmation before go-live.

### Resend domain checklist (SPF/DKIM/DMARC)

Platform mail sends as `EMAIL_FROM` via Resend. Before go-live:

- [ ] Add the Resend-provided SPF record (usually `include:amazonses.com`
  via Resend's SPF host) — `dig TXT <domain>` returns it.
- [ ] Add all Resend DKIM records (3× CNAME/TXT as shown in the Resend
  dashboard) — domain status reads `Verified`, not `Pending`.
- [ ] Publish a DMARC record, e.g.
  `_dmarc.<domain> TXT "v=DMARC1; p=quarantine; rua=mailto:dmarc@<domain>"`,
  then move `p=reject` once mail flows cleanly.
- [ ] `EMAIL_FROM` uses the verified domain (e.g.
  `E-Logbook <noreply@<domain>>`); `EMAIL_REPLY_TO` is monitored.
- [ ] Send a platform test mail (`POST /api/platform/email/test` as
  platform admin) and confirm headers show SPF/DKIM `pass` and the
  envelope-from aligns with the verified domain.

## 8. Hand over

Record: release tag + image digests, migration count, backup schedule,
operator roster, and the go/no-go sign-off (rollout.md). Close port 22
to the world or restrict to bastion IPs.
