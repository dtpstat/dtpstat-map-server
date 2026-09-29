# Администраторы, роли, sessions и аудит

Administrative identity/security хранится в PostgreSQL.

Основные migrations:

```text
V016__admin_security_and_line_labels.sql
V017__protect_bootstrap_admin.sql
V018__admin_sessions_roles_profile_and_ip_security.sql
```

Последующие `V019…V026` расширяют project/report configuration и используют ту же admin/security infrastructure, но не меняют основную модель аутентификации.

## Аутентификация

### Web-admin

```text
POST /api/admin/login
POST /api/admin/logout
GET  /api/admin/me
```

Успешный login создаёт HttpOnly session cookie. В production используется
host-only cookie:

```text
__Host-dtpstat_admin_session
```

Production cookie всегда имеет `Secure; HttpOnly; SameSite=Strict; Path=/`,
не содержит `Domain` и сервер принимает session token только под
`__Host-` именем. Legacy `dtpstat_admin_session` в production не является
fallback.

В development/test сохраняется `dtpstat_admin_session` для совместимости с
локальным HTTP; при HTTPS к ней добавляется `Secure`. Первый deployment с
переходом на `__Host-` завершает ранее открытые browser sessions и требует
повторного login.

В `ADMIN_SESSIONS` хранится SHA-256 hash token, а не plaintext token.

### Session-only online authentication

Защищённый admin HTTP API и WebSocket **не принимают HTTP Basic**.
Пароль передаётся только в `POST /api/admin/login`; успешный login создаёт
DB-backed session cookie. Bootstrap credentials из `.env` используются только
для initial bootstrap/recovery tooling и не являются online-login fallback.

## Права

| DB field | Назначение |
| --- | --- |
| `CAN_MANAGE_DATA` | import/export, OSM/KML, data tasks |
| `CAN_MANAGE_INTERFACE` | project, Mapbox, theme, marker, report config, line types |
| `CAN_MANAGE_USERS` | users |
| `CAN_VIEW_AUDIT` | audit log |
| `CAN_MANAGE_SECURITY` | security policy/blocks |
| `CAN_EDIT_OSM` | отдельный доступ к OSM object editor |
| `CAN_EDIT_GEOMETRIES` | отдельный доступ к geometry editor и mutation API |

`IS_SUPERUSER=true` даёт все permissions.

`MUST_CHANGE_PASSWORD=true` ограничивает interactive session profile/password/logout flow до смены пароля; остальные protected endpoints возвращают `428`.

## Bootstrap-superuser

Если `ADMIN_USERS` пуст, startup использует:

```dotenv
IMPORT_API_USERNAME=admin
IMPORT_API_PASSWORD=replace-with-a-long-random-password
```

Bootstrap row получает:

```text
IS_BOOTSTRAP = true
IS_SUPERUSER = true
все CAN_* = true
```

Если users уже существуют, изменение этих ENV values не меняет DB credentials.

`V017` обеспечивает DB-level invariant: bootstrap user нельзя удалить, лишить superuser/bootstrap state или защищённых permissions.

Temporary anti-bruteforce lockout для него разрешён.

## Пароли

`ADMIN_USERS.PASSWORD_HASH` — salted versioned `scrypt-v1`.

Plaintext password, session token и Authorization header не должны попадать в DB/audit.

Обычный UI password: `12…1024` characters.

## Sessions/profile/avatar

`V018` добавил:

- display/profile fields;
- PNG/JPEG/WebP avatar до 256 KiB;
- active sessions list/revoke;
- idle/absolute session lifetime.

`ADMIN_SESSIONS` содержит user id, token hash, timestamps, IP и User-Agent.

## Account anti-bruteforce

Policy в `ADMIN_SECURITY_SETTINGS`:

| Field | Default |
| --- | ---: |
| `MAX_FAILED_ATTEMPTS` | 5 |
| `FAILURE_WINDOW_SECONDS` | 900 |
| `LOCKOUT_SECONDS` | 900 |

State пользователя:

```text
FAILED_LOGIN_COUNT
FAILED_LOGIN_WINDOW_STARTED_AT
LOCKED_UNTIL
```

Unknown username проходит dummy scrypt operation для уменьшения timing leakage.

## IP anti-bruteforce

State хранится в `ADMIN_LOGIN_IP_STATE`.

| Field | Default |
| --- | ---: |
| `IP_MAX_FAILED_ATTEMPTS` | 20 |
| `IP_FAILURE_WINDOW_SECONDS` | 900 |
| `IP_LOCKOUT_SECONDS` | 3600 |

Account и IP counters независимы.

## Manual blocks

Account manual block fields находятся в `ADMIN_USERS`.

`ADMIN_BLOCKED_IPS` хранит manual IP blocks с optional expiration, reason/admin и audit linkage.

## Session/audit and HTTP request policy

| Field | Default |
| --- | ---: |
| `SESSION_IDLE_SECONDS` | 1800 |
| `SESSION_ABSOLUTE_SECONDS` | 43200 |
| `AUDIT_RETENTION_DAYS` | 365 |
| `REQUEST_RATE_LIMIT_USER_PER_MINUTE` | 600 |
| `REQUEST_RATE_LIMIT_GLOBAL_PER_MINUTE` | 5000 |

Global HTTP rate limiting is applied before authentication for `/api/admin/*`;
per-user limiting is applied after successful authentication. Security settings
used by the pre-auth limiter are cached briefly, so a request flood does not
turn the limiter into a settings-query flood. The global limit must be greater
than or equal to the per-user limit.

Rate-limit responses use `429` and `Retry-After`. Logging/audit for exceeded
limits is coalesced to one event per minute-window per scope/user, while every
excess request is still rejected.

Во время browser upload и пока background admin task находится в
`queued/running/cancelling`, web-admin удерживает idle-session активной:
раз в 30 секунд выполняется same-origin `GET /api/admin/me`. Клиентский
idle-redirect на это время приостанавливается, а сервер обновляет
`last_seen_at` не реже половины configured idle window (с верхней границей
60 секунд). `SESSION_ABSOLUTE_SECONDS` остаётся жёстким пределом и keepalive
его не продлевает.

## Основные HTTP responses

```text
401  auth отсутствует/неверен/expired
403  manual block или недостаточно rights
423  temporary account lockout
429  temporary IP lockout or HTTP request rate limit
428  password change required
```

Temporary lockouts возвращают `Retry-After`.

## Request tampering / malformed requests

Admin HTTP requests reject attempts to assert server-owned authentication or
authorization context through headers, query parameters or top-level JSON
fields. Protected attributes include `UserID`, `RoleIR`, `ToleIR`,
`RoleMode`, role/permission collections, session/auth identity,
`isSuperuser`, `isBootstrap` and capability flags.

The dedicated user-management create/update API may accept its documented
`canManage*` / `canEdit*` capability fields; immutable identity and role
override attributes remain rejected there.

Tamper events store only the suspicious field name and source
(`header` / `query` / `body`), never the supplied value. Authenticated
HTTP responses with error status, malformed JSON, oversized bodies,
unsupported encodings and unknown admin API routes are also recorded. Raw and
streaming upload bodies are not reparsed as JSON; their headers/query remain
covered and their own schema/size validators remain authoritative.

## Strict API contract and client version

Каждый admin route имеет явный contract: HTTP method, path parameters, query,
headers и JSON fields. Неизвестные/дублирующиеся поля, server-owned identity/
permission attributes, method-override headers, malformed/confusable names и
mutating query parameters отклоняются до business handler. Mutating
`POST/PUT/PATCH/DELETE` используют body как единственный источник application
input.

Browser admin client передаёт текущую API version для каждого
`/api/admin/*` запроса. Несовместимый client получает `426`; UI блокирует
дальнейшие mutations и требует reload, не удаляя local geometry workspace.
Admin WebSocket versioned отдельно через subprotocol и также не принимает
несовместимый client.

Contract/probing violations считаются security incidents. Начиная с `V048`
счётчик и request-specific IP lockout сохраняются в
`ADMIN_LOGIN_IP_STATE`; supplied значения подозрительных параметров в
security log не записываются.

## Origin / CSRF boundary

Production требует явный allowlist:

```dotenv
ADMIN_ALLOWED_ORIGINS=https://admin.example.com
```

Для mutating `/api/admin/*` запросов `Origin` обязателен и должен точно
совпасть с allowlist. Wildcards не поддерживаются. `Sec-Fetch-Site` допускает
только `same-origin` / `none`; `same-site` недостаточно.

Admin WebSocket использует тот же allowlist и отклоняет handshake без `Origin`
или с чужим origin до authentication/upgrade.

В development/test при пустом allowlist используется только динамический
same-origin fallback; production без `ADMIN_ALLOWED_ORIGINS` не стартует.

### Reverse proxy

При TLS termination на nginx Express должен знать исходный protocol/IP.

Для одного trusted nginx:

```dotenv
HTTP_TRUST_PROXY_HOPS=1
```

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Без `X-Forwarded-Proto` корректный `Origin: https://...` может быть отклонён как:

```text
Cross-site administrative request rejected
```

Не доверяйте forwarded headers, если Node port доступен клиенту напрямую.

## Journal security events / fail2ban integration

Security-significant события пишутся одной строкой в stderr:

```text
[security] {"marker":"DTPSTAT_SECURITY_V1","event":"admin.request.ip_lockout","ip":"203.0.113.10",...}
```

При запуске процесса под systemd stderr автоматически попадает в journald.
Stable marker `DTPSTAT_SECURITY_V1`, `event` и `ip` предназначены для
внешнего анализа и fail2ban. Конфигурация fail2ban находится за рамками
приложения; приложение не запускает `systemd-cat` и не создаёт subprocess ради
логирования.

Проверка потока journal, если deployment использует systemd:

```bash
journalctl -o cat -u <service> | grep 'DTPSTAT_SECURITY_V1'
```

## Audit

`ADMIN_AUDIT_LOG` содержит, в частности:

```text
CREATED_AT
EVENT_TYPE
OPERATION_TYPE
STATUS
DURATION_MS
IP_ADDRESS
USER_ID
USERNAME snapshot
DETAILS JSONB
```

В audit входят login/lockout, data/settings operations, users/security и завершение background admin tasks.

Для **несекретных mutating admin operations** `DETAILS` теперь хранит не только HTTP method/path/status, но и конкретный bounded change-set:

```json
{
  "changes": [
    { "path": "themePreset", "before": "classic", "after": "modern" },
    { "path": "showLineLabels", "before": false, "after": true }
  ]
}
```

Synchronous settings editors строят field-level `before → after`. Background data tasks записывают input parameters, SHA-256/byte-size загруженного payload там, где он есть, sanitized `changeSummary` из результата операции и **полный `taskLog` задачи** от принятия до финального status. Наружный массив `taskLog` намеренно не ограничивается общим лимитом 100 элементов: для анализа сохраняются все log entries. Содержимое каждой записи по-прежнему проходит redaction/size/depth guards, поэтому password/token/Authorization-like values не сохраняются открытым текстом. В server service log вместо полного массива пишется только `taskLogEntries`, чтобы не дублировать большой журнал.

Audit deliberately **не хранит concrete values security/profile operations**. Пароли, temporary passwords, session/cookie/Authorization values, hashes, secrets, credentials, private/API keys и поля с token-like именами не попадают в clear text. Для token-like полей несекретной конфигурации audit может показать сам факт изменения, но значения будут `[redacted]`. `settings.import` сравнивает только `projectSettings`, `lineTypes` и `reportConfig`; `securitySettings` из value-level diff исключены целиком.

Чтобы `DETAILS` не превращался в копию импортируемых данных, строки/depth/обычные collections/change count ограничены; бинарные значения сохраняются только как metadata, а `createdAt/updatedAt` игнорируются как audit noise. Единственное специальное исключение по длине коллекции — верхний массив background-task `taskLog`: он хранится полностью, потому что это журнал выполнения, а не копия payload. Для больших data imports сам payload в audit не сохраняется: сохраняется fingerprint, позволяющий доказать, какой именно файл/JSON был применён.

В web-admin JSON-details показывают `Изменения (N)`, `Журнал (M)` или оба счётчика одновременно. CSV export продолжает включать весь `DETAILS`, включая `taskLog`, как JSON.

`V018` добавил indexes для filters по event/operation/status/username/IP. Новая детализация использует существующий `DETAILS JSONB`, поэтому отдельная DB migration не требуется.

## WebSocket

```text
/api/admin/ws
```

использует тот же auth service. Для data WebSocket нужен `CAN_MANAGE_DATA` или superuser.

Task state process-local: один Node process имеет собственный `createAdminTaskManager()`. Отдельные Node instances не должны делить active task/cancel state.


### Realtime authorization и server-initiated session control

WebSocket authorization не считается неизменной после handshake. Перед каждой
task/data/notification delivery gateway повторно читает DB-backed session/user
state через read-only realtime-auth path и заново применяет permission policy.
Поэтому снятое право прекращает давать соответствующие события без reconnect.

Realtime-auth намеренно **не** обновляет `ADMIN_SESSIONS.LAST_SEEN_AT`:
server push не является пользовательской активностью и не продлевает idle
session.

Изменение роли/permissions отправляет targeted notification с control
`refresh-session`. Browser перечитывает `GET /api/admin/me`; если capability
set изменился, admin UI перезагружается, при этом persistent local geometry
workspace не уничтожается.

При revoke/block/delete/password reset gateway получает targeted delivery,
обнаруживает уже недействительную session, отправляет `session-control/logout`
и закрывает WebSocket. Audience фильтруется по user/session identity до
доставки, а внутренние `permission/audience` metadata браузеру не передаются.

## Recovery: разблокировка

```bash
npm run admin:unblock -- --user admin1
npm run admin:unblock -- --ip 203.0.113.10
npm run admin:unblock -- --user admin1 --ip 203.0.113.10
```

User path снимает manual/automatic account blocks и failed-login state.

IP path очищает automatic throttle и active manual blocks этого IP.

## Recovery: credentials единственного superuser

```bash
npm run admin:set-superuser
```

По умолчанию берёт bootstrap ENV values. Можно передать явно:

```bash
npm run admin:set-superuser -- --username admin1 --password 'new-password'
```

Команда требует ровно одного `IS_SUPERUSER=TRUE`; иначе transaction rollback.

При успехе credentials/permissions восстанавливаются, account block снимается, sessions этого superuser отзываются.

IP state намеренно не очищается — при необходимости отдельно:

```bash
npm run admin:unblock -- --ip 203.0.113.10
```

## Связанные документы

- [deployment.md](deployment.md)
- [database-indexes.md](database-indexes.md)
- [project-settings-transfer.md](project-settings-transfer.md)
- [geometry-editor.md](geometry-editor.md)

Последняя security migration — `V048__admin_request_incident_lockout.sql`; общая последовательность schema уже включает `V049__empty_descendant_spatial_relink.sql`, поэтому следующее изменение DB schema должно использовать **V050+**.


## Future security backlog

Отложено намеренно:

- MFA/passkeys/TOTP для admin/superuser;
- dependency/CodeQL/Dependabot policy в CI/CD;
- optional external audit/security collectors (например Zabbix/SIEM);
- отдельный расширенный regression suite для всех production security headers.


## Prometheus access

Начиная с V054, доступ к `/metrics` управляется через
`ADMIN_SECURITY_SETTINGS`. В БД хранится только SHA-256 hash bearer token.
Plaintext token возвращается только в ответ на явную ротацию и не входит в
project settings export, audit details или service logs.

Включить metrics без настроенного token нельзя. Очистка token автоматически
выключает endpoint. ENV `METRICS_ENABLED` / `METRICS_BEARER_TOKEN` служат
только одноразовым bootstrap и после `METRICS_SETTINGS_INITIALIZED=true` не
переопределяют настройки администратора.


## Administrative MFA recovery

A superuser can reset MFA for another administrator from
**Users → Access → Reset MFA**. The operation cannot target the current
superuser account. Reset removes the encrypted TOTP secret, pending enrollment,
recovery-code hashes and pending MFA challenges, revokes all sessions for the
target account, and is recorded by the administrative operation audit as
`security.user.mfa.reset`.

The reset endpoint never returns an MFA secret or recovery code. The affected
administrator must sign in with their password and enroll MFA again.
