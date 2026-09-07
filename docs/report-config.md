# Конструктор расчётов и публичного отчёта

Начиная с `V014`, публичный ranking/CSV не зашит в код под один транспортный проект. Настройка находится в:

```text
Настройка интерфейса → Расчёты
```

и требует `CAN_MANAGE_INTERFACE` либо superuser.

Внутри четыре вкладки:

1. **Метрики**;
2. **Публичная таблица**;
3. **CSV**;
4. **Рейтинг**.

Все части сохраняются одной конфигурацией. После validation сервер пересчитывает `CITY_REPORT_VALUES`, затем обновляет public snapshots.

## Принцип: без произвольного SQL

Администратор не вводит SQL/table/column names. Он выбирает только server-owned entities:

- поля города;
- поля geometry;
- aggregate;
- business type;
- другую metric;
- допустимые constants;
- arithmetic operation;
- priority;
- scale/format.

Backend компилирует проверенную декларативную модель в SQL.

## Хранение

`REPORT_CONFIG` — singleton:

```text
METRICS
TABLE_COLUMNS
CSV_COLUMNS
RANK_METRIC_KEY
RANK_DIRECTION
UPDATED_AT
```

`CITY_REPORT_VALUES` — materialized result по city:

```text
CITY_ID
VALUES JSONB
RANK_VALUE
RANK
UPDATED_AT
```

Это обычная table, а не PostgreSQL materialized view: набор metrics динамический и не имеет фиксированных DB columns.

## Когда пересчитывается CITY_REPORT_VALUES

Полный refresh происходит:

- при startup;
- после real import/update cities/boundaries;
- после line import/update;
- после population update;
- после сохранения `REPORT_CONFIG`;
- после project-settings import.

При сохранении report config запись configuration и materialization выполняются согласованно в DB transaction/lock.

После commit пересобираются public files.

## Разрешённые исходные поля

Текущие logical fields:

| Поле | Семантика |
| --- | --- |
| `city.population` | население |
| `city.area_m2` | geodesic area boundary в м² |
| `geometry.length_m` | физическая длина geometry |
| `geometry.lane_length_m` | length с multiplier/числом полос |
| `geometry.lanes` | multiplier/lanes |
| `geometry.id` | source для `COUNT` |

`city.area_m2` считается как:

```text
ST_Area(CITY_BOUNDARIES.GEOM::geography)
```

Результат — м². При отсутствии boundary значение `NULL`.

## Aggregate geometry

Для numeric geometry fields доступны:

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

Median реализована ordered-set aggregate PostgreSQL:

```text
PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ...)
```

Пустой set для MEDIAN возвращает `NULL`.

## Business type filter

Geometry aggregate может быть ограничен одним `LINE_TYPES.NAME`.

Например:

```text
SUM(geometry.length_m WHERE LINE_TYPES.NAME = «Обособленные»)
```

`NAME` выбирается из текущего server-owned dictionary. Numeric `LINE_TYPES.CODE` в report semantic identity не используется.

## Metric references

Metric может ссылаться на другую metric как source/operand.

Например:

```text
network_length_m   = SUM(geometry.length_m)
separated_length_m = SUM(geometry.length_m WHERE type=«Обособленные»)
separation_ratio   = metric(separated_length_m) / metric(network_length_m)
```

Backend строит dependency graph и вычисляет metrics топологически.

Запрещены:

- reference на отсутствующую metric;
- self-reference;
- indirect cycle `A → B → C → A`.

UI order карточек не равен execution order. Карточки можно переставлять для удобства, а dependency order вычисляется отдельно.

## Arithmetic

Поддерживаются:

```text
+
-
×
÷
% от
```

Деление на `0`/`NULL` нормализуется в безопасный `NULL`, а не SQL exception.

Операции можно переставлять.

## Priority и ОПЗ

Каждая operation имеет priority `1…12`:

- большее число выполняется раньше;
- одинаковый priority — слева направо.

Старая configuration без priority нормализуется к default `1`.

Пример:

```text
A +[1] B ×[2] C
```

означает:

```text
A + (B × C)
```

ОПЗ:

```text
A B C × +
```

А:

```text
A +[2] B ×[1] C
```

означает:

```text
(A + B) × C
```

ОПЗ:

```text
A B + C ×
```

Backend переводит linear expression в RPN до SQL compilation. UI показывает read-only фактические brackets и ОПЗ.

## Единицы и scale

Рекомендуется хранить metric в canonical units:

- length — metres;
- area — m²;
- population — persons;
- ratio — `0..1`.

Публичная table и CSV могут независимо задавать `scale` и decimals.

Например одна metric `network_length_m` может показываться:

```text
HTML: km, scale=0.001
CSV:  m,  scale=1
```

## Conditional formatting

Conditional styles доступны для numeric table columns:

- `rank`;
- `metric`.

CSV presentation styles не экспортирует.

На одну column допускается до восьми rules. Пример:

```json
{
  "min": 10,
  "max": 20,
  "bold": true,
  "italic": false,
  "underline": true,
  "strike": false,
  "color": "#2457aa",
  "fontSizeStep": 1
}
```

Range semantics:

```text
min <= value < max
```

`null` означает open boundary.

Пример непрерывных ranges:

```text
min=null max=91
min=91   max=201
min=201  max=null
```

Для metric condition сравнивается число после `scale`, но до string rounding.

Если rules пересекаются, применяется первое совпавшее сверху. Порядок rules является частью configuration.

Styles влияют только на presentation, не на metric value/rank/sort.

## Пример: выделенные полосы

```text
lane_length_m    = SUM(geometry.lane_length_m)
population       = city.population
lane_m_per_1000  = metric(lane_length_m) / metric(population) × 1000
```

Table:

```text
№ | город | длина (км) | жители (тыс.) | м/1000 чел.
```

Display scale:

```text
lane_length_m × 0.001
population    × 0.001
```

Ranking:

```text
lane_m_per_1000 DESC
```

## Пример: трамвайная сеть

```text
network_length_m   = SUM(geometry.length_m)
separated_length_m = SUM(geometry.length_m WHERE type=«Обособленные»)
population         = city.population
separation_ratio   = metric(separated_length_m) / metric(network_length_m)
```

Display:

```text
separation_ratio × 100
network_length_m × 0.001
population       × 0.001
```

## Public report config

```text
GET /api/report-config
```

Публичный endpoint отдаёт UI configuration, необходимую для построения table/ranking:

- column order/type/title;
- `metricKey`;
- scale/decimals;
- conditional rules;
- ranking settings.

Metric values приходят вместе с city data в объекте `metrics`.

Desktop и mobile используют одну data/model implementation; отдельного duplicate набора rows для mobile нет.

## Public table loading state

Status загрузки списка городов отображается **внутри таблицы под её header**, только после того как report config уже построил header. До появления header отдельный status row не показывается.

После успешной загрузки routine status очищается. Errors/no-data остаются пользовательскими состояниями.

## CSV

CSV columns настраиваются отдельно от HTML table.

Доступны, в зависимости от current configuration:

- rank;
- city;
- metric;
- city category;
- bounds `minx/miny/maxx/maxy`.

CSV headers должны быть unique case-insensitively.

Generated file:

```text
var/public-downloads/bus-lanes.csv
```

Public URL:

```text
/bus-lanes.csv
```

## Ranking

Configuration задаёт:

```text
RANK_METRIC_KEY
RANK_DIRECTION = asc | desc
```

Materialization пишет `RANK_VALUE` и `RANK`. Rank partition учитывает категорию города в соответствии с current implementation.

## Admin API

Получение config/catalog:

```text
GET /api/admin/report-config
```

Сохранение:

```text
PUT /api/admin/report-config
Content-Type: application/json
```

Требуется `CAN_MANAGE_INTERFACE` или superuser.

Interactive web-admin использует session cookie; Basic остаётся доступен для scripted API.

## Связь с project-settings transfer

`REPORT_CONFIG` входит в:

```text
GET  /api/admin/settings/export
POST /api/admin/settings/import
```

Актуальный package format — schemaVersion 3. При import report config валидируется относительно итогового target set `LINE_TYPES.NAME`, после чего `CITY_REPORT_VALUES` строится заново на target data.

Подробнее: [project-settings-transfer.md](project-settings-transfer.md).

## Theme не влияет на расчёты

`PROJECT_SETTINGS.THEME_PRESET` (`retro/classic/modern`) изменяет presentation публичной страницы, но не semantic report config, metric values, ranking или CSV.

То же относится к custom city marker и line labels.

## Индексы

`CITY_REPORT_VALUES` использует:

```text
PRIMARY KEY (CITY_ID)
INDEX (RANK)
```

JSONB `VALUES` не индексируется, потому что public runtime читает готовый object, а не выполняет JSON predicates.

Подробнее: [database-indexes.md](database-indexes.md).
