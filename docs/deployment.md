# Развёртывание нескольких экземпляров

Один и тот же `dtpstat-map-server` можно запускать несколько раз на одном сервере. Рекомендуемая изоляция — отдельная PostgreSQL database для каждого экземпляра и отдельный Node HTTP/HTTPS port.

## Модель экземпляра

Рекомендуется:

```text
1 deployment приложения
= 1 PostgreSQL database
= 1 DATABASE_SCHEMA
= 1 набор runtime ports/directories
```

Разные экземпляры могут использовать один PostgreSQL server и один `DATABASE_PORT`, но не одну и ту же database/schema как основной security boundary.

## DATABASE_SCHEMA

```dotenv
DATABASE_SCHEMA=buslanes
```

Переменная одновременно является SQL schema и техническим namespace. Для legacy installs default — `buslanes`.

Она определяет:

- `search_path=<schema>,public`;
- PostgreSQL `application_name`;
- advisory locks;
- `<schema>.schema_versions`;
- service namespace;
- default OSM User-Agent.

Публичное имя проекта хранится отдельно в `PROJECT_SETTINGS.PROJECT_NAME` и не должно совпадать с `DATABASE_SCHEMA`.

### Runtime SQL

Application queries должны использовать `search_path`, а не жёсткие ссылки вида:

```sql
buslanes.some_table
```

Именно это позволяет одному и тому же runtime коду работать с `buslanes`, `tramlanes` и другими экземплярами.

Исторические migrations — исключение: литерал `BUSLANES` в migration source является token, который migration runner заменяет на фактический `DATABASE_SCHEMA` перед исполнением.

## Пример двух экземпляров

Первый:

```dotenv
DATABASE_NAME=buslanes
DATABASE_ROLE=buslanes
DATABASE_SCHEMA=buslanes
HOST=127.0.0.1
HTTP_ENABLED=true
HTTP_PORT=3000
```

Второй:

```dotenv
DATABASE_NAME=tramlanes
DATABASE_ROLE=tramlanes
DATABASE_SCHEMA=tramlanes
HOST=127.0.0.1
HTTP_ENABLED=true
HTTP_PORT=3001
```

Если Node публикуется только через nginx, `HOST=127.0.0.1` предпочтительнее `0.0.0.0`.

## Новый экземпляр

Минимальная последовательность:

```bash
npm install
cp .env.example .env
# заполнить .env
npm run db:init
npm run db:migrate
npm start
```

На первом старте при пустой `ADMIN_USERS` задайте:

```dotenv
IMPORT_API_USERNAME=admin
IMPORT_API_PASSWORD=replace-with-a-long-random-password
```

Сервер создаст bootstrap-superuser.

После bootstrap эти ENV credentials больше не участвуют в online login. Их можно удалить либо оставить только как recovery source для:

```bash
npm run admin:set-superuser
```

## Mapbox bootstrap

Начиная с `V019`, Mapbox public access token хранится в `PROJECT_SETTINGS`.

Первичная конфигурация:

```dotenv
MAPBOX_ACCESS_TOKEN=pk....
```

Пока `PROJECT_SETTINGS.MAPBOX_ACCESS_TOKEN_INITIALIZED=false`, startup один раз копирует ENV token в БД и выставляет initialized marker. После этого ENV token игнорируется, а изменения выполняются в админке.

`MAPBOX_STYLE_URL` остаётся runtime/deployment setting.

## Миграции

Текущий набор: `V001…V021`.

Последние migrations:

```text
V016__admin_security_and_line_labels.sql
V017__protect_bootstrap_admin.sql
V018__admin_sessions_roles_profile_and_ip_security.sql
V019__mapbox_project_setting.sql
V020__city_marker_icon.sql
V021__public_theme_preset.sql
```

Назначение:

- `V016` — DB users/security/audit и line labels;
- `V017` — bootstrap DB invariant;
- `V018` — sessions, дополнительные roles, profile/avatar, IP security и audit indexes;
- `V019` — DB-backed Mapbox token;
- `V020` — custom city marker PNG;
- `V021` — `retro/classic/modern` public theme.

Следующая migration должна быть **V022+**. Уже опубликованные migration-файлы не меняются задним числом.

История хранится в:

```text
<DATABASE_SCHEMA>.schema_versions
```

Legacy history `public.buslanes_schema_versions` автоматически переносится migration runner.

## Production за nginx

Типичная схема:

```text
browser
  ↓ HTTPS
nginx
  ↓ HTTP 127.0.0.1:3001
Node/Express
```

Для одного доверенного nginx:

```dotenv
HOST=127.0.0.1
HTTP_ENABLED=true
HTTP_PORT=3001
HTTP_TRUST_PROXY_HOPS=1
```

Рекомендуемый location:

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

WebSocket headers нужны для `/api/admin/ws`.

## Почему нужен X-Forwarded-Proto

Session-auth mutating admin requests проверяют same-origin. Browser при HTTPS отправляет:

```text
Origin: https://example.org
```

Если nginx терминирует TLS, а Express без trusted proxy видит `request.protocol=http`, expected origin становится `http://example.org`, и запрос отклоняется:

```text
Cross-site administrative request rejected
```

Правильная конфигурация — не ослаблять CSRF check, а настроить:

```dotenv
HTTP_TRUST_PROXY_HOPS=1
```

и:

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
```

## Trust proxy и IP

Default:

```dotenv
HTTP_TRUST_PROXY_HOPS=0
```

Используйте `1` только если перед Node действительно ровно один доверенный proxy. Более длинная доверенная цепочка требует соответствующего числа hops.

Нельзя бездумно доверять forwarded headers, если тот же Node port доступен клиентам напрямую: тогда можно подделать IP, используемый audit/IP security.

## Размер upload через nginx

Node ограничивает крупные protected imports переменной:

```dotenv
IMPORT_API_MAX_BODY_BYTES=26214400
```

Это 25 MiB.

nginx по умолчанию может остановить upload раньше Node и вернуть:

```text
413 Request Entity Too Large
```

Для стандартного 25 MiB application limit удобно дать небольшой запас:

```nginx
client_max_body_size 30m;
```

Если `IMPORT_API_MAX_BODY_BYTES` меняется, nginx limit должен быть согласован с ним.

Проверка/reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## PM2

Запуск непосредственно Node entry point:

```bash
cd /var/www/tramlanes.ru
pm2 start src/server.js --name tramlanes
pm2 save
```

После изменения server code:

```bash
git pull
pm2 restart tramlanes
```

После изменения `.env`:

```bash
pm2 restart tramlanes --update-env
```

Логи:

```bash
pm2 logs tramlanes
```

Успешный startup заканчивается примерно так:

```text
[service] database.health:ok
[service] admin-security.bootstrap:ok
[service] project-settings.load:ok
[service] city-report.refresh:ok
[service] public-downloads.refresh:ok
[service] admin-success-state.load:ok
[service] http-servers.start:ok
[service] startup:ready
```

На уже инициализированной БД `admin-security.bootstrap:ok` обычно содержит `created: false`.

## Empty deployment

Чистый экземпляр после migrations содержит schema/settings/security infrastructure, но может не иметь городов и линий. Это допустимо.

После запуска данные импортируются через admin UI/API. Рекомендуемый перенос:

```text
cities → lines → populations
```

Population import допускает записи для городов, которых нет в target DB: они пропускаются, а существующие города обновляются.

## Public generated files

Процесс должен иметь право записи в:

```text
var/public-downloads/
```

После startup и успешных real-update операций пересобираются:

```text
bus-lanes.geojson
bus-lanes.csv
```

`var/` — runtime state, не source data и не backup format.

## Project settings и theme

DB-backed `PROJECT_SETTINGS` включает:

- project name/keywords/footer;
- analytics IDs;
- line labels;
- Mapbox public token;
- theme preset;
- custom city marker icon.

Встроенные theme values:

```text
retro
classic
modern
```

Настройки конфигурируются в **Настройка интерфейса → Проект**.

## Settings transfer

Superuser может переносить конфигурацию через:

```text
GET  /api/admin/settings/export
POST /api/admin/settings/import
```

Текущий формат — schemaVersion 3, импорт совместим с v1/v2.

Пакет переносит project settings, line types, report config, security settings и public Mapbox token. Custom city marker binary сейчас в пакет не входит.

Подробнее: [project-settings-transfer.md](project-settings-transfer.md).

## Recovery после неудачного deployment

### Снять lockout account/IP

```bash
npm run admin:unblock -- --user admin1 --ip 203.0.113.10
```

### Восстановить login/password единственного superuser

Если `.env` содержит нужные значения:

```bash
npm run admin:set-superuser
```

Или явно:

```bash
npm run admin:set-superuser -- --username admin1 --password 'new-password'
```

Команда требует ровно одного `IS_SUPERUSER=TRUE`, сбрасывает его account blocks/counters, восстанавливает permissions и отзывает sessions. IP lockout очищается отдельно через `admin:unblock`.

Эти команды используют `DATABASE_SCHEMA` и application DB role из текущего `.env`.

## Firewall

Если Node стоит за nginx, внешний доступ к Node port обычно не нужен. Разрешайте извне только `80/443`, а Node bind оставляйте на loopback.

Если Node публикуется напрямую, откройте только конкретный необходимый port.

## Секреты

Не храните в git:

- `.env`;
- PostgreSQL passwords;
- admin passwords;
- TLS private keys;
- private provider credentials.

Mapbox `pk.*` является public browser token, но всё равно должен управляться как project configuration и иметь минимально необходимые ограничения на стороне Mapbox.

`POSTGRES_ADMIN_*` нужны только `npm run db:init`; runtime использует `DATABASE_ROLE`.

## Связанные документы

- [Администраторы и безопасность](admin-security.md)
- [Перенос данных](data-transfer.md)
- [Перенос настроек](project-settings-transfer.md)
- [Аудит индексов](database-indexes.md)
