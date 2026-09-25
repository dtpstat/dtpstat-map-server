export class KmlDownloadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KmlDownloadError';
  }
}

/** @param {string} rawUrl @param {Set<string>} allowedHosts */
function validateDownloadUrl(rawUrl, allowedHosts) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new KmlDownloadError('KML download redirected to an invalid URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new KmlDownloadError('KML download URL must be credential-free HTTPS');
  }
  if (!allowedHosts.has(url.hostname.toLocaleLowerCase('en-US'))) {
    throw new KmlDownloadError(
      `KML download host is not allowed: ${url.hostname}`,
    );
  }
  url.hash = '';
  return url;
}

/**
 * @param {{ fetchURL: string }} source
 * @param {{ timeoutMs: number, maxFileBytes: number, allowedHosts: Set<string>, signal?: AbortSignal }} options
 * @param {typeof fetch} [fetchImplementation]
 */
export async function downloadKml(
  source,
  options,
  fetchImplementation = globalThis.fetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  let url = validateDownloadUrl(source.fetchURL, options.allowedHosts);

  try {
    for (let redirect = 0; redirect <= 5; redirect += 1) {
      let response;
      try {
        response = await fetchImplementation(url, {
          redirect: 'manual',
          signal,
          headers: {
            Accept: 'application/vnd.google-earth.kml+xml, application/xml, text/xml',
            'User-Agent': 'dtpstat-buslines/2.0 KML updater',
          },
        });
      } catch (error) {
        if (options.signal?.aborted) {
          throw options.signal.reason instanceof Error
            ? options.signal.reason
            : error;
        }
        if (controller.signal.aborted) {
          throw new KmlDownloadError(`KML download timed out after ${options.timeoutMs} ms`);
        }
        throw new KmlDownloadError(
          `KML download failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirect === 5) {
          throw new KmlDownloadError('KML download has too many redirects');
        }
        url = validateDownloadUrl(new URL(location, url).toString(), options.allowedHosts);
        continue;
      }
      if (!response.ok) {
        throw new KmlDownloadError(
          `KML download returned HTTP ${response.status}`,
        );
      }

      const declaredLength = Number(response.headers.get('content-length'));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > options.maxFileBytes
      ) {
        throw new KmlDownloadError('KML file exceeds the configured size limit');
      }
      if (!response.body) {
        throw new KmlDownloadError('KML download returned an empty body');
      }

      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > options.maxFileBytes) {
          throw new KmlDownloadError('KML file exceeds the configured size limit');
        }
        chunks.push(buffer);
      }
      if (bytes === 0) {
        throw new KmlDownloadError('KML download returned an empty body');
      }
      let xml;
      try {
        xml = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      } catch {
        throw new KmlDownloadError('KML document is not valid UTF-8');
      }
      return { xml, bytes, finalURL: url.toString() };
    }
    throw new KmlDownloadError('KML download has too many redirects');
  } finally {
    clearTimeout(timeout);
  }
}
