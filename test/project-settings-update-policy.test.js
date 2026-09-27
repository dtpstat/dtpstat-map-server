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
    mapboxAccessToken: 'pk.test-public-token-value',
    largeCityPopulationThreshold: '500000',
    largeCityAreaKm2Threshold: '250.5',
  });

  assert.equal(normalized.themePreset, 'modern');
  assert.equal(normalized.showLineLabels, true);
  assert.equal(normalized.showLinePopups, false);
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
