import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform, addAbortSignal } from 'node:stream';
import {
  createBrotliDecompress,
  createGunzip,
  createInflate,
} from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { openSingleFileZip } from '../shared/streaming/single-file-zip.js';

export class StreamUploadError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'StreamUploadError';
    this.statusCode = statusCode;
  }
}

function normalizedContentType(request) {
  return String(request.get('content-type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLocaleLowerCase('en-US');
}

function normalizedContentEncoding(request) {
  return String(request.get('content-encoding') ?? 'identity')
    .trim()
    .toLocaleLowerCase('en-US') || 'identity';
}

function sizeLimitTransform(maxBytes, message) {
  let bytes = 0;
  const transform = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        callback(new StreamUploadError(message, 413));
        return;
      }
      callback(null, buffer);
    },
  });
  Object.defineProperty(transform, 'bytes', {
    get() { return bytes; },
  });
  return transform;
}

/**
 * Spool only the transport bytes of a protected transfer request without
 * buffering them in memory. Content-Length is optional: chunked bodies from a
 * pipe/stdin ZIP producer are accepted. Decoded JSON is never materialized as
 * a temporary file and is consumed later as a stream inside one DB transaction.
 *
 * @param {import('express').Request} request
 * @param {{
 *   directory: string,
 *   maxUploadBytes: number,
 *   allowedContentTypes: Set<string>
 * }} options
 */
export async function receiveStreamUpload(request, options) {
  const contentType = normalizedContentType(request);
  if (!options.allowedContentTypes.has(contentType)) {
    throw new StreamUploadError(
      'Content-Type must be application/json, application/geo+json or application/zip',
      415,
    );
  }

  const contentEncoding = normalizedContentEncoding(request);
  const supportedEncodings = new Set(['identity', 'gzip', 'deflate', 'br']);
  if (!supportedEncodings.has(contentEncoding)) {
    throw new StreamUploadError(
      `Unsupported Content-Encoding: ${contentEncoding}`,
      415,
    );
  }
  if (contentType === 'application/zip' && contentEncoding !== 'identity') {
    throw new StreamUploadError(
      'ZIP uploads must not use an additional HTTP Content-Encoding',
      415,
    );
  }

  const declaredLength = Number(request.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > options.maxUploadBytes
  ) {
    throw new StreamUploadError(
      `Upload exceeds the configured limit of ${options.maxUploadBytes} bytes`,
      413,
    );
  }

  await fsp.mkdir(options.directory, { recursive: true });
  const filePath = path.join(
    options.directory,
    `.portable-upload-${process.pid}-${crypto.randomUUID()}.tmp`,
  );
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > options.maxUploadBytes) {
        callback(new StreamUploadError(
          `Upload exceeds the configured limit of ${options.maxUploadBytes} bytes`,
          413,
        ));
        return;
      }
      hash.update(buffer);
      callback(null, buffer);
    },
  });

  try {
    await pipeline(
      request,
      counter,
      fs.createWriteStream(filePath, {
        flags: 'wx',
        mode: 0o600,
      }),
    );
    if (bytes === 0) {
      throw new StreamUploadError('Upload body is empty', 400);
    }
    return {
      path: filePath,
      contentType,
      contentEncoding,
      bytes,
      sha256: hash.digest('hex'),
    };
  } catch (error) {
    await fsp.unlink(filePath).catch(() => {});
    throw error;
  }
}

export async function removeStreamUpload(upload) {
  if (!upload?.path) return;
  await fsp.unlink(upload.path).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}

function decodedStreamFor(upload) {
  const input = fs.createReadStream(upload.path);
  if (upload.contentEncoding === 'identity') return input;
  if (upload.contentEncoding === 'gzip') return input.pipe(createGunzip());
  if (upload.contentEncoding === 'deflate') return input.pipe(createInflate());
  if (upload.contentEncoding === 'br') {
    return input.pipe(createBrotliDecompress());
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
export async function openUploadedJson(upload, options) {
  if (upload.contentType === 'application/zip') {
    const entry = await openSingleFileZip(upload.path, {
      maxUncompressedBytes: options.maxJsonBytes,
      maxCompressionRatio: options.maxZipCompressionRatio,
      maxEntries: options.maxZipEntries,
      signal: options.signal,
    });
    return {
      stream: entry.stream,
      transport: 'zip',
      fileName: entry.fileName,
      compressedBytes: entry.compressedSize,
      expectedJsonBytes: entry.uncompressedSize,
    };
  }

  const decoded = decodedStreamFor(upload);
  const limiter = sizeLimitTransform(
    options.maxJsonBytes,
    `Decoded JSON exceeds the configured limit of ${options.maxJsonBytes} bytes`,
  );
  decoded.on('error', (error) => limiter.destroy(error));
  if (options.signal) {
    addAbortSignal(options.signal, decoded);
    addAbortSignal(options.signal, limiter);
  }
  decoded.pipe(limiter);
  return {
    stream: limiter,
    transport: upload.contentEncoding === 'identity'
      ? 'json'
      : `json+${upload.contentEncoding}`,
    fileName: null,
    compressedBytes: upload.bytes,
    expectedJsonBytes: null,
  };
}

/**
 * Best-effort cleanup of orphan request spools after process crashes.
 * Active uploads always use fresh random names.
 *
 * @param {string} directory
 * @param {{ olderThanMs?: number }} [options]
 */
export async function cleanupStreamUploads(
  directory,
  { olderThanMs = 24 * 60 * 60 * 1000 } = {},
) {
  await fsp.mkdir(directory, { recursive: true });
  const threshold = Date.now() - olderThanMs;
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.startsWith('.portable-upload-') ||
      !entry.name.endsWith('.tmp')
    ) {
      continue;
    }
    const filePath = path.join(directory, entry.name);
    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat || stat.mtimeMs >= threshold) continue;
    await fsp.unlink(filePath).catch(() => {});
    removed += 1;
  }
  return removed;
}
