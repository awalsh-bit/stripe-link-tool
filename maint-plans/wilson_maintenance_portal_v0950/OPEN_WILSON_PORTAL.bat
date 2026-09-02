@echo off
setlocal
cd /d "%~dp0"
title Wilson Maintenance Portal

where py >nul 2>&1
if not errorlevel 1 (
  py -3 serve_portal.py
  goto :done
)

where python >nul 2>&1
if not errorlevel 1 (
  python serve_portal.py
  goto :done
)

where python3 >nul 2>&1
if not errorlevel 1 (
  python3 serve_portal.py
  goto :done
)

echo.
echo ERROR: Python was not found on this computer.
echo Install Python or run the prototype on a computer with Python available.
echo.
pause

:done
endlocal
