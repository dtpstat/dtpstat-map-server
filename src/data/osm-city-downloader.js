export class OsmCityDownloadError extends Error {
  /**
   * @param {string} message
   * @param {{
   *   statusCode?: number,
   *   retryAfterMs?: number | null,
   *   finalURL?: string,
   *   code?: string,
   *   limitBytes?: number,
   *   receivedBytes?: number,
   *   networkCode?: string | null,
   *   networkMessage?: string | null,
   *   retryable?: boolean,
   * }} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'OsmCityDownloadError';
    this.statusCode = details.statusCode ?? null;
    this.retryAfterMs = details.retryAfterMs ?? null;
    this.finalURL = details.finalURL ?? null;
    this.code = details.code ?? null;
    this.limitBytes = details.limitBytes ?? null;
    this.receivedBytes = details.receivedBytes ?? null;
    this.networkCode = details.networkCode ?? null;
    this.networkMessage = details.networkMessage ?? null;
    this.retryable = details.retryable ?? false;
  }
}

const RETRYABLE_NETWORK_CODES = new Set([
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function nestedErrorDetail(error, key) {
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current?.[key] === 'string' && current[key]) {
      return current[key];
    }
    current = current?.cause;
  }
  return null;
}

function wrapNetworkError(error, {
  operationSignal,
  timeoutController,
  timeoutMs,
  finalURL,
}) {
  if (operationSignal?.aborted) {
    return operationSignal.reason instanceof Error
      ? operationSignal.reason
      : error;
  }

  if (timeoutController.signal.aborted) {
    const timeoutError = new OsmCityDownloadError(
      `OSM download timed out after ${timeoutMs} ms`,
      {
        code: 'network-timeout',
        networkCode: 'ETIMEDOUT',
        networkMessage: `request timeout after ${timeoutMs} ms`,
        retryable: true,
        finalURL,
      },
    );
    timeoutError.cause = error;
    return timeoutError;
  }

  const networkCode = nestedErrorDetail(error, 'code');
  const networkMessage =
    nestedErrorDetail(error, 'message') ??
    (error instanceof Error ? error.message : String(error));
  const retryable =
    RETRYABLE_NETWORK_CODES.has(networkCode) ||
    (
      error instanceof TypeError &&
      error.message === 'fetch failed'
    );

  const wrapped = new OsmCityDownloadError(
    `OSM download failed: ${networkMessage}` +
    (networkCode ? ` [${networkCode}]` : ''),
    {
      code: 'network-error',
      networkCode,
      networkMessage,
      retryable,
      finalURL,
    },
  );
  wrapped.cause = error;
  return wrapped;
}

/**
 * Parse both HTTP Retry-After forms: delay-seconds and HTTP-date.
 * @param {string | null} value
 * @param {number} [now]
 */
export function parseRetryAfterMs(value, now = Date.now()) {
  const raw = value?.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    const milliseconds = seconds * 1000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : null;
  }
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null;
}

/** @param {string} rawUrl @param {Set<string>} allowedHosts */
function validateDownloadUrl(rawUrl, allowedHosts) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OsmCityDownloadError('OSM download redirected to an invalid URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new OsmCityDownloadError(
      'OSM download URL must be credential-free HTTPS',
    );
  }
  if (!allowedHosts.has(url.hostname.toLocaleLowerCase('en-US'))) {
    throw new OsmCityDownloadError(
      `OSM download host is not allowed: ${url.hostname}`,
    );
  }
  url.hash = '';
  return url;
}

/**
 * @param {string} sourceUrl
 * @param {string} overpassQuery
 * @param {{ timeoutMs: number, maxBytes: number, allowedHosts: Set<string>, userAgent?: string, signal?: AbortSignal }} options
 * @param {typeof fetch} [fetchImplementation]
 */
export async function downloadOsmCities(
  sourceUrl,
  overpassQuery,
  options,
  fetchImplementation = globalThis.fetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  let url = validateDownloadUrl(sourceUrl, options.allowedHosts);
  const body = new URLSearchParams({ data: overpassQuery }).toString();

  try {
    for (let redirect = 0; redirect <= 5; redirect += 1) {
      let response;
      try {
        response = await fetchImplementation(url, {
          method: 'POST',
          redirect: 'manual',
          signal,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'User-Agent': options.userAgent ??
              'dtpstat-buslines/2.0 OSM city updater',
          },
          body,
        });
      } catch (error) {
        throw wrapNetworkError(error, {
          operationSignal: options.signal,
          timeoutController: controller,
          timeoutMs: options.timeoutMs,
          finalURL: url.toString(),
        });
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirect === 5) {
          throw new OsmCityDownloadError('OSM download has too many redirects');
        }
        url = validateDownloadUrl(
          new URL(location, url).toString(),
          options.allowedHosts,
        );
        continue;
      }
      if (!response.ok) {
        throw new OsmCityDownloadError(
          `OSM download returned HTTP ${response.status}`,
          {
            statusCode: response.status,
            retryAfterMs: parseRetryAfterMs(
              response.headers.get('retry-after'),
            ),
            finalURL: url.toString(),
          },
        );
      }

      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
        throw new OsmCityDownloadError(
          'OSM response exceeds the configured size limit',
          {
            code: 'response-size-limit',
            limitBytes: options.maxBytes,
            receivedBytes: declaredLength,
            finalURL: url.toString(),
          },
        );
      }
      if (!response.body) {
        throw new OsmCityDownloadError('OSM download returned an empty body');
      }

      const chunks = [];
      let bytes = 0;
      try {
        for await (const chunk of response.body) {
          const buffer = Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > options.maxBytes) {
            throw new OsmCityDownloadError(
              'OSM response exceeds the configured size limit',
              {
                code: 'response-size-limit',
                limitBytes: options.maxBytes,
                receivedBytes: bytes,
                finalURL: url.toString(),
              },
            );
          }
          chunks.push(buffer);
        }
      } catch (error) {
        if (error instanceof OsmCityDownloadError) throw error;
        throw wrapNetworkError(error, {
          operationSignal: options.signal,
          timeoutController: controller,
          timeoutMs: options.timeoutMs,
          finalURL: url.toString(),
        });
      }
      if (bytes === 0) {
        throw new OsmCityDownloadError('OSM download returned an empty body');
      }

      let jsonText;
      try {
        jsonText = new TextDecoder('utf-8', { fatal: true }).decode(
          Buffer.concat(chunks),
        );
      } catch {
        throw new OsmCityDownloadError('OSM response is not valid UTF-8');
      }
      return { jsonText, bytes, finalURL: url.toString() };
    }
    throw new OsmCityDownloadError('OSM download has too many redirects');
  } finally {
    clearTimeout(timeout);
  }
}
