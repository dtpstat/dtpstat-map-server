# dtpstat-map-server

Node.js/Express + PostgreSQL/PostGIS сервер интерактивной карты линейных объектов. Код рассчитан на несколько независимых экземпляров: разные БД, схемы, порты, данные, расчёты и оформление используют один runtime.

Требования:

- Node.js `20.19+` (для production рекомендуется Node.js `24.x`);
- PostgreSQL;
- PostGIS.

## Возможности

- публичная Mapbox-карта с viewport-загрузкой линий;
- города и административные границы из OSM/Overpass;
- пакетная загрузка `place=city/town` и настраиваемого диапазона `boundary=administrative`;
- дерево вложенности OSM-полигонов, ручные active/displayName/displayType и Mapbox-preview;
- универсальный редактор геометрий с Point/LineString/MultiLineString/Polygon/MultiPolygon, edit leases, localStorage workspace и atomic bulk sync;
- импорт GeoJSON, KML и Google My Maps;
- переносимый GeoJSON/KML со словарём `LINE_TYPES`;
- сохранение `<Placemark><name>` как `properties.placemarkName`;
- независимые постоянные подписи линий и hover-popup;
- декларативные расчётные метрики без произвольного SQL;
- последовательный рейтинг по нескольким метрикам;
- настраиваемые публичная таблица и CSV;
- условное форматирование числовых колонок;
- темы `retro`, `classic`, `modern`;
- DB-backed Mapbox public token;
- настраиваемый PNG-маркер городов;
- настраиваемое базовое имя публичных GeoJSON/CSV;
- DB-backed Yandex Metrica и Google Analytics 4 с CSP-safe ранней загрузкой;
- DB-backed пользователи, роли, sessions, profile/avatar, IP/account lockout и audit с конкретным before/after change-set для несекретных admin-изменений;
- WebSocket-журнал и single-task guard для длительных операций управления данными;
- HTTP/HTTPS и deployment за reverse proxy.

## Быстрый запуск

```bash
npm ci
cp .env.example .env
# заполнить .env
npm run db:init
npm start
```

Для локальной PostgreSQL из `compose.yaml`:

```bash
docker compose up -d database
npm run db:init
npm start
```

При первом старте пустая `ADMIN_USERS` получает bootstrap-superuser из:

```dotenv
IMPORT_API_USERNAME=admin
IMPORT_API_PASSWORD=replace-with-a-long-random-password
```

После появления DB-пользователя эти ENV credentials не являются login fallback. Они могут оставаться только как recovery source для `npm run admin:set-superuser`.

`MAPBOX_ACCESS_TOKEN` начиная с `V019` используется только для одноразового bootstrap DB-настройки. После инициализации token меняется через админку/перенос настроек.

## Архитектура разработки

Архитектурные границы проекта являются частью контракта разработки, а не
рекомендацией. Каноническое описание слоёв, правил зависимостей и размещения
нового кода находится в [docs/architecture.md](docs/architecture.md).
Инструкции для coding agents находятся в корневом [AGENTS.md](AGENTS.md).

Перед отправкой изменений можно отдельно проверить архитектурные ограничения:

```bash
npm run test:architecture
```

Полная обязательная проверка остаётся:

```bash
npm run check
```

## Экземпляры

Рекомендуемая модель:

```text
1 экземпляр приложения
= 1 PostgreSQL database
= 1 DATABASE_SCHEMA
= 1 HTTP/HTTPS port set
```

`DATABASE_SCHEMA` — SQL schema и технический namespace. Runtime SQL использует `search_path=<schema>,public`; жёсткие ссылки `buslanes.<table>` в application code недопустимы.

Пример второго экземпляра:

```dotenv
DATABASE_NAME=tramlanes
DATABASE_ROLE=tramlanes
DATABASE_SCHEMA=tramlanes
HOST=127.0.0.1
HTTP_ENABLED=true
HTTP_PORT=3002
```

Исторические migration files могут содержать token `BUSLANES`: migration runner заменяет его на фактический `DATABASE_SCHEMA` перед выполнением.

Подробнее: [docs/deployment.md](docs/deployment.md).

## Миграции

Текущая последовательность: `V001…V049`.

Последние изменения:

| Migration | Назначение |
| --- | --- |
| `V018` | sessions, роли, profile/avatar, IP security, audit indexes |
| `V019` | Mapbox token в `PROJECT_SETTINGS` |
| `V020` | custom city marker |
| `V021` | public theme preset |
| `V022` | независимый hover-popup имени линии |
| `V023` | `CITY_BOUNDARIES.FULL_NAME`, объединение частей OSM relation и синхронизация `CITIES.FULL_NAME` |
| `V024` | последовательный multi-column ranking (`REPORT_CONFIG.RANK_SORT`) |
| `V025` | `PROJECT_SETTINGS.PUBLIC_DOWNLOAD_NAME` |
| `V026` | динамические ссылки на публичные GeoJSON/CSV в footer |
| `V027` | OSM object identity, active/display identity, hierarchy, DB-backed OSM import settings и пороги large/small |
| `V028` | раздельные лимиты одного Overpass response / всей загрузки и база для adaptive geometry batching |
| `V029` | durable checkpoint + persistent geometry staging для возобновления OSM update после ошибки/рестарта |
| `V030` | накопительный счётчик фактически сохранённых geometry batches в checkpoint |
| `V031` | диагностика OSM-объектов без построенной geometry в resumable checkpoint |
| `V032` | population/asOf/source/attributes на `CITY_BOUNDARIES` и активная проекция в `CITY_POPULATIONS` |
| `V033` | вертикальное key/value-хранилище `REPORT_CONFIG` вместо растущей singleton-строки |
| `V034` | настраиваемая политика паролей администраторов |
| `V035` | отдельное право редактора OSM-дерева |
| `V036` | отдельное право редактора геометрий |
| `V037` | универсальная модель `CITY_GEOMETRIES` для point/line/polygon и editor metadata |
| `V038` | staging/import-conflict model редактора геометрий |
| `V039` | синхронизация active boundaries с canonical `CITIES` для редактора |
| `V040` | geometry model invariants и derived length normalization |
| `V041` | deferred identity/pending guards для city/boundary model |
| `V042` | nullable/effective geometry ownership transition |
| `V043` | final-state geometry constraints |
| `V044` | suspended geometry rebinding transition |
| `V045` | независимые геометрии и spatial-derived `CITY_ID/BOUNDARY_ID` |
| `V046` | cooperative geometry edit leases |
| `V047` | admin request rate-limit settings |
| `V048` | persistent request-incident/IP lockout state |
| `V049` | spatial relink fix для territories без непустой descendant geometry |
| `V050` | point types, icon metadata и optional Point category |
| `V051…V053` | PostGIS-compatible spatial relink hardening |
| `V054` | DB-backed Prometheus settings/token hash |
| `V055…V056` | TOTP MFA и optional mandatory-MFA policy |
| `V057` | geometry zoom/date visibility metadata |
| `V058` | geometry discussions |
| `V059` | public Point/Line/Polygon visibility toggles |
| `V060` | point-type zoom range |
| `V061` | geometry history start date и playback speed profiles |
| `V062…V064` | discussion read state и generic geometry/OSM subjects |
| `V065` | admin IPv4/IPv6 CIDR allowlist |

Текущий migration tail: **V065**. Следующая migration: **V066+**.
Уже опубликованные migrations не редактируются задним числом.

История хранится в:

```text
<DATABASE_SCHEMA>.schema_versions
```

`npm start` автоматически применяет все pending migrations из `db/migrations` **до** bootstrap и открытия HTTP/HTTPS listeners. Migration runner использует PostgreSQL advisory lock, поэтому параллельные старты одного schema не применяют одну migration дважды. Checksum/history по-прежнему проверяются; при modified/gapped/newer history или SQL-ошибке startup завершается и приложение не начинает обслуживать запросы. `npm run db:migrate` остаётся доступной ручной preflight-командой.

## Большие portable JSON / ZIP transfers

Admin transfer для OSM boundaries, линий и населения поддерживает raw
JSON/GeoJSON и single-entry ZIP/ZIP64. Экспорт формируется потоково; импорт
принимает в том числе chunked ZIP из pipe/stdin и затем разбирает JSON по
элементам без materialization всего документа в heap Node. Directory entries
игнорируются, после них должна остаться ровно одна data entry; её имя и
расширение не используются для определения JSON schema.

DB import выполняется одной транзакцией: malformed JSON/ZIP, schema/PostGIS
ошибка или cancellation приводят к полному `ROLLBACK`. Лимиты streaming
transport/decoded JSON/item, ZIP ratio/entry count и JSON depth/record count
задаются через `IMPORT_API_MAX_STREAM_*`. Подробнее:
[docs/data-transfer.md](docs/data-transfer.md).

## OSM геометрии

Начиная с `V027`, исходная identity каждого объекта — строго:

```text
OSM_TYPE + OSM_ID
```

Разные relations больше никогда не объединяются по совпадению имени. Историческая
нормализация V023 отключена новой migration; после перехода на V027 рекомендуется
один раз заново выполнить OSM update, чтобы восстановить объекты, ранее потерянные
из-за name-based merge.

Загрузчик получает ID-индекс, дедуплицирует пересечения selectors по
`(osm_type, osm_id)`, затем последовательно загружает geometry batches.
Начиная с V028 лимит памяти одного Overpass-ответа отделён от суммарного
лимита операции. Если geometry batch превышает single-response limit, он
автоматически делится пополам и повторяется.

Начиная с V029 индекс OSM и успешно проверенные geometry batches сохраняются
в PostgreSQL как durable checkpoint. После ошибки, отмены или перезапуска Node
администратор может явно выбрать «Возобновить»: уже staged объекты повторно
не скачиваются. Production `CITY_BOUNDARIES` при этом остаётся неизменной до
полного snapshot и одной финальной транзакции. «Запустить заново» при наличии
checkpoint требует явного подтверждения; старый checkpoint сохраняется до
успешного получения нового индекса.

Для каждого объекта отдельно хранятся source-признаки OSM и пользовательская
конфигурация:

- `PLACE_TYPE` / `ADMIN_LEVEL`;
- `IS_ACTIVE`;
- `DISPLAY_NAME` / `DISPLAY_TYPE`;
- `PARENT_ID`, вычисленный по полному `ST_Covers(parent, child)`;
- `AREA_M2`.

Только активные boundaries участвуют в привязке населения, линий, публичной
карте и отчётах. Просто пересекающиеся полигоны не образуют parent/child связь.

## Основные таблицы

В `<DATABASE_SCHEMA>` используются:

- `cities`;
- `city_populations`;
- `city_boundaries`;
- `city_geometries`;
- `geometry_edit_leases`;
- `geometry_import_sessions` / `geometry_import_stage`;
- `line_types`;
- `project_settings`;
- `report_config`;
- `city_report_values`;
- `osm_import_settings`;
- `admin_users`;
- `admin_sessions`;
- `admin_security_settings`;
- `admin_login_ip_state`;
- `admin_blocked_ips`;
- `admin_audit_log`;
- `admin_task_successes`;
- operational journals OSM/KML updates.

## Админка

Web-admin: `/admin/`.

Права:

```text
CAN_MANAGE_DATA
CAN_MANAGE_INTERFACE
CAN_MANAGE_USERS
CAN_VIEW_AUDIT
CAN_MANAGE_SECURITY
CAN_EDIT_OSM
CAN_EDIT_GEOMETRIES
IS_SUPERUSER
```

Web UI и защищённый admin API используют только HttpOnly session cookie; online HTTP Basic удалён.

Админка построена на общей layout-схеме: разделы, tabs и визуальные blocks
создаются из `admin/admin-layout-schema.js` через `admin/admin-layout.js`.
Основные разделы: управление данными, геометрии, OSM, настройка интерфейса,
пользователи/аудит, безопасность, сообщения и профиль. Раздел
**Безопасность** внутри себя разделён на **Защита**, **Метрики и тайминги** и
**Блокировки**.

Geometry editor использует VIEW/EDIT model, edit leases, versioned local
workspace, atomic sync, topology preview operations `union/cut/split`,
координатный редактор, обсуждения и realtime. Редактируемые другими
пользователями геометрии помечаются в списке и на карте; выбор города имеет
поиск по содержимому списка.

Длительные mutating data operations выполняются через process-local single-task manager. Один экземпляр Node не должен блокировать задачи другого экземпляра/БД.

Подробнее: [docs/admin-security.md](docs/admin-security.md),
[docs/geometry-editor.md](docs/geometry-editor.md) и
[docs/admin-ui.md](docs/admin-ui.md).

## Настройки проекта

`PROJECT_SETTINGS` содержит, среди прочего:

- `PROJECT_NAME`;
- `KEYWORDS`;
- валидируемый `FOOTER_HTML`;
- analytics IDs;
- `THEME_PRESET`;
- `SHOW_LINE_LABELS`;
- `SHOW_LINE_POPUPS`;
- `SHOW_POINT_GEOMETRIES` / `SHOW_LINE_GEOMETRIES` / `SHOW_POLYGON_GEOMETRIES`;
- `SHOW_GEOMETRY_TIMELINE`;
- `HISTORY_START_DATE` и набор playback-speed profiles;
- Mapbox public token;
- custom city marker;
- `PUBLIC_DOWNLOAD_NAME`.

`SHOW_LINE_LABELS` и `SHOW_LINE_POPUPS` независимы.

Analytics IDs подключаются только когда заданы. Счётчики загружаются ранним внешним скриптом в `<head>`; CSP разрешает официальные endpoints Yandex Metrica/Session Replay и GA4. Диагностика загрузчиков доступна в браузере через `window.dtpstatMetrics`. Подробнее: [docs/analytics.md](docs/analytics.md).

### Публичные GeoJSON/CSV

В настройке задаётся **только базовое имя** без расширения. Например:

```text
tram-lines
```

полностью определяет:

```text
var/public-downloads/tram-lines.geojson
var/public-downloads/tram-lines.csv
/tram-lines.geojson
/tram-lines.csv
Content-Disposition: tram-lines.geojson / tram-lines.csv
```

При смене имени snapshots сразу пересобираются. Старые `.csv/.geojson` в `var/public-downloads/` удаляются; старые URL не сохраняются как aliases.

Footer может использовать placeholders:

```text
{{PUBLIC_GEOJSON_URL}}
{{PUBLIC_CSV_URL}}
```

Они подставляются при рендеринге страницы из текущего `PUBLIC_DOWNLOAD_NAME`.

`var/public-downloads/` — runtime state, а не backup/source bundle. Статические source snapshots в корне репозитория не используются и не хранятся.

## Расчёты и рейтинг

В **Настройка интерфейса → Расчёты** задаются:

- metrics;
- публичные table columns;
- CSV columns;
- ranking.

Backend компилирует только server-owned DSL: fields, aggregates, references на другие metrics, constants и arithmetic operations. Произвольный SQL не принимается.

Рейтинг поддерживает до восьми уникальных критериев:

```json
{
  "rank": {
    "sort": [
      { "metricKey": "separation_ratio", "direction": "desc" },
      { "metricKey": "network_length_m", "direction": "desc" },
      { "metricKey": "population", "direction": "asc" }
    ]
  }
}
```

Критерии применяются последовательно; финальный deterministic fallback — `city.name ASC`. Ranking по-прежнему считается отдельно для больших/малых городов.

Подробнее: [docs/report-config.md](docs/report-config.md).

## Перенос данных

Admin data-transfer разделён на:

1. города/OSM boundaries — GeoJSON;
2. линии + business line types — GeoJSON/KML;
3. население — JSON.

Рекомендуемый порядок для нового экземпляра:

```text
cities → lines → populations
```

Public snapshots не являются round-trip format. Для переноса используйте `/api/admin/export/*` и соответствующие import endpoints.

Подробнее: [docs/data-transfer.md](docs/data-transfer.md) и [docs/kml-transfer.md](docs/kml-transfer.md).

## Перенос настроек

Superuser API:

```text
GET  /api/admin/settings/export
POST /api/admin/settings/import
```

Текущий package: `project-settings`, **schemaVersion 11**.

Импорт принимает `v1…v11` и нормализует legacy fields. V5 добавил
`rank.sort`, V6 — `publicDownloadName`, V7 — пороги разделения
больших/малых городов, V8 — password policy, V9 — per-user/global HTTP
request rate limits, V10 — public visibility типов геометрий, V11 — режим
истории карты (`showGeometryTimeline`, `historyStartDate`,
`historySpeeds`).

Переносятся project settings, line types, report config, security policy и public Mapbox token. Не переносятся users/password hashes/sessions/audit, source data, `.env`, TLS/DB secrets и custom city marker binary.

Подробнее: [docs/project-settings-transfer.md](docs/project-settings-transfer.md).

## Reverse proxy / nginx

Для одного доверенного nginx:

```dotenv
HOST=127.0.0.1
HTTP_TRUST_PROXY_HOPS=1
```

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

Для стандартного application upload limit 25 MiB:

```nginx
client_max_body_size 30m;
```

Подробнее: [docs/deployment.md](docs/deployment.md).

## npm scripts

```text
npm start
npm run dev
npm run db:init
npm run db:migrate
npm run admin:unblock
npm run admin:set-superuser
npm run lint
npm test
npm run check
npm run test:integration
```

### PostgreSQL/PostGIS integration regression

Обычный `npm test` не подключается к PostgreSQL. Для проверки реальных migrations,
PostGIS SQL, project-settings transfer repository/service, временного line-type
staging и spatial/cursor export используется отдельный opt-in harness:

```bash
npm run test:integration
```

Harness подключается к существующей БД, указанной в `.env`: `DATABASE_HOST`,
`DATABASE_PORT`, `DATABASE_NAME` и SSL-настройки берутся из database config,
а административные операции выполняются PostgreSQL role из
`POSTGRES_ADMIN_USER` / `POSTGRES_ADMIN_PASSWORD`.

Основной PostGIS regression не использует и не изменяет рабочую
`DATABASE_SCHEMA`: для каждого запуска создаётся случайная schema
`dtpstat_it_*`, в неё применяются все migrations и выполняются repository /
PostGIS checks. В `finally` schema удаляется через `DROP SCHEMA ... CASCADE`.

Отдельный privilege regression создаёт disposable database `dtp_it_priv_*` и
две disposable login-role. На реальном PostgreSQL он проверяет, что migration
role владеет DDL, а runtime role может DML/TEMP/sequence/function access, но не
может CREATE/ALTER/DROP application objects и не может `SET ROLE` migration
owner. В `finally` временная database и обе role удаляются.

PostGIS ожидается уже установленным в основной integration database штатным
`npm run db:init`.


Импорт и перенос application data выполняются через административные API/UI. Отдельного repository-snapshot import script нет.

## Документация

- [docs/README.md](docs/README.md) — карта всей документации и текущие version anchors;
- [admin-ui.md](docs/admin-ui.md) — общая admin layout/component architecture;
- [deployment.md](docs/deployment.md) — экземпляры, migrations, nginx/PM2;
- [admin-security.md](docs/admin-security.md) — auth/roles/sessions/audit/IP security;
- [data-transfer.md](docs/data-transfer.md) — cities/lines/populations;
- [kml-transfer.md](docs/kml-transfer.md) — portable KML;
- [report-config.md](docs/report-config.md) — metrics/table/CSV/ranking;
- [project-settings-transfer.md](docs/project-settings-transfer.md) — перенос конфигурации;
- [database-indexes.md](docs/database-indexes.md) — актуальные indexes/access paths;
- [geometry-editor.md](docs/geometry-editor.md) — модель геометрий, spatial links, edit leases, local workspace и concurrency;
- [admin-discussions.md](docs/admin-discussions.md) — общие обсуждения geometry/OSM и inbox;
- [monitoring.md](docs/monitoring.md) — Prometheus/fail2ban deployment templates.


### Viewport performance profile

Публичный hot path `/api/geometries` можно профилировать read-only на той же
runtime-role и тем же SQL, который использует HTTP API:

```bash
npm run perf:viewport -- \
  --bbox=37.4,55.6,37.9,55.9 \
  --center=37.62,55.75 \
  --iterations=5
```

`--center` необязателен; по умолчанию используется центр bbox. Profiler
выполняет warm-up, несколько реальных запросов и
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` внутри `BEGIN READ ONLY`.
Результат — JSON с p50/p95 latency, размером/числом features, planning/execution
time, shared buffer hits/reads, index scans и sequential scans. Bbox ограничен
тем же максимумом 20°×20°, что и public API. Profiler не создаёт и не изменяет
DB objects.
