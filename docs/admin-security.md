# Администраторы, роли, sessions и аудит

Административная аутентификация хранится в PostgreSQL. `V016` ввела `ADMIN_USERS`, security policy и audit, `V017` закрепила bootstrap-инвариант, а `V018` добавила interactive web sessions, расширенные роли, profile/avatar, защиту по IP и manual IP blocks.

## Способы аутентификации

### Web-admin

Интерактивная админка использует login endpoint и DB-backed session:

```text
POST /api/admin/login
POST /api/admin/logout
GET  /api/admin/me
```

После успешного входа браузер получает cookie:

```text
dtpstat_admin_session
```

Cookie имеет `HttpOnly` и `SameSite=Strict`; при HTTPS request добавляется `Secure`. В БД plaintext session token не хранится — в `ADMIN_SESSIONS` сохраняется только его SHA-256 hash.

### HTTP Basic

DB-backed HTTP Basic остаётся доступен для скриптов, `curl` и compatibility clients. Логин/пароль всё равно проверяются по `ADMIN_USERS`; bootstrap credentials из `.env` после создания DB-user не являются параллельным fallback.

Session cookie является предпочтительным способом для web-admin, Basic — для automation/API clients.

## Права

У обычного администратора пять независимых permissions:

| DB field | Назначение |
| --- | --- |
| `CAN_MANAGE_DATA` | импорт/экспорт, OSM/KML и data tasks |
| `CAN_MANAGE_INTERFACE` | проект, Mapbox, theme, marker, расчёты, line types |
| `CAN_MANAGE_USERS` | управление обычными admin users |
| `CAN_VIEW_AUDIT` | чтение audit log |
| `CAN_MANAGE_SECURITY` | security policy, blocks и security operations |

`IS_SUPERUSER=true` даёт все permissions независимо от отдельных flags.

`IS_BOOTSTRAP=true` отмечает первоначального защищённого администратора. В штатном UI новый superuser не создаётся автоматически.

## Bootstrap-superuser

На старте сервер проверяет `ADMIN_USERS`. Если таблица пустая, используются:

```dotenv
IMPORT_API_USERNAME=admin
IMPORT_API_PASSWORD=replace-with-a-long-random-password
```

Создаётся пользователь со следующими свойствами:

```text
IS_BOOTSTRAP = true
IS_SUPERUSER = true
CAN_MANAGE_DATA = true
CAN_MANAGE_INTERFACE = true
CAN_MANAGE_USERS = true
CAN_VIEW_AUDIT = true
CAN_MANAGE_SECURITY = true
IS_BLOCKED = false
MUST_CHANGE_PASSWORD = false
```

Если `ADMIN_USERS` уже содержит хотя бы одну запись, ENV credentials не изменяют существующего пользователя и не используются для online login.

Это важно при клонировании deployment: простая замена `IMPORT_API_USERNAME/PASSWORD` в `.env` **не меняет** уже созданный DB account.

## DB-level защита bootstrap-admin

`V017__protect_bootstrap_admin.sql` защищает первоначальную учётку на application- и DB-level.

Bootstrap-admin нельзя:

- удалить;
- вручную заблокировать;
- снять `IS_SUPERUSER`;
- снять `IS_BOOTSTRAP`;
- отозвать базовые административные permissions, защищённые bootstrap-инвариантом.

При этом temporary anti-bruteforce lockout разрешён: `LOCKED_UNTIL` может временно закрыть вход и для bootstrap-admin.

## Пароли

`ADMIN_USERS.PASSWORD_HASH` хранит salted `scrypt` в versioned формате `scrypt-v1`. Plaintext password не записывается в БД или audit log.

Обычный пароль, устанавливаемый через UI, валидируется как пароль длиной `12…1024` символов. Bootstrap/recovery path сохраняет совместимость со старым bootstrap правилом: пароль должен быть непустым.

При сбросе временного пароля может выставляться:

```text
MUST_CHANGE_PASSWORD = true
```

Пока этот flag активен, interactive session может работать только с profile/password/logout flow. Остальные защищённые endpoint отвечают:

```text
428 Password change required
```

## Profile, avatar и sessions

`V018` добавила:

- `DISPLAY_NAME`;
- профиль пользователя;
- avatar `PNG/JPEG/WebP` до 256 KiB;
- список активных sessions;
- отзыв одной/остальных sessions;
- idle timeout;
- absolute session lifetime.

`ADMIN_SESSIONS` хранит:

- user id;
- hash token;
- `CREATED_AT`;
- `LAST_SEEN_AT`;
- `EXPIRES_AT`;
- IP;
- User-Agent.

## Account anti-bruteforce

Account-level policy находится в singleton `ADMIN_SECURITY_SETTINGS`:

| Поле | Default | Назначение |
| --- | ---: | --- |
| `MAX_FAILED_ATTEMPTS` | 5 | ошибок до account lockout |
| `FAILURE_WINDOW_SECONDS` | 900 | окно подсчёта |
| `LOCKOUT_SECONDS` | 900 | длительность account lockout |

Для существующего user счётчик хранится в `ADMIN_USERS`:

```text
FAILED_LOGIN_COUNT
FAILED_LOGIN_WINDOW_STARTED_AT
LOCKED_UNTIL
```

Неизвестный username всё равно проходит дорогую dummy scrypt operation, чтобы уменьшить timing-разницу между «нет пользователя» и «неверный пароль».

## IP anti-bruteforce

Отдельно ведётся состояние источника входа в `ADMIN_LOGIN_IP_STATE`.

Настройки:

| Поле | Default | Назначение |
| --- | ---: | --- |
| `IP_MAX_FAILED_ATTEMPTS` | 20 | ошибок с IP до lockout |
| `IP_FAILURE_WINDOW_SECONDS` | 900 | окно подсчёта |
| `IP_LOCKOUT_SECONDS` | 3600 | длительность IP lockout |

Account и IP counters независимы: неверные credentials могут одновременно увеличить оба состояния.

## Manual blocks

Учётка может иметь manual block fields:

```text
IS_BLOCKED
MANUAL_BLOCKED_AT
MANUAL_BLOCKED_UNTIL
MANUAL_BLOCK_REASON
MANUAL_BLOCKED_BY
```

Отдельная таблица `ADMIN_BLOCKED_IPS` хранит manual IP blocks с optional expiration, администратором и ссылкой на audit event.

## Session timeouts и audit retention

Дополнительные security settings:

| Поле | Default |
| --- | ---: |
| `SESSION_IDLE_SECONDS` | 1800 |
| `SESSION_ABSOLUTE_SECONDS` | 43200 |
| `AUDIT_RETENTION_DAYS` | 365 |

`AUDIT_RETENTION_DAYS=0` означает отсутствие автоматического удаления по retention task, если такой purge вызывается приложением.

## HTTP-коды auth/security

Основные ответы:

```text
401  Authentication required / invalid credentials / expired session
403  account/IP manual block или недостаточно permission
423  account temporarily locked
429  IP temporarily locked
428  password change required
```

Для временного lockout сервер возвращает `Retry-After` и `retryAfterSeconds`.

## CSRF / same-origin для session-auth

Mutating requests, авторизованные **session cookie**, дополнительно проходят same-origin check:

- `Sec-Fetch-Site` не должен указывать cross-site;
- если браузер прислал `Origin`, его origin должен совпасть с `${request.protocol}://${Host}`.

Для HTTP Basic эта проверка не применяется, потому что Basic не является ambient browser credential.

### Почему важен reverse proxy

Если nginx принимает HTTPS, а до Node проксирует HTTP, Express должен знать исходный protocol. Иначе браузер присылает, например:

```text
Origin: https://tramlanes.example
```

а Node без trusted proxy строит expected origin как:

```text
http://tramlanes.example
```

и корректный запрос отклоняется:

```text
Cross-site administrative request rejected
```

Для одного доверенного nginx:

```dotenv
HTTP_TRUST_PROXY_HOPS=1
```

nginx должен передавать как минимум:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Не выставляйте `HTTP_TRUST_PROXY_HOPS=1`, если клиент может обращаться к тому же Node-порту напрямую и тем самым подделывать forwarded headers.

## Client IP

`HTTP_TRUST_PROXY_HOPS=0` — default для прямого доступа к Node.

При корректно настроенном trusted proxy Express использует forwarded chain, поэтому:

- account/IP security видит реальный client IP;
- audit log записывает реальный IP;
- manual IP blocks применяются к клиенту, а не к адресу nginx.

## Audit log

`ADMIN_AUDIT_LOG` содержит:

- `CREATED_AT`;
- `EVENT_TYPE`;
- `OPERATION_TYPE`;
- `STATUS`;
- `DURATION_MS`;
- `IP_ADDRESS`;
- `USER_ID`;
- snapshot `USERNAME`;
- `DETAILS JSONB`.

В audit попадают входы, lockouts, bootstrap, data/settings operations, user/security operations и завершение background admin tasks.

Password, password hash, session token и Authorization header не должны записываться в `DETAILS`.

`V018` добавила server-side indexes для filters по event/operation/status/username/IP и для выдачи последних событий.

## WebSocket

`/api/admin/ws` использует тот же auth service. Для web-admin принимается session cookie, для compatibility client возможен DB-backed Basic. Требуется `CAN_MANAGE_DATA` или superuser; user с `MUST_CHANGE_PASSWORD=true` не получает доступ к data WebSocket.

## Аварийная разблокировка из shell

Если account/IP заблокировались во время диагностики:

```bash
npm run admin:unblock -- --user admin1
npm run admin:unblock -- --ip 203.0.113.10
npm run admin:unblock -- --user admin1 --ip 203.0.113.10
```

Команда использует application DB connection и `DATABASE_SCHEMA` из `.env`.

Для user она сбрасывает:

- manual account block;
- `FAILED_LOGIN_COUNT`;
- failure window;
- `LOCKED_UNTIL`.

Для IP она:

- удаляет запись automatic throttle из `ADMIN_LOGIN_IP_STATE`;
- удаляет активные manual blocks этого IP из `ADMIN_BLOCKED_IPS`.

Перезапуск Node для этой DB-операции не нужен.

## Recovery login/password единственного superuser

Если deployment был создан с неправильными bootstrap credentials или пароль потерян:

```bash
npm run admin:set-superuser
```

По умолчанию команда берёт:

```dotenv
IMPORT_API_USERNAME=...
IMPORT_API_PASSWORD=...
```

Можно передать явно:

```bash
npm run admin:set-superuser -- --username admin1 --password 'new-password'
```

Production предпочтительно использовать `.env`, чтобы пароль не оставался в shell history.

Recovery command требует **ровно одну** запись `IS_SUPERUSER=TRUE`. Если найдено 0 или больше 1, transaction откатывается и данные не меняются.

При успехе команда:

- меняет username;
- пересчитывает `PASSWORD_HASH`;
- восстанавливает все пять admin permissions;
- снимает manual account block;
- сбрасывает account failed-login state;
- снимает `MUST_CHANGE_PASSWORD`;
- обновляет `PASSWORD_CHANGED_AT`;
- отзывает все существующие sessions этого superuser.

IP state эта команда намеренно не очищает. Если заблокирован ещё и IP, после неё выполните:

```bash
npm run admin:unblock -- --ip 203.0.113.10
```

## Связанные миграции

```text
V016__admin_security_and_line_labels.sql
V017__protect_bootstrap_admin.sql
V018__admin_sessions_roles_profile_and_ip_security.sql
```

`V019…V021` относятся к project/public settings, но используют ту же DB-backed administrative инфраструктуру.

Следующее изменение DB schema должно использовать `V022+`.
