# Администраторы, роли и аудит

Начиная с `V016`, административная аутентификация хранится в PostgreSQL, а не в `.env`. HTTP Basic остаётся транспортным механизмом передачи логина/пароля, но проверка пользователя, его прав и блокировок выполняется по `ADMIN_USERS`.

## Разделы админки и права

Админка разделена на три верхнеуровневых окна:

1. **Управление данными** — импорт/экспорт городов, линий и населения, OSM/KML и журнал текущей фоновой операции;
2. **Настройка интерфейса** — проект, расчёты и типы линий;
3. **Пользователи и аудит** — только для superadmin: пользователи, аудит, защита входа и перенос всех DB-настроек проекта.

У обычной административной учётки два независимых права:

- `CAN_MANAGE_DATA` — управление данными;
- `CAN_MANAGE_INTERFACE` — настройка интерфейса.

Они могут выдаваться отдельно или одновременно. `IS_SUPERUSER` даёт доступ ко всем разделам и security API.

Single-task guard относится только к длительным mutating-операциям **управления данными**. Статус и WebSocket-журнал также находятся в этом окне. Настройки интерфейса не включаются в клиентский глобальный lock данных.

## Первоначальная учётная запись

После миграций сервер проверяет `ADMIN_USERS`.

Если таблица пустая, один раз используются совместимые переменные:

```dotenv
IMPORT_API_USERNAME=admin
IMPORT_API_PASSWORD=replace-with-a-long-random-password
```

Из них создаётся первоначальная DB-учётка со свойствами:

```text
IS_BOOTSTRAP = true
IS_SUPERUSER = true
CAN_MANAGE_DATA = true
CAN_MANAGE_INTERFACE = true
IS_BLOCKED = false
```

После появления хотя бы одного DB-пользователя эти ENV credentials больше не участвуют в online-аутентификации и могут быть удалены из `.env`.

### Непотеряемый bootstrap-admin

`V017__protect_bootstrap_admin.sql` защищает первоначального администратора одновременно на application- и DB-уровне.

Bootstrap-пользователя нельзя:

- удалить;
- вручную заблокировать (`IS_BLOCKED=true`);
- снять `IS_SUPERUSER`;
- отозвать `CAN_MANAGE_DATA`;
- отозвать `CAN_MANAGE_INTERFACE`;
- снять сам признак `IS_BOOTSTRAP`.

Для этого используются partial unique index, CHECK constraint и `BEFORE UPDATE OR DELETE` trigger. Таким образом инвариант сохраняется даже при обходе web API.

При этом **временная** блокировка `LOCKED_UNTIL`, выставляемая защитой от перебора пароля, для bootstrap-admin разрешена. Разрешены также смена его email и пароля.

## Пароли

Пароль в `ADMIN_USERS.PASSWORD_HASH` хранится как salted `scrypt` hash в versioned формате `scrypt-v1`. Plaintext-пароль в БД и audit log не записывается.

Через админку можно:

- создать пользователя;
- изменить email;
- изменить два прикладных права;
- вручную заблокировать/разблокировать обычную учётку;
- сменить пароль.

Первоначальная учётка имеет описанные выше ограничения.

## Защита от перебора

Singleton `ADMIN_SECURITY_SETTINGS` содержит:

| Поле | Значение по умолчанию | Назначение |
| --- | ---: | --- |
| `MAX_FAILED_ATTEMPTS` | 5 | число ошибок до lockout |
| `FAILURE_WINDOW_SECONDS` | 900 | окно подсчёта ошибок |
| `LOCKOUT_SECONDS` | 900 | длительность временной блокировки |

Порог и интервалы изменяются superadmin через окно **Пользователи и аудит → Защита входа**.

HTTP-ответы различаются:

```text
401  Authentication required / Invalid username or password
403  Account manually blocked / insufficient permission
423  Account temporarily locked
```

Для `423 Locked` сервер также отдаёт `Retry-After` и JSON `retryAfterSeconds`.

Счётчик ведётся по существующей DB-учётке. Для неизвестного username выполняется дорогостоящая dummy-проверка scrypt, чтобы уменьшить timing-разницу между неизвестным пользователем и неверным паролем.

## IP и reverse proxy

По умолчанию приложение не доверяет forwarded-заголовкам:

```dotenv
HTTP_TRUST_PROXY_HOPS=0
```

Если перед Node находится ровно один доверенный reverse proxy, например nginx:

```dotenv
HTTP_TRUST_PROXY_HOPS=1
```

Это позволяет Express корректно определить исходный IP для audit log. Значение должно соответствовать реальной доверенной proxy-chain; не следует включать произвольный `trust proxy` для публично доступного Node-порта.

## Аудит

`ADMIN_AUDIT_LOG` — append-only журнал административных событий. Для записи сохраняются:

- `CREATED_AT`;
- `EVENT_TYPE`;
- `OPERATION_TYPE`;
- `STATUS`;
- `DURATION_MS`;
- `IP_ADDRESS`;
- `USER_ID`;
- snapshot `USERNAME`;
- `DETAILS JSONB`.

В аудит попадают как минимум:

- успешные и неуспешные входы;
- manual/temporary lockout;
- bootstrap первого пользователя;
- импорт/экспорт данных;
- завершение фоновых admin-задач (`succeeded`, `failed`, `cancelled`);
- изменение проекта, типов линий и расчётов;
- управление пользователями и параметрами защиты;
- экспорт/импорт настроек проекта.

Пароли, password hash и Authorization header в `DETAILS` не записываются.

## WebSocket

`/api/admin/ws` доступен только пользователю с правом управления данными (или superadmin). WebSocket upgrade проверяется тем же DB-backed auth service, что и HTTP API; ENV bootstrap credentials после создания DB-пользователя не являются отдельным fallback.

## Связанные миграции

- `V016__admin_security_and_line_labels.sql` — `ADMIN_USERS`, `ADMIN_SECURITY_SETTINGS`, `ADMIN_AUDIT_LOG`, `PROJECT_SETTINGS.SHOW_LINE_LABELS`;
- `V017__protect_bootstrap_admin.sql` — постоянный bootstrap-инвариант.

Следующее изменение DB schema должно использовать `V018+`.
