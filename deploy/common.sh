#!/usr/bin/env bash
# Общие функции скриптов установки (install.sh, update.sh, restore.sh).

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# Docker и docker compose установлены?
require_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker не установлен. Установите его (см. deploy/УСТАНОВКА.md, шаг 2) и запустите скрипт снова."
  docker compose version >/dev/null 2>&1 || die "Нет команды «docker compose» (Docker Compose v2). Обновите Docker (см. deploy/УСТАНОВКА.md)."
  docker info >/dev/null 2>&1 || die "Docker не отвечает: запустите его или выполните скрипт через sudo."
}

# Ждать, пока база примет подключения.
wait_for_db() {
  local i
  for i in $(seq 1 60); do
    if docker compose exec -T postgres pg_isready -U postgres -d promtehnosfera >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  die "База данных не запустилась за 2 минуты. Посмотрите журнал: docker compose logs postgres"
}

# Сколько таблиц в базе приложения (0 — пустая, новая установка).
table_count() {
  docker compose exec -T postgres psql -U postgres -d promtehnosfera -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" | tr -d '[:space:]'
}

# Загрузить резервную копию (.dump, формат pg_dump custom) в пустую базу приложения.
# Восстанавливает пользователь приложения pts_app — он и станет владельцем таблиц.
restore_dump() {
  local file="$1"
  [ -f "$file" ] || die "Файл копии не найден: $file"
  local dir name
  dir="$(cd "$(dirname "$file")" && pwd)"
  name="$(basename "$file")"
  say "Загружаю данные из копии $name…"
  # shellcheck disable=SC2016
  docker compose run --rm -T --no-deps -v "$dir:/restore:ro" -e PGPASSWORD="$APP_DB_PASSWORD" --entrypoint sh backup -c \
    "pg_restore --no-owner --no-privileges --exit-on-error -h postgres -U pts_app -d promtehnosfera '/restore/$name'" \
    || die "Не удалось загрузить копию. База осталась пустой — исправьте причину и повторите."
}

# Миграции схемы базы (только новые; уже применённые пропускаются).
migrate() {
  say "Обновляю структуру базы…"
  docker compose run --rm -T tools npx prisma migrate deploy || die "Миграции не применились — см. сообщение выше."
}

# Загрузить переменные из .env этой установки.
load_env() {
  [ -f .env ] || die "Нет файла .env — сначала запустите deploy/install.sh"
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
}
