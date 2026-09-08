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

Успешный login создаёт HttpOnly cookie:

```text
dtpstat_admin_session
```

Cookie использует `SameSite=Strict`; при HTTPS — `Secure`.

В `ADMIN_SESSIONS` хранится SHA-256 hash token, а не plaintext token.

### HTTP Basic

DB-backed Basic остаётся для `curl`/automation/compatibility clients. Он проверяет `ADMIN_USERS`.

Bootstrap credentials из `.env` после создания DB user не являются параллельным login fallback.

## Права

| DB field | Назначение |
| --- | --- |
| `CAN_MANAGE_DATA` | import/export, OSM/KML, data tasks |
| `CAN_MANAGE_INTERFACE` | project, Mapbox, theme, marker, report config, line types |
| `CAN_MANAGE_USERS` | users |
| `CAN_VIEW_AUDIT` | audit log |
| `CAN_MANAGE_SECURITY` | security policy/blocks |

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

## Session/audit policy

| Field | Default |
| --- | ---: |
| `SESSION_IDLE_SECONDS` | 1800 |
| `SESSION_ABSOLUTE_SECONDS` | 43200 |
| `AUDIT_RETENTION_DAYS` | 365 |

## Основные HTTP responses

```text
401  auth отсутствует/неверен/expired
403  manual block или недостаточно rights
423  temporary account lockout
429  temporary IP lockout
428  password change required
```

Temporary lockouts возвращают `Retry-After`.

## CSRF / same-origin

Mutating requests с **session cookie** дополнительно проверяют same-origin:

- cross-site `Sec-Fetch-Site` запрещён;
- `Origin`, если присутствует, должен совпасть с `${request.protocol}://${Host}`.

Для HTTP Basic эта browser ambient-credential проверка не применяется.

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

`V018` добавил indexes для filters по event/operation/status/username/IP.

## WebSocket

```text
/api/admin/ws
```

использует тот же auth service. Для data WebSocket нужен `CAN_MANAGE_DATA` или superuser.

Task state process-local: один Node process имеет собственный `createAdminTaskManager()`. Отдельные Node instances не должны делить active task/cancel state.

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

Следующее изменение DB schema после текущего `V026` должно использовать migration **V027+**.
