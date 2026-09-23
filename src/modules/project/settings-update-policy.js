import {
  buildProjectSettingsPlan,
  normalizePublicThemePreset,
  ProjectSettingsValidationError,
} from '../../data/project-settings.js';
import { normalizeMapboxAccessToken } from '../../data/mapbox-access-token.js';

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
    mapboxAccessToken: normalizeMapboxAccessToken(
      mapboxAccessToken,
      { optional: true },
    ),
    largeCityPopulationThreshold: populationThreshold,
    largeCityAreaKm2Threshold: areaThreshold,
  };
}
