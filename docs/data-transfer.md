# Перенос и синхронизация данных

Admin API переносит три независимых набора данных:

1. OSM city/town и их boundaries — GeoJSON;
2. линии вместе со словарём business line types — GeoJSON или KML;
3. население — JSON.

Для data-transfer нужен `CAN_MANAGE_DATA` или superuser.

Interactive web-admin использует session cookie; HTTP Basic остаётся удобным способом аутентификации для `curl`/automation. В обоих случаях credentials проверяются по `ADMIN_USERS`.

Публичные `/bus-lanes.geojson` и `/bus-lanes.csv` **не являются backup/round-trip форматом**. Для переноса используются `/api/admin/export/*` и соответствующие import endpoints.

## Что переносится отдельно

Data transfer не включает project/UI/security configuration:

- project name/footer/analytics/theme;
- Mapbox token;
- custom city marker;
- `REPORT_CONFIG`;
- `ADMIN_SECURITY_SETTINGS`;
- users/sessions/audit;
- deployment `.env`.

Для DB-backed настроек есть отдельный package:

```text
GET  /api/admin/settings/export
POST /api/admin/settings/import
```

Актуальный settings format — schemaVersion 3. Подробнее: [project-settings-transfer.md](project-settings-transfer.md).

## Рекомендуемый порядок на чистом экземпляре

```text
1. cities
2. lines
3. populations
```

`CITY_REPORT_VALUES` как source of truth не переносится: после изменений он пересчитывается на target DB по текущему `REPORT_CONFIG`.

Локальные surrogate IDs между серверами совпадать не обязаны:

```text
cities.id
city_boundaries.id
city_geometries.id
line_types.id
```

Для переносимых связей используются natural/business keys: OSM identity, city slug и business type `NAME`.

# Города

## Экспорт

```text
GET /api/admin/export/cities
```

Файл:

```text
cities.geojson
```

Формат — GeoJSON `FeatureCollection`, `schemaVersion: 1`.

Для boundary передаются:

- `placeType`: `city`/`town`;
- `osmType`: `way`/`relation`;
- `osmId`;
- `osmName`;
- OSM tags;
- OSM timestamp;
- update metadata;
- данные связанного ranked city;
- `Polygon`/`MultiPolygon`.

## Импорт

```text
POST /api/admin/import/cities
Content-Type: application/geo+json
```

Опционально поддерживается dry-run.

Импорт:

1. валидирует весь FeatureCollection до изменения target data;
2. загружает staging geometry пакетами;
3. проверяет PostGIS validity;
4. сохраняет существующие line-to-boundary relationships по OSM identity;
5. атомарно заменяет `city_boundaries`;
6. пересчитывает report/snapshots после успешной real operation.

Связи восстанавливаются по:

```text
osmType + osmId
```

а не по local `boundary.id`.

## Большой GeoJSON и 413

Node limit крупных protected imports задаётся:

```dotenv
IMPORT_API_MAX_BODY_BYTES=26214400
```

При reverse proxy nginx может вернуть `413 Request Entity Too Large` ещё до Node. Его `client_max_body_size` должен быть не меньше application limit, например:

```nginx
client_max_body_size 30m;
```

# Линии и business types

## GeoJSON export

```text
GET /api/admin/export/lines
```

Файл:

```text
lines.geojson
```

Канонический format — `schemaVersion: 3`.

В корне находится dictionary типов:

```json
{
  "schemaVersion": 3,
  "lineTypes": [
    {
      "code": 7,
      "name": "Односторонние",
      "title": "Односторонние линии",
      "color": "#cc4400",
      "style": "dashed",
      "width": 5.5
    }
  ]
}
```

Семантика:

- `code` — numeric source CODE внутри snapshot;
- `name` — business/import identity;
- `title` — display title;
- `color/style/width` — оформление.

Каждая geometry содержит `_dtpstat`, например:

```json
{
  "_dtpstat": {
    "businessTypeCode": 7,
    "citySlug": "example",
    "boundaryOsmType": "relation",
    "boundaryOsmId": 123456
  }
}
```

Source properties также переносятся. Для KML line name используется:

```json
{
  "placemarkName": "Проспект Мира"
}
```

`properties.name` не следует трактовать как line label: в canonical transfer оно может использоваться для полного имени города.

## Главное правило CODE/NAME

Numeric CODE **не является глобальным ID** между deployments.

Импорт:

```text
source businessTypeCode
        ↓
source lineTypes[].code
        ↓
source NAME
        ↓
target lookup by normalized NAME
        ↓
target local LINE_TYPE_ID/CODE
```

Matching `NAME` выполняется без учёта регистра и внешних пробелов.

Если target `NAME` существует:

- локальный target CODE сохраняется;
- `TITLE`, color/style/width обновляются.

Если `NAME` отсутствует:

- создаётся новый target type;
- CODE генерирует target DB.

`TITLE` в identity не участвует.

## Импорт линий

```text
POST /api/admin/import/lines
Content-Type: application/geo+json
```

Legacy alias:

```text
POST /api/admin/import
```

Полный versioned snapshot синхронизирует dictionary типов и заменяет `city_geometries` в transaction, затем пересчитываются report values и public snapshots.

Поддерживается legacy GeoJSON v2. Старый строковый `type` интерпретируется как imported `NAME`; unversioned geometry без business type использует `default`.

# Внешний KML / Google My Maps

Это отдельный import path, а не portable KML format.

Пример source configuration:

```json
[
  {
    "URL": "https://www.google.com/maps/d/viewer?mid=...",
    "layers": [
      { "name": "Двусторонние", "multiple": 2, "type": "Двусторонние" },
      { "name": "Односторонние", "multiple": 1, "type": "Односторонние" }
    ]
  }
]
```

Здесь:

- `multiple` — статистический множитель;
- `type` — `LINE_TYPES.NAME`, не numeric CODE;
- отсутствующий NAME создаётся автоматически;
- target DB генерирует CODE;
- initial TITLE нового type равен NAME.

Стандартный:

```xml
<Placemark>
  <name>Проспект Мира</name>
</Placemark>
```

сохраняется как `CITY_GEOMETRIES.PROPERTIES.placemarkName`.

Public map может:

- показывать его в hover-popup;
- показывать постоянной подписью при `PROJECT_SETTINGS.SHOW_LINE_LABELS=true`.

# Portable KML

Экспорт:

```text
GET /api/admin/export/lines.kml
```

Импорт:

```text
POST /api/admin/import/lines.kml
Content-Type: application/vnd.google-earth.kml+xml
```

Portable KML использует тот же source CODE → source NAME → target NAME matching.

Подробнее: [kml-transfer.md](kml-transfer.md).

# Население

## Экспорт

```text
GET /api/admin/export/populations
```

Файл:

```text
populations.json
```

Для города переносятся:

- `name`;
- `citySlug`;
- `population`;
- `asOf`;
- `source`;
- `attributes`.

Legacy format с общими `asOf`/`source` в корне также поддерживается.

## Импорт

```text
POST /api/admin/populations
Content-Type: application/json
```

### Поведение для отсутствующих target cities

Population snapshot может содержать больше городов, чем текущий target deployment.

Импорт **не падает** из-за таких строк. Он:

1. валидирует сам population payload;
2. сопоставляет entries с текущими `cities`;
3. обновляет только найденные target cities;
4. пропускает неизвестные города;
5. пересчитывает report по успешно применённым данным.

Result задачи содержит диагностические поля:

```json
{
  "cities": 71,
  "requestedCities": 72,
  "skippedCount": 1,
  "skippedCities": ["Киров"]
}
```

То есть ситуация «population file содержит Киров, а target cities не содержит Киров» больше не является fatal validation error.

При этом настоящие ошибки payload — invalid population, duplicate/conflicting entries, некорректные даты/структура — по-прежнему должны отклоняться.

# Compression

Admin exports проходят через HTTP compression/content negotiation. Клиент может использовать:

```text
Accept-Encoding: gzip
```

JSON/GeoJSON import body parser принимает поддерживаемое Express сжатие, включая gzip.

Пример:

```bash
AUTH="$ADMIN_USERNAME:$ADMIN_PASSWORD"

gzip -c cities.geojson | curl --fail-with-body \
  --user "$AUTH" \
  -X POST \
  -H 'Content-Type: application/geo+json' \
  -H 'Content-Encoding: gzip' \
  --data-binary @- \
  https://target.example/api/admin/import/cities
```

Web-admin при доступном `CompressionStream('gzip')` может сжимать крупные JSON/GeoJSON uploads в браузере.

# Полный пример переноса

```bash
AUTH="$ADMIN_USERNAME:$ADMIN_PASSWORD"

curl --fail-with-body --compressed --user "$AUTH" \
  -o cities.geojson https://source.example/api/admin/export/cities
curl --fail-with-body --compressed --user "$AUTH" \
  -o lines.geojson https://source.example/api/admin/export/lines
curl --fail-with-body --compressed --user "$AUTH" \
  -o populations.json https://source.example/api/admin/export/populations

gzip -c cities.geojson | curl --fail-with-body --user "$AUTH" \
  -X POST -H 'Content-Type: application/geo+json' -H 'Content-Encoding: gzip' \
  --data-binary @- https://target.example/api/admin/import/cities

gzip -c lines.geojson | curl --fail-with-body --user "$AUTH" \
  -X POST -H 'Content-Type: application/geo+json' -H 'Content-Encoding: gzip' \
  --data-binary @- https://target.example/api/admin/import/lines

gzip -c populations.json | curl --fail-with-body --user "$AUTH" \
  -X POST -H 'Content-Type: application/json' -H 'Content-Encoding: gzip' \
  --data-binary @- https://target.example/api/admin/populations
```

# Single-task guard

Длительные mutating операции раздела **Управление данными** проходят через общий single-task guard: одновременно выполняется одна такая задача.

Это блокирует data-management controls, но не обязано блокировать settings/profile UI.

Progress/errors доступны в admin task log/WebSocket.

После успешной real operation:

```text
source data commit
→ CITY_REPORT_VALUES refresh
→ var/public-downloads snapshots refresh
```

`dryRun` не фиксирует source data и не должен обновлять производные public files.

# Public snapshots

Файлы:

```text
var/public-downloads/bus-lanes.geojson
var/public-downloads/bus-lanes.csv
```

создаются для публичного download/read path. Они не содержат всей служебной transfer metadata и не заменяют admin export.

# Аутентификация за reverse proxy

При browser session за HTTPS nginx требуется корректный proxy protocol/IP setup. Иначе mutating admin request может получить `Cross-site administrative request rejected`.

Для одного nginx:

```dotenv
HTTP_TRUST_PROXY_HOPS=1
```

и:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Подробнее: [deployment.md](deployment.md) и [admin-security.md](admin-security.md).
