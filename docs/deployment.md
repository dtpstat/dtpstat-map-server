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

Название проекта, которое видит пользователь, к этому namespace не привязано. Оно хранится в `PROJECT_SETTINGS.PROJECT_NAME` и меняется через админку. Расчётные метрики/колонки также хранятся отдельно в `REPORT_CONFIG` каждого экземпляра.

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

Если обе БД находятся на одном PostgreSQL server, `DATABASE_HOST` и `DATABASE_PORT` могут совпадать. Порты самих Node-приложений должны различаться.

Не рекомендуется использовать одну database как security boundary для нескольких экземпляров только за счёт разных schemas. Код умеет работать с настраиваемой схемой, но `db:init` управляет владельцем database и рассчитан на модель «один экземпляр — одна DB».

## Инициализация нового экземпляра

```bash
npm install
cp .env.example .env
# изменить .env
npm run db:init
npm run db:migrate
npm start
```

После V014 чистая БД содержит системные настройки проекта, default business line type и default-конфигурацию публичного отчёта, но не содержит пользовательских городов, населения и линий. Сервер и `/admin/` при этом запускаются, а публичная страница показывает `Данные пока не загружены`.

Default `REPORT_CONFIG` воспроизводит старую таблицу выделенных полос. Для другого экземпляра, например `tramlanes`, её можно изменить во вкладке `/admin/` → **Расчёты** без изменения кода приложения. Подробнее: [report-config.md](report-config.md).

## Миграции

История миграций находится в:

```text
<DATABASE_SCHEMA>.schema_versions
```

Старые deployments могли использовать `public.buslanes_schema_versions`. Migration runner автоматически переносит найденную legacy-историю в schema-specific таблицу и не применяет уже выполненные миграции заново.

Файлы `db/migrations/V001...V014` после применения неизменяемы. В старых SQL встречается литерал `BUSLANES`; он является историческим source token. Перед выполнением migration runner подставляет выбранный `DATABASE_SCHEMA`, но checksum считает по исходному файлу.

Следующее изменение схемы должно добавляться новой миграцией V015+.

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

Служебные записи приложения имеют префикс `[service]`. При старте после V014 дополнительно виден пересчёт подготовленного отчёта:

```text
[service] city-report.refresh:start
[service] city-report.refresh:ok
[service] public-downloads.refresh:start
[service] public-downloads.refresh:ok
```

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

Перед созданием CSV сервер пересчитывает `CITY_REPORT_VALUES` по текущему `REPORT_CONFIG`. Поэтому разные экземпляры одного приложения могут иметь разные бизнес-метрики и разные CSV-колонки.

Каталог `var/` является runtime state и не должен попадать в git/deployment source bundle как заранее подготовленные данные.

## Общие namespaces формата переноса

Имена:

```text
_dtpstat
dtpstat.businessLineTypes
dtpstat.businessTypeCode
```

**не** должны зависеть от `DATABASE_SCHEMA`. Это namespace переносимого GeoJSON/KML формата, а не конкретного deployment. Благодаря этому экспорт одного экземпляра можно импортировать в другой.

Числовой `LINE_TYPES.CODE` также не является глобальным ID: при переносе source CODE разрешается через source dictionary до `NAME`, а целевой сервер сопоставляет тип по нормализованному `NAME` и использует собственный локальный `CODE`/`ID`.

## Firewall и reverse proxy

Если Node доступен непосредственно по новому порту, откройте только нужный TCP-порт, например для UFW:

```bash
sudo ufw allow 3002/tcp
```

В production предпочтительнее оставить Node за nginx/Apache/reverse proxy и наружу публиковать стандартный HTTPS. Basic Auth admin API следует использовать только через HTTPS за пределами доверенной сети.

## Секреты

Не храните в git:

- `.env`;
- PostgreSQL passwords;
- admin Basic Auth password;
- TLS private keys.

`POSTGRES_ADMIN_*` используются только для `npm run db:init`; runtime подключается прикладной ролью `DATABASE_ROLE`.
