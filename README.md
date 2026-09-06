# dtpstat-map-server

Node.js/Express + PostgreSQL/PostGIS сервер интерактивной карты линейных объектов. Репозиторий вырос из проекта карты выделенных полос, но runtime больше не привязан к имени исходного проекта: один код можно разворачивать несколькими независимыми экземплярами с разными БД, схемами, портами, данными и публичным названием.

## Основные возможности

- публичная карта Mapbox с выборкой геометрий только для текущего viewport;
- рейтинг городов с PostGIS-пересчётом длины линий и показателя на 1000 жителей;
- справочник бизнес-типов линий с отдельными `NAME`, `TITLE`, цветом, стилем и толщиной;
- загрузка городов/границ из OSM Overpass;
- импорт линий из KML / Google My Maps;
- перенос городов, линий и населения между экземплярами через admin API;
- переносимый KML с полным словарём типов линий;
- защищённая Basic Auth админка с единственной выполняемой admin-задачей, журналом, dry-run и WebSocket-статусом;
- статические публичные GeoJSON/CSV snapshots и отдельные динамические admin-экспорты;
- HTTP и/или HTTPS;
- структурированные служебные логи и graceful shutdown.

Требуются Node.js `20.19+` и PostgreSQL с доступным PostGIS.

## Быстрый запуск

```bash
npm install
cp .env.example .env
```

Заполните как минимум параметры PostgreSQL, Basic Auth и `MAPBOX_ACCESS_TOKEN`, затем:

```bash
npm run db:init
npm run db:migrate
npm start
```

`db:init` создаёт/обновляет прикладную роль и БД и включает PostGIS. `db:migrate` применяет неизменяемую последовательность миграций V001…V013.

На полностью пустой БД сервер и админка работоспособны. Публичная страница показывает нормальное состояние `Данные пока не загружены`, а не ошибку. Данные можно наполнить через `/admin/`.

Для локальной БД можно использовать `compose.yaml`:

```bash
docker compose up -d database
npm run db:init
npm run db:migrate
npm start
```

## Независимые экземпляры

Рекомендуемая модель: **один экземпляр приложения — одна PostgreSQL database**.

`DATABASE_SCHEMA` одновременно является SQL-схемой и техническим namespace экземпляра. По умолчанию для совместимости используется `buslanes`. Настройка влияет на:

- `search_path`;
- PostgreSQL `application_name`;
- advisory locks;
- таблицу истории миграций;
- служебный namespace обновлений;
- default User-Agent OSM updater.

Например второй экземпляр на том же сервере:

```dotenv
DATABASE_NAME=tramlanes
DATABASE_ROLE=tramlanes_app
DATABASE_SCHEMA=tramlanes
HTTPS_ENABLED=true
HTTPS_PORT=3002
```

Первый и второй экземпляры должны использовать разные HTTP/HTTPS-порты. Если они подключены к одному PostgreSQL server, сам `DATABASE_PORT` может совпадать.

Подробнее: [docs/deployment.md](docs/deployment.md).

## Схема и миграции

Прикладные таблицы находятся в `<DATABASE_SCHEMA>`:

- `cities` — рейтинговые города и рассчитанная статистика;
- `city_populations` — население и метаданные источника;
- `city_boundaries` — OSM city/town и их Polygon/MultiPolygon;
- `city_geometries` — линии, связанные с OSM-границей и бизнес-типом;
- `line_types` — словарь бизнес-типов и визуальных настроек;
- `project_settings` — название проекта, keywords, footer и ID аналитики;
- журналы обновлений и `admin_task_successes`.

История миграций хранится в:

```text
<DATABASE_SCHEMA>.schema_versions
```

Для старых установок мигратор умеет импортировать историю из legacy `public.buslanes_schema_versions`. Файлы миграций после применения **не редактируются**. Исторические SQL-файлы содержат имя `BUSLANES`; migration runner подставляет выбранный `DATABASE_SCHEMA` только перед исполнением, а checksum рассчитывает по оригинальному неизменённому файлу.

Любое следующее изменение схемы должно быть новой миграцией V014+.

## Модель типов линий

Актуальная модель `LINE_TYPES`:

| Поле | Назначение |
| --- | --- |
| `ID` | локальный PK |
| `CODE` | числовой код, генерируется БД, пользователь его не назначает и не редактирует |
| `NAME` | source/import identity; уникален без учёта регистра и внешних пробелов |
| `TITLE` | человекочитаемая подпись легенды |
| `COLOR` | цвет |
| `LINE_STYLE` | `solid`, `dashed`, `dotted` |
| `WIDTH` | толщина |

`CITY_GEOMETRIES.LINE_TYPE_ID` хранит только локальный FK на `LINE_TYPES.ID`.

`NAME` и `TITLE` имеют разные роли: импорт сопоставляет типы по нормализованному `NAME`; `TITLE` используется только для представления. `CODE` является компактной числовой ссылкой в переносимых форматах, но его значение не обязано совпадать между двумя БД.

На публичной карте легенда показывает только типы, у которых реально есть геометрии. Если используется не более одного типа, отдельная легенда не рисуется.

## Обновление данных

Основные операции доступны в `/admin/` и через защищённый `/api/admin/*`.

### Города

Можно загрузить актуальный список `place=city/town` и границы из OSM Overpass либо перенести готовый GeoJSON snapshot. Импорт большого GeoJSON городов сначала валидирует весь файл, затем загружает геометрии во временную таблицу пакетами по 50 объектов, чтобы не отправлять весь большой FeatureCollection одним PostgreSQL JSONB-параметром.

### Линии

Поддерживаются:

- внешний KML / Google My Maps;
- переносимый GeoJSON;
- переносимый KML.

В конфигурации внешнего KML поле `type` содержит **`LINE_TYPES.NAME`**, а не числовой `CODE`. Сопоставление выполняется без учёта регистра и внешних пробелов. Если такого `NAME` ещё нет, тип создаётся автоматически: `CODE` назначает БД, начальный `TITLE = NAME`.

### Население

Население импортируется отдельным JSON snapshot и после успешной фиксации запускает пересчёт зависимой статистики.

Все длительные mutating-операции проходят через единый single-task guard. `dryRun` выполняет проверку без фиксации данных и не обновляет отметку последнего успешного обновления.

Форматы переноса: [docs/data-transfer.md](docs/data-transfer.md) и [docs/kml-transfer.md](docs/kml-transfer.md).

## Публичные downloads и admin exports

Публичные ссылки:

```text
/bus-lanes.geojson
/bus-lanes.csv
```

не выполняют тяжёлый SQL при каждом скачивании. Сервер материализует обычные файлы в:

```text
var/public-downloads/
```

Snapshot строится при старте и после успешного реального изменения данных. Файлы заменяются атомарно. `dryRun` их не пересобирает.

Публичный GeoJSON намеренно содержит только данные, полезные потребителю карты/данных, и **не содержит** `_dtpstat`, словарь стилей, `TITLE/COLOR/STYLE/WIDTH` и другую служебную информацию для round-trip.

Admin-экспорты остаются динамическими и полными:

```text
GET /api/admin/export/cities
GET /api/admin/export/lines
GET /api/admin/export/lines.kml
GET /api/admin/export/populations
```

Именно admin-форматы следует использовать для переноса/backup между экземплярами.

## Служебные логи

Сервер пишет grep-friendly события с единым префиксом:

```text
[service] startup
[service] database.health:start
[service] database.health:ok
[service] public-downloads.refresh:start
[service] public-downloads.refresh:ok
[service] postgres.connection:error
[service] shutdown:start
[service] shutdown:ok
```

Для операций указывается `durationMs`, а для ошибок — безопасные `name`, `code`, `message` и технический контекст без паролей/токенов.

Неожиданная потеря отдельного PostgreSQL connection логируется через `Pool#error` / `Client#error` и не должна превращаться в необработанный EventEmitter error, завершающий весь Node-процесс. SQL-ошибка конкретного запроса по-прежнему возвращается вызывающей операции.

## Production / PM2

Для PM2 лучше запускать Node напрямую, без дополнительного npm wrapper:

```bash
pm2 start src/server.js --name tramlanes
pm2 save
```

Так имя процесса принадлежит конкретному экземпляру, а npm metadata остаётся нейтральной (`dtpstat-map-server`).

Для production используйте HTTPS, длинный Basic Auth пароль и отдельную непривилегированную PostgreSQL роль. `POSTGRES_ADMIN_*` нужны только `npm run db:init`.

## Проверка

```bash
npm run check
```

Команда запускает ESLint и весь набор Node tests.

После изменения `.env` или обновления deployment под PM2:

```bash
pm2 restart <instance-name> --update-env
```

## Bootstrap из исторического snapshot

Корневые `bus-lanes.geojson` и `bus-lanes.csv` сохранены только как исходный bootstrap snapshot для команды:

```bash
npm run db:import
```

Они **не** обслуживают публичные `/bus-lanes.geojson` и `/bus-lanes.csv`; публичные файлы всегда строятся из текущей БД в `var/public-downloads/`.

## Структура репозитория

```text
admin/                 web-admin
public/                публичный JS/CSS
src/                   runtime server/API/data/db
scripts/               db:init, db:migrate, optional db:import
db/migrations/         неизменяемые миграции
 docs/                  deployment и transfer-документация
var/                    generated runtime state, не хранится в git
test/                   Node test suite
```
