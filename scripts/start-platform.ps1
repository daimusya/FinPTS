# Запуск платформы ПРОМТЕХНОСФЕРА на этом компьютере (рабочий режим) — для ярлыка на рабочем столе.
# Если платформа уже запущена, просто открывает её в браузере.
# Платформа доступна только с этого компьютера (127.0.0.1): другим — через туннель, см. deploy/УСТАНОВКА.md.
param([switch]$NoBrowser)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$url = "http://localhost:3000"
$Host.UI.RawUI.WindowTitle = "ПРОМТЕХНОСФЕРА — платформа работает (не закрывайте это окно)"

function Test-Platform {
  try { (Invoke-WebRequest -Uri "$url/api/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
}

if (Test-Platform) {
  if (-not $NoBrowser) { Start-Process $url }
  exit 0
}

$server = Join-Path $root ".next\standalone\server.js"
if (-not (Test-Path $server)) {
  Write-Host "Нет рабочей сборки. Собираю (несколько минут)..."
  npm run build
  if ($LASTEXITCODE -ne 0) { Write-Host "Сборка не удалась."; Read-Host "Нажмите Enter, чтобы закрыть"; exit 1 }
}
node (Join-Path $root "scripts\prepare-standalone.mjs")
if ($LASTEXITCODE -ne 0) { Read-Host "Нажмите Enter, чтобы закрыть"; exit 1 }

# Открыть браузер, как только платформа ответит.
if (-not $NoBrowser) { Start-Job -ScriptBlock {
  param($u)
  for ($i = 0; $i -lt 60; $i++) {
    try { if ((Invoke-WebRequest -Uri "$u/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { Start-Process $u; break } } catch {}
    Start-Sleep -Seconds 1
  }
} -ArgumentList $url | Out-Null }

Write-Host ""
Write-Host "Платформа запускается: $url"
Write-Host "Пока это окно открыто, платформа работает. Закроете окно — платформа остановится."
Write-Host ""
$env:NODE_ENV = "production"
$env:PORT = "3000"
$env:HOSTNAME = "127.0.0.1"
node $server
