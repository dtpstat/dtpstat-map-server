SET SEARCH_PATH = BUSLANES, PUBLIC;

CREATE TABLE IF NOT EXISTS BUSLANES.PROJECT_SETTINGS
(
    ID           SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (ID = 1),
    PROJECT_NAME TEXT        NOT NULL CHECK (CHAR_LENGTH(BTRIM(PROJECT_NAME)) BETWEEN 1 AND 160),
    KEYWORDS     TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[] CHECK (CARDINALITY(KEYWORDS) <= 50),
    FOOTER_HTML  TEXT        NOT NULL CHECK (CHAR_LENGTH(BTRIM(FOOTER_HTML)) BETWEEN 1 AND 65536),
    CREATED_AT   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UPDATED_AT   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO BUSLANES.PROJECT_SETTINGS (ID, PROJECT_NAME, KEYWORDS, FOOTER_HTML)
VALUES (
    1,
    'Выделенные полосы в России',
    ARRAY[
        'выделенные полосы',
        'общественный транспорт',
        'рейтинг городов',
        'автобусные полосы',
        'Россия'
    ]::TEXT[],
    $footer$
<h2>О проекте</h2>
<p>Рейтинг — это суммарная длина действующих выделенных полос в городе. Двусторонняя полоса учитывается дважды; результат делится на население и приводится к тысяче жителей.</p>
<h2>Поддержите работу сайта <a href="https://dtp-stat.ru/donate/">тут</a>.</h2>
<p>Поддержкой сайта занимается команда <a href="https://dtp-stat.ru/">Карты ДТП</a>.</p>
<p><a href="https://t.me/transportlanes?direct">Добавить или исправить город</a>. Свяжитесь с нами в <a href="https://t.me/transportlanes?direct">Телеграме</a>.</p>
<p>Скачать исходные данные: <a href="/bus-lanes.geojson">GeoJSON</a> · <a href="/bus-lanes.csv">CSV</a></p>
<h2>А как насчёт трамваев?</h2>
<p>У нас есть такой же <a href="http://tramlanes.ru">рейтинг обособления трамвайных путей</a>.</p>
<h2>Как вы это делаете?</h2>
<p>Мы собираем от специалистов и активистов в городах информацию, где фактически действуют выделенные полосы, и отрисовываем их на своей карте. Сумму длин и расчёт статистики по городу делает набор скриптов, <a href="https://github.com/culebron/dedicated-lanes">проект опубликован</a> на ГитХабе.</p>
<h2>Авторы</h2>
<p>С 2026 года поддержкой проекта занимается команда Карты ДТП (<a href="https://dtp-stat.ru/">dtp-stat.ru</a>), среди них:</p>
<p><a href="https://www.linkedin.com/in/gig-bite">Алексей Куликов</a> — разработка, анализ данных, администрирование сайта<br><a href="https://t.me/shehovsov">Михаил Шеховцов</a> — координация работы</p>
<p>Создатели первичного сайта:</p>
<p><a href="https://monteklever.livejournal.com">Александр Егоров</a> — администрирование, взаимодействие с активистами.<br><a href="http://facebook.com/planiformica/">Дмитрий Лебедев</a> — программирование расчётов и сайт.<br><a href="https://t.me/alexradchenko2">Радченко Алексей</a> — руководство проектом, PR.<br><a href="https://github.com/Alexkeny">Алексей Антипов</a> — поддержка сайта.</p>
$footer$
)
ON CONFLICT (ID) DO NOTHING;

COMMENT ON TABLE BUSLANES.PROJECT_SETTINGS IS
    'Single-row public project branding, metadata keywords and restricted footer HTML.';
