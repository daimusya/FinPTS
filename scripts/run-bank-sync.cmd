@echo off
rem Bank statement API runner for Windows Task Scheduler (see register-bank-sync-task.ps1).
rem ASCII only: cmd.exe reads batch files in the OEM code page, so Cyrillic text here breaks parsing.
rem Output is appended to backups\bank-sync.log (the backups folder is not in git).
cd /d "%~dp0.."
if not exist backups mkdir backups
call npm run bank:sync >> backups\bank-sync.log 2>&1
exit /b %ERRORLEVEL%
