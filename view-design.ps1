$ErrorActionPreference = "Continue"

Write-Host "=== E-Logbook Design Viewer ===" -ForegroundColor Cyan
Write-Host ""

$contentDir = "G:\elogbook\.superpowers\brainstorm\sess-1490875994\content"

if (-not (Test-Path $contentDir)) {
    Write-Host "ERROR: Content directory not found: $contentDir" -ForegroundColor Red
    Read-Host "Press Enter"
    exit
}

Write-Host "Content directory: OK" -ForegroundColor Green
Write-Host "Files:"
Get-ChildItem $contentDir | ForEach-Object { Write-Host "  $($_.Name)" }
Write-Host ""

try {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:3000/")
    $listener.Start()
    Write-Host "Server running at http://localhost:3000" -ForegroundColor Green
    Write-Host "Open your browser now. Press Ctrl+C to stop." -ForegroundColor Yellow
    
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        $filePath = $request.Url.LocalPath.TrimStart('/')
        if ($filePath -eq '') { $filePath = 'index.html' }
        $fullPath = Join-Path $contentDir $filePath
        
        if (Test-Path $fullPath) {
            $content = Get-Content $fullPath -Raw -Encoding UTF8
            $buf = [System.Text.Encoding]::UTF8.GetBytes($content)
            $response.ContentType = "text/html; charset=utf-8"
            $response.ContentLength64 = $buf.Length
            $response.OutputStream.Write($buf, 0, $buf.Length)
        } else {
            $response.StatusCode = 404
        }
        $response.Close()
    }
} catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
    Read-Host "Press Enter"
}
