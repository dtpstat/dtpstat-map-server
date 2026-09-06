# Переносимый KML линий

Переносимый KML предназначен для полного round-trip линий между экземплярами `dtpstat-map-server`. Он отличается от импорта внешнего KML / Google My Maps: внешний источник передаёт исходные слои и их Placemark, а переносимый KML содержит полный словарь бизнес-типов и служебные ссылки, необходимые для точного восстановления.

## Геометрический и бизнес-тип

Это независимые понятия:

- геометрический тип: KML `LineString` / `MultiGeometry`;
- бизнес-тип: запись `LINE_TYPES`, на которую `CITY_GEOMETRIES` ссылается через локальный `LINE_TYPE_ID`.

PostGIS/KML geometry type никогда не используется как business type.

## Актуальный формат

Канонический переносимый KML имеет `schemaVersion: 2`.

В `Document/ExtendedData` находится:

```text
dtpstat.businessLineTypes
```

Его значение — JSON-словарь, например:

```json
{
  "schemaVersion": 2,
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

Поля:

- `code` — числовой source CODE;
- `name` — source/import identity;
- `title` — подпись легенды;
- `color`, `style`, `width` — оформление приложения.

Обычные KML `<Style>` также записываются для внешних viewers, но не являются источником истины. Стандартный KML не описывает полностью наши `dashed` / `dotted`, поэтому round-trip style восстанавливается из `dtpstat.businessLineTypes`.

## Placemark metadata и имя линии

Каждая линия может содержать:

```text
dtpstat.businessTypeCode
dtpstat.multiple
dtpstat.citySlug
dtpstat.cityName
dtpstat.cityFullName
dtpstat.boundaryOsmType
dtpstat.boundaryOsmId
dtpstat.properties
```

`dtpstat.businessTypeCode` — numeric source reference на `lineTypes[].code` внутри этого KML.

`dtpstat.multiple` — статистический множитель `1`/`2`, а не визуальная толщина и не geometry type.

Сама геометрия хранится обычным `LineString` или `MultiGeometry`.

Имя исходной линии хранится как source property:

```text
placemarkName
```

Для **внешнего** KML / Google My Maps оно берётся непосредственно из:

```xml
<Placemark>
  <name>Проспект Мира</name>
  ...
</Placemark>
```

и сохраняется в `CITY_GEOMETRIES.PROPERTIES.placemarkName`.

При portable round-trip настоящее `placemarkName` входит в `dtpstat.properties`, поэтому сохраняется независимо от локальных ID. Это важно: видимый `<Placemark><name>` переносимого KML может быть сгенерирован как удобная подпись, если исходного имени линии нет. Поэтому для portable KML источником истины является `dtpstat.properties.placemarkName`, а не любой текст `<name>`.

На публичной карте непустой `placemarkName` всегда может показываться в popup при наведении мыши на линию. Для popup используется текстовый API Mapbox (`setText`), поэтому содержимое KML name не интерпретируется как HTML.

Дополнительно `PROJECT_SETTINGS.SHOW_LINE_LABELS` управляет постоянными symbol-подписями вдоль линии. Галочка находится в **Настройка интерфейса → Проект → «Отображать подписи линий на карте»**. Она не отключает hover-popup: это два независимых способа отображения одного `placemarkName`.

Не следует использовать обычное GeoJSON `properties.name` для имени линии: в канонических transfer-данных это поле уже используется для полного названия города.

## Почему CODE не является глобальным ID

Два экземпляра могут иметь разные локальные числовые CODE для одного и того же бизнес-типа. Поэтому импорт **не** выполняет `source CODE == target CODE`.

Порядок:

1. XML и `Document/ExtendedData` проверяются до изменения БД;
2. полностью валидируется `dtpstat.businessLineTypes`;
3. проверяются source CODE, NAME, TITLE, цвет, стиль и ширина;
4. каждый Placemark `businessTypeCode` разрешается в source dictionary;
5. source CODE преобразуется в source `NAME`;
6. target type ищется по нормализованному NAME без учёта регистра и внешних пробелов;
7. для существующего NAME сохраняется локальный target CODE, обновляются TITLE/style-поля;
8. для нового NAME запись создаётся без ручного CODE — CODE назначает target DB;
9. геометрия получает локальный target `LINE_TYPE_ID`.

`TITLE` в matching не участвует.

## Legacy compatibility

Поддерживается старый portable KML `schemaVersion: 1`, где code был строковым source identifier. При чтении такой словарь переводится в актуальную модель: старый code трактуется как imported `NAME`, после чего используется обычное NAME-based сопоставление.

## API

Экспорт:

```text
GET /api/admin/export/lines.kml
```

Скачиваемое имя:

```text
lines.kml
```

Импорт:

```text
POST /api/admin/import/lines.kml
Content-Type: application/vnd.google-earth.kml+xml
```

Также принимаются `application/xml` и `text/xml`.

Оба endpoint требуют DB-admin с `CAN_MANAGE_DATA` либо superadmin. HTTP Basic является транспортом credentials; после bootstrap проверка выполняется по `ADMIN_USERS`.

Импорт участвует в общем single-task guard раздела **Управление данными** и выполняет замену линий в транзакции.

## Внешний KML — другое правило

Для обычного KML / Google My Maps конфигурация слоя выглядит, например, так:

```json
{ "name": "Односторонние", "multiple": 1, "type": "Односторонние" }
```

Поле `type` там является `LINE_TYPES.NAME`, а не `businessTypeCode`. Если NAME отсутствует в target DB, он создаётся автоматически, БД генерирует CODE, начальный TITLE равен NAME.

Для каждого выбранного линейного Placemark также сохраняется его стандартный KML `<name>` как `placemarkName`. Пустое или отсутствующее имя не создаёт hover-popup и постоянную line-label.

То есть `dtpstat.businessTypeCode` используется только в переносимом snapshot с собственным словарём; внешний KML работает по source NAME.
