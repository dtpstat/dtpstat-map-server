# Экспорт и импорт настроек проекта

Settings transfer переносит DB-backed конфигурацию между экземплярами без копирования source data и admin identities.

API для superuser:

```text
GET  /api/admin/settings/export
POST /api/admin/settings/import
```

## Версия формата

Текущий export:

```text
_dtpstat.kind = project-settings
_dtpstat.schemaVersion = 6
```

Import принимает `v1…v6`.

Ключевые изменения:

- `v3` — `themePreset`;
- `v4` — независимый `showLinePopups`;
- `v5` — ordered `reportConfig.rank.sort`;
- `v6` — `projectSettings.publicDownloadName`.

Legacy packages нормализуются к текущей модели.

## Что переносится

### PROJECT_SETTINGS

- `projectName`;
- `keywords`;
- `footerHtml`;
- `yandexMetrikaId`;
- `googleAnalyticsId`;
- `themePreset`;
- `showLineLabels`;
- `showLinePopups`;
- `publicDownloadName`;
- public Mapbox access token.

Не переносятся custom city marker binary/metadata и deployment-specific `MAPBOX_STYLE_URL`.

### LINE_TYPES

Для каждого типа:

```text
code
name
title
color
style
width
```

`NAME` — переносимая business identity. Source numeric `CODE` не навязывается target database.

Matching:

```text
source CODE
→ source NAME
→ target lookup by LOWER(BTRIM(NAME))
→ target local CODE/ID
```

Existing target type сохраняет свой CODE, но получает imported presentation fields. Missing NAME создаётся. Target-only types не удаляются.

### REPORT_CONFIG

Переносятся:

- metrics;
- dependencies и arithmetic operations/priorities;
- public table columns;
- conditional formatting;
- CSV columns;
- ordered ranking criteria.

Пример:

```json
{
  "rank": {
    "sort": [
      { "metricKey": "separation_ratio", "direction": "desc" },
      { "metricKey": "network_length_m", "direction": "desc" }
    ]
  }
}
```

`CITY_REPORT_VALUES` не переносится: target materialization строится заново на target cities/geometries/population.

### ADMIN_SECURITY_SETTINGS

Переносится policy:

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

## Что не переносится

Package не содержит:

- `ADMIN_USERS` и password hashes;
- sessions;
- audit log;
- current account/IP lockout state;
- manual blocked IPs;
- task-success state;
- cities/boundaries/geometries/population;
- materialized report values;
- `.env`;
- DB credentials;
- TLS keys/certificates;
- OSM/KML deployment allowlists;
- custom city marker PNG binary.

## Семантика publicDownloadName

В v6 задаётся только базовое имя без расширения:

```json
{
  "publicDownloadName": "tram-lines"
}
```

После import/refresh оно полностью определяет:

```text
var/public-downloads/tram-lines.geojson
var/public-downloads/tram-lines.csv
/tram-lines.geojson
/tram-lines.csv
Content-Disposition filename
```

Старые имена не сохраняются как URL aliases. При refresh obsolete `.csv/.geojson` snapshots удаляются.

Для footer доступны placeholders:

```text
{{PUBLIC_GEOJSON_URL}}
{{PUBLIC_CSV_URL}}
```

Renderer подставляет URLs из текущего `publicDownloadName`.

Для packages `v1…v5`, где `publicDownloadName` отсутствует, target value сохраняется.

## Семантика line names

Начиная с v4 два режима независимы:

```json
{
  "showLineLabels": true,
  "showLinePopups": false
}
```

- `showLineLabels` — постоянные подписи `placemarkName`;
- `showLinePopups` — popup при наведении.

Для v1-v3 отсутствующий `showLinePopups` нормализуется в `true`, что соответствует прежнему public поведению.

## Семантика ranking

V5+ переносит ordered array `rank.sort`.

```text
primary DESC
→ при равенстве secondary ASC/DESC
→ ...
→ city.name ASC
```

Старый формат:

```json
{
  "rank": {
    "metricKey": "primary",
    "direction": "desc"
  }
}
```

принимается и становится массивом из одного criterion.

Одна metric не может повторяться в `rank.sort`.

## Mapbox token

Если package содержит `mapboxAccessToken`, target DB value обновляется и считается initialized.

Legacy package без этого field не должен обнулять уже настроенный target token.

`MAPBOX_ACCESS_TOKEN` из `.env` после DB bootstrap не является source of truth.

## Validation и transaction

Import:

1. проверяет kind/schemaVersion;
2. валидирует project settings;
3. валидирует line types;
4. нормализует security policy;
5. открывает transaction и advisory import lock;
6. сопоставляет/создаёт target line types;
7. валидирует report config против итогового line-type dictionary;
8. сохраняет project/security/report settings;
9. пересчитывает `CITY_REPORT_VALUES`;
10. commit;
11. после commit пересобирает public snapshots.

До `COMMIT` ошибка вызывает rollback.

Post-commit snapshot refresh не может физически откатить уже committed DB transaction; API должен сообщать post-processing failure отдельно.

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
    "themePreset": "retro",
    "showLineLabels": false,
    "showLinePopups": true,
    "publicDownloadName": "tram-lines",
    "mapboxAccessToken": "pk...."
  },
  "lineTypes": [],
  "reportConfig": {
    "metrics": [],
    "tableColumns": [],
    "csvColumns": [],
    "rank": {
      "sort": [
        { "metricKey": "example", "direction": "desc" }
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

Фактический `reportConfig` должен содержать валидные metrics/columns и пройти обычный server validator.

## Audit

Операции записываются в `ADMIN_AUDIT_LOG`, например:

```text
settings.export
settings.import
```

Подробнее о переносе source data: [data-transfer.md](data-transfer.md).
