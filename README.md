# dtpstat-buslines

Интерактивная карта и рейтинг выделенных полос России. Версия 2 использует
Node.js/Express, PostgreSQL/PostGIS и загружает из API только геометрии выбранного
города.

## Архитектура

- `src/server.js` — точка запуска и корректное завершение процесса.
- `src/config.js` — строгая проверка настроек из `.env`.
- `src/app.js` — Express, статические ресурсы, защитные заголовки и API.
- `src/db/` — пул PostgreSQL и запросы списка городов/GeoJSON.
- `src/db/data-import-service.js` — атомарная замена данных из полного GeoJSON.
- `db/migrations/` — версионируемая схема PostGIS.
- `scripts/migrate.js` — миграции с checksum и advisory lock.
- `scripts/import-data.js` — проверяемый импорт исходных CSV и GeoJSON.
- `public/js/` — API-клиент, контроллер карты и единый компонент рейтинга.

Desktop и mobile используют один `tbody`, одно состояние сортировки и один набор
обработчиков. Различается только адаптивная CSS-раскладка: боковая панель на
desktop и карта с карточным рейтингом на mobile.

## Быстрый запуск

Требуются Node.js 20.19+ и PostgreSQL с доступным расширением PostGIS.

```bash
npm install
cp .env.example .env
```

Укажите в `.env` публичный токен Mapbox. Локальную базу можно запустить через
Docker Compose:

```bash
docker compose up -d database
npm run db:migrate
npm run db:import
npm run dev
```

После этого приложение доступно по адресу `http://localhost:3000`.

Импорт очищает только таблицы `cities` и `city_geometries`, затем загружает 71
город и 872 именованные геометрии. Десять объектов исходного GeoJSON без
`short_name` не импортируются: это дублированные или не связанные с рейтингом
результаты старого пространственного объединения. Перед записью проверяются
суммы длины и рейтинг каждого города.

## HTTP и HTTPS

HTTP включён по умолчанию. Для HTTPS задайте:

```dotenv
HTTPS_ENABLED=true
HTTPS_PORT=3443
HTTPS_KEY_PATH=./certificates/localhost-key.pem
HTTPS_CERT_PATH=./certificates/localhost-cert.pem
```

HTTP и HTTPS могут работать одновременно. Для режима только HTTPS установите
`HTTP_ENABLED=false`. Сертификат и ключ должны быть PEM-файлами, читаемыми
процессом Node.js.

## Переменные окружения

| Переменная | Назначение | По умолчанию |
| --- | --- | --- |
| `NODE_ENV` | Режим приложения | `development` |
| `HOST` | Интерфейс прослушивания | `0.0.0.0` |
| `HTTP_ENABLED` | Запуск HTTP | `true` |
| `HTTP_PORT` / `PORT` | Порт HTTP | `3000` |
| `HTTPS_ENABLED` | Запуск HTTPS | `false` |
| `HTTPS_PORT` | Порт HTTPS | `3443` |
| `HTTPS_KEY_PATH` | Путь к приватному ключу | обязателен для HTTPS |
| `HTTPS_CERT_PATH` | Путь к сертификату | обязателен для HTTPS |
| `DATABASE_URL` | Строка подключения PostgreSQL | обязательна |
| `DATABASE_SSL` | TLS для PostgreSQL | `false` |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Проверка CA базы | `true` |
| `DATABASE_POOL_MAX` | Максимум соединений пула | `10` |
| `IMPORT_API_USERNAME` | Логин Basic Auth для импорта | обязательна |
| `IMPORT_API_PASSWORD` | Пароль Basic Auth для импорта | обязательна |
| `IMPORT_API_MAX_BODY_BYTES` | Максимальный размер GeoJSON | `26214400` |
| `MAPBOX_ACCESS_TOKEN` | Публичный токен карты | обязательна |
| `MAPBOX_STYLE_URL` | Стиль Mapbox | прежний стиль проекта |

Полный шаблон находится в [`.env.example`](./.env.example).

## Схема данных

Миграция `001_initial_schema.sql` создаёт расширение `postgis`, схему
`buslanes` и две таблицы:

- `cities`: название, полное название, население, суммарная длина полос,
  автоматически вычисляемый рейтинг, категория, viewport `box2d` и
  дополнительные атрибуты;
- `city_geometries`: внешний ключ `city_id`, число полос, длины, исходные
  свойства и геометрия `LineString`/`MultiLineString` в SRID 4326.

Для доступа по городу создан B-tree индекс, для пространственных запросов —
GiST. Повторный запуск мигратора безопасен; изменение уже применённого SQL
обнаруживается по SHA-256.

## API

- `GET /api/health` — доступность приложения и базы.
- `GET /api/config` — только публичная конфигурация карты.
- `GET /api/cities` — города, рейтинг, категория и `[minX,minY,maxX,maxY]`.
- `GET /api/cities/:cityId/geometries` — GeoJSON `FeatureCollection` выбранного
  города.
- `POST /api/admin/import` — полное обновление городов и геометрий из GeoJSON;
  защищено Basic Auth.

Последовательность клиента: конфигурация карты → список городов → первый крупный
город → его GeoJSON → `fitBounds` по границам города. Переключение города
отменяет незавершённый предыдущий запрос.

### Обновление данных через API

Endpoint принимает полный `FeatureCollection` в формате `application/geo+json`
или `application/json`:

```bash
curl --fail-with-body \
  --user "$IMPORT_API_USERNAME:$IMPORT_API_PASSWORD" \
  --header "Content-Type: application/geo+json" \
  --data-binary @bus-lanes.geojson \
  https://example.org/api/admin/import
```

Basic Auth необходимо использовать через HTTPS либо через доверенный HTTPS
reverse proxy. Проверка авторизации выполняется до чтения большого request body.

Загрузка считается полным снимком: отсутствующие в файле города удаляются,
существующие сохраняют свои ID, геометрии заменяются. В одной транзакции сервер:

1. проверяет структуру, координаты WGS84, атрибуты и одинаковое население внутри
   каждого города;
2. группирует именованные объекты по `properties.short_name`;
3. обновляет атрибуты городов и заменяет связанные геометрии;
4. в конце пересчитывает в PostGIS суммарную длину и bbox каждого города.

При ошибке выполняется rollback. Параллельные импорты сериализуются advisory
lock. Объекты без `short_name` пропускаются так же, как при CLI-импорте.
Успешный ответ содержит количества городов, геометрий, пропущенных объектов и
время обновления.

## Проверки

```bash
npm run check
```

Команда запускает ESLint и тесты конфигурации, API и целостности исходных данных.
Для проверки самой миграции на реальной PostGIS выполните `npm run db:migrate`
и `npm run db:import` на тестовой базе.
