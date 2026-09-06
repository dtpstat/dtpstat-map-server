# dtpstat-map-server

Node.js/Express + PostgreSQL/PostGIS сервер интерактивной карты линейных объектов. Код не привязан к конкретному транспортному проекту: один репозиторий можно разворачивать несколькими независимыми экземплярами с разными БД, схемами, портами, исходными данными, расчётами и публичным названием.

## Основные возможности

- публичная Mapbox-карта с viewport-загрузкой полных линий;
- selector линий увеличивается до 120% ширины и высоты видимого окна, поэтому объекты не исчезают прямо у края карты;
- импорт внешнего KML / Google My Maps с сохранением `<Placemark><name>` и hover-popup имени линии;
- опциональные постоянные подписи `placemarkName` вдоль линий;
- справочник бизнес-типов линий с независимыми `CODE`, `NAME`, `TITLE`, цветом, стилем и толщиной;
- настраиваемые scalar-метрики городов, ссылки между метриками, арифметика, приоритеты/ОПЗ и группировка по бизнес-типу;
- агрегаты геометрий `SUM`, `AVG`, `MEDIAN`, `MIN`, `MAX`, `COUNT` там, где они допустимы;
- поля уровня города, включая население и геодезическую площадь OSM-границы в м²;
- подготовленная таблица `CITY_REPORT_VALUES` вместо тяжёлого расчёта при каждом публичном запросе;
- отдельная настройка публичной HTML-таблицы, CSV и рейтинга;
- условное форматирование числовых ячеек по диапазонам;
- загрузка городов/границ из OSM Overpass;
- перенос городов, линий, типов и населения между экземплярами через admin API;
- переносимый GeoJSON/KML с полным словарём бизнес-типов;
- DB-backed административные пользователи, независимые роли, anti-bruteforce lockout и аудит;
- три семантических окна админки: управление данными, настройка интерфейса, пользователи/аудит;
- superadmin-only экспорт/импорт всех DB-backed настроек проекта;
- single-task guard, dry-run и WebSocket-журнал только для операций управления данными;
- статические публичные GeoJSON/CSV snapshots и динамические admin-export endpoint;
- HTTP и/или HTTPS;
- структурированные service logs и graceful shutdown.

Требуются Node.js `20.19+` и PostgreSQL с PostGIS.

## Быстрый запуск

```bash
npm install
cp .env.example .env
```

Заполните параметры PostgreSQL, `MAPBOX_ACCESS_TOKEN` и первоначальные admin credentials, затем:

```bash
npm run db:init
npm run db:migrate
npm start
```

`db:init` создаёт/настраивает прикладную роль и БД и включает PostGIS. `db:migrate` применяет последовательность миграций `V001…V017`.

На первом старте после security migrations, если `ADMIN_USERS` пуст, сервер один раз создаёт bootstrap-superadmin из:

```dotenv
IMPORT_API_USERNAME=admin
IMPORT_API_PASSWORD=replace-with-a-long-random-password
```

После создания DB-пользователя эти значения больше не участвуют в online-аутентификации и могут быть удалены из `.env`.

На полностью пустой БД сервер и админка запускаются нормально. Публичная страница показывает `Данные пока не загружены`, а наполнение выполняется через `/admin/`.

Для локальной PostgreSQL можно использовать:

```bash
docker compose up -d database
npm run db:init
npm run db:migrate
npm start
```

## Независимые экземпляры

Рекомендуемая модель: **один экземпляр приложения — одна PostgreSQL database**.

`DATABASE_SCHEMA` одновременно является SQL schema и техническим namespace экземпляра. По умолчанию для совместимости используется `buslanes`. Значение участвует в:

- `search_path`;
- PostgreSQL `application_name`;
- advisory locks;
- таблице истории миграций;
- service namespace;
- default OSM User-Agent.

Например второй экземпляр:

```dotenv
DATABASE_NAME=tramlanes
DATABASE_ROLE=tramlanes_app
DATABASE_SCHEMA=tramlanes
HTTPS_ENABLED=true
HTTPS_PORT=3002
```

Node-приложения должны слушать разные HTTP/HTTPS-порты. Несколько БД в одном PostgreSQL server могут использовать один `DATABASE_PORT`.

Подробнее: [docs/deployment.md](docs/deployment.md).

## Схема, миграции и индексы

Основные таблицы `<DATABASE_SCHEMA>`:

- `cities` — города и legacy/cache статистика;
- `city_populations` — население;
- `city_boundaries` — OSM city/town Polygon/MultiPolygon;
- `city_geometries` — линейные объекты и их source properties;
- `line_types` — словарь бизнес-типов;
- `project_settings` — публичные настройки проекта, включая показ подписей линий;
- `report_config` — декларативные метрики, таблица, CSV и ranking;
- `city_report_values` — материализованные scalar-значения и места городов;
- `admin_users` — административные пользователи и роли;
- `admin_security_settings` — anti-bruteforce policy;
- `admin_audit_log` — журнал входов и admin-операций;
- audit/update tables и `admin_task_successes`.

История миграций:

```text
<DATABASE_SCHEMA>.schema_versions
```

Старые deployment могли использовать `public.buslanes_schema_versions`; migration runner переносит найденную legacy-историю в schema-specific таблицу.

Файлы уже опубликованных/применённых миграций не должны переписываться задним числом. В исторических SQL литерал `BUSLANES` является source token: runner подставляет текущий `DATABASE_SCHEMA` перед исполнением, а checksum считает по исходному файлу.

`V015__index_audit.sql` фиксирует отдельный аудит индексов. `V016` добавляет DB-backed security и настройку подписей линий. `V017` защищает первоначальную bootstrap-учётку на уровне БД.

Следующее изменение схемы должно быть новой миграцией **V018+**.

Подробнее: [docs/database-indexes.md](docs/database-indexes.md).

## Админка, роли и безопасность

В `/admin/` три верхнеуровневых окна.

### Управление данными

Содержит импорт/экспорт городов, линий и населения, OSM/KML, текущую фоновую операцию и live-журнал.

Одна длительная mutating data-задача выполняется одновременно. Пока она активна, блокируются только элементы управления этим разделом. Настройки интерфейса не входят в этот клиентский global lock.

### Настройка интерфейса

Содержит:

- **Проект**;
- **Расчёты**;
- **Типы линий**.

Раздел использует всю доступную ширину вместо постоянной правой колонки журнала data-задачи.

### Пользователи и аудит

Доступен только superadmin. Здесь находятся:

- пользователи и роли;
- audit log;
- параметры защиты от перебора;
- экспорт/импорт всех DB-backed настроек проекта.

У обычного пользователя два независимых права:

```text
CAN_MANAGE_DATA
CAN_MANAGE_INTERFACE
```

Bootstrap-superadmin всегда имеет оба права.

Первоначальную учётку нельзя удалить, вручную заблокировать, лишить superuser или одного из двух прав. Этот инвариант дополнительно защищён DB trigger. При этом временный `LOCKED_UNTIL` от anti-bruteforce действует и на bootstrap-user.

HTTP Basic используется только как транспорт credentials; логин, salted scrypt password hash, роли, manual block и temporary lockout хранятся в PostgreSQL.

Основные auth-ответы:

```text
401  отсутствуют/неверны credentials
403  manual block или недостаточно прав
423  временная anti-bruteforce блокировка
```

Для `423` возвращается `Retry-After`.

Если приложение стоит за доверенным reverse proxy, для корректного audit IP задаётся число доверенных hops:

```dotenv
HTTP_TRUST_PROXY_HOPS=1
```

По умолчанию `0`, forwarded IP не доверяется.

Подробнее: [docs/admin-security.md](docs/admin-security.md).

## Экспорт/импорт настроек проекта

Superadmin-only endpoints:

```text
GET  /api/admin/settings/export
POST /api/admin/settings/import
```

Пакет `project-settings` v1 включает:

- `PROJECT_SETTINGS`;
- `LINE_TYPES`;
- `REPORT_CONFIG`;
- `ADMIN_SECURITY_SETTINGS`.

Не включаются пользователи, password hashes, audit log, города/линии/население, `.env`, DB credentials, Mapbox token, TLS secrets и другие infrastructure settings.

Типы линий при импорте сопоставляются по `NAME`; target-only типы не удаляются, отсутствующие source NAME создаются с новым локальным DB-generated CODE. `CITY_REPORT_VALUES` после импорта пересчитывается заново на данных целевого экземпляра.

DB-часть импорта атомарна. После commit пересобираются public snapshots; ошибка этого производного post-processing возвращается warning и не превращает уже зафиксированный импорт в ложный rollback.

Подробнее: [docs/project-settings-transfer.md](docs/project-settings-transfer.md).

## Конструктор расчётов

В **Настройка интерфейса → Расчёты** есть четыре внутренние вкладки:

1. **Метрики**;
2. **Публичная таблица**;
3. **CSV**;
4. **Рейтинг**.

Конфигурация сохраняется целиком. После валидации сервер пересчитывает `CITY_REPORT_VALUES`, а затем обновляет публичные snapshots.

### Без произвольного SQL

Администратор не вводит SQL, имена таблиц или колонок. Поля, агрегаты, другие метрики, группировки, операции, приоритеты, константы, масштабы и точность выбираются только из server-owned каталогов/dropdown.

Текущие источники включают:

- `city.population`;
- `city.area_m2`;
- `geometry.length_m`;
- `geometry.lane_length_m`;
- `geometry.lanes`;
- `geometry.id` для `COUNT`.

Площадь города:

```text
ST_Area(CITY_BOUNDARIES.GEOM::geography)
```

и задаётся в м².

### Агрегаты

Для числовых geometry-полей доступны:

```text
SUM
AVG
MEDIAN
MIN
MAX
```

Для `geometry.id` — `COUNT`.

Медиана реализована PostgreSQL ordered-set aggregate:

```text
PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ...)
```

### Ссылки между метриками

Например:

```text
network_length_m   = SUM(geometry.length_m)
separated_length_m = SUM(geometry.length_m WHERE LINE_TYPES.NAME = «Обособленные»)
separation_ratio   = metric(separated_length_m) / metric(network_length_m)
```

Backend строит dependency graph и считает метрики топологически. Порядок карточек в админке можно менять `↑/↓`, но он не определяет execution order.

Запрещены ссылки на отсутствующую метрику, self-reference и косвенные циклы.

### Арифметика, приоритеты и ОПЗ

Поддерживаются:

```text
+
−
×
÷
% от
```

Каждая операция имеет приоритет `1…12`: большее значение выполняется раньше; одинаковое — слева направо. Операции можно переставлять `↑/↓`.

Перед SQL-компиляцией выражение переводится в обратную польскую запись. Админка показывает read-only фактические скобки и ОПЗ.

Например:

```text
A +[1] B ×[2] C
```

означает:

```text
A + (B × C)
```

а:

```text
A +[2] B ×[1] C
```

означает:

```text
(A + B) × C
```

### Форматирование чисел

Расчётные значения рекомендуется хранить в канонических единицах, а представление задавать у колонки:

- длина — метры;
- площадь — м²;
- население — люди;
- доля — `0..1`.

Для каждой metric-колонки публичной таблицы и CSV независимо задаются `scale` и количество знаков после запятой.

### Условное форматирование

Для числовых колонок `rank` и `metric` публичной таблицы можно создать до восьми правил.

Диапазон имеет полуоткрытую семантику:

```text
min <= value < max
```

То есть:

- нижняя граница — `>= min`;
- верхняя — `< max`;
- пустой `min` означает `−∞`;
- пустой `max` означает `+∞`.

Смежные диапазоны задаются одной общей границей:

```text
min=null, max=91    -> x < 91
min=91, max=201     -> x >= 91 && x < 201
min=201, max=null   -> x >= 201
```

Так дробные значения вроде `90.5` и `200.9` не выпадают между правилами.

Для metric-колонки проверяется число **после `scale`**, но до форматирования строки.

Правило может задавать:

- жирный;
- курсив;
- подчёркивание;
- зачёркивание;
- цвет текста;
- размер `−2`, `−1`, обычный, `+1`, `+2` пункта.

Если правила перекрываются, применяется первое сверху. Их порядок меняется `↑/↓`. Conditional formatting не меняет исходное значение, ranking, сортировку или CSV.

Подробнее: [docs/report-config.md](docs/report-config.md).

## Viewport линий

Клиент отправляет фактический bbox видимого окна. Сервер увеличивает selector до **120%** ширины и высоты — по 10% исходного размера на каждую сторону.

SQL использует:

```text
GEOM && padded_bbox
ST_Intersects(GEOM, padded_bbox)
```

Первое условие использует GiST bbox-index, второе подтверждает реальное пересечение.

`ST_Intersection` для ответа не применяется: если геометрия хоть частично пересекает расширенное окно, клиент получает **полную линию**. Это устраняет эффект исчезновения объектов на границе скользящего viewport.

## Имена и подписи KML-линий

При импорте внешнего KML / Google My Maps стандартное имя Placemark:

```xml
<Placemark>
  <name>Проспект Мира</name>
  <LineString>...</LineString>
</Placemark>
```

сохраняется как:

```text
CITY_GEOMETRIES.PROPERTIES.placemarkName
```

Если `placemarkName` непустой, публичная карта показывает его в popup при наведении мыши на линию.

В **Настройка интерфейса → Проект** есть отдельная галочка **«Отображать подписи линий на карте»**. Она управляет `PROJECT_SETTINGS.SHOW_LINE_LABELS`. При включении Mapbox создаёт symbol-layer с `text-field = placemarkName` вдоль линии. Hover-popup от этой галочки не зависит.

Popup использует Mapbox `setText`, а не HTML, поэтому содержимое KML name не интерпретируется браузером как разметка.

Важно различать:

```text
properties.placemarkName  = имя линии из KML
properties.name           = полное название города в canonical transfer GeoJSON
LINE_TYPES.NAME            = identity бизнес-типа
LINE_TYPES.TITLE           = подпись легенды
```

Portable KML переносит настоящий `placemarkName` внутри `dtpstat.properties`. Видимый `<Placemark><name>` portable-файла может быть сгенерирован для внешнего viewer, поэтому сам по себе не считается источником истины для line popup/label.

Подробнее: [docs/kml-transfer.md](docs/kml-transfer.md) и [docs/data-transfer.md](docs/data-transfer.md).

## Модель типов линий

`LINE_TYPES`:

| Поле | Назначение |
| --- | --- |
| `ID` | локальный PK |
| `CODE` | числовой DB-generated code; пользователь не создаёт и не редактирует |
| `NAME` | source/import identity, уникален без учёта регистра и внешних пробелов |
| `TITLE` | человекочитаемая подпись легенды |
| `COLOR` | цвет |
| `LINE_STYLE` | `solid`, `dashed`, `dotted` |
| `WIDTH` | толщина |

`CITY_GEOMETRIES.LINE_TYPE_ID` хранит локальный FK на `LINE_TYPES.ID`.

При переносе numeric source CODE разрешается через source dictionary до `NAME`, затем target type ищется по нормализованному `NAME`. Локальный CODE между двумя БД совпадать не обязан. `TITLE` в matching не участвует.

Публичная легенда показывает только типы, у которых реально есть геометрии; при одном типе отдельная легенда не нужна.

## Обновление данных

Основные mutating-операции находятся в **Управление данными** и `/api/admin/*`.

### Города

OSM city/town и границы можно обновлять через Overpass или переносить готовым GeoJSON. Большой city GeoJSON после полной валидации staging-загружается пакетами по 50 объектов, чтобы не отправлять десятки мегабайт одним JSONB-параметром PostgreSQL.

### Линии

Поддерживаются:

- внешний KML / Google My Maps;
- portable GeoJSON;
- portable KML.

Во внешнем KML конфигурационное поле `type` означает **`LINE_TYPES.NAME`**, не CODE. Неизвестный NAME создаётся автоматически, CODE назначает БД, начальный `TITLE = NAME`.

Исходные properties линии сохраняются в JSONB; KML Placemark name хранится как `placemarkName`.

### Население

Население импортируется отдельным snapshot. После успешного изменения исходных данных пересчитываются зависимые метрики и публичные snapshots.

Все длительные mutating data-операции используют single-task guard. `dryRun` проверяет данные без commit и без обновления last-success/public snapshots.

Форматы переноса: [docs/data-transfer.md](docs/data-transfer.md) и [docs/kml-transfer.md](docs/kml-transfer.md).

## Публичные downloads и admin exports

Публичные URL:

```text
/bus-lanes.geojson
/bus-lanes.csv
```

не выполняют тяжёлые DB-запросы при каждом скачивании. Сервер материализует файлы в:

```text
var/public-downloads/
```

Они пересобираются при старте и после успешных real-update операций. Замена каждого файла атомарная; `dryRun` snapshots не обновляет.

Публичный GeoJSON намеренно не является полным round-trip форматом. Для backup/transfer данных используются:

```text
GET /api/admin/export/cities
GET /api/admin/export/lines
GET /api/admin/export/lines.kml
GET /api/admin/export/populations
```

Отдельно superadmin может перенести конфигурацию проекта:

```text
GET  /api/admin/settings/export
POST /api/admin/settings/import
```

CSV строится из `CITY_REPORT_VALUES` и собственного `REPORT_CONFIG.CSV_COLUMNS`.

## Служебные логи и audit

Ключевые runtime-события имеют префикс `[service]`, например:

```text
[service] startup
[service] database.health:start
[service] database.health:ok
[service] city-report.refresh:start
[service] city-report.refresh:ok
[service] public-downloads.refresh:start
[service] public-downloads.refresh:ok
[service] postgres.connection:error
[service] shutdown:start
[service] shutdown:ok
```

Отдельно `ADMIN_AUDIT_LOG` хранит входы и admin-операции с timestamp, status, duration, IP и пользователем.

Ошибки PostgreSQL connection обрабатываются через `Pool#error` / `Client#error`, чтобы неожиданное закрытие одного соединения не превращалось в необработанный EventEmitter error всего Node-процесса. Ошибка конкретного SQL по-прежнему возвращается вызывающей операции.

## Production / PM2

Предпочтительно запускать Node entry point напрямую:

```bash
pm2 start src/server.js --name tramlanes
pm2 save
```

После изменения `.env`:

```bash
pm2 restart tramlanes --update-env
```

Для production используйте HTTPS, длинный первоначальный admin password и непривилегированную PostgreSQL runtime-role. После bootstrap управление пользователями выполняется через БД/админку, а `IMPORT_API_USERNAME/PASSWORD` можно убрать. `POSTGRES_ADMIN_*` нужны только `npm run db:init`.

## Проверка

```bash
npm run check
```

Команда запускает ESLint и Node test suite.

## Bootstrap из исторического snapshot

Корневые:

```text
bus-lanes.geojson
bus-lanes.csv
```

оставлены как bootstrap source для:

```bash
npm run db:import
```

Они не обслуживают публичные `/bus-lanes.geojson` и `/bus-lanes.csv`.

## Структура репозитория

```text
admin/                 web-admin
public/                публичный JS/CSS
src/                   runtime server/API/data/db
scripts/               db:init, db:migrate, optional db:import
db/migrations/         versioned migrations
docs/                  deployment, security, transfer, reports and index docs
var/                    generated runtime state, не хранится в git
test/                   Node test suite
```
