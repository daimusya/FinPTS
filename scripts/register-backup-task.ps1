# Регистрирует ежедневное резервное копирование в Планировщике заданий Windows.
#
#   powershell -ExecutionPolicy Bypass -File scripts\register-backup-task.ps1            # каждый день в 03:00
#   powershell -ExecutionPolicy Bypass -File scripts\register-backup-task.ps1 -Time 23:30
#   powershell -ExecutionPolicy Bypass -File scripts\register-backup-task.ps1 -Remove    # удалить задачу
#
# Задача запускается от имени текущего пользователя, когда он вошёл в систему. Если компьютер был
# выключен в назначенное время, копия делается при следующей возможности (StartWhenAvailable).
# Для запуска без входа пользователя зарегистрируйте задачу от имени службы вручную (нужны права администратора).

param(
    [string]$Time = "03:00",
    [string]$TaskName = "PROMTEHNOSFERA backup",
    [switch]$Remove
)

$ErrorActionPreference = "Stop"

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "Задача «$TaskName» удалена."
    exit 0
}

$runner = Join-Path $PSScriptRoot "run-backup.cmd"
if (-not (Test-Path $runner)) { throw "Не найден $runner" }

$action = New-ScheduledTaskAction -Execute $runner -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Резервное копирование базы ПРОМТЕХНОСФЕРА (npm run db:backup:verify). Журнал: backups\scheduler.log" `
    -Force | Out-Null

Write-Output "Задача «$TaskName» зарегистрирована: ежедневно в $Time. Результаты — на странице «Администрирование → Резервные копии»."
