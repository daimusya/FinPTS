#!/usr/bin/env bash
# Установка ПРОМТЕХНОСФЕРА на сервер. Запуск из папки с программой:
#
#   bash deploy/install.sh                          # новая установка (пустая база)
#   bash deploy/install.sh --restore копия.dump     # с переносом данных с прежнего компьютера
#
# Повторный запуск безопасен: уже созданные пароли и данные не меняются.
set -euo pipefail
cd "$(dirname "$0")/.."
. deploy/common.sh

RESTORE=""
if [ "${1:-}" = "--restore" ]; then
  RESTORE="${2:-}"
  [ -n "$RESTORE" ] || die "Укажите файл копии: bash deploy/install.sh --restore путь/к/копии.dump"
  [ -f "$RESTORE" ] || die "Файл копии не найден: $RESTORE"
fi

require_docker

# 1. Настройки: адрес, почты, новые случайные пароли — в .env (только для владельца файла).
if [ ! -f .env ]; then
  say "Настройка"
  read -rp "Адрес, по которому будут входить (домен), например fin.promtehnosfera.ru: " DOMAIN
  [ -n "$DOMAIN" ] || die "Без адреса сертификат https не выдать."
  read -rp "Почта первого администратора (при переносе данных — ваша почта для входа): " SEED_ADMIN_EMAIL
  [ -n "$SEED_ADMIN_EMAIL" ] || die "Нужна почта администратора."
  read -rp "Почта для писем о сертификате https (Enter — та же): " ACME_EMAIL
  ACME_EMAIL="${ACME_EMAIL:-$SEED_ADMIN_EMAIL}"
  rand() { openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
  umask 077
  cat > .env <<EOF
# Создано deploy/install.sh $(date '+%Y-%m-%d %H:%M'). Храните в тайне: здесь пароли базы и ключ подписи входов.
# Без этого файла не прочитать зашифрованные ключи интеграций — сохраните его копию в надёжном месте.
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
SEED_ADMIN_EMAIL=$SEED_ADMIN_EMAIL
POSTGRES_SUPERUSER_PASSWORD=$(rand 24)
APP_DB_PASSWORD=$(rand 24)
AUTH_SECRET=$(rand 32)
EOF
  chmod 600 .env
  echo "Настройки записаны в .env (пароли созданы случайно)."
else
  say "Найден .env — использую сохранённые настройки"
fi
load_env

# Адрес должен указывать на этот сервер, иначе сертификат не выдадут.
resolved="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)"
mine="$(hostname -I 2>/dev/null || true)"
if [ -z "$resolved" ]; then
  warn "Адрес $DOMAIN пока никуда не указывает. Добавьте у регистратора домена запись A на IP этого сервера ($mine) — без неё https не заработает."
else
  echo "Адрес $DOMAIN указывает на $resolved (адреса этого сервера: $mine)."
fi

# 2. Сборка программы (первый раз — несколько минут).
say "Собираю программу (первый раз — 5–10 минут)…"
docker compose build

# 3. База данных.
say "Запускаю базу данных…"
docker compose up -d postgres
wait_for_db

tables="$(table_count)"
if [ -n "$RESTORE" ]; then
  [ "$tables" = "0" ] || die "В базе уже есть данные ($tables таблиц) — копию загружают только в новую установку. Для замены данных: bash deploy/restore.sh файл.dump"
  restore_dump "$RESTORE"
  echo
  echo "Ключи интеграций (DaData, банки, почта, Telegram) и вход с кодом зашифрованы ключом AUTH_SECRET прежнего компьютера."
  echo "Чтобы перенести их, вставьте значение AUTH_SECRET из файла .env прежнего компьютера (на экране не отображается)."
  read -rsp "AUTH_SECRET прежнего компьютера (Enter — пропустить, ключи введёте заново): " OLD_AUTH_SECRET
  echo
  if [ -n "$OLD_AUTH_SECRET" ]; then
    OLD_AUTH_SECRET="$OLD_AUTH_SECRET" docker compose run --rm -T -e OLD_AUTH_SECRET tools npm run --silent rekey-secrets \
      || warn "Ключи не перешифрованы — их нужно будет ввести заново в разделах интеграций, а вход с кодом сбросить: docker compose run --rm tools npm run reset-2fa -- почта"
  else
    warn "Пропущено: введите ключи интеграций заново; вход с кодом у пользователей сбросьте (docker compose run --rm tools npm run reset-2fa -- почта)."
  fi
  unset OLD_AUTH_SECRET
fi

migrate

say "Заполняю справочники по умолчанию…"
docker compose run --rm -T tools npx tsx prisma/seed.ts

# 4. Всё остальное: приложение, https, выписки и мониторинг, резервные копии.
say "Запускаю платформу…"
docker compose up -d

say "Проверяю https://$DOMAIN …"
ok=""
for i in $(seq 1 40); do
  if curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 3
done
if [ -n "$ok" ]; then
  say "Готово: https://$DOMAIN"
else
  warn "Платформа запущена, но https://$DOMAIN пока не отвечает. Частые причины: запись A домена ещё не обновилась (до нескольких часов) или закрыты порты 80/443. Журнал: docker compose logs caddy app"
fi

cat <<EOF

Дальше:
  1. Войдите на https://$DOMAIN ${SEED_ADMIN_EMAIL:+под $SEED_ADMIN_EMAIL}. Если выше напечатан временный пароль — система попросит сменить его.
  2. Подключите себе вход с кодом (ссылка «вход с кодом» вверху), затем в «Пользователи» сделайте его обязательным.
  3. Заведите учётные записи тестировщикам с нужными ролями.

Полезные команды (из этой папки):
  bash deploy/update.sh                                   — обновить программу до новой версии
  docker compose ps                                       — что запущено
  docker compose logs -f app                              — журнал приложения
  docker compose run --rm tools npm run reset-password -- почта   — аварийный сброс пароля
  docker compose run --rm tools npm run reset-2fa -- почта        — снять вход с кодом (потерян телефон)
  Резервные копии: папка backups/ (копируйте её и файл .env в другое место).
EOF
