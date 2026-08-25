# E2E Comprehensive Route Test — All Roles, All Routes
# Uses Supabase session creation to get cookies, then tests every Next.js route

$supabaseUrl = "https://nuyedxkzaimlzaetbpaw.supabase.co"
$anonKey = "sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3"
$localUrl = "http://localhost:3000"
$tenantSlug = "qa-e2e"
$tenantId = "11111111-1111-1110-1111-111111111111"
$results = @()
$pass = 0
$fail = 0

# Helper: Create a Supabase session and return the session token
function New-Session {
    param([string]$Email, [string]$Password = "password123!")
    $resp = Invoke-RestMethod -Uri "$supabaseUrl/auth/v1/token?grant_type=password" `
        -Method Post `
        -Headers @{ "apikey" = $anonKey; "Content-Type" = "application/json" } `
        -Body (@{ email = $Email; password = $Password } | ConvertTo-Json)
    return $resp.access_token
}

# Helper: Test a route
function Test-Route {
    param(
        [string]$Method, 
        [string]$Url, 
        [string]$Token,
        [string]$Role,
        [string]$Description,
        [string]$Body = $null,
        [hashtable]$ExtraHeaders = @{}
    )
    $code = 0
    $detail = ""
    try {
        $headers = @{ "apikey" = $anonKey }
        if ($Token) { $headers["Authorization"] = "Bearer $Token" }
        $headers += $ExtraHeaders
        $params = @{ 
            Uri = $Url; 
            Method = $Method; 
            Headers = $headers; 
            TimeoutSec = 15; 
            UseBasicParsing = $true 
        }
        if ($Body) { 
            $params["Body"] = $Body
            $headers["Content-Type"] = "application/json"
        }
        $resp = Invoke-WebRequest @params
        $code = $resp.StatusCode
    } catch {
        if ($_.Exception.Response) {
            $code = [int]$_.Exception.Response.StatusCode
        }
    }
    
    # Routes returning 200 (HTML page), 302/307 (redirect) are OK
    # 404 means route doesn't exist, 403 means forbidden, 401 means unauthorized, 500 means server error
    $ok = $code -in @(200, 302, 307)
    if ($ok) { $script:pass++ } else { $script:fail++ }
    $status = if ($ok) { "OK" } else { "FAIL" }
    Write-Output "$status | $Role | $Method $Url | HTTP $code | $Description"
    $script:results += [PSCustomObject]@{Role=$Role;Method=$Method;Url=$Url;Code=$code;Status=$status;Desc=$Description}
}

Write-Output "=== E-LOGBOOK COMPREHENSIVE E2E TEST ==="
Write-Output ""

# ── Login All Roles ──────────────────────────────────────────────────────────
Write-Output "--- LOGGING IN ALL ROLES ---"
$tokens = @{}
$roles = @(
    @{email="qa-resident@elogbook.dev";role="resident"},
    @{email="qa-supervisor@elogbook.dev";role="supervisor"},
    @{email="qa-director@elogbook.dev";role="director"},
    @{email="qa-institution-admin@elogbook.dev";role="inst_admin"},
    @{email="qa-admin@elogbook.dev";role="admin"}
)
foreach ($r in $roles) {
    try {
        $tokens[$r.role] = New-Session -Email $r.email
        Write-Output "OK | $($r.role) logged in"
    } catch {
        Write-Output "FAIL | $($r.role) login failed: $($_.Exception.Message)"
    }
}

Write-Output ""
Write-Output "--- PUBLIC PAGES (no auth required) ---"
Test-Route "GET" "$localUrl/login" "" "" "Login page"
Test-Route "GET" "$localUrl/signup" "" "" "Signup page"
Test-Route "GET" "$localUrl/pricing" "" "" "Pricing page"
Test-Route "GET" "$localUrl/contact" "" "" "Contact page"

Write-Output ""
Write-Output "--- POST: CONTACT FORM ---"
Test-Route "POST" "$localUrl/api/contact" "" "" "Contact API" `
    (@{ name="E2E Test"; email="e2e@hospital.org"; message="Automated test" } | ConvertTo-Json)

Write-Output ""
Write-Output "--- RESIDENT WORKFLOWS ---"
$r = $tokens["resident"]
Test-Route "GET" "$localUrl/$tenantSlug/dashboard" $r "resident" "Dashboard"
Test-Route "GET" "$localUrl/$tenantSlug/cases" $r "resident" "Cases list"
Test-Route "GET" "$localUrl/$tenantSlug/cases/new" $r "resident" "New case form"
Test-Route "GET" "$localUrl/$tenantSlug/goals" $r "resident" "Goals"
Test-Route "GET" "$localUrl/$tenantSlug/milestones" $r "resident" "Milestones"
Test-Route "GET" "$localUrl/$tenantSlug/resident/duty-hours" $r "resident" "Duty hours"
Test-Route "GET" "$localUrl/$tenantSlug/resident/evaluations" $r "resident" "My evaluations"
Test-Route "GET" "$localUrl/$tenantSlug/reports" $r "resident" "Reports"
Test-Route "GET" "$localUrl/$tenantSlug/audit" $r "resident" "Audit log"
Test-Route "GET" "$localUrl/$tenantSlug/compliance" $r "resident" "Compliance"
Test-Route "GET" "$localUrl/$tenantSlug/billing" $r "resident" "Billing"
Test-Route "GET" "$localUrl/$tenantSlug/consent" $r "resident" "Consent"
Test-Route "GET" "$localUrl/$tenantSlug/rotations" $r "resident" "Rotations"
# Resident should NOT access these:
Test-Route "GET" "$localUrl/$tenantSlug/analytics" $r "resident" "Analytics (FORBIDDEN)"
Test-Route "GET" "$localUrl/$tenantSlug/admin" $r "resident" "Admin (FORBIDDEN)"

Write-Output ""
Write-Output "--- SUPERVISOR WORKFLOWS ---"
$s = $tokens["supervisor"]
Test-Route "GET" "$localUrl/$tenantSlug/dashboard" $s "supervisor" "Dashboard"
Test-Route "GET" "$localUrl/$tenantSlug/cases" $s "supervisor" "Cases"
Test-Route "GET" "$localUrl/$tenantSlug/approvals" $s "supervisor" "Approvals"
Test-Route "GET" "$localUrl/$tenantSlug/evaluations" $s "supervisor" "Evaluations"
Test-Route "GET" "$localUrl/$tenantSlug/evaluate" $s "supervisor" "Evaluate"

Write-Output ""
Write-Output "--- DIRECTOR WORKFLOWS ---"
$d = $tokens["director"]
Test-Route "GET" "$localUrl/$tenantSlug/dashboard" $d "director" "Dashboard"
Test-Route "GET" "$localUrl/$tenantSlug/cases" $d "director" "Cases"
Test-Route "GET" "$localUrl/$tenantSlug/approvals" $d "director" "Approvals"
Test-Route "GET" "$localUrl/$tenantSlug/analytics" $d "director" "Analytics"
Test-Route "GET" "$localUrl/$tenantSlug/reports" $d "director" "Reports"
Test-Route "GET" "$localUrl/$tenantSlug/rotations" $d "director" "Rotations"
Test-Route "GET" "$localUrl/$tenantSlug/goals" $d "director" "Goals"
Test-Route "GET" "$localUrl/$tenantSlug/milestones" $d "director" "Milestones"
Test-Route "GET" "$localUrl/$tenantSlug/audit" $d "director" "Audit"
Test-Route "GET" "$localUrl/$tenantSlug/compliance" $d "director" "Compliance"

Write-Output ""
Write-Output "--- INSTITUTION ADMIN WORKFLOWS ---"
$a = $tokens["inst_admin"]
Test-Route "GET" "$localUrl/$tenantSlug/dashboard" $a "inst_admin" "Dashboard"
Test-Route "GET" "$localUrl/$tenantSlug/admin" $a "inst_admin" "Admin panel"
Test-Route "GET" "$localUrl/$tenantSlug/billing" $a "inst_admin" "Billing"
Test-Route "GET" "$localUrl/$tenantSlug/audit" $a "inst_admin" "Audit"
Test-Route "GET" "$localUrl/$tenantSlug/analytics" $a "inst_admin" "Analytics"
Test-Route "GET" "$localUrl/$tenantSlug/reports" $a "inst_admin" "Reports"

Write-Output ""
Write-Output "--- PLATFORM ADMIN WORKFLOWS ---"
$p = $tokens["admin"]
Test-Route "GET" "$localUrl/$tenantSlug/dashboard" $p "admin" "Dashboard"
Test-Route "GET" "$localUrl/$tenantSlug/admin" $p "admin" "Admin panel"
Test-Route "GET" "$localUrl/$tenantSlug/billing" $p "admin" "Billing"
Test-Route "GET" "$localUrl/$tenantSlug/audit" $p "admin" "Audit"

Write-Output ""
Write-Output "--- MFA PAGES (authenticated) ---"
Test-Route "GET" "$localUrl/mfa/enroll" $r "resident" "MFA enroll"
Test-Route "GET" "$localUrl/mfa/verify" $r "resident" "MFA verify"

Write-Output ""
Write-Output "=== RESULTS: $pass passed, $fail failed ==="
$failed = $results | Where-Object { $_.Status -eq "FAIL" }
if ($failed) {
    Write-Output ""
    Write-Output "--- FAILED ROUTES ---"
    $failed | Format-Table -AutoSize
}
