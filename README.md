# dtpstat-map-server

Node.js/Express + PostgreSQL/PostGIS сервер интерактивной карты линейных объектов. Код рассчитан на несколько независимых экземпляров: разные БД, схемы, порты, данные, расчёты и оформление используют один runtime.

Требования:

- Node.js `20.19+` (для production рекомендуется Node.js `24.x`);
- PostgreSQL;
- PostGIS.

## Возможности

- публичная Mapbox-карта с viewport-загрузкой линий;
- города и границы из OSM/Overpass;
- объединение частей одного OSM `relation` в один логический город;
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
npm run db:migrate
npm start
```

Для локальной PostgreSQL из `compose.yaml`:

```bash
docker compose up -d database
npm run db:init
npm run db:migrate
npm start
```

При первом старте пустая `ADMIN_USERS` получает bootstrap-superuser из:

```dotenv
IMPORT_API_USERNAME=admin
IMPORT_API_PASSWORD=replace-with-a-long-random-password
```

После появления DB-пользователя эти ENV credentials не являются login fallback. Они могут оставаться только как recovery source для `npm run admin:set-superuser`.

`MAPBOX_ACCESS_TOKEN` начиная с `V019` используется только для одноразового bootstrap DB-настройки. После инициализации token меняется через админку/перенос настроек.

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

Текущая последовательность: `V001…V026`.

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

Следующая migration: **V027+**. Уже опубликованные migrations не редактируются задним числом.

История хранится в:

```text
<DATABASE_SCHEMA>.schema_versions
```

## OSM города

`CITY_BOUNDARIES.FULL_NAME` вычисляется как первое непустое значение:

```text
addr:district
→ name:ru
→ osm_name
```

Для `OSM_TYPE='relation'` строки с одинаковыми:

```text
PLACE_TYPE + FULL_NAME
```

считаются частями одного логического города и объединяются в `MultiPolygon`.

`OSM_TYPE/OSM_ID` пока сохраняются как provenance и используются portable city-transfer для восстановления связей. Это не identity логического города после нормализации relation fragments.

## Основные таблицы

В `<DATABASE_SCHEMA>` используются:

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
IS_SUPERUSER
```

Web UI использует HttpOnly session cookie. HTTP Basic остаётся для scripted API.

Длительные mutating data operations выполняются через process-local single-task manager. Один экземпляр Node не должен блокировать задачи другого экземпляра/БД.

Подробнее: [docs/admin-security.md](docs/admin-security.md).

## Настройки проекта

`PROJECT_SETTINGS` содержит, среди прочего:

- `PROJECT_NAME`;
- `KEYWORDS`;
- валидируемый `FOOTER_HTML`;
- analytics IDs;
- `THEME_PRESET`;
- `SHOW_LINE_LABELS`;
- `SHOW_LINE_POPUPS`;
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

Текущий package: `project-settings`, **schemaVersion 6**.

Импорт принимает `v1…v6` и нормализует legacy fields. V5 добавил `rank.sort`, V6 — `publicDownloadName`.

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
```

Импорт и перенос application data выполняются через административные API/UI. Отдельного repository-snapshot import script нет.

## Документация

- [deployment.md](docs/deployment.md) — экземпляры, migrations, nginx/PM2;
- [admin-security.md](docs/admin-security.md) — auth/roles/sessions/audit/IP security;
- [data-transfer.md](docs/data-transfer.md) — cities/lines/populations;
- [kml-transfer.md](docs/kml-transfer.md) — portable KML;
- [report-config.md](docs/report-config.md) — metrics/table/CSV/ranking;
- [project-settings-transfer.md](docs/project-settings-transfer.md) — перенос конфигурации;
- [database-indexes.md](docs/database-indexes.md) — актуальные indexes/access paths.
