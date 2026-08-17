# E-Logbook Comprehensive Browser + API Test Script
# Tests every route for all 5 roles

$baseApiUrl = "https://nuyedxkzaimlzaetbpaw.supabase.co"
$supabaseUrl = "https://nuyedxkzaimlzaetbpaw.supabase.co"
$anonKey = "sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3"
$localUrl = "http://localhost:3000"
$tenantSlug = "qa-e2e"
$tenantId = "11111111-1111-1111-1111-111111111111"

# ── Helper Functions ──────────────────────────────────────────────────────────

function Get-UserToken {
    param([string]$Email, [string]$Password = "password123!")
    $resp = Invoke-RestMethod -Uri "$supabaseUrl/auth/v1/token?grant_type=password" `
        -Method Post `
        -Headers @{ "apikey" = $anonKey; "Content-Type" = "application/json" } `
        -Body (@{ email = $Email; password = $Password } | ConvertTo-Json)
    return @{ token = $resp.access_token; user = $resp.user }
}

function Test-Route {
    param([string]$Method, [string]$Url, [string]$Token, [string]$Body = $null, [int[]]$ExpectedCodes, [string]$Description)
    try {
        $headers = @{ "apikey" = $anonKey }
        if ($Token) { $headers["Authorization"] = "Bearer $Token" }
        $params = @{ Uri = $Url; Method = $Method; Headers = $headers; TimeoutSec = 15; UseBasicParsing = $true }
        if ($Body) { $params["Body"] = $Body; $params["Headers"]["Content-Type"] = "application/json" }
        $resp = Invoke-WebRequest @params
        $status = $resp.StatusCode
    } catch {
        $status = [int]$_.Exception.Response.StatusCode.value__
    }
    $pass = $ExpectedCodes -contains $status
    $icon = if ($pass) { "PASS" } else { "FAIL" }
    Write-Output "$icon | $Method $Url | Expected: $($ExpectedCodes -join '/') | Got: $status | $Description"
    return $pass
}

function Login-AllRoles {
    $roles = @{}
    $roles["resident"]    = Get-UserToken -Email "qa-resident@elogbook.dev"
    $roles["supervisor"]  = Get-UserToken -Email "qa-supervisor@elogbook.dev"
    $roles["director"]    = Get-UserToken -Email "qa-director@elogbook.dev"
    $roles["inst_admin"]  = Get-UserToken -Email "qa-institution-admin@elogbook.dev"
    $roles["admin"]       = Get-UserToken -Email "qa-admin@elogbook.dev"
    return $roles
}

# ── Phase 1: Login All Roles ──────────────────────────────────────────────────

Write-Output "`n=== PHASE 1: LOGIN ALL ROLES ==="
$roles = Login-AllRoles
foreach ($role in $roles.Keys) {
    $t = $roles[$role].token
    Test-Route -Method "POST" -Url "$supabaseUrl/auth/v1/token?grant_type=password" `
        -Body (@{ email = "qa-$role@elogbook.dev"; password = "password123!" } | ConvertTo-Json) `
        -ExpectedCodes @(200) `
        -Description "Login as $role"
}

# ── Phase 2: Auth Endpoints ───────────────────────────────────────────────────

Write-Output "`n=== PHASE 2: AUTH & PUBLIC ENDPOINTS ==="
Test-Route -Method "GET" -Url "$localUrl/login" -ExpectedCodes @(200) -Description "Login page"
Test-Route -Method "GET" -Url "$localUrl/signup" -ExpectedCodes @(200) -Description "Signup page"
Test-Route -Method "GET" -Url "$localUrl/pricing" -ExpectedCodes @(200) -Description "Pricing page"
Test-Route -Method "GET" -Url "$localUrl/contact" -ExpectedCodes @(200) -Description "Contact page"
Test-Route -Method "POST" -Url "$localUrl/api/contact" `
    -Body (@{ name = "Test"; email = "test@example.com"; message = "Test message" } | ConvertTo-Json) `
    -ExpectedCodes @(200) -Description "Contact form submission"

# ── Phase 3: Resident Routes ──────────────────────────────────────────────────

Write-Output "`n=== PHASE 3: RESIDENT ROUTES ==="
$resident = $roles["resident"].token

Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/dashboard" -Token $resident -ExpectedCodes @(200) -Description "Resident: Dashboard"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/cases" -Token $resident -ExpectedCodes @(200) -Description "Resident: Cases list"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/cases/new" -Token $resident -ExpectedCodes @(200) -Description "Resident: New case form"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/goals" -Token $resident -ExpectedCodes @(200) -Description "Resident: Goals"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/milestones" -Token $resident -ExpectedCodes @(200) -Description "Resident: Milestones"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/resident/duty-hours" -Token $resident -ExpectedCodes @(200) -Description "Resident: Duty hours"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/resident/evaluations" -Token $resident -ExpectedCodes @(200) -Description "Resident: My evaluations"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/analytics" -Token $resident -ExpectedCodes @(302, 403) -Description "Resident: Analytics (should redirect 403)"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/reports" -Token $resident -ExpectedCodes @(200) -Description "Resident: Reports"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/audit" -Token $resident -ExpectedCodes @(200) -Description "Resident: Audit log"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/compliance" -Token $resident -ExpectedCodes @(200) -Description "Resident: Compliance"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/billing" -Token $resident -ExpectedCodes @(200) -Description "Resident: Billing"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/consent" -Token $resident -ExpectedCodes @(200) -Description "Resident: Consent"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/admin" -Token $resident -ExpectedCodes @(302, 403) -Description "Resident: Admin (should redirect 403)"

# ── Phase 4: Supervisor Routes ────────────────────────────────────────────────

Write-Output "`n=== PHASE 4: SUPERVISOR ROUTES ==="
$supervisor = $roles["supervisor"].token

Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/dashboard" -Token $supervisor -ExpectedCodes @(200) -Description "Supervisor: Dashboard"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/approvals" -Token $supervisor -ExpectedCodes @(200) -Description "Supervisor: Approvals"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/evaluations" -Token $supervisor -ExpectedCodes @(200) -Description "Supervisor: Evaluations"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/evaluate" -Token $supervisor -ExpectedCodes @(200) -Description "Supervisor: Evaluate"

# ── Phase 5: Director Routes ──────────────────────────────────────────────────

Write-Output "`n=== PHASE 5: DIRECTOR ROUTES ==="
$director = $roles["director"].token

Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/dashboard" -Token $director -ExpectedCodes @(200) -Description "Director: Dashboard"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/analytics" -Token $director -ExpectedCodes @(200) -Description "Director: Analytics"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/reports" -Token $director -ExpectedCodes @(200) -Description "Director: Reports"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/rotations" -Token $director -ExpectedCodes @(200) -Description "Director: Rotations"

# ── Phase 6: Institution Admin Routes ─────────────────────────────────────────

Write-Output "`n=== PHASE 6: INSTITUTION ADMIN ROUTES ==="
$instAdmin = $roles["inst_admin"].token

Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/dashboard" -Token $instAdmin -ExpectedCodes @(200) -Description "InstAdmin: Dashboard"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/admin" -Token $instAdmin -ExpectedCodes @(200) -Description "InstAdmin: Admin panel"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/billing" -Token $instAdmin -ExpectedCodes @(200) -Description "InstAdmin: Billing"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/audit" -Token $instAdmin -ExpectedCodes @(200) -Description "InstAdmin: Audit"

# ── Phase 7: Admin Routes ─────────────────────────────────────────────────────

Write-Output "`n=== PHASE 7: PLATFORM ADMIN ROUTES ==="
$admin = $roles["admin"].token

Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/dashboard" -Token $admin -ExpectedCodes @(200) -Description "Admin: Dashboard"
Test-Route -Method "GET" -Url "$localUrl/$tenantSlug/admin" -Token $admin -ExpectedCodes @(200) -Description "Admin: Admin panel"

# ── Phase 8: Cross-tenant Access Tests ────────────────────────────────────────

Write-Output "`n=== PHASE 8: CROSS-TENANT ISOLATION ==="

# Try to access a non-existent tenant
Test-Route -Method "GET" -Url "$localUrl/nonexistent/dashboard" -Token $resident -ExpectedCodes @(302, 404) -Description "Cross-tenant: non-existent slug"
Test-Route -Method "GET" -Url "$localUrl/other-tenant/dashboard" -Token $resident -ExpectedCodes @(302, 404) -Description "Cross-tenant: other slug"

# ── Phase 9: MFA Required Routes ──────────────────────────────────────────────

Write-Output "`n=== PHASE 9: MFA ENROLLMENT ==="
Test-Route -Method "GET" -Url "$localUrl/mfa/enroll" -Token $resident -ExpectedCodes @(200) -Description "MFA: Enroll page accessible"
Test-Route -Method "GET" -Url "$localUrl/mfa/verify" -Token $resident -ExpectedCodes @(200) -Description "MFA: Verify page accessible"

Write-Output "`n=== ALL TESTS COMPLETE ==="
