# Аудит индексов PostgreSQL / PostGIS

Индексы соответствуют текущим SQL access paths. Неиспользуемый index увеличивает storage и стоимость `INSERT/UPDATE/DELETE`, VACUUM и bulk import.

Основной audit application tables зафиксирован `V015__index_audit.sql`. Security indexes добавлены `V016…V018`. `V019…V026` в основном расширяют singleton/configuration и OSM/report semantics; новых универсальных indexes для них не требуется.

## CITIES

Основные constraints/indexes:

```text
PRIMARY KEY (ID)
UNIQUE SOURCE_INDEX
UNIQUE SLUG
UNIQUE NAME
```

Public ranking читается из `CITY_REPORT_VALUES.RANK`; исторический city-ranking index больше не является основным report access path.

Отдельный index по low-cardinality `IS_LARGE` не нужен.

## CITY_POPULATIONS

```text
PRIMARY KEY (CITY_ID)
```

PK покрывает join с `CITIES.ID`. Runtime не фильтрует список по `POPULATION/AS_OF/SOURCE`, поэтому дополнительные B-tree indexes не нужны.

## CITY_BOUNDARIES

Relational identity/provenance:

```text
PRIMARY KEY (ID)
UNIQUE (OSM_TYPE, OSM_ID)
partial UNIQUE (CITY_ID) WHERE CITY_ID IS NOT NULL
```

Также используются indexes по OSM name/place type из базовой schema.

Spatial:

```text
GiST (GEOM)
GiST (BOUNDS)
```

`GEOM` обслуживает `&&`, `ST_Intersects`, `ST_Covers` и spatial matching. `BOUNDS` — extent/export.

### V023 и FULL_NAME

`V023` добавил generated `CITY_BOUNDARIES.FULL_NAME` и объединение `relation` fragments по:

```text
PLACE_TYPE + FULL_NAME
```

`FULL_NAME` пока не является frequent runtime lookup predicate после materialization, поэтому отдельный permanent B-tree не добавлен.

`(OSM_TYPE, OSM_ID)` сохраняется как source provenance и для portable transfer/link restoration. Это не означает, что один OSM object равен одному логическому городу после V023.

## CITY_GEOMETRIES

Spatial:

```text
GiST (GEOM)
```

Viewport path:

```text
GEOM && padded_bbox
AND ST_Intersects(GEOM, padded_bbox)
```

Relational:

```text
(CITY_ID, LINE_TYPE_ID)
BOUNDARY_ID
LINE_TYPE_ID
```

Отдельный `(CITY_ID)` не нужен: он является left prefix составного index. Отдельный `(LINE_TYPE_ID)` нужен для type-only access.

`PROPERTIES JSONB`, включая `placemarkName`, не индексируется: сейчас JSONB не используется как search predicate.

## LINE_TYPES

```text
PRIMARY KEY (ID)
UNIQUE (CODE)
UNIQUE LOWER(BTRIM(NAME))
```

Expression unique index соответствует transfer/import matching по normalized NAME.

## PROJECT_SETTINGS

Singleton:

```text
PRIMARY KEY (ID)
CHECK (ID = 1)
```

Здесь находятся project metadata, analytics, theme, line labels/popups, Mapbox token, city marker и `PUBLIC_DOWNLOAD_NAME`.

Все поля читаются по `ID=1`; дополнительные indexes бессмысленны.

## REPORT_CONFIG

Singleton:

```text
PRIMARY KEY (ID)
CHECK (ID = 1)
```

JSONB fields:

```text
METRICS
TABLE_COLUMNS
CSV_COLUMNS
RANK_SORT
```

Runtime не ищет rows по содержимому этих JSONB, поэтому GIN не нужен.

`RANK_SORT` из `V024` читается из singleton row и используется только при materialization.

## CITY_REPORT_VALUES

```text
PRIMARY KEY (CITY_ID)
CITY_REPORT_VALUES_RANK_IDX (RANK)
```

PK — update/join при materialization. `RANK` — public ranking.

`VALUES JSONB` возвращается целиком и не участвует в `@>`/JSON-path predicates, поэтому GIN пока не нужен.

## ADMIN_USERS

```text
PRIMARY KEY (ID)
UNIQUE LOWER(BTRIM(USERNAME))
UNIQUE ((1)) WHERE IS_BOOTSTRAP
```

Username expression index совпадает с login lookup. Bootstrap partial unique index обеспечивает DB invariant: максимум один bootstrap user.

Booleans roles/block state отдельно не индексируются из-за малого набора users и текущих access paths.

## ADMIN_SESSIONS

```text
PRIMARY KEY (ID)
UNIQUE (TOKEN_HASH)
(USER_ID, CREATED_AT DESC)
(EXPIRES_AT)
```

- token hash — authentication;
- user/time — list/revoke sessions;
- expiry — cleanup.

Plaintext session token в DB не хранится.

## ADMIN_SECURITY_SETTINGS

Singleton `ID=1`; indexes кроме PK не нужны.

## ADMIN_LOGIN_IP_STATE

```text
PRIMARY KEY (IP_ADDRESS)
partial (LOCKED_UNTIL) WHERE LOCKED_UNTIL IS NOT NULL
```

## ADMIN_BLOCKED_IPS

```text
PRIMARY KEY (ID)
(IP_ADDRESS, CREATED_AT DESC)
partial (EXPIRES_AT) WHERE EXPIRES_AT IS NOT NULL
```

## ADMIN_AUDIT_LOG

Основные indexes:

```text
(CREATED_AT DESC, ID DESC)
(USER_ID, CREATED_AT DESC)
(EVENT_TYPE, CREATED_AT DESC, ID DESC)
(OPERATION_TYPE, CREATED_AT DESC, ID DESC)
(STATUS, CREATED_AT DESC, ID DESC)
(USERNAME, CREATED_AT DESC, ID DESC)
(IP_ADDRESS, CREATED_AT DESC, ID DESC)
```

Они соответствуют реальным server-side filters audit UI.

## ADMIN_TASK_SUCCESSES

```text
PRIMARY KEY (TASK_TYPE)
```

Набор task types небольшой; index по completion time не нужен.

## Operational journals

`GEOMETRY_UPDATE_RUNS` / `OSM_CITY_UPDATE_RUNS` — append-only journals. Дополнительные indexes добавляются только при появлении тяжёлого runtime filtering.

## Temporary staging

KML/city/settings imports используют temporary staging. Для spatial KML matching создаётся temporary GiST и выполняется `ANALYZE`.

Temporary indexes не должны превращаться в permanent schema objects без реального runtime access path.

## Миграции, важные для текущего audit

```text
V015__index_audit.sql
V016__admin_security_and_line_labels.sql
V017__protect_bootstrap_admin.sql
V018__admin_sessions_roles_profile_and_ip_security.sql
V023__merge_osm_relation_city_parts.sql
V024__multi_column_report_ranking.sql
V025__public_download_name.sql
V026__dynamic_public_download_links.sql
```

`V019…V022` и `V025…V026` добавляют/меняют singleton/configuration fields и не требуют новых indexes.

Следующее schema/index изменение должно оформляться migration **V027+**.

## Итог

```text
CITY_BOUNDARIES      GiST GEOM/BOUNDS + OSM provenance identity
CITY_GEOMETRIES      GiST GEOM + (CITY_ID, LINE_TYPE_ID)
LINE_TYPES           normalized unique NAME
CITY_REPORT_VALUES   PK CITY_ID + RANK
ADMIN_USERS          normalized USERNAME + bootstrap invariant
ADMIN_SESSIONS       TOKEN_HASH + user/expiry
ADMIN_LOGIN_IP_STATE PK IP + partial lock expiry
ADMIN_BLOCKED_IPS    IP history + partial expiration
ADMIN_AUDIT_LOG      newest-first + filter-specific indexes
```

Остальные поля либо singleton/low-cardinality, либо не являются текущими predicates. Индексы «на всякий случай» не добавляются.
