@echo off
echo Trying Python server on port 3000...
echo.
echo If Windows Firewall pops up, click "Allow access"
echo.
echo Open: http://localhost:3000
echo Press Ctrl+C to stop
echo.
python -c "from http.server import HTTPServer, SimpleHTTPRequestHandler; import os; os.chdir(r'G:\elogbook\.superpowers\brainstorm\sess-1490875994\content'); s = HTTPServer(('127.0.0.1', 3000), SimpleHTTPRequestHandler); print('Server running on http://localhost:3000'); s.serve_forever()"
pause
