#!/usr/bin/env bash
# Обновление ПРОМТЕХНОСФЕРА до новой версии: свежий код, сборка, миграции базы, перезапуск.
# Данные и настройки сохраняются. Перед обновлением делается резервная копия.
set -euo pipefail
cd "$(dirname "$0")/.."
. deploy/common.sh
require_docker
load_env

say "Резервная копия перед обновлением…"
docker compose run --rm -T backup node scripts/backup.mjs || die "Копия не сделалась — обновление остановлено, данные не тронуты."

say "Получаю новую версию…"
git pull --ff-only || die "Не удалось обновить код (есть локальные правки?). Ничего не изменено."

say "Собираю…"
docker compose build

docker compose up -d postgres
wait_for_db
migrate

say "Перезапускаю…"
docker compose up -d
docker image prune -f >/dev/null 2>&1 || true
say "Обновление завершено: https://$DOMAIN"
