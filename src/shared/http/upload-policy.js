export class StreamUploadError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'StreamUploadError';
    this.statusCode = statusCode;
  }
}

function normalizedHeader(value, fallback = '') {
  return String(value ?? fallback)
    .trim()
    .toLocaleLowerCase('en-US');
}

/**
 * Validate portable-upload HTTP metadata before any body bytes are spooled.
 *
 * @param {{
 *   contentTypeHeader?: unknown,
 *   contentEncodingHeader?: unknown,
 *   contentLengthHeader?: unknown
 * }} metadata
 * @param {{
 *   maxUploadBytes: number,
 *   allowedContentTypes: Set<string>
 * }} options
 */
export function validateStreamUploadTransport(
  {
    contentTypeHeader,
    contentEncodingHeader,
    contentLengthHeader,
  },
  options,
) {
  const contentType =
    normalizedHeader(contentTypeHeader)
      .split(';', 1)[0]
      .trim();

  if (
    !options.allowedContentTypes
      .has(contentType)
  ) {
    throw new StreamUploadError(
      'Content-Type must be application/json, application/geo+json or application/zip',
      415,
    );
  }

  const contentEncoding =
    normalizedHeader(
      contentEncodingHeader,
      'identity',
    ) || 'identity';

  const supportedEncodings =
    new Set([
      'identity',
      'gzip',
      'deflate',
      'br',
    ]);

  if (
    !supportedEncodings
      .has(contentEncoding)
  ) {
    throw new StreamUploadError(
      `Unsupported Content-Encoding: ${contentEncoding}`,
      415,
    );
  }

  if (
    contentType ===
      'application/zip' &&
    contentEncoding !==
      'identity'
  ) {
    throw new StreamUploadError(
      'ZIP uploads must not use an additional HTTP Content-Encoding',
      415,
    );
  }

  const declaredLength =
    Number(contentLengthHeader);

  if (
    Number.isFinite(
      declaredLength,
    ) &&
    declaredLength >
      options.maxUploadBytes
  ) {
    throw new StreamUploadError(
      `Upload exceeds the configured limit of ${options.maxUploadBytes} bytes`,
      413,
    );
  }

  return {
    contentType,
    contentEncoding,
    declaredLength:
      Number.isFinite(
        declaredLength,
      )
        ? declaredLength
        : null,
  };
}
