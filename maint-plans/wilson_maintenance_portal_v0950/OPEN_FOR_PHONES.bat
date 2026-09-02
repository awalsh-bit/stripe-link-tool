@echo off
setlocal
cd /d "%~dp0"
title Wilson Maintenance Portal - phones on this network

rem Serves the tool to phones on the same Wi-Fi, behind the shop passcode.
rem If no passcode is set this refuses to start and tells you what to run.
rem Keep this window open while technicians are using it.

where py >nul 2>&1
if not errorlevel 1 (
  py -3 serve_portal.py --lan
  goto :done
)
where python >nul 2>&1
if not errorlevel 1 (
  python serve_portal.py --lan
  goto :done
)
where python3 >nul 2>&1
if not errorlevel 1 (
  python3 serve_portal.py --lan
  goto :done
)
echo Python was not found on this computer.
:done
echo.
pause
