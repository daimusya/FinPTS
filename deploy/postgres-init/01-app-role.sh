#!/bin/sh
# Первый запуск базы: отдельный пользователь приложения pts_app без прав
# суперпользователя (не может читать файлы сервера и запускать программы)
# и база promtehnosfera, которой он владеет. CREATEDB — для пробного
# восстановления резервной копии в отдельную временную базу.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE pts_app LOGIN CREATEDB PASSWORD :'app_password';
CREATE DATABASE promtehnosfera OWNER pts_app;
SQL
