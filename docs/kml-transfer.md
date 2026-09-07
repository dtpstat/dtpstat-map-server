# Переносимый KML линий

Portable KML предназначен для round-trip линий между экземплярами `dtpstat-map-server`. Он отличается от импорта внешнего KML / Google My Maps: внешний KML описывает исходные layers/Placemark, а portable format дополнительно содержит словарь business line types и служебные ссылки для точного восстановления.

## Геометрический и business type

Это независимые понятия:

- geometry type: `LineString` / `MultiGeometry`;
- business type: запись `LINE_TYPES`, на которую target geometry ссылается через local `LINE_TYPE_ID`.

KML/PostGIS geometry type никогда не используется как business type.

## Актуальный portable format

Канонический KML имеет:

```text
schemaVersion: 2
```

В `Document/ExtendedData` хранится:

```text
dtpstat.businessLineTypes
```

Значение — JSON dictionary, например:

```json
{
  "schemaVersion": 2,
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

Поля:

- `code` — source numeric CODE внутри snapshot;
- `name` — переносимая business identity;
- `title` — display title;
- `color/style/width` — application style.

Обычные KML `<Style>` могут записываться для внешних viewers, но не являются полным source of truth: стандартный KML не выражает всю внутреннюю семантику `dashed/dotted`.

## Placemark metadata

Для линии могут передаваться:

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

`businessTypeCode` указывает на source `lineTypes[].code` из того же document.

`multiple` — статистический множитель, а не visual width и не geometry type.

## Имя линии

Source line name хранится как:

```text
placemarkName
```

Для внешнего KML он берётся из:

```xml
<Placemark>
  <name>Проспект Мира</name>
  ...
</Placemark>
```

и сохраняется в:

```text
CITY_GEOMETRIES.PROPERTIES.placemarkName
```

Для portable round-trip property находится внутри `dtpstat.properties`. Именно оно является source of truth.

Видимый `<Placemark><name>` portable KML может быть сгенерирован для удобства viewer и не должен автоматически считаться исходным line label.

Public map использует `placemarkName` двумя независимыми способами:

- как hover-popup при `PROJECT_SETTINGS.SHOW_LINE_POPUPS=true`;
- как постоянную подпись вдоль линии при `PROJECT_SETTINGS.SHOW_LINE_LABELS=true`.

Оба режима можно включать и отключать независимо. Popup выводит текст без HTML interpretation.

## Почему CODE не глобальный

Два deployments могут иметь разные numeric CODE для одного business type. Поэтому import не делает:

```text
source CODE == target CODE
```

Алгоритм:

```text
source businessTypeCode
        ↓
source dictionary CODE
        ↓
source NAME
        ↓
target lookup by normalized NAME
        ↓
target local LINE_TYPE_ID/CODE
```

Matching NAME выполняется без учёта регистра и внешних пробелов.

Для existing target NAME:

- target CODE сохраняется;
- TITLE/color/style/width обновляются.

Для missing target NAME:

- создаётся новая row;
- target DB генерирует CODE.

`TITLE` в identity не участвует.

## Legacy compatibility

Поддерживается portable KML `schemaVersion: 1`, где source code мог быть строковым identifier. Legacy parser переводит его в актуальную NAME-based model перед target matching.

## API

Export:

```text
GET /api/admin/export/lines.kml
```

Файл:

```text
lines.kml
```

Import:

```text
POST /api/admin/import/lines.kml
Content-Type: application/vnd.google-earth.kml+xml
```

Также принимаются совместимые XML content types.

Нужен `CAN_MANAGE_DATA` или superuser.

Interactive web-admin использует session cookie. Для scripted API можно использовать DB-backed HTTP Basic. Bootstrap ENV credentials после создания DB-user не являются login fallback.

Import участвует в общем single-task guard раздела **Управление данными** и заменяет line data транзакционно.

## Внешний KML / Google My Maps

Внешний source configuration, например:

```json
{
  "name": "Односторонние",
  "multiple": 1,
  "type": "Односторонние"
}
```

имеет другую семантику:

- `type` — `LINE_TYPES.NAME`;
- это не portable `businessTypeCode`;
- missing target NAME создаётся автоматически;
- DB генерирует CODE;
- initial TITLE равен NAME.

Стандартный `<Placemark><name>` внешнего KML сохраняется как `placemarkName`.

## Связь с GeoJSON transfer

GeoJSON lines snapshot использует тот же принцип:

```text
source numeric CODE
→ source dictionary NAME
→ target NAME matching
→ target local CODE/ID
```

Поэтому GeoJSON и portable KML взаимно согласованы по business semantics, хотя container format различается.

Подробнее: [data-transfer.md](data-transfer.md).

## Reverse proxy

Если import выполняется через browser session за HTTPS nginx, proxy должен корректно передавать protocol/IP. Для одного доверенного nginx:

```dotenv
HTTP_TRUST_PROXY_HOPS=1
```

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

KML size limits приложения и reverse proxy также должны быть согласованы. Общая production-конфигурация описана в [deployment.md](deployment.md).