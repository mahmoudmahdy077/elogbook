@echo off
cd /d "G:\elogbook"
echo.
echo ==================================
echo   E-Logbook Design Viewer
echo ==================================
echo.
echo Starting server on http://localhost:3000
echo Keep this window open. Open your browser to the URL above.
echo.
python -c "import os; os.chdir(r'G:\elogbook\.superpowers\brainstorm\sess-1490875994\content'); from http.server import HTTPServer, SimpleHTTPRequestHandler; s=HTTPServer(('127.0.0.1',3000),SimpleHTTPRequestHandler); print('READY - open http://localhost:3000'); s.serve_forever()"
pause
