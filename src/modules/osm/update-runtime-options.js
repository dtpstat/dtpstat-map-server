import {
  normalizeOsmUpdateUrl,
  OsmCityUpdateValidationError,
  resolveOsmCityUpdateRequest,
} from '../../data/osm-city-update-options.js';

export async function resolveOsmUpdateRuntimeOptions({
  settingsRepository,
  config,
  body,
  query,
}) {
  const savedSettings = settingsRepository
    ? await settingsRepository.get()
    : null;

  if (savedSettings?.sourceURL) {
    const savedSourceURL = normalizeOsmUpdateUrl(
      savedSettings.sourceURL,
      config.allowedHosts,
    );
    if (config.allowedURLs && !config.allowedURLs.has(savedSourceURL)) {
      throw new OsmCityUpdateValidationError(
        `Saved OSM URL is no longer allowed by deployment configuration: ${savedSourceURL}`,
      );
    }
  }

  const runtimeConfig = savedSettings
    ? {
        ...config,
        url: savedSettings.sourceURL,
        includeCity: savedSettings.includeCity,
        includeTown: savedSettings.includeTown,
        includeAdministrative: savedSettings.includeAdministrative,
        adminLevelMin: savedSettings.adminLevelMin,
        adminLevelMax: savedSettings.adminLevelMax,
        batchSize: savedSettings.batchSize,
        minDelayMs: savedSettings.minDelayMs,
        timeoutMs: savedSettings.timeoutMs,
        queryTimeoutSeconds: savedSettings.queryTimeoutSeconds,
        maxResponseBytes: savedSettings.maxResponseBytes,
        maxTotalBytes: savedSettings.maxTotalBytes,
        maxRetries: savedSettings.maxRetries,
        retryBaseDelayMs: savedSettings.retryBaseDelayMs,
        retryMaxDelayMs: savedSettings.retryMaxDelayMs,
      }
    : config;

  return resolveOsmCityUpdateRequest(body, query, runtimeConfig);
}
