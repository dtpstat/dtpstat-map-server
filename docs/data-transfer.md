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
- boundary-owned `population/populationAsOf/populationSource/attributes`;
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

Население и связанные с ним attributes хранятся независимо от флага
`active`. Импорт населения никогда не активирует и не деактивирует OSM-объекты.

Для активных boundaries сервер отдельно синхронизирует рабочую проекцию
`CITY_POPULATIONS`, которую используют отчёты и public API.

## Export

```text
GET /api/admin/export/populations
```

Файлы:

- `GET /api/admin/export/populations` → `populations.json`;
- `GET /api/admin/export/populations.zip` → `populations.zip`, внутри ровно один `populations.json`.

Canonical format — `schemaVersion: 3`. Он сохраняет переносимую source
identity `osmType + osmId` для региона и города, но локальный
`CITY_BOUNDARIES.ID` никогда не экспортируется.

Import остаётся обратно совместим с `schemaVersion: 2` и с v3-записями, где
`osmType/osmId` отсутствуют целиком. В таком случае используется прежнее
сопоставление по нормализованным именам. Если identity присутствует, exact
`osmType + osmId` имеет приоритет и name fallback для этой записи не
используется.

```json
{
  "schemaVersion": 3,
  "exportedAt": "2026-09-22T12:00:00.000Z",
  "asOf": "2026-01-01",
  "source": "Росстат",
  "regions": [
    {
      "name": "Республика Татарстан",
      "osmType": "relation",
      "osmId": "79374",
      "attributes": {
        "federalDistrict": "Приволжский федеральный округ"
      },
      "cities": [
        {
          "name": "Казань",
          "osmType": "relation",
          "osmId": "337422",
          "population": 1320000,
          "attributes": {}
        },
        {
          "name": "Набережные Челны",
          "osmType": "relation",
          "osmId": "308525",
          "population": 544000,
          "asOf": "2025-01-01",
          "source": "Татарстанстат",
          "attributes": {}
        }
      ]
    }
  ]
}
```

На уровне региона обязательны `name` и непустой `cities[]`; `attributes`
необязателен и по умолчанию равен `{}`. Поля `osmType/osmId` необязательны,
но должны либо присутствовать парой, либо отсутствовать оба.

У города обязательны `name` и `population`. `population` может быть
`null`, что очищает население найденного города. `asOf/source` могут
наследоваться от top-level значений или переопределяться для конкретного
города. `attributes` необязателен и по умолчанию равен `{}`.
`osmType/osmId` также являются необязательной парой.

Поле `active` в population format отсутствует намеренно.

## Import

```text
POST /api/admin/populations
Content-Type: application/json

# или
POST /api/admin/populations
Content-Type: application/zip
```

Import:

1. потоково читает top-level `regions[]`;
2. если у записи есть пара `osmType + osmId`, сопоставляет exact OSM object;
   если пары нет — использует legacy name matching без учёта регистра, `ё/е`,
   пробелов и пунктуации;
3. duplicate detection использует OSM identity, когда она есть, поэтому разные
   OSM objects с одинаковым именем не схлопываются; для legacy записей без
   identity сохраняется name-based duplicate detection;
4. невалидный отдельный регион/город пропускает с warning, не отменяя
   корректную часть файла;
5. exact identity региона ищется среди `admin_level=4` boundaries; без
   identity регион ищется по имени;
6. exact identity города ищется только внутри поддерева найденного региона; без
   identity город ищется там же по имени;
7. отсутствующие и неоднозначные fallback-сопоставления пропускаются с warning;
8. обновляет `population/asOf/source/attributes` только успешно
   сопоставленных городов и `attributes` успешно найденных регионов;
9. не изменяет `IS_ACTIVE`;
10. синхронизирует активную проекцию `CITY_POPULATIONS`, пересчитывает
    статистику и фиксирует корректную часть одной транзакцией.

Если хотя бы одна запись была пропущена, task технически завершается
`succeeded`, но result содержит `partial: true`, а журнал получает
`WARNING Задача завершена с предупреждениями`. Полный rollback остаётся для
ошибок всего документа/transport (битый JSON/ZIP, несовместимый
`schemaVersion`, превышение лимитов), отмены задачи и неожиданных ошибок БД.

Пример result:

```json
{
  "regions": 84,
  "requestedRegions": 85,
  "cities": 1117,
  "requestedCities": 1119,
  "normalizedCities": 1119,
  "skippedCount": 2,
  "warningCount": 2,
  "partial": true,
  "skippedCities": [
    "Примерная область / Город не найден",
    "Другая область / Неоднозначный город"
  ],
  "warnings": [
    {
      "code": "city-missing",
      "scope": "city",
      "regionName": "Примерная область",
      "cityName": "Город не найден",
      "skipped": true
    }
  ]
}
```

# Streaming JSON / ZIP и body limits

Большие portable city/line/population transfers **не проходят через
`express.json()`**. HTTP body сначала потоково записывается как сжатый/raw
spool-файл в `var/import-staging`, после чего background admin task читает его
потоком. Распакованный JSON целиком ни на диск, ни в RAM не создаётся.

Streaming parser сканирует уже декодированные chunks пакетно, без
посимвольного async-loop. Для длинного одиночного JSON item byte-progress
публикуется прямо во время чтения потока, а city-boundary import перед каждым
PostgreSQL/PostGIS staging batch отдельно публикует фазу `stage-write`.
Поэтому UI различает собственно чтение JSON и ожидание DB batch.

Для raw JSON/GeoJSON по-прежнему поддерживаются HTTP `gzip`, `deflate` и
`br`. ZIP передаётся как `Content-Type: application/zip` без дополнительного
`Content-Encoding`.

ZIP-контракт намеренно строгий:

- после игнорирования directory entries должна остаться ровно **одна**
  ordinary data entry;
- имя и расширение этой entry не определяют формат: допустимы, например,
  `stdin`, `payload/data` и даже anonymous entry с пустым именем, который
  создаёт `7z ... -si` без явного имени; JSON/GeoJSON определяется и
  валидируется по содержимому/schema;
- encryption и multi-volume ZIP не поддерживаются;
- поддерживаются Store и Deflate;
- поддерживаются classic ZIP и ZIP64, включая streamed archives с data
  descriptor, когда размер entry неизвестен в local header;
- проверяются CRC32, decoded size, central-directory consistency,
  максимальное число entries и compression ratio.

Сам HTTP request также может быть потоком без `Content-Length`
(`Transfer-Encoding: chunked`). Это позволяет подавать на endpoint ZIP,
который другой процесс формирует из stdin на лету. Сервер не собирает его в
RAM: на диск spoolятся только transport bytes архива, после чего единственная
data entry декодируется непосредственно в streaming JSON parser. Отдельный
распакованный JSON-файл не создаётся.

Лимиты:

```dotenv
# Старый лимит небольших JSON API; не используется как RAM-buffer для больших
# portable imports.
IMPORT_API_MAX_BODY_BYTES=26214400

# Размер входящего transport body: raw JSON, HTTP-compressed JSON или ZIP.
IMPORT_API_MAX_STREAM_UPLOAD_BYTES=8589934592

# Максимальный размер JSON после HTTP/ZIP decompression.
IMPORT_API_MAX_STREAM_JSON_BYTES=34359738368

# Максимальный размер одного feature/population JSON value.
IMPORT_API_MAX_STREAM_ITEM_BYTES=134217728

# ZIP-bomb / archive structure limits.
IMPORT_API_MAX_STREAM_ZIP_RATIO=1000
IMPORT_API_MAX_STREAM_ZIP_ENTRIES=64

# Streaming JSON complexity limits.
IMPORT_API_MAX_STREAM_JSON_DEPTH=128
IMPORT_API_MAX_STREAM_JSON_ITEMS=5000000
```

Для nginx `client_max_body_size` должен быть **не меньше**
`IMPORT_API_MAX_STREAM_UPLOAD_BYTES` (либо выбранного production значения).
Например для лимита 8 GiB нужно настраивать nginx соответственно, а не оставлять
старые `30m`. Для действительно streaming/chunked upload также необходимо,
чтобы reverse proxy не буферизовал request body целиком собственной политикой.

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

Пример готового ZIP:

```bash
curl --fail-with-body \
  --user "$AUTH" \
  -X POST \
  -H 'Content-Type: application/zip' \
  --data-binary @cities.zip \
  https://target.example/api/admin/import/cities
```

То же API принимает ZIP из pipe/stdin: upstream ZIP producer пишет archive
bytes в stdout, а `curl --data-binary @-` передаёт их без промежуточного
JSON-файла на стороне сервера. Имя единственной data entry может быть
`stdin`; расширение `.json` не требуется.

После полного приёма transport stream сервер отвечает `202` и запускает
admin task. Полный transport body не держится в heap; spool нужен для проверки
ZIP central directory/ZIP64 metadata перед транзакционным чтением JSON.
Синтаксическая ошибка JSON, неправильный ZIP, несовместимый schema, системная
DB/PostGIS ошибка или отмена задачи переводят task в `failed/cancelled`;
такие ошибки делают `ROLLBACK` целиком. Ошибки отдельных записей population
import являются best-effort warnings: проблемные записи не попадают в staging,
а валидная часть той же транзакции коммитится. Временный spool удаляется после завершения task, а orphan
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
