# Аудит индексов PostgreSQL / PostGIS

Аудит выполнен по фактическим SQL access paths приложения, а не по правилу «создать индекс на каждую колонку». Лишний индекс увеличивает размер БД, замедляет `INSERT/UPDATE/DELETE`, VACUUM и массовые импорты, поэтому для singleton и append-only таблиц отсутствие дополнительных индексов может быть правильным состоянием.

Актуальное состояние после `V015__index_audit.sql`.

## CITIES

Уже покрыто:

- `PRIMARY KEY (ID)`;
- `UNIQUE (SOURCE_INDEX)`;
- `UNIQUE (SLUG)`;
- `UNIQUE (NAME)`;
- исторический `CITIES_RANKING_IDX`.

Основные runtime-доступы идут по `ID`, `SLUG`, `NAME` и через joins. Дополнительный индекс только по `IS_LARGE` нецелесообразен: значений всего два, селективность низкая. Сортировка нового рейтинга использует `CITY_REPORT_VALUES.RANK`, поэтому старый ranking-index не является единственной опорой нового отчёта.

## CITY_POPULATIONS

```text
PRIMARY KEY (CITY_ID)
```

Это одновременно unique B-tree индекс для всех текущих joins `population.city_id = city.id`. По `POPULATION`, `AS_OF`, `SOURCE` runtime не фильтрует, поэтому дополнительные индексы не нужны.

## CITY_BOUNDARIES

Реляционные:

- `PRIMARY KEY (ID)`;
- unique `(OSM_TYPE, OSM_ID)` — импорт/перенос по OSM identity;
- partial unique `(CITY_ID) WHERE CITY_ID IS NOT NULL` — связь ranked city → boundary;
- `OSM_NAME`;
- `PLACE_TYPE`.

Пространственные:

- GiST `(GEOM)`;
- GiST `(BOUNDS)`.

`GEOM` используется для `&&`, `ST_Intersects`, `ST_Covers` и поиска города под центром viewport. `BOUNDS` используется для extent/export. Отдельный B-tree на `OSM_ID` не нужен, потому что реальные lookup выполняются парой `(OSM_TYPE, OSM_ID)`.

## CITY_GEOMETRIES

Пространственный:

```text
GiST (GEOM)
```

Он является главным индексом viewport-запроса:

```text
GEOM && padded_bbox
AND ST_Intersects(GEOM, padded_bbox)
```

Реляционные после V015:

```text
(CITY_ID, LINE_TYPE_ID)
BOUNDARY_ID
LINE_TYPE_ID
```

До V015 существовал отдельный `(CITY_ID)`. Он заменён на `(CITY_ID, LINE_TYPE_ID)`: PostgreSQL может использовать левый префикс составного индекса для старых city-only запросов, а второй столбец соответствует частому join/grouping отчётов по типу линии. Отдельный `(LINE_TYPE_ID)` оставлен, потому что составной индекс с `CITY_ID` первым не заменяет reverse lookup только по типу.

`BOUNDARY_ID` индексирован отдельно для связи геометрий с OSM polygon.

`PROPERTIES JSONB` содержит source metadata, в том числе KML `placemarkName`. GIN/expression-индекс для него сейчас намеренно не создаётся: popup имени линии не ищет `placemarkName` в PostgreSQL, а получает property вместе с уже найденной по GiST viewport-геометрией. Если в будущем появится SQL-фильтр/поиск по source properties, индекс следует проектировать под конкретный предикат, а не добавлять общий GIN заранее.

## LINE_TYPES

- `PRIMARY KEY (ID)`;
- `UNIQUE (CODE)`;
- unique expression index:

```text
LOWER(BTRIM(NAME))
```

Expression index точно соответствует import matching, где `NAME` сравнивается без регистра и внешних пробелов. Дополнительный обычный индекс по `NAME` дублировал бы данные и не обслуживал бы основной нормализованный lookup.

## PROJECT_SETTINGS

Singleton:

```text
PRIMARY KEY (ID), CHECK (ID = 1)
```

Всегда читается одна строка по `ID=1`. Других индексов не требуется.

## REPORT_CONFIG

Singleton:

```text
PRIMARY KEY (ID), CHECK (ID = 1)
```

`METRICS`, `TABLE_COLUMNS`, `CSV_COLUMNS` — JSONB-конфигурация, но runtime не выполняет поиск внутри JSONB. Поэтому GIN-индекс здесь был бы лишним.

## CITY_REPORT_VALUES

- `PRIMARY KEY (CITY_ID)` — join к городу и обновление materialized values;
- `CITY_REPORT_VALUES_RANK_IDX (RANK)` — выдача подготовленного рейтинга.

`VALUES JSONB` не индексируется: приложение читает весь объект метрик конкретного города и не использует SQL-предикаты вида `VALUES @> ...`. GIN здесь не нужен.

## ADMIN_TASK_SUCCESSES

```text
PRIMARY KEY (TASK_TYPE)
```

Таблица содержит небольшое фиксированное число типов задач и читается по `TASK_TYPE`. Индекс `COMPLETED_AT` не нужен.

## GEOMETRY_UPDATE_RUNS / OSM_CITY_UPDATE_RUNS

Это append-only audit-журналы. Текущий runtime пишет новые строки, но не строит пользовательские запросы по `CREATED_AT`, checksum или другим полям. Поэтому дополнительные timestamp/checksum индексы намеренно не создаются: они увеличили бы стоимость каждого массового обновления без текущей read-нагрузки.

Если позже появится UI истории с `ORDER BY CREATED_AT DESC LIMIT ...`, соответствующий индекс следует добавить новой миграцией в момент появления такого запроса.

## Временные staging-таблицы

KML matching создаёт временную геометрическую таблицу и **в рамках операции** создаёт GiST на её `geom`, затем выполняет `ANALYZE`. Этот индекс не должен быть постоянным — staging table живёт только до commit.

Импорт городов также использует временные staging structures; постоянные индексы на них не нужны.

## Итог

Проверены как пространственные, так и обычные access paths. После V015 единственным изменением постоянной индексной схемы стал более полезный составной индекс:

```text
CITY_GEOMETRIES (CITY_ID, LINE_TYPE_ID)
```

с удалением ставшего избыточным:

```text
CITY_GEOMETRIES (CITY_ID)
```

Остальные текущие запросы уже покрыты существующими PK/UNIQUE/B-tree/GiST индексами либо работают с настолько маленькими/singleton/append-only таблицами, что дополнительный индекс ухудшил бы стоимость записи без практической пользы.
