# Аудит индексов PostgreSQL / PostGIS

Аудит выполнен по фактическим SQL access paths приложения, а не по правилу «создать индекс на каждую колонку». Лишний индекс увеличивает размер БД, замедляет `INSERT/UPDATE/DELETE`, VACUUM и массовые импорты, поэтому для singleton и append-only таблиц отсутствие дополнительных индексов может быть правильным состоянием.

Основной аудит application-data индексов зафиксирован `V015__index_audit.sql`. `V016/V017` добавили security tables и их собственные индексы; они также перечислены ниже.

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

`PROPERTIES JSONB` содержит source metadata, в том числе KML `placemarkName`. GIN/expression-индекс для него сейчас намеренно не создаётся: popup и постоянные подписи имени линии не ищут `placemarkName` в PostgreSQL, а получают property вместе с уже найденной по GiST viewport-геометрией. Если в будущем появится SQL-фильтр/поиск по source properties, индекс следует проектировать под конкретный предикат, а не добавлять общий GIN заранее.

## LINE_TYPES

- `PRIMARY KEY (ID)`;
- `UNIQUE (CODE)`;
- unique expression index:

```text
LOWER(BTRIM(NAME))
```

Expression index точно соответствует import matching, где `NAME` сравнивается без регистра и внешних пробелов. Он также используется при superadmin-импорте настроек проекта. Дополнительный обычный индекс по `NAME` дублировал бы данные и не обслуживал бы основной нормализованный lookup.

## PROJECT_SETTINGS

Singleton:

```text
PRIMARY KEY (ID), CHECK (ID = 1)
```

Всегда читается одна строка по `ID=1`. `SHOW_LINE_LABELS` — обычный singleton field и отдельного индекса не требует.

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

## ADMIN_USERS

Создана `V016`, bootstrap-инвариант расширен `V017`.

Индексы:

```text
PRIMARY KEY (ID)
UNIQUE LOWER(BTRIM(USERNAME))
UNIQUE ((1)) WHERE IS_BOOTSTRAP
```

`ADMIN_USERS_USERNAME_CI_UIDX` соответствует фактической аутентификации:

```text
LOWER(BTRIM(username)) = LOWER(BTRIM($1))
```

Поэтому дополнительный обычный индекс `USERNAME` не нужен.

`ADMIN_USERS_BOOTSTRAP_UIDX` — небольшой partial unique index-инвариант: в экземпляре может быть не более одной первоначальной `IS_BOOTSTRAP=true` учётки. Это не performance optimization, а DB-level constraint.

Отдельные индексы на `IS_BLOCKED`, `LOCKED_UNTIL`, `CAN_MANAGE_DATA`, `CAN_MANAGE_INTERFACE` не создаются. Пользователи загружаются по `ID`/`USERNAME` или небольшим полным списком; фильтрация по этим low-cardinality flags не является runtime access path.

## ADMIN_SECURITY_SETTINGS

Singleton:

```text
PRIMARY KEY (ID), CHECK (ID = 1)
```

Дополнительные индексы не нужны.

## ADMIN_AUDIT_LOG

Append-only журнал, но в отличие от старых update-run tables он имеет реальный UI чтения последних событий.

Поэтому V016 создаёт:

```text
(CREATED_AT DESC, ID DESC)
(USER_ID, CREATED_AT DESC)
```

Первый индекс обслуживает основной `ORDER BY CREATED_AT DESC, ID DESC LIMIT ...`; второй — готовый access path для пользовательской истории/диагностики по `USER_ID`.

`EVENT_TYPE`, `OPERATION_TYPE`, `STATUS`, `IP_ADDRESS` пока не используются как server-side filters, поэтому отдельные индексы на них не добавляются заранее.

## ADMIN_TASK_SUCCESSES

```text
PRIMARY KEY (TASK_TYPE)
```

Таблица содержит небольшое фиксированное число типов задач и читается по `TASK_TYPE`. Индекс `COMPLETED_AT` не нужен.

## GEOMETRY_UPDATE_RUNS / OSM_CITY_UPDATE_RUNS

Это append-only audit-журналы обновления данных. Текущий runtime пишет новые строки, но не строит пользовательские запросы по `CREATED_AT`, checksum или другим полям. Поэтому дополнительные timestamp/checksum индексы намеренно не создаются: они увеличили бы стоимость каждого массового обновления без текущей read-нагрузки.

`ADMIN_AUDIT_LOG` отличается: у него уже есть UI выдачи последних записей, поэтому timestamp-index там обоснован.

## Временные staging-таблицы

KML matching создаёт временную геометрическую таблицу и **в рамках операции** создаёт GiST на её `geom`, затем выполняет `ANALYZE`. Этот индекс не должен быть постоянным — staging table живёт только до commit.

Импорт городов и superadmin-импорт настроек также используют временные staging structures; постоянные индексы на них не нужны.

## Итог

Проверены как пространственные, так и обычные access paths. Основным изменением V015 стал составной индекс:

```text
CITY_GEOMETRIES (CITY_ID, LINE_TYPE_ID)
```

с удалением ставшего избыточным:

```text
CITY_GEOMETRIES (CITY_ID)
```

Security migrations дополнительно создают только индексы, имеющие конкретный lookup/invariant:

```text
ADMIN_USERS LOWER(BTRIM(USERNAME)) UNIQUE
ADMIN_USERS bootstrap partial UNIQUE
ADMIN_AUDIT_LOG (CREATED_AT DESC, ID DESC)
ADMIN_AUDIT_LOG (USER_ID, CREATED_AT DESC)
```

Остальные текущие запросы уже покрыты существующими PK/UNIQUE/B-tree/GiST индексами либо работают с настолько маленькими/singleton/append-only таблицами, что дополнительный индекс ухудшил бы стоимость записи без практической пользы.
