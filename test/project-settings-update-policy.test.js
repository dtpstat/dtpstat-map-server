import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeProjectSettingsUpdate,
} from '../src/modules/project/settings-update-policy.js';

test('project settings update policy preserves optional runtime settings semantics', () => {
  const normalized = normalizeProjectSettingsUpdate({
    projectName: 'Test',
    keywords: ['map'],
    footerHtml: '<p>Test</p>',
    yandexMetrikaId: null,
    googleAnalyticsId: null,
  });

  assert.equal(normalized.plan.projectName, 'Test');
  assert.equal(normalized.themePreset, null);
  assert.equal(normalized.showLineLabels, false);
  assert.equal(normalized.showLinePopups, null);
  assert.equal(normalized.showGeometryTimeline, false);
  assert.equal(normalized.historyStartDate, null);
  assert.equal(normalized.historySpeeds, null);
  assert.equal(normalized.showPointGeometries, true);
  assert.equal(normalized.showLineGeometries, true);
  assert.equal(normalized.showPolygonGeometries, true);
  assert.equal(normalized.mapboxAccessToken, null);
  assert.equal(normalized.largeCityPopulationThreshold, 400000);
  assert.equal(normalized.largeCityAreaKm2Threshold, null);
});

test('project settings update policy normalizes theme token and thresholds', () => {
  const normalized = normalizeProjectSettingsUpdate({
    projectName: 'Test',
    keywords: [],
    footerHtml: '<p>Test</p>',
    yandexMetrikaId: null,
    googleAnalyticsId: null,
    themePreset: 'modern',
    showLineLabels: true,
    showLinePopups: false,
    showGeometryTimeline: true,
    historyStartDate: '2000-01-01',
    historySpeeds: [
      {
        name: '1x',
        stepUnit: 'month',
        intervalSeconds: '1.0',
        isActive: true,
        isDefault: true,
      },
      {
        name: '10x',
        stepUnit: 'decade',
        intervalSeconds: '0.2',
        isActive: true,
        isDefault: false,
      },
    ],
    showPointGeometries: false,
    showLineGeometries: true,
    showPolygonGeometries: false,
    mapboxAccessToken: 'pk.test-public-token-value',
    largeCityPopulationThreshold: '500000',
    largeCityAreaKm2Threshold: '250.5',
  });

  assert.equal(normalized.themePreset, 'modern');
  assert.equal(normalized.showLineLabels, true);
  assert.equal(normalized.showLinePopups, false);
  assert.equal(normalized.showGeometryTimeline, true);
  assert.equal(normalized.historyStartDate, '2000-01-01');
  assert.equal(normalized.historySpeeds.length, 2);
  assert.equal(normalized.historySpeeds[0].sortOrder, 10);
  assert.equal(normalized.historySpeeds[1].intervalSeconds, 0.2);
  assert.equal(normalized.showPointGeometries, false);
  assert.equal(normalized.showLineGeometries, true);
  assert.equal(normalized.showPolygonGeometries, false);
  assert.equal(
    normalized.mapboxAccessToken,
    'pk.test-public-token-value',
  );
  assert.equal(normalized.largeCityPopulationThreshold, 500000);
  assert.equal(normalized.largeCityAreaKm2Threshold, 250.5);
});

test('project settings update policy rejects invalid thresholds before DB work', () => {
  const base = {
    projectName: 'Test',
    keywords: [],
    footerHtml: '<p>Test</p>',
    yandexMetrikaId: null,
    googleAnalyticsId: null,
  };

  assert.throws(
    () => normalizeProjectSettingsUpdate({
      ...base,
      largeCityPopulationThreshold: 0,
    }),
    /largeCityPopulationThreshold/u,
  );
  assert.throws(
    () => normalizeProjectSettingsUpdate({
      ...base,
      largeCityAreaKm2Threshold: -1,
    }),
    /largeCityAreaKm2Threshold/u,
  );
});


test('project settings update policy rejects non-boolean timeline setting', () => {
  assert.throws(
    () =>
      normalizeProjectSettingsUpdate({
        projectName: 'Test',
        keywords: [],
        footerHtml: '<p>Test</p>',
        yandexMetrikaId: null,
        googleAnalyticsId: null,
        showGeometryTimeline: 'yes',
      }),
    /showGeometryTimeline must be boolean/u,
  );
});


test('project settings update policy rejects non-boolean geometry type settings', () => {
  const base = {
    projectName: 'Test',
    keywords: [],
    footerHtml: '<p>Test</p>',
    yandexMetrikaId: null,
    googleAnalyticsId: null,
  };

  for (const field of [
    'showPointGeometries',
    'showLineGeometries',
    'showPolygonGeometries',
  ]) {
    assert.throws(
      () =>
        normalizeProjectSettingsUpdate({
          ...base,
          [field]: 'yes',
        }),
      new RegExp(field + ' must be boolean', 'u'),
    );
  }
});


test('project settings update policy rejects invalid history configuration', () => {
  const base = {
    projectName: 'Test',
    keywords: [],
    footerHtml: '<p>Test</p>',
    yandexMetrikaId: null,
    googleAnalyticsId: null,
  };

  assert.throws(
    () => normalizeProjectSettingsUpdate({
      ...base,
      historyStartDate: '2025-02-30',
    }),
    /historyStartDate/u,
  );

  assert.throws(
    () => normalizeProjectSettingsUpdate({
      ...base,
      historySpeeds: [{
        name: '1x',
        stepUnit: 'month',
        intervalSeconds: 0.05,
        isActive: true,
        isDefault: true,
      }],
    }),
    /intervalSeconds/u,
  );

  assert.throws(
    () => normalizeProjectSettingsUpdate({
      ...base,
      historySpeeds: [{
        name: '1x',
        stepUnit: 'month',
        intervalSeconds: 1,
        isActive: true,
        isDefault: false,
      }],
    }),
    /exactly one/u,
  );
});
