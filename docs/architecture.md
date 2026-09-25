# Архитектура разработки DTP-Stat

Этот документ фиксирует архитектуру, к которой приведён backend после
рефакторинга domain modules. Это контракт для дальнейшей разработки: новый код
должен расширять существующие границы, а не возвращать исторические
compatibility-facade и общий каталог `src/data`.

## Основной принцип

У каждого поведения должен быть один канонический владелец. Старый путь после
переноса удаляется, а не остаётся как re-export/adapter «для совместимости».

Направление зависимостей должно идти от внешней композиции и инфраструктуры к
доменному коду, но не обратно.

## Слои

| Путь | Ответственность | Разрешённые зависимости |
| --- | --- | --- |
| `src/modules/<domain>` | Доменная политика, validation, parsers/plans, use cases, domain transport helpers и сфокусированные domain repositories | свой/другой domain module, `src/shared`, внешние библиотеки/Node |
| `src/application` | Cross-domain composition, runtime wiring, orchestration, long-lived subsystem assembly | `modules`, `db`, `shared`, HTTP adapters/routes в явных composition roots |
| `src/db` | Реальное persistence/storage и DB infrastructure | `db`, `shared`, при необходимости domain policy/compiler |
| `src/routes` | Express route registration и HTTP endpoint orchestration | `application`, `modules`, `http`, `shared`; не `db` |
| `src/http` | HTTP middleware/adapters, auth transport, public-site/server transport | `modules`, `shared`; не прямой `db` |
| `src/shared` | Domain-neutral reusable infrastructure | только `shared`, Node/external libraries и нейтральные top-level logging helpers |
| `src/testing` | Test-only defaults/helpers | production code не должен от него зависеть |
| `src/data` | **Удалённый legacy layer** | не создавать |

### Почему repositories бывают и в modules, и в db

`src/db` не означает «единственное место любого SQL».

Сфокусированный repository может находиться рядом с доменным use case, если он
является частью bounded implementation этого домена, например:

- `src/modules/lines/import-repository.js`;
- `src/modules/geometry/city-boundary-transfer-repository.js`;
- `src/modules/population/import-repository.js`;
- `src/modules/osm/boundary-update-repository.js`.

`src/db` используется для persistence/infrastructure, которое является
общесистемным, runtime-level или обслуживает несколько application slices:
connection/migrations/locks, project/report storage, security storage,
checkpoint storage и т.п.

Критерий — ownership, а не слово «repository».

## Запрещённые направления

Автоматические architecture tests закрепляют как минимум следующие границы:

- `modules -> application/db/routes/http/testing/data` запрещено;
- `shared -> application/db/modules/routes/http/testing/data` запрещено;
- `db -> application/routes/http/testing/data` запрещено;
- `routes -> db/testing/data` запрещено;
- `http -> application/db/routes/testing/data` запрещено;
- domain modules не импортируют Express/`node:http`/`node:https`;
- в `src/db` не создаются `*-service.js`, `*-runtime.js`,
  `*-routes.js` composition facades;
- `src/data` должен оставаться пустым/отсутствующим.

Если новый design действительно требует изменить одно из этих правил, это
отдельное архитектурное изменение: сначала меняется этот документ и
architecture guard с явным обоснованием, а не просто добавляется исключение.

## Composition roots

Основные точки сборки должны оставаться тонкими:

- `src/application/server-runtime.js` — строит long-lived graph сервисов и
  repositories после migrations;
- `src/application/http/api-composition.js` — подключает API route families;
- `src/app.js` — собирает Express application;
- `src/server.js` — startup/process lifecycle.

Новый subsystem обычно получает собственный `src/application/*-runtime.js`,
если ему требуется собрать несколько repositories/services/infrastructure
dependencies.

Не создавайте composition facade в `src/db` только потому, что большинство
его зависимостей связано с PostgreSQL.

## Как выбирать место для нового кода

### Domain rule / validation / parser / plan

Размещать в:

```text
src/modules/<domain>/
```

Примеры текущих owners: lines, OSM, geometry, population, project, reporting,
security.

### Domain use case

Размещать в `src/modules/<domain>`. Use case получает persistence/runtime
dependencies через аргументы или создаёт только свой сфокусированный
domain-repository.

Он не должен импортировать `src/db` или HTTP layer.

### Cross-domain/runtime composition

Размещать в:

```text
src/application/
```

Именно здесь допустимо связать domain service с `src/db` storage,
authorization, derived refresh и другими subsystem dependencies.

### SQL/storage

Сначала определить owner:

- domain-specific persistence — repository рядом с domain module;
- cross-domain/runtime persistence и DB infrastructure — `src/db`.

SQL не должен «утекать» в route handlers или application composition только
ради удобства.

### HTTP

- endpoint/routing — `src/routes`;
- reusable HTTP adapter/middleware — `src/http` или `src/shared/http`;
- transport-neutral domain validation остаётся в `src/modules`.

Route получает service/repository через dependency injection; прямой импорт из
`src/db` запрещён.

### Общая инфраструктура

Только действительно domain-neutral код размещается в `src/shared`.
Если helper знает о project/OSM/lines/security semantics, он не shared.

## Перенос ownership

При переносе существующего кода обязательна последовательность:

1. определить канонический domain/application owner;
2. переместить реализацию;
3. обновить все production/test/script consumers;
4. удалить старый путь полностью;
5. не оставлять compatibility re-export;
6. добавить architecture guard на удалённый путь или новое правило;
7. сохранить поведение отдельным refactoring commit, если функциональное
   изменение не является целью задачи.

Это особенно важно для import paths: несколько предыдущих regressions были
вызваны единичными stale imports после корректного ownership move.

## Транзакции и orchestration

Фокусированный repository отвечает за свои SQL operations.

Если одна операция координирует несколько persistence slices, lifecycle stages
или derived refresh, transaction/orchestration должен находиться в owning
domain service или `src/application` runtime. Не создавать для этого
«repository», который на деле только собирает другие repositories/services.

## Что не является причиной для рефакторинга

Размер файла сам по себе не является архитектурным дефектом. Не дробить parser,
policy или streaming implementation механически только ради числа строк.

Выделение нового модуля оправдано ownership/responsibility boundary, повторным
использованием или направлением зависимостей.

## Проверки

Быстрый architecture-only прогон:

```bash
npm run test:architecture
```

Полная обязательная regression-проверка:

```bash
npm run check
```

При изменениях PostgreSQL/PostGIS дополнительно:

```bash
npm run test:integration
```

Architecture tests находятся в
`test/domain-architecture.test.js`. Их задача — не проверять косметическую
структуру каталогов, а не позволять постепенно вернуть слои/facades, которые
были удалены рефакторингом.
