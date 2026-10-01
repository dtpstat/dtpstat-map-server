import {
  DEFAULT_ADMIN_PASSWORD_POLICY,
  normalizeAdminSecuritySettings,
} from '../security/policy.js';
import {
  buildProjectSettingsPlan,
  ProjectSettingsValidationError,
} from './settings-policy.js';
import { normalizeMapboxAccessToken } from './mapbox-token-policy.js';
import { normalizePublicDownloadName } from './public-download-policy.js';
import {
  normalizeHistoryDate,
  normalizeHistorySpeeds,
} from './settings-update-policy.js';

export const PROJECT_SETTINGS_TRANSFER_SCHEMA_VERSION = 11;
export const PROJECT_SETTINGS_TRANSFER_KIND = 'project-settings';

const LEGACY_SECURITY_DEFAULTS = Object.freeze({
  ipMaxFailedAttempts: 20,
  ipFailureWindowSeconds: 900,
  ipLockoutSeconds: 3600,
  sessionIdleSeconds: 1800,
  sessionAbsoluteSeconds: 43200,
  auditRetentionDays: 365,
});

const LEGACY_REQUEST_RATE_DEFAULTS =
  Object.freeze({
    requestRateLimitUserPerMinute:
      600,
    requestRateLimitGlobalPerMinute:
      5000,
  });

export class ProjectSettingsTransferValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProjectSettingsTransferValidationError';
  }
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProjectSettingsTransferValidationError(
      `${label} must be an object`,
    );
  }
  return value;
}

export function validateProjectSettingsTransferEnvelope(payload) {
  const input = object(payload, 'settings transfer');
  const allowed = new Set([
    '_dtpstat',
    'projectSettings',
    'lineTypes',
    'reportConfig',
    'securitySettings',
  ]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ProjectSettingsTransferValidationError(
      `settings transfer contains unsupported properties: ${unknown.join(', ')}`,
    );
  }

  const metadata = object(input._dtpstat, '_dtpstat');
  if (metadata.kind !== PROJECT_SETTINGS_TRANSFER_KIND) {
    throw new ProjectSettingsTransferValidationError(
      `_dtpstat.kind must be ${PROJECT_SETTINGS_TRANSFER_KIND}`,
    );
  }
  const supportedVersions = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    PROJECT_SETTINGS_TRANSFER_SCHEMA_VERSION,
  ];
  if (!supportedVersions.includes(metadata.schemaVersion)) {
    throw new ProjectSettingsTransferValidationError(
      '_dtpstat.schemaVersion must be 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 or ' +
      PROJECT_SETTINGS_TRANSFER_SCHEMA_VERSION,
    );
  }

  return {
    input,
    schemaVersion: metadata.schemaVersion,
  };
}

export function normalizeTransferredProjectSettings(payload) {
  const input = object(payload, 'projectSettings');
  const hasMapboxAccessToken = Object.hasOwn(input, 'mapboxAccessToken');
  const hasShowLinePopups = Object.hasOwn(input, 'showLinePopups');
  const hasPublicDownloadName = Object.hasOwn(input, 'publicDownloadName');
  const hasShowPointGeometries = Object.hasOwn(input, 'showPointGeometries');
  const hasShowLineGeometries = Object.hasOwn(input, 'showLineGeometries');
  const hasShowPolygonGeometries = Object.hasOwn(input, 'showPolygonGeometries');
  const hasShowGeometryTimeline = Object.hasOwn(input, 'showGeometryTimeline');
  const hasHistoryStartDate = Object.hasOwn(input, 'historyStartDate');
  const hasHistorySpeeds = Object.hasOwn(input, 'historySpeeds');
  const hasPopulationThreshold = Object.hasOwn(
    input,
    'largeCityPopulationThreshold',
  );
  const hasAreaThreshold = Object.hasOwn(
    input,
    'largeCityAreaKm2Threshold',
  );
  const {
    showLineLabels = false,
    showLinePopups: rawShowLinePopups,
    showPointGeometries: rawShowPointGeometries,
    showLineGeometries: rawShowLineGeometries,
    showPolygonGeometries: rawShowPolygonGeometries,
    showGeometryTimeline: rawShowGeometryTimeline,
    historyStartDate: rawHistoryStartDate,
    historySpeeds: rawHistorySpeeds,
    publicDownloadName: rawPublicDownloadName,
    mapboxAccessToken: rawMapboxAccessToken,
    largeCityPopulationThreshold: rawPopulationThreshold,
    largeCityAreaKm2Threshold: rawAreaThreshold,
    ...base
  } = input;

  if (typeof showLineLabels !== 'boolean') {
    throw new ProjectSettingsValidationError(
      'showLineLabels must be boolean',
    );
  }
  if (hasShowLinePopups && typeof rawShowLinePopups !== 'boolean') {
    throw new ProjectSettingsValidationError(
      'showLinePopups must be boolean',
    );
  }
  for (
    const [field, present, value] of [
      ['showPointGeometries', hasShowPointGeometries, rawShowPointGeometries],
      ['showLineGeometries', hasShowLineGeometries, rawShowLineGeometries],
      ['showPolygonGeometries', hasShowPolygonGeometries, rawShowPolygonGeometries],
      ['showGeometryTimeline', hasShowGeometryTimeline, rawShowGeometryTimeline],
    ]
  ) {
    if (present && typeof value !== 'boolean') {
      throw new ProjectSettingsValidationError(
        field + ' must be boolean',
      );
    }
  }

  const populationThreshold = hasPopulationThreshold
    ? Number(rawPopulationThreshold)
    : 400000;
  if (
    !Number.isSafeInteger(populationThreshold) ||
    populationThreshold <= 0
  ) {
    throw new ProjectSettingsValidationError(
      'largeCityPopulationThreshold must be a positive integer',
    );
  }

  const areaThreshold =
    !hasAreaThreshold ||
    rawAreaThreshold === null ||
    rawAreaThreshold === ''
      ? null
      : Number(rawAreaThreshold);
  if (
    areaThreshold !== null &&
    (!Number.isFinite(areaThreshold) || areaThreshold < 0)
  ) {
    throw new ProjectSettingsValidationError(
      'largeCityAreaKm2Threshold must be non-negative or null',
    );
  }

  return {
    ...buildProjectSettingsPlan(base),
    largeCityPopulationThreshold: populationThreshold,
    largeCityAreaKm2Threshold: areaThreshold,
    showLineLabels,
    // Transfer schemas 1-3 predate this field. Their effective behaviour was
    // always to show hover popups, so missing values normalize to true.
    showLinePopups: hasShowLinePopups ? rawShowLinePopups : true,
    showPointGeometries:
      hasShowPointGeometries ? rawShowPointGeometries : true,
    showLineGeometries:
      hasShowLineGeometries ? rawShowLineGeometries : true,
    showPolygonGeometries:
      hasShowPolygonGeometries ? rawShowPolygonGeometries : true,
    showGeometryTimeline:
      hasShowGeometryTimeline ? rawShowGeometryTimeline : false,
    historyStartDate:
      hasHistoryStartDate
        ? normalizeHistoryDate(rawHistoryStartDate)
        : null,
    historySpeeds:
      hasHistorySpeeds
        ? normalizeHistorySpeeds(rawHistorySpeeds)
        : null,
    hasPublicDownloadName,
    publicDownloadName: hasPublicDownloadName
      ? normalizePublicDownloadName(rawPublicDownloadName)
      : null,
    hasMapboxAccessToken,
    mapboxAccessToken: hasMapboxAccessToken
      ? normalizeMapboxAccessToken(rawMapboxAccessToken, { optional: true })
      : null,
  };
}

export function normalizeTransferredSecuritySettings(
  payload,
  schemaVersion,
) {
  const input = object(payload, 'securitySettings');
  const defaults =
    schemaVersion === 1
      ? {
          ...LEGACY_SECURITY_DEFAULTS,
          ...LEGACY_REQUEST_RATE_DEFAULTS,
          ...DEFAULT_ADMIN_PASSWORD_POLICY,
        }
      : schemaVersion < 8
        ? {
            ...LEGACY_REQUEST_RATE_DEFAULTS,
            ...DEFAULT_ADMIN_PASSWORD_POLICY,
          }
        : schemaVersion < 9
          ? LEGACY_REQUEST_RATE_DEFAULTS
          : {};

  return normalizeAdminSecuritySettings({
    ...defaults,
    ...input,
  });
}
