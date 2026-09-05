import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProjectSettingsPlan,
  normalizeProjectFooterHtml,
  ProjectSettingsValidationError,
} from '../src/data/project-settings.js';

test('project settings normalize name keywords and restricted footer HTML', () => {
  const plan = buildProjectSettingsPlan({
    projectName: '  Выделенные   полосы в России  ',
    keywords: ['Транспорт', ' транспорт ', 'Россия'],
    footerHtml: `
      <h2>О проекте</h2>
      <p class="project-lead">Описание</p>
      <a href="https://example.com/?a=1&amp;b=2" target="_blank">Ссылка</a>
    `,
  });

  assert.equal(plan.projectName, 'Выделенные полосы в России');
  assert.deepEqual(plan.keywords, ['Транспорт', 'Россия']);
  assert.match(plan.footerHtml, /class="project-lead"/);
  assert.match(plan.footerHtml, /href="https:\/\/example\.com\/\?a=1&amp;b=2"/);
  assert.match(plan.footerHtml, /rel="noopener noreferrer"/);
  assert.equal(normalizeProjectFooterHtml(plan.footerHtml), plan.footerHtml);
});

test('project footer rejects executable or unsupported markup', () => {
  for (const footerHtml of [
    '<script>alert(1)</script>',
    '<p style="color:red">text</p>',
    '<p class="made-up-style">text</p>',
    '<a href="javascript:alert(1)">text</a>',
    '<a href="javascript&#58;alert(1)">text</a>',
    '<p><strong>broken</p></strong>',
    '<iframe src="https://example.com"></iframe>',
  ]) {
    assert.throws(
      () => buildProjectSettingsPlan({
        projectName: 'Проект',
        keywords: [],
        footerHtml,
      }),
      ProjectSettingsValidationError,
    );
  }
});

test('project settings reject unknown payload properties and invalid keywords', () => {
  assert.throws(
    () => buildProjectSettingsPlan({
      projectName: 'Проект',
      keywords: ['ok'],
      footerHtml: '<p>text</p>',
      extra: true,
    }),
    /unsupported properties/,
  );

  assert.throws(
    () => buildProjectSettingsPlan({
      projectName: 'Проект',
      keywords: [123],
      footerHtml: '<p>text</p>',
    }),
    /keywords\[0\]/,
  );
});
