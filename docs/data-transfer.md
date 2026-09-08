# Перенос и синхронизация данных

Admin API переносит три независимых набора source data:

1. OSM city/town boundaries — GeoJSON;
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

Текущий settings format: `schemaVersion 6`.

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

Файл: `cities.geojson`.

Portable city snapshot содержит OSM provenance и, если boundary уже связан с application city, переносимые city fields.

Boundary properties включают:

- `placeType` (`city`/`town`);
- `osmType` (`way`/`relation`);
- `osmId`;
- `osmName`;
- OSM tags/timestamp;
- geometry `Polygon`/`MultiPolygon`;
- linked city slug/name/fullName/attributes.

## Import

```text
POST /api/admin/import/cities
Content-Type: application/geo+json
```

Import:

1. валидирует FeatureCollection;
2. загружает temporary staging пакетами;
3. проверяет PostGIS geometry validity/area;
4. сохраняет существующие line-to-boundary references по OSM provenance, где это возможно;
5. заменяет `CITY_BOUNDARIES` в transaction;
6. применяет DB normalization `V023`;
7. пересчитывает report/public snapshots после успешного real update.

### Логический город после V023

`CITY_BOUNDARIES.FULL_NAME` вычисляется как:

```text
addr:district
→ name:ru
→ osm_name
```

Для `OSM_TYPE='relation'` несколько source rows с одинаковыми:

```text
PLACE_TYPE + FULL_NAME
```

объединяются в один `MultiPolygon` через `ST_UnaryUnion(ST_Collect(...))`.

Таким образом `osmType + osmId` остаётся **source provenance/portable-transfer key**, но не является identity логического города после relation normalization.

Когда normalized boundary связан с `CITIES.ID`, его `FULL_NAME` синхронизируется в `CITIES.FULL_NAME`. Короткое `CITIES.NAME` остаётся отдельным display/import name.

# Линии и LINE_TYPES

## GeoJSON export

```text
GET /api/admin/export/lines
```

Файл: `lines.geojson`.

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

Файл: `populations.json`.

Для каждой записи переносятся name/citySlug/population/asOf/source/attributes.

## Import

```text
POST /api/admin/populations
Content-Type: application/json
```

Population snapshot может содержать города, отсутствующие в target `cities`. Такие entries пропускаются без падения всей операции.

Result содержит, в частности:

```json
{
  "cities": 71,
  "requestedCities": 72,
  "skippedCount": 1,
  "skippedCities": ["Киров"]
}
```

Invalid population values, conflicts и malformed payload по-прежнему являются ошибками.

# Compression и body limits

Application limit крупных protected imports:

```dotenv
IMPORT_API_MAX_BODY_BYTES=26214400
```

Если используется nginx:

```nginx
client_max_body_size 30m;
```

Admin exports поддерживают HTTP compression. Import body может быть gzip-compressed, например:

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
