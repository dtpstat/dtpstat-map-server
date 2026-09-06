# Экспорт и импорт настроек проекта

Superadmin может переносить DB-backed настройки экземпляра отдельным JSON-пакетом через окно:

```text
Пользователи и аудит → Настройки проекта
```

API:

```text
GET  /api/admin/settings/export
POST /api/admin/settings/import
```

Оба endpoint доступны только `IS_SUPERUSER`.

## Что входит в пакет

Текущая `schemaVersion = 1` переносит:

1. `PROJECT_SETTINGS`:
   - название проекта;
   - keywords;
   - HTML информационного блока;
   - Yandex Metrica ID;
   - Google Analytics ID;
   - `SHOW_LINE_LABELS`;
2. `LINE_TYPES`:
   - source/import `NAME`;
   - `TITLE`;
   - цвет;
   - стиль;
   - толщина;
   - source numeric `CODE` только как часть переносимого словаря;
3. `REPORT_CONFIG`:
   - метрики;
   - ссылки между метриками;
   - арифметика/приоритеты;
   - публичная таблица;
   - conditional formatting;
   - CSV;
   - ranking;
4. `ADMIN_SECURITY_SETTINGS`:
   - порог ошибок входа;
   - окно подсчёта;
   - длительность временной блокировки.

## Что намеренно НЕ входит

Пакет настроек не является backup всей БД. В него не включаются:

- `ADMIN_USERS`;
- логины/пароли/password hashes;
- `ADMIN_AUDIT_LOG`;
- текущие `FAILED_LOGIN_COUNT` / `LOCKED_UNTIL`;
- города и OSM-границы;
- геометрии линий;
- население;
- materialized `CITY_REPORT_VALUES` как источник истины;
- `ADMIN_TASK_SUCCESSES`;
- инфраструктурные `.env` параметры;
- PostgreSQL credentials;
- Mapbox token;
- TLS private key/certificate;
- KML/Overpass network allowlists и другие deployment secrets.

Данные городов/линий/населения переносятся существующими data-transfer endpoint, а не этим форматом.

## Формат v1

Пример структуры:

```json
{
  "_dtpstat": {
    "kind": "project-settings",
    "schemaVersion": 1,
    "exportedAt": "2026-09-06T12:00:00.000Z"
  },
  "projectSettings": {
    "projectName": "Трамвайные системы России",
    "keywords": ["трамвай"],
    "footerHtml": "<p>...</p>",
    "yandexMetrikaId": null,
    "googleAnalyticsId": null,
    "showLineLabels": true
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
      "metricKey": "example",
      "direction": "desc"
    }
  },
  "securitySettings": {
    "maxFailedAttempts": 5,
    "failureWindowSeconds": 900,
    "lockoutSeconds": 900
  }
}
```

Фактический `reportConfig` должен удовлетворять обычному validator и содержать допустимые метрики/колонки.

## Семантика LINE_TYPES

Как и в data-transfer форматах, numeric `CODE` между экземплярами **не является локальным идентификатором**.

При импорте:

```text
source entry
  CODE + NAME
       ↓
target lookup by normalized NAME
       ↓
existing target type → обновить TITLE/color/style/width
missing target NAME  → создать, target DB генерирует новый CODE
```

Сопоставление `NAME` выполняется без учёта регистра и внешних пробелов.

Типы, которые существуют только в целевой БД и отсутствуют в импортируемом файле, **не удаляются**. Это необходимо, чтобы импорт настроек не разрушал существующие ссылки `CITY_GEOMETRIES.LINE_TYPE_ID`.

## Атомарность импорта

Перед фиксацией сервер:

- проверяет envelope `_dtpstat.kind/schemaVersion`;
- валидирует `PROJECT_SETTINGS` существующим HTML/meta validator;
- валидирует словарь `LINE_TYPES`;
- валидирует security thresholds;
- внутри транзакции сопоставляет/создаёт line types;
- валидирует `REPORT_CONFIG` уже относительно итогового набора `LINE_TYPES.NAME`;
- пересчитывает `CITY_REPORT_VALUES`.

`PROJECT_SETTINGS`, оформление типов, `REPORT_CONFIG`, security policy и materialized report фиксируются одной PostgreSQL transaction. Ошибка до `COMMIT` приводит к rollback.

После commit сервер пересобирает статические public-download snapshots. Это производный post-processing: если он завершился ошибкой, импорт настроек остаётся успешным, а API возвращает warning о неудачной пересборке вместо ложного rollback-status.

## Materialized report

`CITY_REPORT_VALUES` не переносится как snapshot. После импорта он строится заново на основании:

```text
текущие данные целевой БД
+
импортированный REPORT_CONFIG
```

Поэтому один и тот же пакет настроек можно применять к разным наборам городов/геометрий, если используемые `LINE_TYPES.NAME` совместимы.

## Audit

Экспорт и импорт записываются в `ADMIN_AUDIT_LOG` как:

```text
settings.export
settings.import
```

с пользователем, IP, status и duration.

Сам экспорт не содержит audit log или credentials.

## Версионирование

Формат использует отдельную версию:

```text
_dtpstat.kind = project-settings
_dtpstat.schemaVersion = 1
```

Неизвестный `kind` или неподдерживаемый `schemaVersion` отклоняется до изменения БД.
