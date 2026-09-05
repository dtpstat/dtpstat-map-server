# Переносимый KML линий

Переносимый KML предназначен для полного round-trip набора линий между экземплярами приложения.
Он отличается от внешнего KML / Google My Maps импорта: внешний источник не обязан содержать служебные metadata, а переносимый KML всегда содержит полный справочник бизнес-типов и стилей.

## Два независимых понятия

Геометрический тип и бизнес-тип линии никогда не смешиваются:

- геометрический тип: KML `LineString` / `MultiGeometry` (в GeoJSON — `LineString` / `MultiLineString`);
- бизнес-тип: `BUSLANES.LINE_TYPES.CODE`, на который в БД ссылается `CITY_GEOMETRIES.LINE_TYPE_ID`.

Текстовое имя бизнес-типа в геометрии не хранится.

## Справочник типов и стилей

В `Document/ExtendedData` находится один авторитетный property:

```text
dtpstat.businessLineTypes
```

Его значение — JSON:

```json
{
  "schemaVersion": 1,
  "lineTypes": [
    {
      "code": "one-way",
      "name": "Односторонние",
      "color": "#cc4400",
      "style": "dashed",
      "width": 5
    }
  ]
}
```

`code` — стабильный бизнес-ключ. `name` — подпись легенды. `color`, `style`, `width` — оформление приложения.

Дополнительно KML содержит обычные `<Style>` с цветом и толщиной, чтобы файл был удобнее открывать во внешних KML-просмотрщиках. Они не являются источником истины: стандартный KML не умеет полноценно передавать наши `dashed` / `dotted`, поэтому приложение восстанавливает оформление только из `dtpstat.businessLineTypes`.

## Placemark

Каждая линия содержит отдельные metadata:

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

`dtpstat.businessTypeCode` ссылается только на `lineTypes[].code`.

`dtpstat.multiple` — статистический множитель 1/2. Он не является стилем и не определяет геометрический тип.

Геометрия Placemark хранится отдельно обычными KML-элементами `LineString`/`MultiGeometry`.

## Порядок импорта

Импорт выполняется в строгом порядке:

1. XML и `Document/ExtendedData` проверяются до запуска DB-задачи.
2. Полностью читается и валидируется `dtpstat.businessLineTypes`.
3. Проверяются уникальность `code`, уникальность `name` без учёта регистра и внешних пробелов, цвет, стиль и ширина.
4. Только после успешной проверки справочника читаются Placemark и их геометрии.
5. Каждый `businessTypeCode` проверяется на наличие в словаре.
6. В одной DB-транзакции синхронизируется справочник, затем линии получают `LINE_TYPE_ID` по `CODE`.

При любой ошибке словаря или ссылок линии не заменяются.

## API

Экспорт:

```text
GET /api/admin/export/lines.kml
```

Импорт:

```text
POST /api/admin/import/lines.kml
Content-Type: application/vnd.google-earth.kml+xml
```

Оба endpoint защищены тем же Basic Auth, что и остальные административные операции.
