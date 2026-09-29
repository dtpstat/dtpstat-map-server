# Редактор геометрий

Geometry editor работает с `CITY_GEOMETRIES` как с самостоятельными
доменными объектами. Administrative ownership не определяет lifecycle
геометрии: `CITY_ID` и `BOUNDARY_ID` — nullable derived links, которые
могут отсутствовать без ошибки.

## Поддерживаемые geometry types

Начиная с `V037`:

```text
Point
LineString
MultiLineString
Polygon
MultiPolygon
```

Line geometries требуют business line type и lanes; для point/polygon line-only
derived values остаются `NULL`. Editable metadata и geometry revision
хранятся вместе с объектом, включая `DISPLAY_NAME`, `TOOLTIP`, `TAGS`,
`SOURCE_TAGS`, `IS_VISIBLE`, `WAS_EDITED`, `UPDATED_AT`.

## Derived city/boundary links

Финальная модель введена `V045__spatial_geometry_links.sql`.

`CITY_ID` и `BOUNDARY_ID`:

- могут быть одновременно `NULL`;
- пересчитываются после geometry save;
- пересчитываются после OSM/admin boundary changes;
- не являются частью optimistic revision;
- relink сам по себе не изменяет `CITY_GEOMETRIES.UPDATED_AT`.

UI показывает такие объекты в группе **«Без привязки»**.

Spatial resolver:

- Point → deepest active territory;
- Line/MultiLine → territory с максимальной effective intersection length;
- Polygon/MultiPolygon → territory с максимальной effective intersection area;
- effective area parent исключает active descendant areas;
- при равенстве выбирается меньший `BOUNDARY_ID`.

`V049` отдельно фиксирует случай, когда aggregate descendant geometry
возвращается PostGIS как EMPTY, а не `NULL`.

## Права

Отдельное DB permission:

```text
CAN_EDIT_GEOMETRIES
```

Оно даёт доступ к geometry editor и mutation API независимо от широкого
`CAN_MANAGE_DATA`. `IS_SUPERUSER` включает это право автоматически.

## VIEW и EDIT

Выбор existing geometry не начинает редактирование. В VIEW отображается server
geometry.

**Начать редактирование** сначала получает edit lease. Только после успешного
lease acquisition UI переключается в EDIT:

- server base geometry скрывается;
- на карте отображается editable working copy;
- draft сохраняется локально;
- mutation требует lease token.

Если lease уже принадлежит другому client/user, обычный пользователь видит
owner lock и не может перехватить его. Superuser может выполнить force
takeover; старый token после этого невалиден.

## Edit leases

`V046__geometry_edit_leases.sql` создаёт `GEOMETRY_EDIT_LEASES`.

Ключевые поля:

```text
GEOMETRY_ID
TOKEN
USER_ID
CLIENT_ID
GENERATION
ACQUIRED_AT
LAST_SEEN_AT
EXPIRES_AT
```

Lease короткоживущий и cooperative. `GENERATION` увеличивается при takeover
или reacquisition после expiry, поэтому stale browser state не может незаметно
продолжить старую сессию редактирования.

После reload persisted token валидируется сервером до восстановления EDIT.
Expired token может быть resumed владельцем только если lease не был заменён.
Realtime `geometry-edit-leases` invalidation заставляет старый client удалить
отозванный local draft/token для конкретной geometry.

## Local workspace

Geometry drafts хранятся в versioned `localStorage` workspace.

Правила:

- новая geometry получает local id вида `local:<uuid>`;
- existing draft хранит `baseUpdatedAt` и edit token;
- future/incompatible storage schema не перезаписывается старым client;
- cross-tab изменения синхронизируются через storage events и realtime refresh;
- незавершённый drag/cut не перезаписывается внешним tab update посреди gesture.

Atomic bulk sync сохраняет create/update набор одной DB transaction. При
ошибке выполняется rollback, а local workspace остаётся. После success
удаляются только drafts, которые действительно были сохранены.

**Очистить локальные изменения** — явная destructive operation: editor
release-ит принадлежащие ему leases и очищает workspace.

## Optimistic concurrency

Lease — первая защита от одновременного interactive editing, но не единственная.

Existing geometry mutation также передаёт base revision (`UPDATED_AT` /
`baseUpdatedAt`). Если server revision уже изменилась, operation завершается
conflict вместо blind overwrite.

Merge/cut/delete используют тот же lease/revision contract.

## Import conflicts

KML import может создавать staged geometry conflicts (`V038`). Editor
показывает candidate/existing geometry и позволяет принять решение, не удаляя
несвязанные local drafts. Import apply остаётся transaction-bound.

## Realtime

Geometry editor использует общий admin WebSocket/realtime bus. События
геометрий и leases обновляют browser state без page reload. Realtime client id
также используется, чтобы отличать собственную mutation от изменения другого
client.

## Связанные migrations

```text
V036 geometry editor permission
V037 universal geometry model
V038 staged import conflicts
V039-V044 transitional integrity/rebinding hardening
V045 spatial-derived administrative links
V046 edit leases
V049 empty-descendant spatial resolver fix
```

## Future backlog

Ниже зафиксированы следующие связанные этапы развития editor. Это backlog, а
не контракт уже реализованного поведения; пункты должны вводиться небольшими
отдельными изменениями с regression tests.

### Карта и режимы редактирования

- [x] leased геометрии обозначать на карте нейтральным серым состоянием;
- [x] phantom midpoint/segment для добавления узла снабдить явным hint;
- [x] унифицировать add/delete cursors одной визуальной системой;
- [x] для point/line/polygon drawing явно показывать активный режим и специальный
  cursor;
- [x] line drawing не должен получать polygon fill; preview line должен совпадать
  со стилем рабочей editable line;
- [x] «Сохранить локально» завершает активный EDIT, но сохраняет lease/token за
  client до явного release/sync/discard;
- добавить перенос всей geometry drag-ом, отдельно от vertex drag;
- добавить coordinate editor в отдельном окне: табличный ввод точек и
  multi-row paste из clipboard.

### Геометрические операции

- сохранить существующий режим «Вырезать область…» для рисуемого cutter
  polygon;
- добавить использование существующей polygon geometry как cutter;
- добавить split line в выбранной точке/узле на две geometry;
- добавить split polygon режущей линией на две geometry;
- все destructive topology operations должны сохранять lease + optimistic
  revision + atomic transaction contract.

### Notification / realtime infrastructure

Реализовано:

- [x] общий client notification pool с publish/subscribe/dismiss/snapshot;
- [x] несколько notifications одновременно;
- [x] типы `info`, `log`, `warn`, `error`;
- [x] `info/log` auto-dismiss, `warn/error` persistent до явного закрытия;
- [x] user-visible WebSocket data-change/task/log/success проходят через общий
  notification channel;
- [x] server notification channel отделён от WebSocket transport;
- [x] перед каждой WS-delivery выполняется read-only повторная проверка session
  и текущих permissions;
- [x] realtime authorization не touch-ит `last_seen_at` и поэтому server push
  не продлевает idle-session;
- [x] role/permission change публикует targeted `refresh-session`; клиент
  перечитывает `/api/admin/me`, а при изменении capability set reload-ит UI;
- [x] revoke/block/delete/password reset публикуют targeted control event;
  revoked socket получает server-initiated logout и закрывается;
- [x] delivery audience поддерживает user/session targets и исключение текущей
  session; delivery metadata не отправляется браузеру.

Security rule: notification text рендерится только через `textContent`; HTML
из notification payload не интерпретируется. `warn/error` нельзя превратить
в auto-dismiss сообщением с сервера. Notification channel не является способом
обойти RBAC: transport повторно проверяет authoritative DB-backed session/user
state непосредственно перед отправкой.

### Point types и icons

Point geometry должна получить отдельный business type, определяющий icon.

В **Настройках интерфейса** нужен CRUD типов точек:

- name/title;
- active/inactive;
- icon upload;
- target width/height, default `32×32`;
- anchor X/Y, default center;
- delete с удалением связанного server file.

Разрешённый input: только строго распознанные PNG/GIF/SVG. Нельзя доверять
filename, extension или присланному MIME. Upload должен пройти signature/type
validation, decode/sanitize и **принудительное безопасное пересохранение** в
server-owned формате/файле до публикации. Для SVG требуется parse/sanitize с
запретом script/external references либо rasterization; исходный пользовательский
файл не должен отдаваться обратно как trusted asset.

Icons хранятся в отдельном server-owned каталоге, metadata/type — в PostgreSQL.
При delete type необходимо атомарно проверить references, удалить/заменить DB
record согласно выбранной policy и убрать связанный файл без orphan assets.

## Проверки

Для UI/application-only изменения:

```bash
npm run check
```

Если изменяются migrations/PostGIS/spatial SQL:

```bash
npm run check
npm run test:integration
```

Основные regression suites:

```text
test/geometry-editor-ui.test.js
test/geometry-editor-backend.test.js
test/geometry-editor-service.test.js
test/geometry-editor-policy.test.js
test/geometry-draft.test.js
test/geometry-suspended-ownership.test.js
```
