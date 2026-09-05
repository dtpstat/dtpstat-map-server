# Перенос и синхронизация данных

Сервер поддерживает перенос трёх независимых наборов данных без повторного обращения к Overpass:

1. OSM города/посёлки и их полигоны — GeoJSON.
2. Линии выделенных полос — GeoJSON.
3. Население — JSON.

Все transfer-endpoint защищены теми же `IMPORT_API_USERNAME` / `IMPORT_API_PASSWORD`, что и остальные admin-операции.

## Порядок переноса на новый сервер

Для полного переноса рекомендуется порядок:

1. города;
2. линии;
3. население.

Линии versioned-экспорта содержат переносимую ссылку на OSM-полигон (`osmType` + `osmId`). Если такой полигон отсутствует на принимающем сервере, импорт линий завершается ошибкой и предлагает сначала загрузить снимок городов.

Локальные surrogate ID таблиц (`cities.id`, `city_boundaries.id`) в формат переноса не входят и между серверами совпадать не обязаны.

## Города

### Экспорт

```text
GET /api/admin/export/cities
```

Файл: `dtpstat-buslines-cities.geojson`.

GeoJSON содержит полный снимок `city_boundaries`. Для каждого Feature передаются:

- `placeType` — `city` или `town`;
- `osmType` — `way` или `relation`;
- `osmId`;
- `osmName`;
- полный объект OSM `tags`;
- `osmTimestamp`;
- `updatedAt`;
- необязательные `citySlug` и `cityName` для связи с рейтинговым городом;
- Polygon/MultiPolygon geometry.

В корне находятся `schemaVersion: 1` и `exportedAt`.

### Импорт

```text
POST /api/admin/import/cities
Content-Type: application/geo+json
```

Необязательный query-параметр:

```text
dryRun=true
```

Импорт проверяет весь снимок и атомарно заменяет `city_boundaries`. Существующие связи линий с полигонами сохраняются по естественному OSM-ключу `osmType/osmId`.

## Линии

### Экспорт

```text
GET /api/admin/export/lines
```

Файл: `dtpstat-buslines-lines.geojson`.

Кроме исходных properties каждая линия получает актуальные `lanes`, `length`, `lanes_length` и служебный объект:

```json
{
  "_dtpstat": {
    "citySlug": "...",
    "boundaryOsmType": "relation",
    "boundaryOsmId": 123456
  }
}
```

Эти значения нужны только для точного round-trip между серверами; локальные ID БД не передаются.

### Импорт

Канонический endpoint:

```text
POST /api/admin/import/lines
Content-Type: application/geo+json
```

Старый endpoint `/api/admin/import` оставлен как совместимый alias.

Импорт полностью заменяет `city_geometries`, восстанавливает `city_id` и `boundary_id` по переносимым ключам и заново рассчитывает длины и рейтинг PostGIS.

## Население

### Экспорт

```text
GET /api/admin/export/populations
```

Файл: `dtpstat-buslines-populations.json`.

Для каждого города сохраняются:

- `name`;
- `citySlug`;
- `population`;
- `asOf`;
- `source`;
- `attributes`.

### Импорт

```text
POST /api/admin/populations
Content-Type: application/json
```

Старый формат с общими `asOf` и `source` в корне остаётся совместимым. Экспортный формат может хранить разные `asOf`/`source` у отдельных городов и импортирует их без потери.

## HTTP compression

### Ответы сервера

Экспортные ответы проходят через HTTP content negotiation. Если клиент отправляет:

```text
Accept-Encoding: gzip
```

достаточно большой JSON/GeoJSON будет передан с `Content-Encoding: gzip`. Также middleware может согласовать `br` или `deflate`.

Например `curl --compressed` автоматически объявляет поддержку сжатия и распаковывает ответ:

```bash
curl --fail-with-body --compressed \
  --user "$IMPORT_API_USERNAME:$IMPORT_API_PASSWORD" \
  --output cities.geojson \
  "https://source.example/api/admin/export/cities"
```

### Сжатые запросы

JSON/GeoJSON import-endpoint принимают сжатое тело запроса. Для gzip:

```bash
gzip -c cities.geojson | curl --fail-with-body \
  --user "$IMPORT_API_USERNAME:$IMPORT_API_PASSWORD" \
  --request POST \
  --header "Content-Type: application/geo+json" \
  --header "Content-Encoding: gzip" \
  --data-binary @- \
  "https://target.example/api/admin/import/cities"
```

Аналогично работают `/api/admin/import/lines` и `/api/admin/populations`.

Web-admin использует `CompressionStream('gzip')` для JSON/GeoJSON upload размером от 1 KiB, если API доступен браузеру; иначе автоматически отправляет обычное несжатое тело.

## Пример полного переноса

```bash
AUTH="$IMPORT_API_USERNAME:$IMPORT_API_PASSWORD"

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

Все mutating admin-операции по-прежнему проходят через общий single-task guard: одновременно выполняется только одна операция обновления.
