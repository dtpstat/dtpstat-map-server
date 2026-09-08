import { ProjectSettingsValidationError } from './project-settings.js';

export const DEFAULT_PUBLIC_DOWNLOAD_NAME = 'bus-lanes';
export const PUBLIC_DOWNLOAD_NAME_MAX_LENGTH = 120;

/**
 * Normalize the base file name used for public GeoJSON/CSV downloads.
 * The extension is deliberately not part of the setting.
 *
 * @param {unknown} value
 * @param {{ optional?: boolean }} [options]
 */
export function normalizePublicDownloadName(value, options = {}) {
  if (value === undefined || value === null) {
    if (options.optional) return null;
    return DEFAULT_PUBLIC_DOWNLOAD_NAME;
  }
  if (typeof value !== 'string') {
    throw new ProjectSettingsValidationError('publicDownloadName must be a string');
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new ProjectSettingsValidationError('publicDownloadName contains control characters');
  }

  const normalized = value.trim().replace(/\s+/g, ' ').normalize('NFC');
  if (!normalized || normalized.length > PUBLIC_DOWNLOAD_NAME_MAX_LENGTH) {
    throw new ProjectSettingsValidationError(
      `publicDownloadName must contain 1-${PUBLIC_DOWNLOAD_NAME_MAX_LENGTH} characters`,
    );
  }
  if (/[\\/]/.test(normalized)) {
    throw new ProjectSettingsValidationError('publicDownloadName must not contain path separators');
  }
  if (normalized === '.' || normalized === '..') {
    throw new ProjectSettingsValidationError('publicDownloadName is not a valid file name');
  }
  if (/\.(?:csv|geojson)$/i.test(normalized)) {
    throw new ProjectSettingsValidationError(
      'publicDownloadName must not include .csv or .geojson extension',
    );
  }

  return normalized;
}
