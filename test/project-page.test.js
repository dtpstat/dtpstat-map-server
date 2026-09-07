import assert from 'node:assert/strict';
import test from 'node:test';
import { projectManifest, renderProjectPage } from '../src/http/project-page.js';

const template = `
  <html data-theme="{{PROJECT_THEME_NAME}}">
  <head>
    <title>{{PROJECT_NAME}}</title>
    <meta name="keywords" content="{{PROJECT_KEYWORDS}}">
    <meta property="og:title" content="{{PROJECT_NAME}}">
    {{PROJECT_METRICS_META}}
    {{PROJECT_THEME_STYLESHEET}}
  </head>
  <body>
    <h1>{{PROJECT_NAME}}</h1>
    <section>{{PROJECT_FOOTER_HTML}}</section>
    <noscript>{{YANDEX_METRIKA_NOSCRIPT}}</noscript>
    {{PROJECT_METRICS_SCRIPT}}
  </body>
  </html>
`;

test('project page renders title keywords footer and classic theme fallback', () => {
  const html = renderProjectPage(template, {
    projectName: 'Трамваи & <метро>',
    keywords: ['трамвай', 'A&B'],
    footerHtml: '<h2>О проекте</h2><p>Готово</p>',
    yandexMetrikaId: null,
    googleAnalyticsId: null,
  });

  assert.equal((html.match(/Трамваи &amp; &lt;метро&gt;/g) ?? []).length, 3);
  assert.match(html, /content="трамвай, A&amp;B"/);
  assert.match(html, /<section><h2>О проекте<\/h2><p>Готово<\/p><\/section>/);
  assert.match(html, /data-theme="classic"/);
  assert.match(html, /href="\/css\/themes\/classic\.css"/);
  assert.doesNotMatch(html, /yandex-metrika-id/);
  assert.doesNotMatch(html, /google-analytics-id/);
  assert.doesNotMatch(html, /\/js\/metrics\.js/);
  assert.doesNotMatch(html, /\{\{PROJECT_/);
  assert.doesNotMatch(html, /\{\{YANDEX_/);
});

test('project page loads exactly the selected built-in theme stylesheet', () => {
  for (const themePreset of ['retro', 'classic', 'modern']) {
    const html = renderProjectPage(template, {
      projectName: 'Проект',
      keywords: [],
      footerHtml: '<p>Текст</p>',
      themePreset,
      yandexMetrikaId: null,
      googleAnalyticsId: null,
    });
    assert.match(html, new RegExp(`data-theme="${themePreset}"`));
    assert.match(html, new RegExp(`href="/css/themes/${themePreset}\\.css"`));
    assert.equal((html.match(/\/css\/themes\//g) ?? []).length, 1);
  }

  const fallback = renderProjectPage(template, {
    projectName: 'Проект',
    keywords: [],
    footerHtml: '<p>Текст</p>',
    themePreset: '../../custom',
    yandexMetrikaId: null,
    googleAnalyticsId: null,
  });
  assert.match(fallback, /data-theme="classic"/);
  assert.match(fallback, /href="\/css\/themes\/classic\.css"/);
});

test('project page enables only configured analytics collectors', () => {
  const both = renderProjectPage(template, {
    projectName: 'Проект',
    keywords: [],
    footerHtml: '<p>Текст</p>',
    yandexMetrikaId: '12345678',
    googleAnalyticsId: 'G-AB12CD34EF',
  });

  assert.match(both, /name="yandex-metrika-id" content="12345678"/);
  assert.match(both, /name="google-analytics-id" content="G-AB12CD34EF"/);
  assert.match(both, /src="https:\/\/mc\.yandex\.ru\/watch\/12345678"/);
  assert.equal((both.match(/src="\/js\/metrics\.js"/g) ?? []).length, 1);

  const googleOnly = renderProjectPage(template, {
    projectName: 'Проект',
    keywords: [],
    footerHtml: '<p>Текст</p>',
    yandexMetrikaId: null,
    googleAnalyticsId: 'G-AB12CD34EF',
  });
  assert.doesNotMatch(googleOnly, /mc\.yandex\.ru\/watch/);
  assert.doesNotMatch(googleOnly, /yandex-metrika-id/);
  assert.match(googleOnly, /google-analytics-id/);
  assert.match(googleOnly, /\/js\/metrics\.js/);
});

test('web manifest uses project name for PWA name and short name', () => {
  const manifest = projectManifest({ projectName: 'Обособленные трамвайные пути' });

  assert.equal(manifest.name, 'Обособленные трамвайные пути');
  assert.equal(manifest.short_name, 'Обособленные трамвайные пути');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.icons.length, 2);
});