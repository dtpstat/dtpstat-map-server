import assert from 'node:assert/strict';
import test from 'node:test';
import { projectManifest, renderProjectPage } from '../src/http/project-page.js';

test('project page renders title keywords and footer without leaking markup into metadata', () => {
  const template = `
    <title>{{PROJECT_NAME}}</title>
    <meta name="keywords" content="{{PROJECT_KEYWORDS}}">
    <meta property="og:title" content="{{PROJECT_NAME}}">
    <h1>{{PROJECT_NAME}}</h1>
    <section>{{PROJECT_FOOTER_HTML}}</section>
  `;
  const html = renderProjectPage(template, {
    projectName: 'Трамваи & <метро>',
    keywords: ['трамвай', 'A&B'],
    footerHtml: '<h2>О проекте</h2><p>Готово</p>',
  });

  assert.equal((html.match(/Трамваи &amp; &lt;метро&gt;/g) ?? []).length, 3);
  assert.match(html, /content="трамвай, A&amp;B"/);
  assert.match(html, /<section><h2>О проекте<\/h2><p>Готово<\/p><\/section>/);
  assert.doesNotMatch(html, /\{\{PROJECT_/);
});

test('web manifest uses project name for PWA name and short name', () => {
  const manifest = projectManifest({ projectName: 'Обособленные трамвайные пути' });

  assert.equal(manifest.name, 'Обособленные трамвайные пути');
  assert.equal(manifest.short_name, 'Обособленные трамвайные пути');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.icons.length, 2);
});
