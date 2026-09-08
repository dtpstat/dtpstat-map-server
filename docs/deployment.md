# Развёртывание нескольких экземпляров

Один checkout `dtpstat-map-server` можно запускать несколькими независимыми экземплярами. Рекомендуемая изоляция:

```text
1 instance
= 1 PostgreSQL database
= 1 DATABASE_SCHEMA
= 1 Node port
```

Разные instances могут использовать один PostgreSQL server, но не должны делить одну application database/schema как security boundary.

## Новый экземпляр

```bash
npm ci
cp .env.example .env
# заполнить .env
npm run db:init
npm run db:migrate
npm start
```

Минимальные runtime variables:

```dotenv
DATABASE_HOST=127.0.0.1
DATABASE_PORT=5432
DATABASE_NAME=tramlanes
DATABASE_ROLE=tramlanes
DATABASE_SCHEMA=tramlanes
HOST=127.0.0.1
HTTP_ENABLED=true
HTTP_PORT=3002
```

Для initial bootstrap admin:

```dotenv
IMPORT_API_USERNAME=admin
IMPORT_API_PASSWORD=replace-with-a-long-random-password
```

После появления DB-backed admin user эти ENV credentials не участвуют в online login.

## DATABASE_SCHEMA

`DATABASE_SCHEMA` определяет:

- `search_path=<schema>,public`;
- PostgreSQL `application_name`;
- advisory-lock namespace;
- `<schema>.schema_versions`;
- service namespace;
- default OSM User-Agent.

Runtime SQL должен использовать `search_path`, а не literals вида `buslanes.table`.

В migration source token `BUSLANES` допустим: migration runner заменяет его на фактический schema name до выполнения.

## Mapbox bootstrap

Начиная с `V019`, public Mapbox token хранится в `PROJECT_SETTINGS`.

```dotenv
MAPBOX_ACCESS_TOKEN=pk....
```

используется только пока `MAPBOX_ACCESS_TOKEN_INITIALIZED=false`. После bootstrap authoritative value находится в БД и меняется через admin/settings transfer.

`MAPBOX_STYLE_URL` остаётся deployment setting.

## Миграции

Текущий набор: `V001…V026`.

Последние migrations:

```text
V018__admin_sessions_roles_profile_and_ip_security.sql
V019__mapbox_project_setting.sql
V020__city_marker_icon.sql
V021__public_theme_preset.sql
V022__line_popup_setting.sql
V023__merge_osm_relation_city_parts.sql
V024__multi_column_report_ranking.sql
V025__public_download_name.sql
V026__dynamic_public_download_links.sql
```

Назначение `V023…V026`:

- `V023` — logical `FULL_NAME` OSM boundary, merge relation fragments по `PLACE_TYPE + FULL_NAME`, sync `CITIES.FULL_NAME`;
- `V024` — ordered `REPORT_CONFIG.RANK_SORT`;
- `V025` — configurable `PROJECT_SETTINGS.PUBLIC_DOWNLOAD_NAME`;
- `V026` — dynamic footer placeholders для GeoJSON/CSV URLs.

Следующая migration: **V027+**. Опубликованные migration files не изменяются задним числом.

## Production за nginx

Типичная схема:

```text
browser HTTPS
→ nginx
→ HTTP 127.0.0.1:3002
→ Node/Express
```

Для одного trusted proxy:

```dotenv
HOST=127.0.0.1
HTTP_ENABLED=true
HTTP_PORT=3002
HTTP_TRUST_PROXY_HOPS=1
```

```nginx
location / {
    proxy_pass http://127.0.0.1:3002;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    proxy_http_version 1.1;

    # Analytics/Webvisor CSP intentionally contains many provider origins and
    # can exceed nginx's small default upstream-header buffer.
    proxy_buffer_size 32k;
    proxy_buffers 8 32k;
    proxy_busy_buffers_size 64k;

    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

WebSocket headers нужны для `/api/admin/ws`.

### CSRF / X-Forwarded-Proto

Session-auth mutating requests проверяют same-origin. Если nginx завершает TLS, а Express не доверяет proxy, browser отправит `Origin: https://...`, тогда как Node будет считать protocol `http` и вернёт:

```text
Cross-site administrative request rejected
```

Исправление — корректный `HTTP_TRUST_PROXY_HOPS` и `X-Forwarded-Proto`, а не ослабление CSRF.

### Upload limit

Application default:

```dotenv
IMPORT_API_MAX_BODY_BYTES=26214400
```

Для nginx удобно:

```nginx
client_max_body_size 30m;
```

Иначе proxy может вернуть `413 Request Entity Too Large` раньше Node.

Проверка:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## PM2

```bash
cd /var/www/tramlanes.ru
pm2 start src/server.js --name tramlanes
pm2 save
```

После code/migrations:

```bash
git pull
npm run db:migrate
pm2 restart tramlanes
```

После изменения `.env`:

```bash
pm2 restart tramlanes --update-env
```

Логи:

```bash
pm2 logs tramlanes
```

## Public generated files

Процесс должен иметь write access к:

```text
var/public-downloads/
```

Имя берётся из:

```text
PROJECT_SETTINGS.PUBLIC_DOWNLOAD_NAME
```

Например `tram-lines` создаёт:

```text
var/public-downloads/tram-lines.geojson
var/public-downloads/tram-lines.csv
```

и public URLs:

```text
/tram-lines.geojson
/tram-lines.csv
```

Расширение в админке не вводится.

При переименовании snapshots сразу пересобираются; старые `.csv/.geojson` из runtime directory удаляются и старые URLs не являются aliases.

`var/` — runtime state, не backup/source bundle.

## OSM city normalization

После `V023` relation fragments одного логического города объединяются по:

```text
OSM_TYPE = relation
PLACE_TYPE
FULL_NAME
```

`FULL_NAME` вычисляется как:

```text
addr:district → name:ru → osm_name
```

В результате одна логическая city/town boundary может быть `MultiPolygon`, даже если OSM source отдал несколько relation objects.

## Project settings

DB-backed `PROJECT_SETTINGS` включает:

- project name/keywords/footer;
- analytics IDs;
- theme;
- line labels/popups;
- public Mapbox token;
- custom city marker;
- public download base name.

Настройки меняются в **Настройка интерфейса → Проект**.

## Settings transfer

Superuser endpoints:

```text
GET  /api/admin/settings/export
POST /api/admin/settings/import
```

Current format:

```text
kind = project-settings
schemaVersion = 6
```

Import принимает v1-v6. V5 добавляет `rank.sort`, V6 — `publicDownloadName`.

После import report values и public snapshots перестраиваются на target data.

Подробнее: [project-settings-transfer.md](project-settings-transfer.md).

## Empty deployment

Чистый экземпляр после migrations может не иметь городов/линий. Это нормальное состояние.

Рекомендуемый порядок загрузки:

```text
cities → lines → populations
```

## Recovery

Снять lockout:

```bash
npm run admin:unblock -- --user admin1 --ip 203.0.113.10
```

Восстановить credentials единственного superuser:

```bash
npm run admin:set-superuser
```

или:

```bash
npm run admin:set-superuser -- --username admin1 --password 'new-password'
```

## Firewall

Если Node работает только за nginx, наружу обычно нужны только `80/443`, а Node bind лучше оставлять на `127.0.0.1`.

Не доверяйте forwarded headers от произвольных клиентов: это влияет на audit/IP security.

## Секреты

Не хранить в git:

- `.env`;
- DB/admin passwords;
- TLS private keys;
- private provider credentials.

Mapbox `pk.*` — browser public token, но его ограничения всё равно должны быть минимально необходимыми.

## См. также

- [admin-security.md](admin-security.md)
- [data-transfer.md](data-transfer.md)
- [project-settings-transfer.md](project-settings-transfer.md)
- [database-indexes.md](database-indexes.md)

## Node.js / shared NVM для production

Минимум проекта — Node.js `20.19+`; для production рекомендуется поддерживаемая ветка Node.js `24.x`. На сервере с несколькими экземплярами удобно держать один shared NVM в `/usr/local/nvm`, а стабильные runtime links — в `/usr/local/node` и `/usr/local/bin`.

Пример общей установки NVM:

```bash
sudo mkdir -p /usr/local/nvm
sudo git clone https://github.com/nvm-sh/nvm.git /usr/local/nvm
cd /usr/local/nvm
sudo git checkout "$(git describe --abbrev=0 --tags)"

sudo tee /etc/profile.d/nvm.sh >/dev/null <<'EOF'
export NVM_DIR="/usr/local/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
EOF
sudo chmod 755 /etc/profile.d/nvm.sh
sudo chmod -R a+rX /usr/local/nvm
```

Node 24 и стабильные system-wide links:

```bash
sudo bash -lc '
export NVM_DIR=/usr/local/nvm
source /usr/local/nvm/nvm.sh
nvm install 24
nvm alias default 24
'

export NVM_DIR=/usr/local/nvm
source /usr/local/nvm/nvm.sh
nvm use 24
NODE24="$(dirname "$(dirname "$(nvm which 24)")")"
sudo ln -sfn "$NODE24" /usr/local/node
sudo ln -sfn /usr/local/node/bin/node /usr/local/bin/node
sudo ln -sfn /usr/local/node/bin/npm /usr/local/bin/npm
sudo ln -sfn /usr/local/node/bin/npx /usr/local/bin/npx
sudo ln -sfn /usr/local/node/bin/corepack /usr/local/bin/corepack
hash -r
```

После major Node upgrade dependencies пересобираются из lock-файла, а PM2 переустанавливается именно новым npm:

```bash
sudo /usr/local/bin/npm install -g pm2
pm2 save
pm2 kill
pm2 resurrect
pm2 startup systemd -u dtpstat --hp /home/dtpstat
pm2 save

cd /var/www/buslanes.ru && rm -rf node_modules && npm ci
cd /var/www/tramlanes.ru && rm -rf node_modules && npm ci
```

Только после проверки `which node`, `node -v`, `which pm2`, `pm2 report` и startup logs старый distro `nodejs/npm` можно удалить через package manager. Production process log должен показывать ожидаемую версию Node.

`npm install` не используется как deployment-команда: он способен менять lock-файл. Для reproducible deploy используется `npm ci`.

## Большой CSP и nginx upstream buffers

Yandex Metrica/Webvisor использует несколько региональных collector origins. Полный CSP получается крупнее типичного заголовка приложения. Если nginx пишет:

```text
upstream sent too big header while reading response header from upstream
```

и отдаёт `502 Bad Gateway`, это не падение Node. В `location /` должны быть достаточные upstream buffers:

```nginx
proxy_buffer_size 32k;
proxy_buffers 8 32k;
proxy_busy_buffers_size 64k;
```

Диагностика разделяет Node и proxy:

```bash
curl -sI http://127.0.0.1:3001/ | head
curl -sI https://buslanes.ru/ | head
```

Первый запрос проверяет Express напрямую, второй — полный HTTPS/nginx path. После изменения nginx обязательно `sudo nginx -t` и `sudo systemctl reload nginx`.
