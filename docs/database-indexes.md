# Аудит индексов PostgreSQL / PostGIS

Индексы проектируются под фактические SQL access paths, а не по правилу «индексировать каждую колонку». Лишний индекс увеличивает размер БД и стоимость `INSERT/UPDATE/DELETE`, VACUUM и массового импорта.

Основной application-data audit зафиксирован `V015__index_audit.sql`. Security indexes добавлены `V016…V018`. `V019…V021` расширяют singleton `PROJECT_SETTINGS` и новых indexes не требуют.

## CITIES

Основные indexes/constraints:

- `PRIMARY KEY (ID)`;
- unique `SOURCE_INDEX`;
- unique `SLUG`;
- unique `NAME`;
- исторический ranking index.

Runtime lookup идёт по ID/slug/name и joins. Отдельный index только по `IS_LARGE` не нужен из-за низкой cardinality.

Новый ranking читает `CITY_REPORT_VALUES.RANK`; старый city ranking index не является основным access path materialized report.

## CITY_POPULATIONS

```text
PRIMARY KEY (CITY_ID)
```

PK уже является B-tree для join с `CITIES.ID`. По `POPULATION`, `AS_OF`, `SOURCE` runtime filters сейчас не выполняются.

## CITY_BOUNDARIES

Реляционные:

- `PRIMARY KEY (ID)`;
- unique `(OSM_TYPE, OSM_ID)`;
- partial unique `(CITY_ID) WHERE CITY_ID IS NOT NULL`;
- indexes по `OSM_NAME` и `PLACE_TYPE`.

Spatial:

```text
GiST (GEOM)
GiST (BOUNDS)
```

`GEOM` обслуживает `&&`, `ST_Intersects`, `ST_Covers` и spatial matching. `BOUNDS` используется для extent/export.

Отдельный B-tree только по `OSM_ID` не нужен: natural identity — `(OSM_TYPE, OSM_ID)`.

## CITY_GEOMETRIES

Spatial:

```text
GiST (GEOM)
```

Основной viewport predicate:

```text
GEOM && padded_bbox
AND ST_Intersects(GEOM, padded_bbox)
```

Реляционные access paths после `V015`:

```text
(CITY_ID, LINE_TYPE_ID)
BOUNDARY_ID
LINE_TYPE_ID
```

Старый отдельный `(CITY_ID)` удалён как избыточный: левый prefix `(CITY_ID, LINE_TYPE_ID)` обслуживает city-only lookup, а второй столбец нужен grouping/report queries.

Отдельный `(LINE_TYPE_ID)` остаётся, потому что составной index с `CITY_ID` первым не помогает lookup только по type.

`PROPERTIES JSONB`, включая `placemarkName`, сейчас не требует GIN: properties возвращаются вместе с geometry, уже найденной spatial index. При появлении SQL search по JSONB index нужно проектировать под конкретный predicate.

## LINE_TYPES

Indexes:

```text
PRIMARY KEY (ID)
UNIQUE (CODE)
UNIQUE LOWER(BTRIM(NAME))
```

Expression unique index совпадает с import/settings-transfer matching:

```text
LOWER(BTRIM(target.name)) = LOWER(BTRIM(source.name))
```

Обычный duplicate index по NAME не требуется.

## PROJECT_SETTINGS

Singleton:

```text
PRIMARY KEY (ID)
CHECK (ID = 1)
```

После `V019…V021` здесь также находятся:

- Mapbox token/bootstrap marker;
- custom city marker binary/metadata;
- public theme preset.

Все эти поля читаются из одной строки `ID=1`; дополнительные indexes бессмысленны.

## REPORT_CONFIG

Singleton:

```text
PRIMARY KEY (ID)
CHECK (ID = 1)
```

`METRICS`, `TABLE_COLUMNS`, `CSV_COLUMNS` — JSONB configuration, но runtime не ищет строки по содержимому этих JSONB. GIN не нужен.

## CITY_REPORT_VALUES

```text
PRIMARY KEY (CITY_ID)
CITY_REPORT_VALUES_RANK_IDX (RANK)
```

PK обслуживает materialization update/join. Rank index — публичную выдачу рейтинга.

`VALUES JSONB` возвращается целиком для города и не используется в `@>`/JSON-path filters, поэтому GIN сейчас не нужен.

# Administrative security

## ADMIN_USERS

Создана `V016`, bootstrap marker/index — `V017`, новые role/profile fields — `V018`.

Indexes:

```text
PRIMARY KEY (ID)
UNIQUE LOWER(BTRIM(USERNAME))
UNIQUE ((1)) WHERE IS_BOOTSTRAP
```

Username expression index точно соответствует login lookup.

Bootstrap partial unique index — прежде всего DB invariant: максимум одна `IS_BOOTSTRAP=true` row.

Отдельные indexes по role booleans, `IS_BLOCKED`, `MUST_CHANGE_PASSWORD` и account `LOCKED_UNTIL` сейчас не нужны: users ищутся по ID/username либо загружаются небольшим списком.

## ADMIN_SESSIONS

`V018`:

```text
PRIMARY KEY (ID)
UNIQUE (TOKEN_HASH)
(USER_ID, CREATED_AT DESC)
(EXPIRES_AT)
```

Назначение:

- unique token hash — session authentication;
- `(USER_ID, CREATED_AT DESC)` — список/revoke user sessions;
- `EXPIRES_AT` — cleanup/expiry access path.

Plaintext session token в БД отсутствует.

## ADMIN_SECURITY_SETTINGS

Singleton:

```text
PRIMARY KEY (ID)
CHECK (ID = 1)
```

Account/IP thresholds, session timeouts и audit retention — fields одной строки, indexes не нужны.

## ADMIN_LOGIN_IP_STATE

```text
PRIMARY KEY (IP_ADDRESS)
partial index (LOCKED_UNTIL) WHERE LOCKED_UNTIL IS NOT NULL
```

PK обслуживает login lookup/update по IP. Partial lock index позволяет работать только с реально locked rows без индексации постоянных NULL.

## ADMIN_BLOCKED_IPS

`V018` создаёт:

```text
PRIMARY KEY (ID)
(IP_ADDRESS, CREATED_AT DESC)
partial (EXPIRES_AT) WHERE EXPIRES_AT IS NOT NULL
```

Первый B-tree обслуживает поиск manual block по IP и выбор последней записи. Partial expiration index предназначен для expiration/cleanup path.

## ADMIN_AUDIT_LOG

`V016` создала базовые:

```text
(CREATED_AT DESC, ID DESC)
(USER_ID, CREATED_AT DESC)
```

`V018` добавила server-side filter indexes:

```text
(EVENT_TYPE, CREATED_AT DESC, ID DESC)
(OPERATION_TYPE, CREATED_AT DESC, ID DESC)
(STATUS, CREATED_AT DESC, ID DESC)
(USERNAME, CREATED_AT DESC, ID DESC)
(IP_ADDRESS, CREATED_AT DESC, ID DESC)
```

Это соответствует UI/filter API, где audit можно фильтровать по event type, operation type, status, username и IP при сохранении сортировки newest-first.

Таким образом старое утверждение «эти поля не используются как server-side filters» больше не актуально.

## ADMIN_TASK_SUCCESSES

```text
PRIMARY KEY (TASK_TYPE)
```

Таблица содержит небольшое число task types и читается/обновляется по `TASK_TYPE`. Index по `COMPLETED_AT` не нужен.

Runtime repository обращается к таблице через `search_path`; hardcoded `buslanes.admin_task_successes` недопустим для cloned deployments.

# Update/audit tables

## GEOMETRY_UPDATE_RUNS / OSM_CITY_UPDATE_RUNS

Это append-only operational journals. Пока runtime не имеет тяжёлого пользовательского filtering по timestamp/checksum, дополнительные indexes не добавляются заранее.

`ADMIN_AUDIT_LOG` отличается тем, что имеет реальный UI filters и поэтому индексируется шире.

# Temporary staging

KML matching создаёт временную spatial staging table и в рамках transaction строит временный GiST + `ANALYZE`.

City import и project-settings import также используют temporary staging structures.

Indexes этих temp tables не должны становиться постоянными schema objects.

# Spatial vs relational indexes

Для line viewport ключевой index — GiST geometry. B-tree indexes по city/type не заменяют spatial lookup.

Для report/materialization, наоборот, важны relational joins `(CITY_ID, LINE_TYPE_ID)`; GiST не заменяет их.

Такое разделение позволяет не пытаться обслужить все workload одним типом index.

# Миграции, влияющие на текущий audit

```text
V015__index_audit.sql
V016__admin_security_and_line_labels.sql
V017__protect_bootstrap_admin.sql
V018__admin_sessions_roles_profile_and_ip_security.sql
```

`V019__mapbox_project_setting.sql`, `V020__city_marker_icon.sql` и `V021__public_theme_preset.sql` добавляют singleton fields и дополнительных indexes не создают.

Следующее изменение schema/index set должно оформляться новой migration `V022+`, а не изменением уже применённых SQL files.

# Итог

Главные текущие решения:

```text
CITY_BOUNDARIES           GiST GEOM/BOUNDS + OSM natural identity
CITY_GEOMETRIES           GiST GEOM + (CITY_ID, LINE_TYPE_ID)
LINE_TYPES                unique normalized NAME
CITY_REPORT_VALUES        PK CITY_ID + RANK
ADMIN_USERS               normalized username + bootstrap invariant
ADMIN_SESSIONS            token hash + user/expiry indexes
ADMIN_LOGIN_IP_STATE      PK IP + partial lock expiry
ADMIN_BLOCKED_IPS         IP history + partial expiration
ADMIN_AUDIT_LOG           newest-first + filter-specific composite indexes
```

Остальные fields либо singleton/low-cardinality, либо не участвуют в текущих SQL predicates, поэтому дополнительные indexes без конкретного access path не создаются.
