import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

async function source(relativePath) {
  return fs.readFile(path.join(projectRoot, relativePath), 'utf8');
}

test('project settings migration creates one persistent settings row', async () => {
  const sql = await source('db/migrations/V009__project_settings.sql');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS BUSLANES\.PROJECT_SETTINGS/i);
  assert.match(sql, /CHECK \(ID = 1\)/i);
  assert.match(sql, /PROJECT_NAME TEXT/i);
  assert.match(sql, /KEYWORDS\s+TEXT\[\]/i);
  assert.match(sql, /FOOTER_HTML\s+TEXT/i);
  assert.match(sql, /'Выделенные полосы в России'/);
});

test('admin bootstraps a fourth Project tab with metadata and restricted HTML editor', async () => {
  const [notices, editor, css] = await Promise.all([
    source('admin/task-notices.js'),
    source('admin/project-settings-editor.js'),
    source('admin/project-settings.css'),
  ]);

  assert.match(notices, /import '\.\/project-settings-editor\.js'/);
  assert.match(editor, /data\.taskTab = 'project'/);
  assert.match(editor, /data-operation-tab="project-settings"/);
  assert.match(editor, /name="projectName"/);
  assert.match(editor, /name="keywords"/);
  assert.match(editor, /name="footerHtml"/);
  assert.match(editor, /data-project-snippet="callout"/);
  assert.match(editor, /data-project-snippet="columns"/);
  assert.match(editor, /\/api\/admin\/project-settings/);
  assert.match(css, /grid-template-columns: repeat\(4,/);
});

test('public page derives visible title and service metadata from one project name', async () => {
  const [html, app, css] = await Promise.all([
    source('index.html'),
    source('src/app.js'),
    source('public/css/project-content.css'),
  ]);

  for (const marker of [
    '<title>{{PROJECT_NAME}}</title>',
    'name="application-name" content="{{PROJECT_NAME}}"',
    'name="apple-mobile-web-app-title" content="{{PROJECT_NAME}}"',
    'property="og:title" content="{{PROJECT_NAME}}"',
    'property="og:site_name" content="{{PROJECT_NAME}}"',
    'name="twitter:title" content="{{PROJECT_NAME}}"',
    '<h1 id="page-title">{{PROJECT_NAME}}</h1>',
  ]) {
    assert.ok(html.includes(marker), marker);
  }
  assert.match(html, /name="keywords" content="\{\{PROJECT_KEYWORDS\}\}"/);
  assert.match(html, /\{\{PROJECT_FOOTER_HTML\}\}/);
  assert.match(html, /\/css\/project-content\.css/);
  assert.match(app, /projectManifest\(settings\)/);
  assert.match(app, /renderProjectPage\(publicPageTemplate, settings\)/);
  assert.match(css, /\.project-callout/);
  assert.match(css, /\.project-columns/);
  assert.match(css, /\.project-link-button/);
});
