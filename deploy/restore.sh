#!/usr/bin/env bash
# Восстановление данных из резервной копии ВМЕСТО текущих (например, после сбоя):
#
#   bash deploy/restore.sh backups/имя-копии.dump
#
# Текущие данные сначала сохраняются отдельной копией, потом заменяются.
set -euo pipefail
cd "$(dirname "$0")/.."
. deploy/common.sh
require_docker
load_env

FILE="${1:-}"
[ -n "$FILE" ] || die "Укажите файл копии: bash deploy/restore.sh backups/имя.dump"
[ -f "$FILE" ] || die "Файл не найден: $FILE"

echo "Все текущие данные платформы будут заменены данными из $(basename "$FILE")."
read -rp "Продолжить? Введите ДА: " answer
[ "$answer" = "ДА" ] || die "Отменено."

docker compose up -d postgres
wait_for_db
say "Сохраняю текущие данные на всякий случай…"
docker compose run --rm -T backup node scripts/backup.mjs || die "Копия текущих данных не сделалась — восстановление остановлено."

say "Останавливаю платформу…"
docker compose stop app scheduler backup

say "Очищаю базу…"
docker compose exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE promtehnosfera WITH (FORCE)" -c "CREATE DATABASE promtehnosfera OWNER pts_app"

restore_dump "$FILE"
migrate

say "Запускаю платформу…"
docker compose up -d
say "Готово: данные восстановлены из $(basename "$FILE")."
