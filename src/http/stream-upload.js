import fs from 'node:fs';
import {
  Transform,
  addAbortSignal,
} from 'node:stream';
import {
  createBrotliDecompress,
  createGunzip,
  createInflate,
} from 'node:zlib';
import {
  cleanupStagedUploads,
  removeStagedUpload,
  stageUploadStream,
} from '../shared/files/upload-staging.js';
import {
  StreamUploadError,
  validateStreamUploadTransport,
} from '../shared/http/upload-policy.js';
import {
  openSingleFileZip,
} from '../shared/streaming/single-file-zip.js';

export {
  StreamUploadError,
};

function sizeLimitTransform(
  maxBytes,
  message,
) {
  let bytes = 0;

  const transform =
    new Transform({
      transform(
        chunk,
        _encoding,
        callback,
      ) {
        const buffer =
          Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk);

        bytes += buffer.length;

        if (bytes > maxBytes) {
          callback(
            new StreamUploadError(
              message,
              413,
            ),
          );
          return;
        }

        callback(
          null,
          buffer,
        );
      },
    });

  Object.defineProperty(
    transform,
    'bytes',
    {
      get() {
        return bytes;
      },
    },
  );

  return transform;
}

/**
 * Spool only the transport bytes of a protected transfer request without
 * buffering them in memory. Content-Length is optional: chunked bodies from a
 * pipe/stdin ZIP producer are accepted.
 *
 * @param {import('express').Request} request
 * @param {{
 *   directory: string,
 *   maxUploadBytes: number,
 *   allowedContentTypes: Set<string>
 * }} options
 */
export async function receiveStreamUpload(
  request,
  options,
) {
  const {
    contentType,
    contentEncoding,
  } =
    validateStreamUploadTransport(
      {
        contentTypeHeader:
          request.get(
            'content-type',
          ),
        contentEncodingHeader:
          request.get(
            'content-encoding',
          ),
        contentLengthHeader:
          request.get(
            'content-length',
          ),
      },
      options,
    );

  const staged =
    await stageUploadStream(
      request,
      options,
    );

  return {
    ...staged,
    contentType,
    contentEncoding,
  };
}

export async function removeStreamUpload(
  upload,
) {
  await removeStagedUpload(
    upload,
  );
}

function decodedStreamFor(upload) {
  const input =
    fs.createReadStream(
      upload.path,
    );

  if (
    upload.contentEncoding ===
    'identity'
  ) {
    return input;
  }

  if (
    upload.contentEncoding ===
    'gzip'
  ) {
    return input.pipe(
      createGunzip(),
    );
  }

  if (
    upload.contentEncoding ===
    'deflate'
  ) {
    return input.pipe(
      createInflate(),
    );
  }

  if (
    upload.contentEncoding ===
    'br'
  ) {
    return input.pipe(
      createBrotliDecompress(),
    );
  }

  throw new StreamUploadError(
    `Unsupported Content-Encoding: ${upload.contentEncoding}`,
    415,
  );
}

/**
 * Open an uploaded raw JSON/GeoJSON or one-file ZIP as a bounded decoded JSON
 * stream. ZIP CRC/size validation remains part of the stream, so a corrupt
 * archive fails the surrounding DB transaction.
 *
 * @param {object} upload
 * @param {{
 *   maxJsonBytes: number,
 *   maxZipCompressionRatio?: number,
 *   maxZipEntries?: number,
 *   signal?: AbortSignal
 * }} options
 */
export async function openUploadedJson(
  upload,
  options,
) {
  if (
    upload.contentType ===
    'application/zip'
  ) {
    const entry =
      await openSingleFileZip(
        upload.path,
        {
          maxUncompressedBytes:
            options.maxJsonBytes,
          maxCompressionRatio:
            options
              .maxZipCompressionRatio,
          maxEntries:
            options.maxZipEntries,
          signal:
            options.signal,
        },
      );

    return {
      stream: entry.stream,
      transport: 'zip',
      fileName:
        entry.fileName,
      compressedBytes:
        entry.compressedSize,
      expectedJsonBytes:
        entry.uncompressedSize,
    };
  }

  const decoded =
    decodedStreamFor(upload);

  const limiter =
    sizeLimitTransform(
      options.maxJsonBytes,
      `Decoded JSON exceeds the configured limit of ${options.maxJsonBytes} bytes`,
    );

  decoded.on(
    'error',
    (error) =>
      limiter.destroy(error),
  );

  if (options.signal) {
    addAbortSignal(
      options.signal,
      decoded,
    );
    addAbortSignal(
      options.signal,
      limiter,
    );
  }

  decoded.pipe(limiter);

  return {
    stream: limiter,
    transport:
      upload.contentEncoding ===
        'identity'
        ? 'json'
        : `json+${upload.contentEncoding}`,
    fileName: null,
    compressedBytes:
      upload.bytes,
    expectedJsonBytes: null,
  };
}

export async function cleanupStreamUploads(
  directory,
  options,
) {
  return cleanupStagedUploads(
    directory,
    options,
  );
}
