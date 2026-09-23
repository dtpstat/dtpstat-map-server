import { OsmCityDownloadError } from '../../data/osm-city-downloader.js';

const RETRYABLE_HTTP_STATUS_CODES = new Set([429, 502, 503, 504]);
const GEOMETRY_504_RETRIES_BEFORE_SPLIT = 3;

/**
 * Owns one OSM update's Overpass request lifecycle: throttling, retry policy,
 * transport byte limits and request metrics. Parsing, checkpoint persistence
 * and database replacement deliberately remain outside this component.
 *
 * @param {{
 *   download: Function,
 *   config: {
 *     allowedHosts: Set<string> | string[],
 *     userAgent?: string,
 *   },
 *   options: {
 *     url: string,
 *     timeoutMs: number,
 *     maxResponseBytes: number,
 *     maxTotalBytes: number,
 *     minDelayMs: number,
 *     maxRetries: number,
 *     retryBaseDelayMs: number,
 *     retryMaxDelayMs: number,
 *   },
 *   signal?: AbortSignal,
 *   sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
 *   now: () => number,
 *   metrics: {
 *     downloadedBytes: number,
 *     requestAttemptCount: number,
 *     retryCount: number,
 *     retryWaitMs: number,
 *     throttleWaitMs: number,
 *   },
 *   assertNotCancelled: () => void,
 *   emitProgress?: (progress: object) => void,
 *   onDownloaded?: (downloaded: {
 *     bytes: number,
 *     jsonText: string,
 *     finalURL?: string,
 *   }) => void,
 * }} dependencies
 */
export function createOverpassRequestSession(dependencies) {
  const {
    download,
    config,
    options,
    signal,
    sleep,
    now,
    metrics,
    assertNotCancelled,
    emitProgress = () => {},
    onDownloaded = () => {},
  } = dependencies;
  let lastRequestCompletedAt = null;

  return {
    async downloadQuery(overpassQuery, requestProgress) {
      for (let attempt = 0; ; attempt += 1) {
        assertNotCancelled();

        if (lastRequestCompletedAt !== null) {
          const waitMs = Math.max(
            0,
            lastRequestCompletedAt + options.minDelayMs - now(),
          );
          if (waitMs > 0) {
            metrics.throttleWaitMs += waitMs;
            await sleep(waitMs, signal);
          }
        }

        const remainingTotalBytes =
          options.maxTotalBytes - metrics.downloadedBytes;
        if (remainingTotalBytes < 1) {
          throw new OsmCityDownloadError(
            'OSM responses exceed the configured total size limit',
            {
              code: 'total-size-limit',
              limitBytes: options.maxTotalBytes,
              receivedBytes: metrics.downloadedBytes,
            },
          );
        }
        const responseLimitBytes = Math.min(
          options.maxResponseBytes,
          remainingTotalBytes,
        );

        metrics.requestAttemptCount += 1;
        try {
          const downloaded = await download(options.url, overpassQuery, {
            allowedHosts: config.allowedHosts,
            timeoutMs: options.timeoutMs,
            maxBytes: responseLimitBytes,
            userAgent: config.userAgent,
            signal,
          });
          lastRequestCompletedAt = now();
          assertNotCancelled();
          metrics.downloadedBytes += downloaded.bytes;
          onDownloaded(downloaded);
          return downloaded;
        } catch (error) {
          lastRequestCompletedAt = now();
          if (
            error instanceof OsmCityDownloadError &&
            error.code === 'response-size-limit' &&
            responseLimitBytes < options.maxResponseBytes
          ) {
            const totalLimitError = new OsmCityDownloadError(
              'OSM responses exceed the configured total size limit',
              {
                code: 'total-size-limit',
                limitBytes: options.maxTotalBytes,
                receivedBytes: metrics.downloadedBytes,
                finalURL: error.finalURL,
              },
            );
            totalLimitError.cause = error;
            throw totalLimitError;
          }

          const retryableHttp =
            error instanceof OsmCityDownloadError &&
            RETRYABLE_HTTP_STATUS_CODES.has(error.statusCode);
          const retryableNetwork =
            error instanceof OsmCityDownloadError &&
            error.retryable === true &&
            (
              error.code === 'network-error' ||
              error.code === 'network-timeout'
            );
          if (!retryableHttp && !retryableNetwork) {
            throw error;
          }

          const retryAttempt = attempt + 1;
          const splitEligible504 =
            retryableHttp &&
            error.statusCode === 504 &&
            requestProgress.requestPhase === 'geometry' &&
            (requestProgress.objectCount ?? 0) > 1;
          const retryLimit = splitEligible504
            ? Math.min(
                options.maxRetries,
                GEOMETRY_504_RETRIES_BEFORE_SPLIT,
              )
            : options.maxRetries;

          if (retryAttempt > retryLimit) {
            const exhausted = new OsmCityDownloadError(
              retryableNetwork
                ? `OSM network download failed after ${retryLimit} retries: ` +
                  `${error.networkCode ?? error.networkMessage ?? 'network failure'}`
                : `OSM download returned HTTP ${error.statusCode} after ` +
                  `${retryLimit} retries`,
              {
                statusCode: error.statusCode,
                retryAfterMs: error.retryAfterMs,
                finalURL: error.finalURL,
                code: splitEligible504
                  ? 'geometry-504-retry-limit'
                  : 'retry-limit',
                networkCode: error.networkCode,
                networkMessage: error.networkMessage,
                retryable: false,
              },
            );
            exhausted.retryCount = retryLimit;
            exhausted.configuredMaxRetries = options.maxRetries;
            exhausted.cause = error;
            throw exhausted;
          }

          const fallbackDelayMs = Math.min(
            options.retryBaseDelayMs * (2 ** (retryAttempt - 1)),
            options.retryMaxDelayMs,
          );
          const waitMs = Math.max(
            options.minDelayMs,
            fallbackDelayMs,
            error.retryAfterMs ?? 0,
          );
          metrics.retryCount += 1;
          metrics.retryWaitMs += waitMs;
          const progress = {
            phase: 'retry',
            ...requestProgress,
            statusCode: error.statusCode,
            attempt: retryAttempt,
            maxRetries: retryLimit,
            configuredMaxRetries: options.maxRetries,
            waitMs,
            retryAt: new Date(now() + waitMs).toISOString(),
            retryAfterMs: error.retryAfterMs,
            fallbackDelayMs,
            ...(retryableNetwork
              ? {
                  retryKind: 'network',
                  networkCode: error.networkCode,
                  networkMessage: error.networkMessage,
                }
              : {}),
          };
          emitProgress(progress);
          await sleep(waitMs, signal);
          lastRequestCompletedAt = null;
        }
      }
    },
  };
}
