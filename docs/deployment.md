# Развёртывание нескольких экземпляров

Один и тот же `dtpstat-map-server` можно запускать несколько раз на одном сервере. Рекомендуемая изоляция — отдельная PostgreSQL database для каждого экземпляра и отдельный HTTP/HTTPS-порт.

## Технический namespace экземпляра

Переменная:

```dotenv
DATABASE_SCHEMA=buslanes
```

используется одновременно как SQL schema и технический namespace приложения. Для старых установок значение по умолчанию — `buslanes`.

Она определяет:

- PostgreSQL `search_path=<schema>,public`;
- `application_name`, например `<schema>:server`;
- advisory locks, например `<schema>:data-import` и `<schema>:migrations`;
- таблицу истории `<schema>.schema_versions`;
- default OSM User-Agent `<schema>/2.0 OSM city updater`.

Название проекта, которое видит пользователь, к namespace не привязано. Оно хранится в `PROJECT_SETTINGS.PROJECT_NAME`. Расчётные метрики/колонки хранятся отдельно в `REPORT_CONFIG` каждого экземпляра.

## Пример двух экземпляров

Первый:

```dotenv
DATABASE_NAME=buslanes
DATABASE_ROLE=buslanes_app
DATABASE_SCHEMA=buslanes
HTTP_ENABLED=true
HTTP_PORT=3000
```

Второй:

```dotenv
DATABASE_NAME=tramlanes
DATABASE_ROLE=tramlanes_app
DATABASE_SCHEMA=tramlanes
HTTP_ENABLED=false
HTTPS_ENABLED=true
HTTPS_PORT=3002
```

Если обе БД находятся на одном PostgreSQL server, `DATABASE_HOST` и `DATABASE_PORT` могут совпадать. Порты Node-приложений должны различаться.

Не рекомендуется использовать одну database как security boundary для нескольких экземпляров только за счёт разных schemas. `db:init` управляет владельцем database и рассчитан на модель «один экземпляр — одна DB».

## Инициализация нового экземпляра

До **первого** старта задайте bootstrap administrator:

```dotenv
IMPORT_API_USERNAME=admin
IMPORT_API_PASSWORD=replace-with-a-long-random-password
```

Затем:

```bash
npm install
npm run db:init
npm run db:migrate
npm start
```

После `V016/V017` чистая БД содержит системные настройки проекта, default business line type, default report config и security tables, но ещё не содержит `ADMIN_USERS`. При первом старте сервер создаёт один `IS_BOOTSTRAP=true` superadmin из указанных ENV credentials.

После успешного bootstrap `IMPORT_API_USERNAME` и `IMPORT_API_PASSWORD` можно удалить из `.env`: при непустой `ADMIN_USERS` они больше не участвуют в online-аутентификации и не являются fallback.

Bootstrap-user нельзя удалить, вручную заблокировать, лишить superuser или одного из двух административных прав. Temporary anti-bruteforce `LOCKED_UNTIL` для него работает обычно.

Публичная страница пустого экземпляра показывает `Данные пока не загружены`; админка доступна созданному DB-admin.

Default `REPORT_CONFIG` воспроизводит старую таблицу выделенных полос. Для другого экземпляра, например `tramlanes`, её можно изменить в **Настройка интерфейса → Расчёты** без изменения кода. Подробнее: [report-config.md](report-config.md).

## Миграции

История миграций находится в:

```text
<DATABASE_SCHEMA>.schema_versions
```

Старые deployments могли использовать `public.buslanes_schema_versions`. Migration runner автоматически переносит найденную legacy-историю в schema-specific таблицу и не применяет уже выполненные миграции заново.

Исторические миграции `V001…V015` не переписываются. Новые security migrations:

```text
V016__admin_security_and_line_labels.sql
V017__protect_bootstrap_admin.sql
```

`V016` добавляет DB-backed пользователей, security policy, audit log и `PROJECT_SETTINGS.SHOW_LINE_LABELS`. `V017` добавляет bootstrap marker и DB-level invariant первоначальной учётки.

Следующее изменение схемы должно добавляться новой миграцией **V018+**.

Подробный аудит индексов: [database-indexes.md](database-indexes.md).

## Административная аутентификация

HTTP Basic остаётся способом передачи credentials, но после bootstrap логин и salted scrypt hash проверяются по `ADMIN_USERS`.

У обычного пользователя два независимых права:

```text
CAN_MANAGE_DATA
CAN_MANAGE_INTERFACE
```

`IS_SUPERUSER` дополнительно даёт доступ к пользователям, audit/security policy и переносу всех настроек проекта.

Подробнее: [admin-security.md](admin-security.md).

## Reverse proxy и IP в аудите

По умолчанию:

```dotenv
HTTP_TRUST_PROXY_HOPS=0
```

Приложение не доверяет `X-Forwarded-For`.

Если Node доступен только через ровно один доверенный reverse proxy:

```dotenv
HTTP_TRUST_PROXY_HOPS=1
```

При более длинной доверенной цепочке укажите соответствующее количество hops. Значение должно отражать **реальную** архитектуру: бездумно доверять forwarded headers на непосредственно доступном Node-порту нельзя, иначе клиент сможет подменить IP в аудите.

## PM2

Предпочтительно запускать сам Node entry point, а не `npm start`:

```bash
cd /srv/tramlanes
pm2 start src/server.js --name tramlanes
pm2 save
```

Это убирает npm banner и позволяет дать каждому process собственное имя.

После изменения `.env`:

```bash
pm2 restart tramlanes --update-env
```

Логи:

```bash
pm2 logs tramlanes
```

При старте видны в том числе:

```text
[service] database.health:start
[service] admin-security.bootstrap:start
[service] admin-security.bootstrap:ok
[service] city-report.refresh:start
[service] city-report.refresh:ok
[service] public-downloads.refresh:start
[service] public-downloads.refresh:ok
```

На последующих стартах `admin-security.bootstrap:ok` должен показывать `created=false`.

## Публичные generated files

Процесс должен иметь право создавать каталог:

```text
var/public-downloads/
```

При старте и после успешных real-update операций там атомарно пересобираются:

```text
bus-lanes.geojson
bus-lanes.csv
```

Перед созданием CSV сервер пересчитывает `CITY_REPORT_VALUES` по текущему `REPORT_CONFIG`. Поэтому разные экземпляры могут иметь разные бизнес-метрики и разные CSV-колонки.

Каталог `var/` является runtime state и не должен попадать в git/deployment source bundle как заранее подготовленные данные.

При superadmin-импорте настроек `CITY_REPORT_VALUES` пересчитывается внутри основной DB-транзакции. Public snapshots пересобираются после commit; ошибка этой производной операции возвращается как warning и не отменяет уже зафиксированные настройки.

## Перенос настроек между экземплярами

Помимо data-transfer форматов есть отдельный superadmin package:

```text
GET  /api/admin/settings/export
POST /api/admin/settings/import
```

Он переносит DB-backed `PROJECT_SETTINGS`, `LINE_TYPES`, `REPORT_CONFIG` и `ADMIN_SECURITY_SETTINGS`, но не переносит пользователей/password hashes/audit log и deployment secrets.

Подробнее: [project-settings-transfer.md](project-settings-transfer.md).

## Общие namespaces формата переноса

Имена:

```text
_dtpstat
dtpstat.businessLineTypes
dtpstat.businessTypeCode
```

**не** должны зависеть от `DATABASE_SCHEMA`. Это namespace переносимого формата, а не конкретного deployment. Благодаря этому экспорт одного экземпляра можно импортировать в другой.

Числовой `LINE_TYPES.CODE` также не является глобальным ID: при переносе source CODE разрешается через source dictionary до `NAME`, а целевой сервер сопоставляет тип по нормализованному `NAME` и использует собственный локальный `CODE`/`ID`.

## Firewall

Если Node доступен непосредственно по новому порту, откройте только нужный TCP-порт, например:

```bash
sudo ufw allow 3002/tcp
```

В production предпочтительнее оставить Node за nginx/Apache/reverse proxy и наружу публиковать стандартный HTTPS. Административные credentials не следует передавать по незашифрованному публичному HTTP.

## Секреты

Не храните в git:

- `.env`;
- PostgreSQL passwords;
- первоначальный admin password;
- TLS private keys;
- Mapbox/private provider secrets.

`POSTGRES_ADMIN_*` используются только для `npm run db:init`; runtime подключается прикладной ролью `DATABASE_ROLE`.

После DB bootstrap первоначальные admin ENV credentials рекомендуется удалить: действующий пароль уже представлен только salted hash в `ADMIN_USERS`.
