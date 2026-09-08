# Экспорт и импорт настроек проекта

Для переноса DB-backed конфигурации между экземплярами используется отдельный JSON package.

API:

```text
GET  /api/admin/settings/export
POST /api/admin/settings/import
```

Endpoint доступны только `IS_SUPERUSER`.

Это **не** backup всей database: города/линии/население переносятся отдельными data-transfer formats.

## Актуальная версия

Текущий export создаёт:

```text
_dtpstat.kind = project-settings
_dtpstat.schemaVersion = 6
```

Import принимает:

```text
schemaVersion 1
schemaVersion 2
schemaVersion 3
schemaVersion 4
schemaVersion 5
schemaVersion 6
```

Legacy packages нормализуются к текущей модели. Для отсутствующих в старых форматах security fields используются совместимые defaults; отсутствующий theme normalizes to `classic`. До v4 hover-popup имени линии был всегда включён, поэтому для v1-v3 без `showLinePopups` используется compatibility default `true`.

V5 добавил перенос ordered multi-column ranking. V1-v4 с прежним одиночным `rank.metricKey/rank.direction` продолжают импортироваться и нормализуются в один criterion.

V6 добавляет `projectSettings.publicDownloadName` — базовое имя публичных GeoJSON/CSV файлов. При импорте v1-v5 без этого поля текущее имя target deployment сохраняется.

## Что входит в v6

### PROJECT_SETTINGS

Переносятся:

- `projectName`;
- `keywords`;
- `footerHtml`;
- `yandexMetrikaId`;
- `googleAnalyticsId`;
- `themePreset`;
- `showLineLabels` — постоянные подписи `placemarkName` вдоль линий;
- `showLinePopups` — popup `placemarkName` при наведении указателя;
- `publicDownloadName` — базовое имя скачиваемых GeoJSON/CSV без расширения;
- public `mapboxAccessToken`.

`showLineLabels` и `showLinePopups` независимы: можно включить любой из режимов отдельно, оба одновременно или отключить оба.

Допустимые `themePreset`:

```text
retro
classic
modern
```

`publicDownloadName` задаётся без `.geojson`/`.csv`. Сервер сам формирует:

```text
<publicDownloadName>.geojson
<publicDownloadName>.csv
```

Public URL остаются стабильными (`/bus-lanes.geojson` и `/bus-lanes.csv`), имя из настройки используется в `Content-Disposition`, то есть как имя файла при скачивании.

Mapbox token — browser/public `pk.*` token. В settings transfer он является частью project configuration.

### LINE_TYPES

Для каждого business type:

- source numeric `code`;
- `name`;
- `title`;
- `color`;
- `style`;
- `width`.

`NAME` является переносимой identity. Numeric CODE нужен как часть source dictionary и не считается глобальным target ID.

### REPORT_CONFIG

Переносятся:

- metrics;
- metric dependencies;
- arithmetic operations/priorities;
- table columns;
- conditional formatting;
- CSV columns;
- ordered ranking criteria `rank.sort`.

Пример:

```json
"rank": {
  "sort": [
    { "metricKey": "separation_ratio", "direction": "desc" },
    { "metricKey": "network_length_m", "direction": "desc" }
  ]
}
```

Критерии применяются последовательно сверху вниз. Старые single-rank packages преобразуются в массив из одного элемента.

`CITY_REPORT_VALUES` не копируется: target materialized report строится заново с той же последовательностью сортировки.

### ADMIN_SECURITY_SETTINGS

Текущая версия переносит полный policy set:

```text
maxFailedAttempts
failureWindowSeconds
lockoutSeconds
ipMaxFailedAttempts
ipFailureWindowSeconds
ipLockoutSeconds
sessionIdleSeconds
sessionAbsoluteSeconds
auditRetentionDays
```

## Что НЕ входит

Package намеренно не переносит:

- `ADMIN_USERS`;
- username/password/password hash;
- avatars пользователей;
- `ADMIN_SESSIONS`;
- `ADMIN_AUDIT_LOG`;
- account `FAILED_LOGIN_COUNT/LOCKED_UNTIL`;
- `ADMIN_LOGIN_IP_STATE`;
- `ADMIN_BLOCKED_IPS`;
- `ADMIN_TASK_SUCCESSES`;
- города и boundaries;
- line geometries;
- population;
- materialized `CITY_REPORT_VALUES` как source snapshot;
- `.env`;
- database credentials;
- TLS keys/certificates;
- OSM/KML deployment allowlists;
- `MAPBOX_STYLE_URL`;
- custom city marker PNG binary и его image metadata.

Последний пункт важен: city marker хранится в `PROJECT_SETTINGS`, но текущий v6 transfer package его **не экспортирует**.

## Пример v6

```json
{
  "_dtpstat": {
    "kind": "project-settings",
    "schemaVersion": 6,
    "exportedAt": "2026-09-08T03:00:00.000Z"
  },
  "projectSettings": {
    "projectName": "Трамвайные системы России",
    "keywords": ["трамвай"],
    "footerHtml": "<p>...</p>",
    "yandexMetrikaId": null,
    "googleAnalyticsId": null,
    "themePreset": "classic",
    "showLineLabels": false,
    "showLinePopups": true,
    "publicDownloadName": "tram-lines",
    "mapboxAccessToken": "pk...."
  },
  "lineTypes": [
    {
      "code": 0,
      "name": "default",
      "title": "Трамвайные линии",
      "color": "#045b69",
      "style": "solid",
      "width": 4
    }
  ],
  "reportConfig": {
    "metrics": [],
    "tableColumns": [],
    "csvColumns": [],
    "rank": {
      "sort": [
        { "metricKey": "example", "direction": "desc" },
        { "metricKey": "secondary", "direction": "asc" }
      ]
    }
  },
  "securitySettings": {
    "maxFailedAttempts": 5,
    "failureWindowSeconds": 900,
    "lockoutSeconds": 900,
    "ipMaxFailedAttempts": 20,
    "ipFailureWindowSeconds": 900,
    "ipLockoutSeconds": 3600,
    "sessionIdleSeconds": 1800,
    "sessionAbsoluteSeconds": 43200,
    "auditRetentionDays": 365
  }
}
```

Фактический `reportConfig` должен пройти обычный server validator; `metricKey` каждого ranking criterion должен существовать среди импортируемых metrics, а одна metric не может повторяться в `rank.sort`.

## Семантика Mapbox token при import

Если `projectSettings` содержит `mapboxAccessToken`, target token обновляется и считается initialized.

Если legacy package не содержит это поле, текущий target token сохраняется: import не должен обнулять уже настроенный deployment только потому, что старый format не знал о Mapbox setting.

После DB initialization переменная `MAPBOX_ACCESS_TOKEN` из `.env` используется только для одноразового bootstrap `V019`; settings package работает уже с DB value.

## Семантика theme

Начиная с v3 экспортируется явный:

```json
"themePreset": "retro | classic | modern"
```

Для legacy package без theme применяется compatibility normalization `classic`.

## Семантика отображения наименований линий

Начиная с v4 это два независимых boolean-параметра:

```json
{
  "showLineLabels": true,
  "showLinePopups": false
}
```

- `showLineLabels=true` создаёт постоянные Mapbox symbol layers с `text-field=placemarkName`;
- `showLinePopups=true` разрешает hover-query линейных слоёв и popup с `placemarkName`;
- выключение popup не влияет на постоянные подписи;
- выключение постоянных подписей не влияет на popup.

Для v1-v3 отсутствующий `showLinePopups` трактуется как `true`, поскольку именно так работал публичный frontend до разделения настроек.

## Семантика имени публичных файлов

Начиная с v6 settings package содержит:

```json
{
  "publicDownloadName": "tram-lines"
}
```

Расширение в setting не хранится. Значения с `.csv` или `.geojson`, path separators и control characters отклоняются validator-ом.

Для v1-v5 отсутствие поля означает **сохранить текущее target-значение**, а не сбросить его в `bus-lanes`.

## Семантика ranking transfer

V5 и новее экспортируют ordered array:

```json
{
  "rank": {
    "sort": [
      { "metricKey": "primary", "direction": "desc" },
      { "metricKey": "secondary", "direction": "asc" }
    ]
  }
}
```

При import target materialization использует тот же порядок:

```text
primary DESC
→ при равенстве secondary ASC
→ при полном равенстве city.name ASC
```

V1-v4 могут содержать старую форму:

```json
{
  "rank": {
    "metricKey": "primary",
    "direction": "desc"
  }
}
```

Она остаётся валидной и превращается в один элемент `rank.sort`.

## LINE_TYPES matching

Source CODE не переносится в target как обязательный numeric identifier.

Алгоритм:

```text
source CODE + NAME
        ↓
normalize NAME
        ↓
target lookup by NAME
        ↓
existing NAME → update TITLE/color/style/width, keep target CODE
missing NAME  → create row, target DB generates CODE
```

Сравнение `NAME` выполняется без учёта регистра и внешних пробелов.

Target-only types, отсутствующие в package, **не удаляются**. Это защищает существующие `CITY_GEOMETRIES.LINE_TYPE_ID` от разрушения.

## Validation и transaction

До commit сервер:

1. проверяет `_dtpstat.kind/schemaVersion`;
2. валидирует project settings;
3. валидирует footer HTML/analytics/theme/line display settings/public download name/Mapbox token;
4. валидирует line type dictionary;
5. нормализует security policy;
6. открывает DB transaction/import lock;
7. сопоставляет и создаёт target line types;
8. валидирует `REPORT_CONFIG`, включая `rank.sort`, уже против итогового набора target `LINE_TYPES.NAME`;
9. сохраняет settings/security/report config;
10. пересчитывает `CITY_REPORT_VALUES` с последовательным ranking.

До `COMMIT` операция атомарна: ошибка приводит к rollback.

## Post-commit snapshots

После успешного DB commit сервер пересобирает public downloads.

Если этот производный post-processing завершился ошибкой, уже зафиксированный settings import не откатывается. API может вернуть warning вместо ложного сообщения о DB rollback.

## Materialized report

`CITY_REPORT_VALUES` строится из:

```text
target cities/boundaries/geometries/population
+
imported REPORT_CONFIG
+
target line types после matching
```

Поэтому один settings package можно применять к разным data deployments при совместимой семантике line type NAME.

## Audit

Settings operations записываются в `ADMIN_AUDIT_LOG`, в частности как:

```text
settings.export
settings.import
```

Package не содержит audit log, session credentials или password hashes.

## Отличие от data transfer

Project settings package — конфигурация поведения/интерфейса.

Исходные данные переносятся отдельно:

```text
GET /api/admin/export/cities
GET /api/admin/export/lines
GET /api/admin/export/populations
```

Подробнее: [data-transfer.md](data-transfer.md).