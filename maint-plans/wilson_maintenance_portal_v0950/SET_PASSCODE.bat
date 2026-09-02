@echo off
setlocal
cd /d "%~dp0"
title Wilson Maintenance Portal - set the shop passcode

rem Run this once, on the machine that will hold real customer stops. Until a
rem passcode is set, the tool will not serve anything to the network at all.

where py >nul 2>&1
if not errorlevel 1 (
  py -3 serve_portal.py --set-passcode
  goto :done
)
where python >nul 2>&1
if not errorlevel 1 (
  python serve_portal.py --set-passcode
  goto :done
)
where python3 >nul 2>&1
if not errorlevel 1 (
  python3 serve_portal.py --set-passcode
  goto :done
)
echo Python was not found on this computer.
:done
echo.
pause
