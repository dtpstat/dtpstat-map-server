import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTransferredProjectSettings,
  normalizeTransferredSecuritySettings,
  ProjectSettingsTransferValidationError,
  validateProjectSettingsTransferEnvelope,
} from '../src/modules/project/settings-transfer-policy.js';

test('project settings transfer policy validates kind and schema before DB work', () => {
  assert.throws(
    () => validateProjectSettingsTransferEnvelope({
      _dtpstat: { kind: 'lines', schemaVersion: 1 },
    }),
    ProjectSettingsTransferValidationError,
  );
  assert.throws(
    () => validateProjectSettingsTransferEnvelope({
      _dtpstat: { kind: 'project-settings', schemaVersion: 12 },
    }),
    ProjectSettingsTransferValidationError,
  );
  assert.equal(
    validateProjectSettingsTransferEnvelope({
      _dtpstat: { kind: 'project-settings', schemaVersion: 11 },
      projectSettings: {},
      lineTypes: [],
      reportConfig: {},
      securitySettings: {},
    }).schemaVersion,
    11,
  );
});

test('project settings transfer policy preserves legacy popup and threshold defaults', () => {
  const settings = normalizeTransferredProjectSettings({
    projectName: 'Test',
    keywords: [],
    footerHtml: '<p>Test</p>',
    yandexMetrikaId: null,
    googleAnalyticsId: null,
    themePreset: 'modern',
  });

  assert.equal(settings.showLineLabels, false);
  assert.equal(settings.showLinePopups, true);
  assert.equal(settings.showPointGeometries, true);
  assert.equal(settings.showLineGeometries, true);
  assert.equal(settings.showPolygonGeometries, true);
  assert.equal(settings.showGeometryTimeline, false);
  assert.equal(settings.historyStartDate, null);
  assert.equal(settings.historySpeeds, null);
  assert.equal(settings.largeCityPopulationThreshold, 400000);
  assert.equal(settings.largeCityAreaKm2Threshold, null);
  assert.equal(settings.hasPublicDownloadName, false);
  assert.equal(settings.hasMapboxAccessToken, false);
});

test('project settings transfer policy supplies security defaults for legacy schemas', () => {
  const v1 = normalizeTransferredSecuritySettings({
    maxFailedAttempts: 5,
    failureWindowSeconds: 900,
    lockoutSeconds: 900,
  }, 1);

  assert.equal(v1.ipMaxFailedAttempts, 20);
  assert.equal(v1.sessionIdleSeconds, 1800);
  assert.equal(
    v1.requestRateLimitUserPerMinute,
    600,
  );
  assert.equal(
    v1.requestRateLimitGlobalPerMinute,
    5000,
  );
  assert.equal(typeof v1.passwordMinLength, 'number');

  const v7 = normalizeTransferredSecuritySettings({
    maxFailedAttempts: 5,
    failureWindowSeconds: 900,
    lockoutSeconds: 900,
    ipMaxFailedAttempts: 20,
    ipFailureWindowSeconds: 900,
    ipLockoutSeconds: 3600,
    sessionIdleSeconds: 1800,
    sessionAbsoluteSeconds: 43200,
    auditRetentionDays: 365,
  }, 7);

  assert.equal(typeof v7.passwordMinLength, 'number');
  assert.equal(
    v7.requestRateLimitUserPerMinute,
    600,
  );

  const v8 =
    normalizeTransferredSecuritySettings({
      maxFailedAttempts: 5,
      failureWindowSeconds: 900,
      lockoutSeconds: 900,
      ipMaxFailedAttempts: 20,
      ipFailureWindowSeconds: 900,
      ipLockoutSeconds: 3600,
      sessionIdleSeconds: 1800,
      sessionAbsoluteSeconds: 43200,
      auditRetentionDays: 365,
      passwordMinLength: 12,
      passwordMaxLength: 1024,
      passwordRequireLowercase: false,
      passwordRequireUppercase: false,
      passwordRequireDigit: false,
      passwordRequireSpecial: false,
    }, 8);

  assert.equal(
    v8.requestRateLimitUserPerMinute,
    600,
  );
  assert.equal(
    v8.requestRateLimitGlobalPerMinute,
    5000,
  );
});


test('project settings transfer policy validates history mode profiles', () => {
  const settings = normalizeTransferredProjectSettings({
    projectName: 'Test',
    keywords: [],
    footerHtml: '<p>Test</p>',
    yandexMetrikaId: null,
    googleAnalyticsId: null,
    themePreset: 'modern',
    showGeometryTimeline: true,
    historyStartDate: '2000-01-01',
    historySpeeds: [
      {
        name: '1x',
        stepUnit: 'month',
        intervalSeconds: 1,
        isActive: true,
        isDefault: true,
      },
      {
        name: '10x',
        stepUnit: 'decade',
        intervalSeconds: 0.2,
        isActive: true,
        isDefault: false,
      },
    ],
  });

  assert.equal(settings.showGeometryTimeline, true);
  assert.equal(settings.historyStartDate, '2000-01-01');
  assert.deepEqual(
    settings.historySpeeds.map(
      ({ name, stepUnit, intervalSeconds, isDefault }) => ({
        name,
        stepUnit,
        intervalSeconds,
        isDefault,
      }),
    ),
    [
      {
        name: '1x',
        stepUnit: 'month',
        intervalSeconds: 1,
        isDefault: true,
      },
      {
        name: '10x',
        stepUnit: 'decade',
        intervalSeconds: 0.2,
        isDefault: false,
      },
    ],
  );

  assert.throws(
    () => normalizeTransferredProjectSettings({
      projectName: 'Test',
      keywords: [],
      footerHtml: '<p>Test</p>',
      yandexMetrikaId: null,
      googleAnalyticsId: null,
      themePreset: 'modern',
      historySpeeds: [
        {
          name: 'bad',
          stepUnit: 'century',
          intervalSeconds: 1,
          isActive: true,
          isDefault: true,
        },
      ],
    }),
    /stepUnit/u,
  );
});
