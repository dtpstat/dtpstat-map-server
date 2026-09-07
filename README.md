# dtpstat-map-server

Node.js/Express + PostgreSQL/PostGIS сервер интерактивной карты линейных объектов. Репозиторий не привязан к одному транспортному проекту: один и тот же код можно разворачивать несколькими независимыми экземплярами с разными БД, SQL-схемами, портами, данными, расчётами, оформлением и публичным названием.

Требуются Node.js `20.19+` и PostgreSQL с PostGIS.

## Основные возможности

- публичная Mapbox-карта с viewport-загрузкой линейных геометрий;
- загрузка и обновление городов/границ из OSM Overpass;
- импорт внешнего KML / Google My Maps с сохранением `<Placemark><name>` как `placemarkName`;
- hover-popup и опциональные постоянные подписи имён линий;
- настраиваемый справочник бизнес-типов линий: `CODE`, `NAME`, `TITLE`, цвет, стиль и толщина;
- декларативные метрики городов без произвольного SQL, ссылки между метриками, агрегаты, приоритеты и ОПЗ;
- материализованный `CITY_REPORT_VALUES` для быстрого публичного рейтинга;
- независимая настройка публичной HTML-таблицы, CSV и ranking;
- условное форматирование числовых значений;
- три встроенных публичных theme preset: `retro`, `classic`, `modern`;
- настраиваемый PNG-маркер городов;
- DB-backed Mapbox public access token с одноразовым bootstrap из `.env`;
- перенос городов, линий, типов и населения между экземплярами;
- переносимый GeoJSON/KML с полным словарём бизнес-типов;
- отдельный versioned пакет переноса настроек проекта;
- DB-backed admin users, web sessions, роли, profile/avatar, anti-bruteforce по учётке и IP, manual IP blocks и audit;
- session-cookie для web-admin и HTTP Basic для скриптов/compatibility clients;
- single-task guard, dry-run и WebSocket-журнал для длительных операций управления данными;
- статические публичные GeoJSON/CSV snapshots;
- HTTP и/или HTTPS, reverse-proxy-aware deployment;
- структурированные service logs и graceful shutdown.

## Быстрый запуск

```bash
npm install
cp .env.example .env
```

Заполните параметры PostgreSQL, первоначальные admin credentials и Mapbox token, затем:

```bash
npm run db:init
npm run db:migrate
npm start
```

`db:init` создаёт/настраивает прикладную роль и database и включает PostGIS. `db:migrate` применяет последовательность миграций `V001…V021`.

На первом старте, если `ADMIN_USERS` пуст, сервер создаёт bootstrap-superuser из:

```dotenv
IMPORT_API_USERNAME=admin
IMPORT_API_PASSWORD=replace-with-a-long-random-password
```

После создания хотя бы одного DB-пользователя эти ENV credentials больше не используются для online login. Их можно удалить из `.env`, если они не нужны для аварийного `admin:set-superuser`.

`MAPBOX_ACCESS_TOKEN` начиная с `V019` также является bootstrap-параметром: он копируется в `PROJECT_SETTINGS` только пока `MAPBOX_ACCESS_TOKEN_INITIALIZED=false`. После этого DB-значение является authoritative и меняется через админку.

На пустой БД приложение запускается нормально; данные затем загружаются через `/admin/`.

Для локальной PostgreSQL:

```bash
docker compose up -d database
npm run db:init
npm run db:migrate
npm start
```

## Независимые экземпляры

Рекомендуемая модель: **один экземпляр приложения — одна PostgreSQL database**.

`DATABASE_SCHEMA` является SQL schema и техническим namespace экземпляра. По умолчанию для старых установок используется `buslanes`.

Значение участвует в:

- `search_path`;
- PostgreSQL `application_name`;
- advisory locks;
- `<DATABASE_SCHEMA>.schema_versions`;
- service namespace;
- default OSM User-Agent.

Пример отдельного экземпляра:

```dotenv
DATABASE_NAME=tramlanes
DATABASE_ROLE=tramlanes
DATABASE_SCHEMA=tramlanes
HTTP_ENABLED=true
HTTP_PORT=3001
```

Runtime SQL должен работать через настроенный `search_path` и не должен жёстко ссылаться на `buslanes.<table>`. Исторические migration-файлы могут содержать source token `BUSLANES`: migration runner подставляет фактический `DATABASE_SCHEMA` перед исполнением.

Подробнее: [docs/deployment.md](docs/deployment.md).

## Миграции

Текущая последовательность заканчивается `V021`:

- `V014` — configurable report;
- `V015` — аудит индексов;
- `V016` — DB-backed admin security и line labels;
- `V017` — DB-level защита bootstrap-admin;
- `V018` — web sessions, расширенные роли, profile/avatar, IP security и дополнительные audit indexes;
- `V019` — DB-backed Mapbox access token;
- `V020` — custom city marker PNG;
- `V021` — public theme preset `retro/classic/modern`.

Следующее изменение DB schema должно добавляться новой миграцией **V022+**. Уже опубликованные migration-файлы задним числом не изменяются.

История миграций:

```text
<DATABASE_SCHEMA>.schema_versions
```

Legacy `public.buslanes_schema_versions` автоматически переносится migration runner в schema-specific историю.

Подробнее: [docs/database-indexes.md](docs/database-indexes.md).

## Основные таблицы

В `<DATABASE_SCHEMA>` используются, в частности:

- `cities`;
- `city_populations`;
- `city_boundaries`;
- `city_geometries`;
- `line_types`;
- `project_settings`;
- `report_config`;
- `city_report_values`;
- `admin_users`;
- `admin_sessions`;
- `admin_security_settings`;
- `admin_login_ip_state`;
- `admin_blocked_ips`;
- `admin_audit_log`;
- `admin_task_successes`;
- журналы OSM/KML update runs.

## Админка и роли

Web-admin находится в `/admin/`. Интерактивный вход выполняется через `/admin/login.html`; успешный login создаёт HttpOnly session cookie `dtpstat_admin_session`. HTTP Basic остаётся доступен для API-скриптов и compatibility clients.

Обычной административной учётке могут независимо выдаваться права:

```text
CAN_MANAGE_DATA
CAN_MANAGE_INTERFACE
CAN_MANAGE_USERS
CAN_VIEW_AUDIT
CAN_MANAGE_SECURITY
```

`IS_SUPERUSER` даёт все разрешения. `IS_BOOTSTRAP` отмечает первоначальную защищённую учётку.

Разделы админки:

- **Управление данными** — импорт/экспорт, OSM/KML, фоновые data tasks и live-журнал;
- **Настройка интерфейса** — проект, тема, Mapbox, marker icon, расчёты и типы линий;
- **Пользователи и аудит** — пользователи, security policy, sessions/IP blocks, audit и перенос настроек согласно выданным permissions.

`MUST_CHANGE_PASSWORD` ограничивает interactive session страницей профиля/смены пароля до установки нового пароля.

Подробнее: [docs/admin-security.md](docs/admin-security.md).

## Защита входа

Защита ведётся отдельно по учётке и IP. Основные ответы:

```text
401  credentials отсутствуют/неверны
403  manual block, IP block или недостаточно прав
423  временный account lockout
429  временный IP lockout
428  требуется смена пароля
```

Для временных блокировок возвращается `Retry-After`.

Session-auth mutating requests проходят same-origin/CSRF-проверку. При HTTPS termination на nginx Express должен видеть исходный protocol через trusted proxy, иначе корректный браузерный `Origin: https://...` может быть отклонён как cross-site.

## Reverse proxy / nginx

Для одного доверенного nginx перед Node:

```dotenv
HTTP_TRUST_PROXY_HOPS=1
```

Рекомендуемые proxy headers:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Если крупные GeoJSON imports проходят через nginx, proxy body limit должен быть не меньше Node limit. При стандартном:

```dotenv
IMPORT_API_MAX_BODY_BYTES=26214400
```

разумная настройка nginx:

```nginx
client_max_body_size 30m;
```

После изменения nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Не включайте `trust proxy` для произвольной цепочки, если Node доступен клиенту напрямую.

## Project settings

`PROJECT_SETTINGS` содержит публичную конфигурацию проекта, включая:

- название;
- keywords;
- безопасно валидируемый footer HTML;
- Yandex Metrica / Google Analytics IDs;
- `SHOW_LINE_LABELS`;
- `MAPBOX_ACCESS_TOKEN`;
- `THEME_PRESET`;
- custom city marker PNG и его метаданные.

Встроенные темы:

```text
retro   — строгая табличная подача в стиле 90-х
classic — базовый сдержанный стиль
modern  — скруглённые блоки и мягкие акценты
```

## Перенос настроек проекта

Superuser endpoints:

```text
GET  /api/admin/settings/export
POST /api/admin/settings/import
```

Актуальный формат — `project-settings` **schemaVersion 3**; импорт также принимает v1/v2.

Пакет переносит:

- основные `PROJECT_SETTINGS`, включая `themePreset`, `showLineLabels` и public Mapbox token;
- `LINE_TYPES`;
- `REPORT_CONFIG`;
- полный набор `ADMIN_SECURITY_SETTINGS`.

Не переносятся:

- admin users, password hashes и sessions;
- audit log и текущие lockout states;
- города, линии и население;
- deployment `.env`, DB/TLS secrets;
- custom city marker binary.

Типы линий сопоставляются по normalized `NAME`; target-only типы не удаляются. `CITY_REPORT_VALUES` после импорта пересчитывается заново на данных целевой БД.

Подробнее: [docs/project-settings-transfer.md](docs/project-settings-transfer.md).

## Перенос данных

Admin API разделяет три набора:

1. города/OSM boundaries — GeoJSON;
2. линии + dictionary business types — GeoJSON/KML;
3. население — JSON.

Рекомендуемый порядок на новом экземпляре:

```text
города → линии → население
```

Импорт населения обновляет только города, которые существуют в target `cities`. Строки для отсутствующих городов пропускаются без падения всей операции; результат содержит `requestedCities`, `cities`, `skippedCount` и `skippedCities`.

Подробнее: [docs/data-transfer.md](docs/data-transfer.md) и [docs/kml-transfer.md](docs/kml-transfer.md).

## Конструктор расчётов

В **Настройка интерфейса → Расчёты** настраиваются:

- scalar metrics;
- публичная таблица;
- CSV;
- ranking.

Backend не принимает произвольный SQL. Выражения строятся из server-owned fields/aggregates/metric references/constants. Поддерживаются dependency graph, циклическая валидация, `SUM/AVG/MEDIAN/MIN/MAX/COUNT`, арифметика, priorities `1…12`, ОПЗ и conditional formatting.

Подробнее: [docs/report-config.md](docs/report-config.md).

## Public snapshots

Runtime directory:

```text
var/public-downloads/
```

После старта и успешных real-update операций пересобираются:

```text
bus-lanes.geojson
bus-lanes.csv
```

`var/` является runtime state и не должен использоваться как source bundle/backup. Для round-trip применяйте admin export endpoints.

## Maintenance npm tasks

### Разблокировать учётку/IP

```bash
npm run admin:unblock -- --user admin1
npm run admin:unblock -- --ip 203.0.113.10
npm run admin:unblock -- --user admin1 --ip 203.0.113.10
```

Команда использует тот же `.env`, application DB role и `DATABASE_SCHEMA`. Для user очищаются manual/automatic account blocks; для IP — automatic throttle state и активные manual blocks.

### Восстановить credentials единственного superuser

По умолчанию используются `IMPORT_API_USERNAME` и `IMPORT_API_PASSWORD` из `.env`:

```bash
npm run admin:set-superuser
```

Или явно:

```bash
npm run admin:set-superuser -- --username admin1 --password 'new-password'
```

Явный пароль попадает в shell history, поэтому production предпочтительно использовать `.env`.

Задача требует **ровно одну** строку `IS_SUPERUSER=TRUE`; при 0 или >1 superusers она прекращает работу без изменений. При успехе она:

- меняет login/password hash;
- восстанавливает все admin permissions;
- сбрасывает manual/account lockout state;
- снимает `MUST_CHANGE_PASSWORD`;
- отзывает существующие sessions superuser.

Подробнее: [docs/admin-security.md](docs/admin-security.md).

## NPM команды

```text
npm start                 запуск сервера
npm run dev               запуск с node --watch
npm run db:init           bootstrap database/application role/PostGIS
npm run db:migrate        применить migrations
npm run db:import         CLI import исходных данных
npm run admin:unblock     аварийно снять account/IP blocks
npm run admin:set-superuser восстановить login/password единственного superuser
npm run lint              ESLint
npm test                  node --test
npm run check             lint + tests
```

## Документация

- [Развёртывание нескольких экземпляров](docs/deployment.md)
- [Администраторы, роли, sessions, IP security и recovery](docs/admin-security.md)
- [Перенос и синхронизация данных](docs/data-transfer.md)
- [Переносимый KML](docs/kml-transfer.md)
- [Экспорт/импорт настроек проекта](docs/project-settings-transfer.md)
- [Конструктор расчётов и публичного отчёта](docs/report-config.md)
- [Аудит индексов PostgreSQL/PostGIS](docs/database-indexes.md)

## Проверка перед deployment

```bash
npm run check
npm run db:migrate
```

После обновления server code перезапустите process manager. Для PM2, если менялся `.env`:

```bash
pm2 restart <instance-name> --update-env
```

Изменение только DB-данных через maintenance task перезапуска Node обычно не требует.
