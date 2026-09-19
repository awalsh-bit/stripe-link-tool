@echo off
rem Wilson service journey - Phase 0 watcher. Schedule this every 5 minutes (copy the "Wilson Routing EPASS Import" task).
rem Adjust the connection string once the WilsonService database exists on localhost\SQLEXPRESS.
set WILSON_SERVICE_DB=mssql:DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost\SQLEXPRESS;DATABASE=WilsonService;Trusted_Connection=yes
cd /d C:\Dev\service_call_journey\phase0
python -m wilson_service watch >> C:\Dev\service_call_journey\phase0\watch.log 2>&1
