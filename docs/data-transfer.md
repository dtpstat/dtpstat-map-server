# Перенос и синхронизация данных

Admin API поддерживает перенос трёх независимых наборов без повторного обращения к исходным источникам:

1. OSM city/town и их границы — GeoJSON;
2. линии вместе со словарём бизнес-типов — GeoJSON или KML;
3. население — JSON.

Data-transfer endpoint требуют DB-пользователя с `CAN_MANAGE_DATA` либо superadmin. HTTP Basic передаёт credentials, но проверка выполняется по `ADMIN_USERS`; bootstrap ENV credentials после создания DB-user не являются отдельным fallback.

Публичные `/bus-lanes.geojson` и `/bus-lanes.csv` **не являются transfer/backup форматом**. Это упрощённые статические snapshots для пользователей страницы. Для round-trip используйте `/api/admin/export/*`.

## Что не переносится вместе с данными

Настройки конкретного экземпляра намеренно не входят в transfer-файлы городов, линий и населения. В частности отдельно настраиваются:

- `PROJECT_SETTINGS` — название, footer, keywords, analytics IDs и подписи линий;
- `REPORT_CONFIG` — расчётные метрики, публичная таблица, CSV и ranking;
- `ADMIN_SECURITY_SETTINGS`;
- deployment `.env`, включая `DATABASE_SCHEMA`, порты и секреты.

Это позволяет импортировать один и тот же набор исходных геометрий в проекты с разной бизнес-интерпретацией.

Если нужно перенести и DB-backed конфигурацию, superadmin использует отдельный `project-settings` package:

```text
GET  /api/admin/settings/export
POST /api/admin/settings/import
```

Он описан в [project-settings-transfer.md](project-settings-transfer.md). Пользователи, пароли и audit log в этот пакет не входят.

## Рекомендуемый порядок переноса данных

Для полного переноса данных на чистый экземпляр:

1. города;
2. линии;
3. население.

При необходимости после/до этого отдельно импортируется пакет настроек проекта. `CITY_REPORT_VALUES` не переносится как источник истины — он пересчитывается по данным целевого экземпляра и текущему `REPORT_CONFIG`.

Линии содержат переносимую ссылку на OSM boundary (`osmType` + `osmId`). Если нужной границы нет на принимающем сервере, импорт линий не должен молча привязывать геометрию к другому объекту.

Локальные surrogate ID (`cities.id`, `city_boundaries.id`, `line_types.id`) между серверами переноситься и совпадать не должны.

## Города

### Экспорт

```text
GET /api/admin/export/cities
```

Имя скачиваемого файла:

```text
cities.geojson
```

Формат — GeoJSON `FeatureCollection`, `schemaVersion: 1`. Для каждого Feature передаются:

- `placeType`: `city` или `town`;
- `osmType`: `way` или `relation`;
- `osmId`;
- `osmName`;
- OSM `tags`;
- `osmTimestamp`;
- `updatedAt`;
- переносимые данные связанного рейтингового города;
- `Polygon` / `MultiPolygon` geometry.

### Импорт

```text
POST /api/admin/import/cities
Content-Type: application/geo+json
```

Опционально:

```text
dryRun=true
```

Импорт сначала валидирует весь FeatureCollection, затем в одной транзакции staging-геометрии загружаются пакетами по 50 Feature. Это ограничивает размер одного PostgreSQL JSONB-параметра и memory spike на больших snapshots. После staging проверяется PostGIS validity, сохраняются существующие связи линий с OSM-объектами и выполняется атомарная замена `city_boundaries`.

Существующие line-to-boundary связи восстанавливаются по естественному ключу `osmType/osmId`.

## Линии и словарь типов

### Актуальный GeoJSON экспорт

```text
GET /api/admin/export/lines
```

Имя файла:

```text
lines.geojson
```

Канонический формат — `schemaVersion: 3`.

В корне передаётся словарь:

```json
{
  "schemaVersion": 3,
  "lineTypes": [
    {
      "code": 7,
      "name": "Односторонние",
      "title": "Односторонние полосы",
      "color": "#cc4400",
      "style": "dashed",
      "width": 5.5
    }
  ]
}
```

Семантика:

- `code` — числовой **source CODE**;
- `name` — стабильная source/import identity;
- `title` — подпись легенды;
- `color`, `style`, `width` — оформление.

Каждая геометрия содержит служебную ссылку:

```json
{
  "_dtpstat": {
    "businessTypeCode": 7,
    "citySlug": "...",
    "boundaryOsmType": "relation",
    "boundaryOsmId": 123456
  }
}
```

Исходные свойства `CITY_GEOMETRIES.PROPERTIES` также входят в admin GeoJSON. Поэтому, если линия пришла из KML с непустым `<Placemark><name>`, переносится дополнительное свойство:

```json
{
  "placemarkName": "Проспект Мира"
}
```

`placemarkName` — именно имя линии. Обычный `properties.name` в каноническом transfer GeoJSON используется для полного имени города и не должен трактоваться как подпись линии.

### Главное правило CODE/NAME

Числовой CODE переносим как компактную ссылку **внутри конкретного snapshot**, но source CODE не считается глобальным ID и не обязан совпадать с CODE в целевой БД.

Импорт выполняется так:

1. полностью разбирается и валидируется `lineTypes`;
2. source `businessTypeCode` разрешается в source dictionary;
3. из dictionary получается source `NAME`;
4. целевой `LINE_TYPES` ищется по нормализованному `NAME` — без учёта регистра и внешних пробелов;
5. если `NAME` уже существует, обновляются `TITLE` и style-поля, а локальный target `CODE` сохраняется;
6. если `NAME` отсутствует, он создаётся, target `CODE` генерирует БД;
7. геометрия получает локальный target `LINE_TYPE_ID`.

`TITLE` никогда не участвует в identity/matching.

### Импорт линий

```text
POST /api/admin/import/lines
Content-Type: application/geo+json
```

Старый `/api/admin/import` остаётся compatibility alias.

Полный versioned snapshot атомарно синхронизирует словарь и заменяет `city_geometries`, затем PostGIS пересчитывает длины и рейтинг. Source properties, включая `placemarkName`, сохраняются вместе с геометрией.

Поддерживается legacy GeoJSON v2: старый строковый `type` интерпретируется как imported `NAME`, а старое display `name` — как `TITLE`. Unversioned legacy geometry без business type получает `default`.

## Внешний KML / Google My Maps

Это **не** тот же формат, что переносимый KML.

Конфигурация источника может задавать:

```json
[
  {
    "URL": "https://www.google.com/maps/d/viewer?mid=...",
    "layers": [
      { "name": "Автобусные", "multiple": 2, "type": "Двусторонние" },
      { "name": "Односторонние", "multiple": 1, "type": "Односторонние" }
    ]
  }
]
```

Здесь:

- `multiple` — статистический множитель `1` или `2`;
- `type` — **source/import `LINE_TYPES.NAME`**, не numeric CODE;
- NAME сопоставляется без учёта регистра и внешних пробелов;
- отсутствующий NAME создаётся автоматически;
- новый `CODE` назначает БД;
- начальный `TITLE = NAME`.

Если `type` не указан, используется source NAME `default`.

Для каждого импортируемого линейного Placemark стандартный KML элемент:

```xml
<Placemark>
  <name>Проспект Мира</name>
  ...
</Placemark>
```

сохраняется как `CITY_GEOMETRIES.PROPERTIES.placemarkName`. Пустое/отсутствующее имя сохранять нечего. Публичный viewport API отдаёт source properties вместе с линией; frontend показывает непустой `placemarkName` в hover-popup и, если `PROJECT_SETTINGS.SHOW_LINE_LABELS=true`, постоянной подписью вдоль линии.

Popup использует Mapbox `setText`, без HTML-интерпретации.

## Переносимый KML

Экспорт:

```text
GET /api/admin/export/lines.kml
```

Импорт:

```text
POST /api/admin/import/lines.kml
Content-Type: application/vnd.google-earth.kml+xml
```

Имя файла:

```text
lines.kml
```

Переносимый KML использует тот же принцип numeric source CODE → dictionary NAME → target local type. Настоящее имя исходной линии переносится внутри `dtpstat.properties.placemarkName`; видимый `<Placemark><name>` может быть сгенерирован для удобства внешних viewers и сам по себе не является источником истины для line popup/label. Подробности: [kml-transfer.md](kml-transfer.md).

## Население

Экспорт:

```text
GET /api/admin/export/populations
```

Имя файла:

```text
populations.json
```

Импорт:

```text
POST /api/admin/populations
Content-Type: application/json
```

Для каждого города переносятся `name`, `citySlug`, `population`, `asOf`, `source`, `attributes`. Формат с общими `asOf`/`source` в корне также поддерживается как legacy input.

## Compression

### Ответы

Admin exports проходят через Express compression/content negotiation. Клиент может использовать:

```text
Accept-Encoding: gzip
```

Для shell-примеров ниже `ADMIN_USERNAME/ADMIN_PASSWORD` — credentials **DB-пользователя**, а не обязательные runtime ENV-переменные приложения:

```bash
AUTH="$ADMIN_USERNAME:$ADMIN_PASSWORD"

curl --fail-with-body --compressed \
  --user "$AUTH" \
  --output cities.geojson \
  "https://source.example/api/admin/export/cities"
```

### Сжатые запросы

JSON/GeoJSON import-endpoint принимают gzip/deflate/br через Express body parser. Пример gzip:

```bash
gzip -c cities.geojson | curl --fail-with-body \
  --user "$AUTH" \
  --request POST \
  --header "Content-Type: application/geo+json" \
  --header "Content-Encoding: gzip" \
  --data-binary @- \
  "https://target.example/api/admin/import/cities"
```

Web-admin при наличии `CompressionStream('gzip')` может сжимать крупные JSON/GeoJSON uploads в браузере.

## Пример полного переноса данных

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

Для этих операций пользователь должен иметь `CAN_MANAGE_DATA`.

## Single-task и производные публичные файлы

Все длительные mutating операции **управления данными** проходят через общий single-task guard: одновременно выполняется только одна такая задача. Это блокирует data-management UI, но не глобально весь интерфейс настроек.

После успешного реального изменения городов, линий или населения сервер сначала пересчитывает `CITY_REPORT_VALUES`, затем пересобирает статические public snapshots в `var/public-downloads/`. `dryRun` этого не делает.

Ошибки и прогресс data-операции доступны в её admin log/WebSocket. Завершение задачи также записывается в `ADMIN_AUDIT_LOG` с пользователем, IP, status и duration.
