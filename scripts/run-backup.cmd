@echo off
rem Backup runner for Windows Task Scheduler (see register-backup-task.ps1).
rem ASCII only: cmd.exe reads batch files in the OEM code page, so Cyrillic text here breaks parsing.
rem Every run is a backup with a trial restore; output is appended to backups\scheduler.log.
cd /d "%~dp0.."
if not exist backups mkdir backups
call npm run db:backup:verify >> backups\scheduler.log 2>&1
exit /b %ERRORLEVEL%
