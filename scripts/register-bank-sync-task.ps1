# Регистрирует автоматическую загрузку выписок по API банков в Планировщике заданий Windows.
#
#   powershell -ExecutionPolicy Bypass -File scripts\register-bank-sync-task.ps1              # каждые 30 минут
#   powershell -ExecutionPolicy Bypass -File scripts\register-bank-sync-task.ps1 -Minutes 60  # раз в час
#   powershell -ExecutionPolicy Bypass -File scripts\register-bank-sync-task.ps1 -Remove      # удалить задачу
#
# Задача запускается от имени текущего пользователя, когда он вошёл в систему; пропущенный запуск
# выполняется при первой возможности. Загружаются все включённые подключения со страницы
# «Интеграции → Банки: выписка по API». Журнал — backups\bank-sync.log.

param(
    [int]$Minutes = 30,
    [string]$TaskName = "PROMTEHNOSFERA bank statements",
    [switch]$Remove
)

$ErrorActionPreference = "Stop"

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "Задача «$TaskName» удалена."
    exit 0
}

if ($Minutes -lt 5) { throw "Интервал — не меньше 5 минут: банки ограничивают частоту запросов." }

$runner = Join-Path $PSScriptRoot "run-bank-sync.cmd"
if (-not (Test-Path $runner)) { throw "Не найден $runner" }

$action = New-ScheduledTaskAction -Execute $runner -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $Minutes)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Загрузка выписок по API банков (npm run bank:sync). Журнал: backups\bank-sync.log" `
    -Force | Out-Null

Write-Output "Задача «$TaskName» зарегистрирована: каждые $Minutes мин. Результаты — на странице «Интеграции → Банки: выписка по API»."
