import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  StreamUploadError,
} from '../http/upload-policy.js';

/**
 * Persist transport bytes to a private temporary spool while enforcing the
 * configured byte ceiling and calculating a stable payload fingerprint.
 *
 * @param {import('node:stream').Readable} source
 * @param {{
 *   directory: string,
 *   maxUploadBytes: number
 * }} options
 */
export async function stageUploadStream(
  source,
  options,
) {
  await fsp.mkdir(
    options.directory,
    { recursive: true },
  );

  const filePath = path.join(
    options.directory,
    `.portable-upload-${process.pid}-${crypto.randomUUID()}.tmp`,
  );

  const hash =
    crypto.createHash('sha256');

  let bytes = 0;

  const counter =
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

        if (
          bytes >
          options.maxUploadBytes
        ) {
          callback(
            new StreamUploadError(
              `Upload exceeds the configured limit of ${options.maxUploadBytes} bytes`,
              413,
            ),
          );
          return;
        }

        hash.update(buffer);
        callback(null, buffer);
      },
    });

  try {
    await pipeline(
      source,
      counter,
      fs.createWriteStream(
        filePath,
        {
          flags: 'wx',
          mode: 0o600,
        },
      ),
    );

    if (bytes === 0) {
      throw new StreamUploadError(
        'Upload body is empty',
        400,
      );
    }

    return {
      path: filePath,
      bytes,
      sha256:
        hash.digest('hex'),
    };
  } catch (error) {
    await fsp
      .unlink(filePath)
      .catch(() => {});

    throw error;
  }
}

export async function removeStagedUpload(
  upload,
) {
  if (!upload?.path) return;

  await fsp
    .unlink(upload.path)
    .catch((error) => {
      if (
        error?.code !==
        'ENOENT'
      ) {
        throw error;
      }
    });
}

/**
 * Best-effort cleanup of orphan request spools after process crashes.
 *
 * @param {string} directory
 * @param {{ olderThanMs?: number }} [options]
 */
export async function cleanupStagedUploads(
  directory,
  {
    olderThanMs =
      24 * 60 * 60 * 1000,
  } = {},
) {
  await fsp.mkdir(
    directory,
    { recursive: true },
  );

  const threshold =
    Date.now() - olderThanMs;

  const entries =
    await fsp.readdir(
      directory,
      {
        withFileTypes: true,
      },
    );

  let removed = 0;

  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.startsWith(
        '.portable-upload-',
      ) ||
      !entry.name.endsWith(
        '.tmp',
      )
    ) {
      continue;
    }

    const filePath =
      path.join(
        directory,
        entry.name,
      );

    const stat =
      await fsp
        .stat(filePath)
        .catch(() => null);

    if (
      !stat ||
      stat.mtimeMs >= threshold
    ) {
      continue;
    }

    await fsp
      .unlink(filePath)
      .catch(() => {});

    removed += 1;
  }

  return removed;
}
