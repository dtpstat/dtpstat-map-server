# Перенос и синхронизация данных

Admin API переносит три независимых набора source data:

1. OSM place/admin boundaries — GeoJSON;
2. линии + dictionary business line types — GeoJSON или portable KML;
3. население — JSON.

Для операций нужен `CAN_MANAGE_DATA` или superuser.

Public GeoJSON/CSV snapshots **не являются backup/round-trip форматом**. Их имя и URL зависят от `PROJECT_SETTINGS.PUBLIC_DOWNLOAD_NAME`; для переноса используйте `/api/admin/export/*`.

## Отдельно переносится конфигурация

Project/UI/security settings экспортируются отдельно:

```text
GET  /api/admin/settings/export
POST /api/admin/settings/import
```

Текущий settings format: `schemaVersion 7`.

Подробнее: [project-settings-transfer.md](project-settings-transfer.md).

## Рекомендуемый порядок на новом экземпляре

```text
1. cities
2. lines
3. populations
```

`CITY_REPORT_VALUES` не переносится и после изменений строится заново по текущему `REPORT_CONFIG`.

# Города

## Export

```text
GET /api/admin/export/cities
```

Файлы:

- `GET /api/admin/export/cities` → `cities.geojson`;
- `GET /api/admin/export/cities.zip` → `cities.zip`, внутри ровно один `cities.geojson`.

Оба варианта формируются потоково; полный FeatureCollection не собирается в памяти Node.

Portable city snapshot содержит OSM provenance и, если boundary уже связан с application city, переносимые city fields.

Boundary properties schemaVersion 2 включают:

- `placeType` (`city`/`town`/null);
- `adminLevel`;
- `active`;
- `displayName` / `displayType`;
- `osmType` (`way`/`relation`);
- `osmId`;
- `osmName`;
- OSM tags/timestamp;
- geometry `Polygon`/`MultiPolygon`;
- linked city slug/name/fullName/displayType/attributes.

## Import

```text
POST /api/admin/import/cities
Content-Type: application/geo+json

# или
POST /api/admin/import/cities
Content-Type: application/zip
```

Import:

1. валидирует FeatureCollection;
2. загружает temporary staging пакетами;
3. проверяет PostGIS geometry validity/area;
4. сохраняет существующие line-to-boundary references по OSM provenance, где это возможно;
5. атомарно заменяет `CITY_BOUNDARIES`;
6. пересчитывает hierarchy по полному `ST_Covers`;
7. синхронизирует application cities только с активными boundaries;
8. пересчитывает city statistics, report/public snapshots.

### Identity и hierarchy после V027

`osmType + osmId` — identity исходного OSM объекта. Разные relations не
объединяются по имени. Пользовательская identity активного объекта задаётся
отдельно через `displayType + displayName`; среди активных она уникальна после
нормализации регистра и пробелов.

`parentId` является производным и в portable snapshot не считается authority:
после импорта дерево строится заново по геометрическому containment.

# Линии и LINE_TYPES

## GeoJSON export

```text
GET /api/admin/export/lines
```

Файлы:

- `GET /api/admin/export/lines` → `lines.geojson`;
- `GET /api/admin/export/lines.zip` → `lines.zip`, внутри ровно один `lines.geojson`.

JSON и ZIP формируются потоково.

Canonical format содержит versioned dictionary `lineTypes` и geometry metadata.

Business type identity переносится так:

```text
source businessTypeCode
→ source lineTypes[].code
→ source NAME
→ target lookup by normalized NAME
→ target local LINE_TYPE_ID/CODE
```

Numeric `CODE` не является глобальным ID между deployments.

Если target NAME существует, его local CODE сохраняется, а presentation fields обновляются. Если NAME отсутствует — создаётся новая row с target-generated CODE.

`TITLE` в identity не участвует.

## Line name

KML `<Placemark><name>` сохраняется как:

```text
CITY_GEOMETRIES.PROPERTIES.placemarkName
```

Public map может показывать это значение:

- постоянно при `SHOW_LINE_LABELS=true`;
- в hover-popup при `SHOW_LINE_POPUPS=true`.

Режимы независимы.

## GeoJSON import

```text
POST /api/admin/import/lines
Content-Type: application/geo+json

# или
POST /api/admin/import/lines
Content-Type: application/zip
```

Legacy alias:

```text
POST /api/admin/import
```

Полный snapshot синхронизирует dictionary типов и заменяет `CITY_GEOMETRIES` транзакционно.

# Внешний KML / Google My Maps

Это import source, а не portable round-trip format.

Пример source config:

```json
[
  {
    "URL": "https://www.google.com/maps/d/viewer?mid=...",
    "layers": [
      { "name": "Обособленные", "multiple": 1, "type": "Обособленные" },
      { "name": "Совмещённые", "multiple": 1, "type": "Совмещённые" }
    ]
  }
]
```

Здесь:

- `multiple` — статистический multiplier;
- `type` — `LINE_TYPES.NAME`;
- отсутствующий NAME создаётся автоматически;
- `<Placemark><name>` становится `placemarkName`.

# Portable KML

Export:

```text
GET /api/admin/export/lines.kml
```

Import:

```text
POST /api/admin/import/lines.kml
Content-Type: application/vnd.google-earth.kml+xml
```

Portable KML использует тот же NAME-based business-type matching, что GeoJSON.

Подробнее: [kml-transfer.md](kml-transfer.md).

# Население

## Export

```text
GET /api/admin/export/populations
```

Файлы:

- `GET /api/admin/export/populations` → `populations.json`;
- `GET /api/admin/export/populations.zip` → `populations.zip`, внутри ровно один `populations.json`.

Для каждой записи переносятся type/name/citySlug/population/asOf/source/attributes.

## Import

```text
POST /api/admin/populations
Content-Type: application/json

# или
POST /api/admin/populations
Content-Type: application/zip
```

Population matching выполняется только по активным OSM boundaries. Основная
identity — нормализованные `type + name` без учёта регистра и whitespace.
Legacy запись без `type` принимается только если имя соответствует ровно одному
активному объекту; неоднозначные записи не угадываются.

Записи без совпадения пропускаются без падения всей операции.

Result содержит, в частности:

```json
{
  "cities": 71,
  "requestedCities": 72,
  "skippedCount": 1,
  "skippedCities": ["Киров"],
  "ambiguousCount": 0,
  "ambiguousCities": []
}
```

Invalid population values, conflicts и malformed payload по-прежнему являются ошибками.

# Streaming JSON / ZIP и body limits

Большие portable city/line/population transfers **не проходят через
`express.json()`**. HTTP body сначала потоково записывается как сжатый/raw
spool-файл в `var/import-staging`, после чего background admin task читает его
потоком. Распакованный JSON целиком ни на диск, ни в RAM не создаётся.

Для raw JSON/GeoJSON по-прежнему поддерживаются HTTP `gzip`, `deflate` и
`br`. ZIP передаётся как `Content-Type: application/zip` без дополнительного
`Content-Encoding`.

ZIP-контракт намеренно строгий:

- ровно **одна** file entry;
- каталогов и путей внутри archive быть не должно;
- encryption и multi-volume ZIP не поддерживаются;
- поддерживаются Store и Deflate;
- проверяются CRC32 и declared decoded size;
- ZIP64 не принимается: ZIP transfer ограничен ZIP32 (< 4 GiB). Для больших
  объёмов до configured raw JSON limit можно использовать обычный streaming
  JSON/GeoJSON без ZIP.

Лимиты:

```dotenv
# Старый лимит небольших JSON API; не используется как RAM-buffer для больших
# portable imports.
IMPORT_API_MAX_BODY_BYTES=26214400

# Размер входящего transport body: raw JSON, HTTP-compressed JSON или ZIP.
IMPORT_API_MAX_STREAM_UPLOAD_BYTES=2147483648

# Максимальный размер JSON после HTTP/ZIP decompression.
IMPORT_API_MAX_STREAM_JSON_BYTES=3221225472

# Максимальный размер одного feature/population JSON value.
IMPORT_API_MAX_STREAM_ITEM_BYTES=134217728
```

Для nginx `client_max_body_size` должен быть **не меньше**
`IMPORT_API_MAX_STREAM_UPLOAD_BYTES` (либо выбранного production значения).
Например для лимита 2 GiB нужно настраивать nginx соответственно, а не оставлять
старые `30m`.

Пример raw gzip:

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

Пример ZIP:

```bash
curl --fail-with-body \
  --user "$AUTH" \
  -X POST \
  -H 'Content-Type: application/zip' \
  --data-binary @cities.zip \
  https://target.example/api/admin/import/cities
```

После полного приёма HTTP upload сервер отвечает `202` и запускает admin task.
Синтаксическая ошибка JSON, неправильный ZIP, schema/PostGIS ошибка или отмена
задачи переводят task в `failed/cancelled`; DB import выполняется в одной
транзакции и делает `ROLLBACK` целиком. Уже изменённые production rows при
ошибке не остаются. Временный spool удаляется после завершения task, а orphan
spools после process crash чистятся при следующем startup (старше 24 часов).

# Single-task guard

Длительные mutating операции **Управления данными** проходят через process-local single-task guard одного Node instance.

После успешной real operation:

```text
source data commit
→ CITY_REPORT_VALUES refresh
→ var/public-downloads snapshots refresh
```

`dryRun` не должен менять source data или public snapshots.

# Public snapshots

Runtime files имеют имя из `PROJECT_SETTINGS.PUBLIC_DOWNLOAD_NAME`.

Например:

```text
PUBLIC_DOWNLOAD_NAME = tram-lines
```

даёт:

```text
var/public-downloads/tram-lines.geojson
var/public-downloads/tram-lines.csv
/tram-lines.geojson
/tram-lines.csv
```

При rename старые `.csv/.geojson` snapshots удаляются. Public URLs старого имени не сохраняются.

# Reverse proxy

Для browser session за одним HTTPS nginx:

```dotenv
HTTP_TRUST_PROXY_HOPS=1
```

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Подробнее: [deployment.md](deployment.md) и [admin-security.md](admin-security.md).
