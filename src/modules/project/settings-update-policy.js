import {
  buildProjectSettingsPlan,
  normalizePublicThemePreset,
  ProjectSettingsValidationError,
} from './settings-policy.js';
import { normalizeMapboxAccessToken } from './mapbox-token-policy.js';

const HISTORY_STEP_UNITS =
  new Set([
    'day',
    'week',
    'month',
    'quarter',
    'year',
    'five_years',
    'decade',
  ]);

export function normalizeHistoryDate(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value)
  ) {
    throw new ProjectSettingsValidationError(
      'historyStartDate must be null or YYYY-MM-DD',
    );
  }
  const parsed =
    new Date(value + 'T00:00:00.000Z');
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new ProjectSettingsValidationError(
      'historyStartDate must be a real calendar date',
    );
  }
  return value;
}

export function normalizeHistorySpeeds(value) {
  if (value === undefined) {
    return null;
  }
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 20
  ) {
    throw new ProjectSettingsValidationError(
      'historySpeeds must contain 1-20 profiles',
    );
  }

  let defaults = 0;
  let active = 0;
  const names = new Set();

  const normalized =
    value.map((item, index) => {
      if (
        !item ||
        typeof item !== 'object' ||
        Array.isArray(item)
      ) {
        throw new ProjectSettingsValidationError(
          'historySpeeds entries must be objects',
        );
      }
      const unknown =
        Object.keys(item).filter(
          (key) =>
            ![
              'name',
              'stepUnit',
              'intervalSeconds',
              'isActive',
              'isDefault',
            ].includes(key),
        );
      if (unknown.length) {
        throw new ProjectSettingsValidationError(
          'Unsupported history speed fields: ' +
            unknown.join(', '),
        );
      }

      const name =
        String(item.name ?? '')
          .trim()
          .replace(/\s+/gu, ' ')
          .normalize('NFC');
      if (!name || name.length > 40) {
        throw new ProjectSettingsValidationError(
          'history speed name must contain 1-40 characters',
        );
      }
      const nameKey =
        name.toLocaleLowerCase('ru-RU');
      if (names.has(nameKey)) {
        throw new ProjectSettingsValidationError(
          'history speed names must be unique',
        );
      }
      names.add(nameKey);

      if (!HISTORY_STEP_UNITS.has(item.stepUnit)) {
        throw new ProjectSettingsValidationError(
          'history speed stepUnit is unsupported',
        );
      }

      const intervalSeconds =
        Number(item.intervalSeconds);
      if (
        !Number.isFinite(intervalSeconds) ||
        intervalSeconds < 0.1 ||
        intervalSeconds > 60
      ) {
        throw new ProjectSettingsValidationError(
          'history speed intervalSeconds must be from 0.1 to 60',
        );
      }

      const isActive =
        item.isActive !== false;
      const isDefault =
        item.isDefault === true;

      if (isActive) active += 1;
      if (isDefault) defaults += 1;
      if (isDefault && !isActive) {
        throw new ProjectSettingsValidationError(
          'default history speed must be active',
        );
      }

      return {
        name,
        stepUnit:
          item.stepUnit,
        intervalSeconds,
        sortOrder:
          (index + 1) * 10,
        isActive,
        isDefault,
      };
    });

  if (active < 1) {
    throw new ProjectSettingsValidationError(
      'at least one history speed must be active',
    );
  }
  if (defaults !== 1) {
    throw new ProjectSettingsValidationError(
      'exactly one history speed must be default',
    );
  }

  return normalized;
}

export function normalizeProjectSettingsUpdate(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ProjectSettingsValidationError(
      'Request body must be a JSON object',
    );
  }

  const hasShowLinePopups = Object.hasOwn(
    payload,
    'showLinePopups',
  );
  const {
    themePreset: rawThemePreset,
    showLineLabels = false,
    showLinePopups: rawShowLinePopups,
    showGeometryTimeline = false,
    historyStartDate = null,
    historySpeeds,
    showPointGeometries = true,
    showLineGeometries = true,
    showPolygonGeometries = true,
    mapboxAccessToken = null,
    largeCityPopulationThreshold = 400000,
    largeCityAreaKm2Threshold = null,
    ...base
  } = payload;

  if (typeof showLineLabels !== 'boolean') {
    throw new ProjectSettingsValidationError(
      'showLineLabels must be boolean',
    );
  }
  if (
    hasShowLinePopups &&
    typeof rawShowLinePopups !== 'boolean'
  ) {
    throw new ProjectSettingsValidationError(
      'showLinePopups must be boolean',
    );
  }
  if (
    typeof showGeometryTimeline !==
      'boolean'
  ) {
    throw new ProjectSettingsValidationError(
      'showGeometryTimeline must be boolean',
    );
  }
  for (
    const [
      field,
      value,
    ] of [
      [
        'showPointGeometries',
        showPointGeometries,
      ],
      [
        'showLineGeometries',
        showLineGeometries,
      ],
      [
        'showPolygonGeometries',
        showPolygonGeometries,
      ],
    ]
  ) {
    if (typeof value !== 'boolean') {
      throw new ProjectSettingsValidationError(
        field + ' must be boolean',
      );
    }
  }

  const populationThreshold =
    Number(largeCityPopulationThreshold);
  if (
    !Number.isSafeInteger(populationThreshold) ||
    populationThreshold <= 0 ||
    populationThreshold > 2147483647
  ) {
    throw new ProjectSettingsValidationError(
      'largeCityPopulationThreshold must be a positive integer',
    );
  }

  const areaThreshold =
    largeCityAreaKm2Threshold === null ||
    largeCityAreaKm2Threshold === undefined ||
    largeCityAreaKm2Threshold === ''
      ? null
      : Number(largeCityAreaKm2Threshold);
  if (
    areaThreshold !== null &&
    (!Number.isFinite(areaThreshold) || areaThreshold < 0)
  ) {
    throw new ProjectSettingsValidationError(
      'largeCityAreaKm2Threshold must be a non-negative number or null',
    );
  }

  return {
    plan: buildProjectSettingsPlan(base),
    themePreset:
      rawThemePreset === undefined
        ? null
        : normalizePublicThemePreset(rawThemePreset),
    showLineLabels,
    showLinePopups:
      hasShowLinePopups ? rawShowLinePopups : null,
    showGeometryTimeline,
    historyStartDate:
      normalizeHistoryDate(
        historyStartDate,
      ),
    historySpeeds:
      normalizeHistorySpeeds(
        historySpeeds,
      ),
    showPointGeometries,
    showLineGeometries,
    showPolygonGeometries,
    mapboxAccessToken: normalizeMapboxAccessToken(
      mapboxAccessToken,
      { optional: true },
    ),
    largeCityPopulationThreshold: populationThreshold,
    largeCityAreaKm2Threshold: areaThreshold,
  };
}
