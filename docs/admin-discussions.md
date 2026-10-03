# Admin discussions

Admin discussions — общий domain для человеческих обсуждений административных
объектов. Он не является notification/toast infrastructure и не используется
для системных логов.

## Subject model

Начиная с `V063__admin_discussion_subjects.sql` существующие обсуждения
геометрий мигрируются in-place в общие таблицы:

- `ADMIN_DISCUSSION_MESSAGES`;
- `ADMIN_DISCUSSION_READ_STATE`.

Поддерживаемые `SUBJECT_TYPE`:

- `geometry`;
- `osm-boundary`.

Существующие message id и read position геометрий сохраняются. Миграция не
копирует историю в параллельную таблицу.

Каждое сообщение хранит:

- subject type/id;
- автора;
- revision объекта на момент сообщения;
- текст;
- timestamps.

Read state хранится отдельно на комбинацию
`(subject_type, subject_id, user_id)`.

## RBAC

Discussion не создаёт отдельного обходного permission.

Пользователь видит в inbox только subject types, для которых у него есть
текущая capability:

- `canEditGeometries` → geometry;
- `canEditOsm` → osm-boundary;
- superuser → оба типа.

Subject-specific API дополнительно защищены соответствующим editor permission.

## Profile inbox

`GET /api/admin/profile/discussions` возвращает единый read model:

- subject type/id/title/subtitle;
- наличие исходного объекта;
- geometry city/workspace id, когда применимо;
- последнее сообщение и автора;
- unread count по треду;
- общий `totalUnread`.

Общий inbox расположен в верхнем разделе админки **Сообщения**. В geometry
editor кнопка thread закреплена в правом верхнем углу карточки выбранной
геометрии; unread badge не зависит от положения scroll. OSM editor использует
тот же discussion domain и transport.

Inbox позволяет:

- открыть thread;
- читать/отправлять сообщения;
- видеть delivered/read receipt;
- перейти к исходной геометрии или OSM-объекту;
- видеть общий unread badge на вкладке профиля.

Удалённый subject может оставаться в inbox как исторический thread, но переход
к объекту и отправка нового сообщения для него отключаются.

## Realtime

Geometry и OSM discussions публикуют data-change events после успешной
persistence.

Для обоих типов публикуются:

- новое сообщение;
- изменение read position.

Клиенты не должны увеличивать unread на событии `action=read`. Read event
используется для сброса собственного unread в других вкладках и обновления
receipt у автора.

## Avatar transport

Avatar endpoints находятся под `/api/admin/*` и подчиняются обязательному
`X-DTPStat-API-Version`.

Поэтому protected avatar URL нельзя назначать напрямую через `<img src>` или
CSS `url(...)`: browser image request не проходит через admin fetch guard.

Все admin UI, включая Profile, Security, Geometry discussion, OSM discussion и
discussion inbox, загружают avatar через `adminAvatarObjectUrl()`:

1. guarded same-origin `fetch`;
2. проверка успешного image response;
3. `Blob`;
4. локальный `blob:` object URL для image/background.

Server-side API version guard для avatar routes не ослабляется.


## UI state

Discussion UI не дублирует notification/toast pool:

- envelope/thread marker означает наличие человеческого обсуждения;
- unread badge считается из persistent read state;
- открытие thread обновляет read position;
- общий раздел **Сообщения** агрегирует geometry и OSM subjects;
- переход к subject восстанавливает нужный editor context, если объект ещё
  существует и permission остаётся доступным.

В avatar rendering используется общий guarded fetch helper
`adminAvatarObjectUrl()`; прямой protected `<img src>` не используется.
