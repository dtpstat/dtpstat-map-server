# Конструктор расчётов и публичного отчёта

Настройка находится в:

```text
Настройка интерфейса → Расчёты
```

Нужен `CAN_MANAGE_INTERFACE` или superuser.

Конфигурация разделена на:

1. **Метрики**;
2. **Публичную таблицу**;
3. **CSV**;
4. **Рейтинг**.

Сохранение configuration пересчитывает `CITY_REPORT_VALUES`, после чего пересобираются public snapshots.

## Без произвольного SQL

Admin выбирает только server-owned элементы DSL:

- поля city/geometry;
- aggregate;
- business line type;
- другую metric;
- constant;
- arithmetic operator;
- priority;
- display scale/precision;
- ordered ranking criteria.

Backend валидирует модель и компилирует SQL сам.

## Хранение

`REPORT_CONFIG` — singleton:

```text
METRICS
TABLE_COLUMNS
CSV_COLUMNS
RANK_SORT
RANK_METRIC_KEY
RANK_DIRECTION
UPDATED_AT
```

`RANK_SORT` добавлен в `V024`. Старые `RANK_METRIC_KEY/RANK_DIRECTION` остаются compatibility mirror первого criterion.

`CITY_REPORT_VALUES`:

```text
CITY_ID
VALUES JSONB
RANK_VALUE
RANK
UPDATED_AT
```

`RANK_VALUE` хранит значение первого ranking criterion. Остальные значения уже находятся в `VALUES`.

## Когда выполняется refresh

Полный materialization refresh происходит:

- при startup;
- после real city/boundary update;
- после line update/import;
- после population update;
- после изменения `REPORT_CONFIG`;
- после project-settings import.

## Доступные исходные поля

| Logical field | Семантика |
| --- | --- |
| `city.population` | население |
| `city.area_m2` | площадь OSM boundary в м² |
| `geometry.length_m` | физическая длина geometry |
| `geometry.lane_length_m` | длина с multiplier/lanes |
| `geometry.lanes` | multiplier/lanes |
| `geometry.id` | source для `COUNT` |

`city.area_m2` считается через:

```text
ST_Area(CITY_BOUNDARIES.GEOM::geography)
```

## Aggregates

Для numeric geometry fields:

```text
SUM
AVG
MEDIAN
MIN
MAX
```

Для `geometry.id`:

```text
COUNT
```

Median использует PostgreSQL:

```text
PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ...)
```

## Business line type filter

Aggregate может быть ограничен одним `LINE_TYPES.NAME`, например:

```text
SUM(geometry.length_m WHERE type = «Обособленные»)
```

NAME выбирается из текущего dictionary. Numeric CODE не является semantic identity report configuration.

## Metric references

Metric может ссылаться на уже объявленную logical metric как source или operand:

```text
network_length_m   = SUM(geometry.length_m)
separated_length_m = SUM(geometry.length_m WHERE type=«Обособленные»)
separation_ratio   = metric(separated_length_m) / metric(network_length_m)
```

Backend строит dependency graph и вычисляет metrics топологически.

Запрещены:

- reference на отсутствующую metric;
- self-reference;
- dependency cycles.

UI order карточек и execution order — разные понятия.

## Arithmetic и priority

Операторы:

```text
+
-
×
÷
% от
```

Деление на `0`/`NULL` даёт `NULL`, а не SQL exception.

Каждая operation имеет priority `1…12`:

- большее число выполняется раньше;
- одинаковый priority — слева направо.

Backend преобразует linear expression в RPN до SQL compilation.

Пример:

```text
A +[1] B ×[2] C
```

эквивалентен:

```text
A + (B × C)
```

## Единицы и display scale

Рекомендуемые canonical units:

- length — metres;
- area — m²;
- population — persons;
- ratio — `0..1`.

HTML table и CSV независимо задают `scale` и `decimals`.

Например:

```text
metric: network_length_m
HTML: × 0.001 → km
CSV:  × 1     → m
```

## Conditional formatting

Доступно для numeric public-table columns (`rank`, `metric`).

Range semantics:

```text
min <= value < max
```

`null` означает open boundary. Если ranges пересекаются, выигрывает первое правило сверху.

Поддерживаются:

- bold;
- italic;
- underline;
- strike;
- color;
- relative font-size step.

Presentation rules не влияют на metric value/ranking/CSV data.

## Последовательный рейтинг

`V024` добавил ordered multi-column ranking. Допускается до восьми уникальных metrics.

```json
{
  "rank": {
    "sort": [
      { "metricKey": "separation_ratio", "direction": "desc" },
      { "metricKey": "network_length_m", "direction": "desc" },
      { "metricKey": "population", "direction": "asc" }
    ]
  }
}
```

Семантика:

```text
1. separation_ratio DESC
2. при равенстве → network_length_m DESC
3. при равенстве → population ASC
4. при полном равенстве → city.name ASC
```

Все criteria используют `NULLS LAST`.

Если значение **первого** criterion `NULL`, `RANK` остаётся `NULL`, как в прежней модели.

Ranking вычисляется отдельно внутри категорий:

```sql
PARTITION BY COALESCE(city.is_large, FALSE)
```

Одинаковую metric нельзя добавить дважды.

Старый single-rank формат по-прежнему принимается:

```json
{
  "rank": {
    "metricKey": "score",
    "direction": "desc"
  }
}
```

и нормализуется в `rank.sort` из одного элемента.

Клик пользователя по header публичной таблицы — временная UI single-column сортировка; он не меняет materialized `RANK`.

## Пример: выделенные полосы

```text
lane_length_m   = SUM(geometry.lane_length_m)
population      = city.population
lane_m_per_1000 = metric(lane_length_m) / metric(population) × 1000
```

## Пример: трамвайная сеть

```text
network_length_m   = SUM(geometry.length_m)
separated_length_m = SUM(geometry.length_m WHERE type=«Обособленные»)
population         = city.population
separation_ratio   = metric(separated_length_m) / metric(network_length_m)
```

Пример ranking:

```text
separation_ratio DESC
network_length_m DESC
```

## Public API

```text
GET /api/report-config
```

Возвращает presentation configuration:

- columns;
- metricKey;
- scale/decimals;
- conditional rules;
- `rank.sort`;
- compatibility aliases первого ranking criterion.

Actual metric values приходят в city payload `metrics`.

Desktop/mobile используют один table model; отдельных duplicate rows нет.

## Admin API

```text
GET /api/admin/report-config
PUT /api/admin/report-config
```

PUT требует `CAN_MANAGE_INTERFACE` или superuser.

## CSV

CSV columns конфигурируются независимо от HTML table. Доступны:

- rank;
- city;
- metric;
- category;
- bounds `minx/miny/maxx/maxy`.

Headers должны быть unique case-insensitively.

Имя generated CSV не зашито в report config. Оно берётся из:

```text
PROJECT_SETTINGS.PUBLIC_DOWNLOAD_NAME
```

Например `tram-lines`:

```text
var/public-downloads/tram-lines.csv
/tram-lines.csv
```

GeoJSON использует то же base name с расширением `.geojson`.

## Settings transfer

`REPORT_CONFIG` входит в project-settings package.

Текущий package format:

```text
schemaVersion 6
```

- v5 добавил `rank.sort`;
- v6 добавил `projectSettings.publicDownloadName`.

Legacy single-rank packages остаются импортируемыми.

Подробнее: [project-settings-transfer.md](project-settings-transfer.md).

## Индексы

`CITY_REPORT_VALUES` использует:

```text
PRIMARY KEY (CITY_ID)
INDEX (RANK)
```

`VALUES JSONB` сейчас не требует GIN: runtime возвращает whole object и не выполняет JSON predicates.

Подробнее: [database-indexes.md](database-indexes.md).
