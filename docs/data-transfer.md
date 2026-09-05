# Перенос и синхронизация данных

Сервер поддерживает перенос трёх независимых наборов данных без повторного обращения к Overpass:

1. OSM города/посёлки и их полигоны — GeoJSON.
2. Линии и справочник их типов/стилей — GeoJSON.
3. Население — JSON.

Все transfer-endpoint защищены теми же `IMPORT_API_USERNAME` / `IMPORT_API_PASSWORD`, что и остальные admin-операции.

## Порядок переноса на новый сервер

Для полного переноса рекомендуется порядок:

1. города;
2. линии вместе с `line_types`;
3. население.

Линии versioned-экспорта содержат переносимую ссылку на OSM-полигон (`osmType` + `osmId`). Если такой полигон отсутствует на принимающем сервере, импорт линий завершается ошибкой и предлагает сначала загрузить снимок городов.

Локальные surrogate ID таблиц (`cities.id`, `city_boundaries.id`, `line_types.id`) в формат переноса не входят и между серверами совпадать не обязаны. Для типов линий переносимым ключом служит `line_types.code`, который в API и KML-конфигурации называется `type`.

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
- переносимые свойства связанного `cities`: `slug`, `name`, `fullName`, `attributes`;
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

## Линии и типы линий

### Экспорт

```text
GET /api/admin/export/lines
```

Файл: `dtpstat-buslines-lines.geojson`.

Актуальный формат имеет `schemaVersion: 2`. В корне находится полный переносимый справочник:

```json
{
  "lineTypes": [
    {
      "type": "default",
      "name": "Выделенные полосы",
      "color": "#045b69",
      "style": "solid",
      "width": 4
    },
    {
      "type": "tram",
      "name": "Трамвай",
      "color": "#cc4400",
      "style": "dashed",
      "width": 6
    }
  ]
}
```

`type` — стабильный переносимый ключ. `name` используется в легенде карты. Поддерживаемые стили: `solid`, `dashed`, `dotted`; `width` задаётся в пикселях и должен быть от `0.5` до `32`.

Кроме исходных properties каждая линия получает актуальные `lanes`, `length`, `lanes_length` и служебный объект:

```json
{
  "_dtpstat": {
    "citySlug": "...",
    "boundaryOsmType": "relation",
    "boundaryOsmId": 123456,
    "lineType": "tram"
  }
}
```

Эти значения нужны для точного round-trip между серверами; локальные ID БД не передаются.

### Импорт

Канонический endpoint:

```text
POST /api/admin/import/lines
Content-Type: application/geo+json
```

Старый endpoint `/api/admin/import` оставлен как совместимый alias.

Versioned GeoJSON v2 полностью заменяет `city_geometries`, синхронизирует `line_types`, восстанавливает `city_id`, `boundary_id` и `line_type_id` по переносимым ключам и заново рассчитывает длины и рейтинг PostGIS. Если импорт завершается ошибкой, все изменения откатываются одной транзакцией.

Legacy GeoJSON без `lineTypes` и `_dtpstat.lineType` остаётся совместимым: его линии получают тип `default`, а существующий справочник типов на сервере не удаляется.

## KML и `type`

Каждый выбранный KML-слой может задавать одновременно статистический множитель `multiple` и тип линии `type`:

```json
[
  {
    "URL": "https://www.google.com/maps/d/viewer?mid=...",
    "layers": [
      { "name": "Автобусные", "multiple": 2, "type": "bus" },
      { "name": "Трамвайные", "multiple": 1, "type": "tram" }
    ]
  }
]
```

`multiple` по-прежнему означает коэффициент длины `1` или `2` и не задаёт визуальную толщину. `type` ссылается на заранее настроенный `line_types.code`. Если `type` отсутствует, используется `default`. Если указан неизвестный тип, KML-import завершается ошибкой до замены линий.

Справочник типов редактируется в web-admin внутри вкладки линий. Для каждого типа настраиваются:

- переносимый ключ `type`;
- имя для легенды;
- цвет `#RRGGBB`;
- стиль `solid` / `dashed` / `dotted`;
- толщина.

Публичный клиент получает справочник через:

```text
GET /api/line-types
```

Если в `line_types` больше одной записи, на карте отображается легенда. Клик по её элементу динамически включает или отключает соответствующий тип без повторного запроса геометрий.

## Выбор геометрий по viewport

`GET /api/geometries` использует bbox только как условие отбора:

- сначала применяется GiST-предикат `geom && viewport`;
- затем точный `ST_Intersects(geom, viewport)`;
- выбранная линия возвращается **целиком**.

`ST_Intersection` с viewport не выполняется. Поэтому линия, пересекающая край текущего окна, больше не обрезается по этому краю.

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

Все mutating admin-операции по-прежнему проходят через общий single-task guard: одновременно выполняется только одна операция обновления. Изменение `line_types` не создаёт отдельную длительную задачу, но API запрещает его во время активного импорта/обновления.
