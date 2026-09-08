from pathlib import Path


def replace_once(path, old, new):
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}')
    file.write_text(text.replace(old, new, 1))


replace_once(
    'src/app.js',
    """            ...YANDEX_METRIKA_HTTPS_ORIGINS,
            'https://*.google-analytics.com',
""",
    """            ...YANDEX_METRIKA_HTTPS_ORIGINS,
            // Current Metrica tag uses this image-only endpoint for mapuid sync.
            'https://yandex.ru',
            'https://*.google-analytics.com',
""",
)

replace_once(
    'test/api.test.js',
    """    assert.match(csp, /script-src[^;]*https:\\/\\/yastatic\\.net/);
    assert.match(csp, /script-src[^;]*https:\\/\\/\\*\\.googletagmanager\\.com/);
""",
    """    assert.match(csp, /script-src[^;]*https:\\/\\/yastatic\\.net/);
    assert.match(csp, /img-src[^;]*https:\\/\\/yandex\\.ru(?:\\s|;)/);
    assert.doesNotMatch(csp, /script-src[^;]*\\shttps:\\/\\/yandex\\.ru(?:\\s|;)/);
    assert.doesNotMatch(csp, /connect-src[^;]*\\shttps:\\/\\/yandex\\.ru(?:\\s|;)/);
    assert.match(csp, /script-src[^;]*https:\\/\\/\\*\\.googletagmanager\\.com/);
""",
)

replace_once(
    'docs/analytics.md',
    """Приложение использует Helmet CSP. Для Yandex разрешён опубликованный Yandex набор региональных `mc.yandex.*`, `mc.webvisor.*`, `yastatic.net`, websocket endpoints и `frame-ancestors`, необходимые Session Replay/картам.
""",
    """Приложение использует Helmet CSP. Для Yandex разрешён опубликованный Yandex набор региональных `mc.yandex.*`, `mc.webvisor.*`, `yastatic.net`, websocket endpoints и `frame-ancestors`, необходимые Session Replay/картам. Дополнительно `https://yandex.ru` разрешён только в `img-src`: текущий Metrica tag использует `https://yandex.ru/an/mapuid/...` для image-based mapuid sync; это разрешение намеренно не распространяется на `script-src` или `connect-src`.
""",
)
