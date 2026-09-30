# eLogbook Security Hardening Plan

**Status:** IN PROGRESS  
**Date:** 2026-09-23  
**Priority:** CRITICAL - Multiple high-severity vulnerabilities identified

## Executive Summary

Security audit identified critical vulnerabilities requiring immediate remediation:
- 2 CRITICAL RCE vulnerabilities in Next.js 16.3.1
- Production secrets in .env.local at risk of commit
- Console logging may leak sensitive data
- Multiple security hardening opportunities across auth, input validation, and infrastructure

## 🔴 CRITICAL - Immediate Action Required (P0)

### 1. ✅ Next.js Critical RCE Vulnerabilities
**Severity:** CRITICAL  
**CVEs:** 
- GHSA-p293-qw3h-jr36: Unauthenticated RCE on Windows-hosted servers
- GHSA-2xp9-vwfh-vxw4: Unauthenticated RCE in Image Optimization API (AVIF)

**Current:** Next.js 16.3.1 (VULNERABLE)  
**Required:** Next.js >=16.3.3  
**Action:** Upgrade Next.js immediately

```bash
pnpm up next@latest -r
pnpm up @sentry/nextjs@latest -r
```

### 2. ✅ Production Secrets in .env.local
**Severity:** CRITICAL  
**Risk:** Real production Supabase credentials in apps/web/.env.local

**Current state:** real values are present in `apps/web/.env.local`. They are
deliberately not reproduced here; the file is gitignored, but the service-role
key it holds is still live and must be rotated.

```
SUPABASE_SERVICE_ROLE_KEY=<redacted — rotate this key>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<redacted>
```

**Actions:**
- [ ] Verify .env.local is NOT in git history
- [ ] Move to .env.example with placeholder values
- [ ] Rotate Supabase service role key immediately
- [ ] Add pre-commit hook to prevent .env commits
- [ ] Document secret management in README

### 3. ✅ Remove Console Logging from Production
**Severity:** HIGH  
**Risk:** Sensitive data (errors, user info) exposed in production logs

**Found in:**
- apps/web/app/api/[tenant]/admin/*.ts (14+ instances)
- apps/web/app/(authenticated)/[tenant]/cases/[id]/submit/route.ts

**Action:** Replace console.* with structured logging via Sentry

## 🟠 HIGH Priority (P1)

### 4. ⏳ Environment Variable Security
- [ ] Verify RATE_LIMIT_MODE is set in production
- [ ] Audit all NEXT_PUBLIC_* variables for secrets
- [ ] Implement secret scanning in CI/CD
- [ ] Add .env.production.example template

### 5. ⏳ Input Validation & Sanitization
- [ ] Audit all API routes for missing input validation
- [ ] Add Zod schemas for all request payloads
- [ ] Implement file upload validation (type, size, content)
- [ ] Add XSS protection for user-generated content

### 6. ⏳ Authentication & Authorization
- [ ] Audit all API routes for missing auth checks
- [ ] Verify requireTenantAdmin usage is consistent
- [ ] Check for privilege escalation vectors
- [ ] Implement MFA enforcement for sensitive operations

### 7. ⏳ Rate Limiting Coverage
- [ ] Add rate limiting to file upload endpoints
- [ ] Rate limit expensive operations (PDF, AI queries)
- [ ] Implement per-tenant rate limits
- [ ] Add webhook rate limiting

## 🟡 MEDIUM Priority (P2)

### 8. ⏳ SQL Injection Prevention
- [ ] Audit all Supabase queries for proper parameterization
- [ ] Review SECURITY DEFINER functions for injection risks
- [ ] Add query complexity limits

### 9. ⏳ CSRF Protection Enhancement
- [ ] Verify CSRF tokens on all state-changing operations
- [ ] Add SameSite=Strict on auth cookies
- [ ] Implement double-submit cookie pattern

### 10. ⏳ Email Verification
- [ ] Enforce email verification before granting access
- [ ] Implement email verification flow
- [ ] Add email change confirmation

### 11. ⏳ Password Security
- [ ] Verify Supabase password policy (min length, complexity)
- [ ] Implement password breach checking
- [ ] Add password reset rate limiting

### 12. ⏳ Session Management
- [ ] Verify auth tokens use httpOnly cookies
- [ ] Implement session timeout/rotation
- [ ] Add concurrent session limits

### 13. ⏳ API Security
- [ ] Add request size limits
- [ ] Implement API versioning
- [ ] Add rate limiting headers
- [ ] Document API authentication

### 14. ⏳ File Upload Security
- [ ] Validate file types server-side
- [ ] Scan uploads for malware
- [ ] Implement file size limits
- [ ] Store uploads outside webroot

### 15. ⏳ Webhook Security
- [ ] Verify all webhook signatures
- [ ] Add webhook retry logic with exponential backoff
- [ ] Implement webhook secret rotation

## 🟢 LOW Priority (P3)

### 16. ⏳ Infrastructure Hardening
- [ ] Disable debug mode in production (verify NODE_ENV)
- [ ] Add security headers (HSTS, X-Frame-Options, etc)
- [ ] Implement CSP reporting
- [ ] Add health check monitoring

### 17. ⏳ Dependency Management
- [ ] Set up automated dependency updates (Dependabot/Renovate)
- [ ] Add pnpm audit to CI/CD pipeline
- [ ] Pin all dependency versions
- [ ] Regular security scanning

### 18. ⏳ Logging & Monitoring
- [ ] Implement structured logging (Winston/Pino)
- [ ] Add security event monitoring
- [ ] Set up alerting for suspicious activity
- [ ] Implement audit trail for sensitive operations

### 19. ⏳ Data Protection
- [ ] Verify PHI redaction in audit logs
- [ ] Implement data retention policies
- [ ] Add data export/deletion APIs (GDPR)
- [ ] Encrypt sensitive fields at rest

### 20. ⏳ Security Testing
- [ ] Add security-focused unit tests
- [ ] Implement automated security testing in CI
- [ ] Conduct penetration testing
- [ ] Add OWASP ZAP scanning

## Implementation Progress

**Current Status:** Awaiting security review agent results  
**Next Steps:** 
1. Fix P0 critical vulnerabilities
2. Run comprehensive security review
3. Implement fixes based on review findings
4. Deploy and verify

## Notes

- All security changes should be tested in staging before production
- Document all security decisions and trade-offs
- Keep this plan updated as work progresses
- Schedule regular security audits (quarterly)
