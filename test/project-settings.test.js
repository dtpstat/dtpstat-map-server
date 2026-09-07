import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProjectSettingsPlan,
  normalizeProjectFooterHtml,
  ProjectSettingsValidationError,
} from '../src/data/project-settings.js';

test('project settings normalize name keywords metrics theme and restricted footer HTML', () => {
  const plan = buildProjectSettingsPlan({
    projectName: '  Выделенные   полосы в России  ',
    keywords: ['Транспорт', ' транспорт ', 'Россия'],
    yandexMetrikaId: ' 12345678 ',
    googleAnalyticsId: ' g-ab12cd34ef ',
    themePreset: ' MODERN ',
    footerHtml: `
      <h2>О проекте</h2>
      <p class="project-lead">Описание</p>
      <a href="https://example.com/?a=1&amp;b=2" target="_blank">Ссылка</a>
    `,
  });

  assert.equal(plan.projectName, 'Выделенные полосы в России');
  assert.deepEqual(plan.keywords, ['Транспорт', 'Россия']);
  assert.equal(plan.yandexMetrikaId, '12345678');
  assert.equal(plan.googleAnalyticsId, 'G-AB12CD34EF');
  assert.equal(plan.themePreset, 'modern');
  assert.match(plan.footerHtml, /class="project-lead"/);
  assert.match(plan.footerHtml, /href="https:\/\/example\.com\/\?a=1&amp;b=2"/);
  assert.match(plan.footerHtml, /rel="noopener noreferrer"/);
  assert.equal(normalizeProjectFooterHtml(plan.footerHtml), plan.footerHtml);
});

test('empty analytics IDs disable collectors and omitted theme remains classic', () => {
  const plan = buildProjectSettingsPlan({
    projectName: 'Проект',
    keywords: [],
    yandexMetrikaId: '',
    googleAnalyticsId: null,
    footerHtml: '<p>text</p>',
  });

  assert.equal(plan.yandexMetrikaId, null);
  assert.equal(plan.googleAnalyticsId, null);
  assert.equal(plan.themePreset, 'classic');
});

test('project settings reject invalid analytics IDs', () => {
  for (const [field, value] of [
    ['yandexMetrikaId', '0'],
    ['yandexMetrikaId', '1234567890123456'],
    ['yandexMetrikaId', 'counter-123'],
    ['googleAnalyticsId', 'UA-123456-1'],
    ['googleAnalyticsId', 'G-!INVALID!'],
  ]) {
    assert.throws(
      () => buildProjectSettingsPlan({
        projectName: 'Проект',
        keywords: [],
        footerHtml: '<p>text</p>',
        [field]: value,
      }),
      ProjectSettingsValidationError,
    );
  }
});

test('project settings accept only built-in theme presets', () => {
  for (const themePreset of ['retro', 'classic', 'modern']) {
    const plan = buildProjectSettingsPlan({
      projectName: 'Проект',
      keywords: [],
      footerHtml: '<p>text</p>',
      themePreset,
    });
    assert.equal(plan.themePreset, themePreset);
  }

  assert.throws(
    () => buildProjectSettingsPlan({
      projectName: 'Проект',
      keywords: [],
      footerHtml: '<p>text</p>',
      themePreset: 'custom.css',
    }),
    ProjectSettingsValidationError,
  );
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