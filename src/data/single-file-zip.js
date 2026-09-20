import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable, Transform, addAbortSignal } from 'node:stream';
import { createDeflateRaw, createInflateRaw } from 'node:zlib';

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR = 0x07064b50;
const DATA_DESCRIPTOR = 0x08074b50;
const ZIP64_EXTRA_FIELD = 0x0001;
const MAX_EOCD_SEARCH = 22 + 0xffff;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const ZIP_FLAGS_UTF8_DATA_DESCRIPTOR = 0x0808;
const ZIP_FLAG_ENCRYPTED = 0x0001;
const ZIP_FLAG_STRONG_ENCRYPTION = 0x0040;
const ZIP_SUPPORTED_FLAGS_MASK =
  ZIP_FLAG_ENCRYPTED |
  ZIP_FLAG_STRONG_ENCRYPTION |
  0x0008 |
  0x0800;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0
        ? 0xedb88320 ^ (value >>> 1)
        : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function updateCrc32(crc, chunk) {
  let value = crc >>> 0;
  for (const byte of chunk) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return value >>> 0;
}

function finalCrc32(crc) {
  return (crc ^ 0xffffffff) >>> 0;
}

export class SingleFileZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SingleFileZipError';
  }
}

async function readExactly(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(
      buffer,
      offset,
      length - offset,
      position + offset,
    );
    if (result.bytesRead === 0) {
      throw new SingleFileZipError('ZIP archive ended unexpectedly');
    }
    offset += result.bytesRead;
  }
  return buffer;
}

function safeNumber(value, label) {
  const bigint = typeof value === 'bigint' ? value : BigInt(value);
  if (bigint < 0n || bigint > MAX_SAFE_BIGINT) {
    throw new SingleFileZipError(
      `ZIP ${label} exceeds JavaScript safe integer range`,
    );
  }
  return Number(bigint);
}

function decodeFileName(buffer, flags) {
  if ((flags & 0x0800) === 0 && buffer.some((byte) => byte > 0x7f)) {
    throw new SingleFileZipError(
      'ZIP entry filename must be UTF-8 or ASCII',
    );
  }
  const name = buffer.toString('utf8');
  if (!name || name.includes('\0')) {
    throw new SingleFileZipError('ZIP entry has an invalid filename');
  }
  return name;
}

function validateExportEntryName(name) {
  if (
    typeof name !== 'string' ||
    !name ||
    name.includes('\0') ||
    name.endsWith('/') ||
    name.endsWith('\\')
  ) {
    throw new SingleFileZipError(
      'ZIP export entry must be an ordinary file',
    );
  }
}

function parseExtraFields(buffer) {
  const fields = new Map();
  let offset = 0;
  while (offset < buffer.length) {
    if (offset + 4 > buffer.length) {
      throw new SingleFileZipError('ZIP extra field is truncated');
    }
    const id = buffer.readUInt16LE(offset);
    const length = buffer.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + length > buffer.length) {
      throw new SingleFileZipError('ZIP extra field payload is truncated');
    }
    if (!fields.has(id)) {
      fields.set(id, buffer.subarray(offset, offset + length));
    }
    offset += length;
  }
  return fields;
}

function centralZip64Values({
  compressed32,
  uncompressed32,
  localOffset32,
  diskStart16,
  extra,
}) {
  const zip64 = parseExtraFields(extra).get(ZIP64_EXTRA_FIELD);
  const needsZip64 =
    compressed32 === MAX_UINT32 ||
    uncompressed32 === MAX_UINT32 ||
    localOffset32 === MAX_UINT32 ||
    diskStart16 === MAX_UINT16;

  if (!needsZip64) {
    return {
      compressedSize: compressed32,
      uncompressedSize: uncompressed32,
      localOffset: localOffset32,
      diskStart: diskStart16,
    };
  }
  if (!zip64) {
    throw new SingleFileZipError(
      'ZIP64 central-directory entry is missing its ZIP64 extra field',
    );
  }

  let offset = 0;
  const takeUInt64 = (label) => {
    if (offset + 8 > zip64.length) {
      throw new SingleFileZipError(
        `ZIP64 extra field is missing ${label}`,
      );
    }
    const value = safeNumber(zip64.readBigUInt64LE(offset), label);
    offset += 8;
    return value;
  };
  const takeUInt32 = (label) => {
    if (offset + 4 > zip64.length) {
      throw new SingleFileZipError(
        `ZIP64 extra field is missing ${label}`,
      );
    }
    const value = zip64.readUInt32LE(offset);
    offset += 4;
    return value;
  };

  return {
    uncompressedSize: uncompressed32 === MAX_UINT32
      ? takeUInt64('uncompressed size')
      : uncompressed32,
    compressedSize: compressed32 === MAX_UINT32
      ? takeUInt64('compressed size')
      : compressed32,
    localOffset: localOffset32 === MAX_UINT32
      ? takeUInt64('local-header offset')
      : localOffset32,
    diskStart: diskStart16 === MAX_UINT16
      ? takeUInt32('disk number')
      : diskStart16,
  };
}

async function directoryInfo(handle, stat, tail, tailOffset, eocdOffset) {
  const absoluteEocdOffset = tailOffset + eocdOffset;
  const diskNumber = tail.readUInt16LE(eocdOffset + 4);
  const centralDisk = tail.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk16 = tail.readUInt16LE(eocdOffset + 8);
  const entriesTotal16 = tail.readUInt16LE(eocdOffset + 10);
  const centralSize32 = tail.readUInt32LE(eocdOffset + 12);
  const centralOffset32 = tail.readUInt32LE(eocdOffset + 16);

  if (diskNumber !== 0 || centralDisk !== 0) {
    throw new SingleFileZipError(
      'Multi-volume ZIP archives are not supported',
    );
  }

  const zip64 =
    entriesOnDisk16 === MAX_UINT16 ||
    entriesTotal16 === MAX_UINT16 ||
    centralSize32 === MAX_UINT32 ||
    centralOffset32 === MAX_UINT32;

  if (!zip64) {
    if (entriesOnDisk16 !== entriesTotal16) {
      throw new SingleFileZipError(
        'Multi-volume ZIP archives are not supported',
      );
    }
    return {
      entriesTotal: entriesTotal16,
      centralSize: centralSize32,
      centralOffset: centralOffset32,
      metadataStart: absoluteEocdOffset,
      zip64: false,
    };
  }

  const locatorOffset = absoluteEocdOffset - 20;
  if (locatorOffset < 0) {
    throw new SingleFileZipError(
      'ZIP64 end-of-central-directory locator is missing',
    );
  }
  const locator = await readExactly(handle, 20, locatorOffset);
  if (
    locator.readUInt32LE(0) !== ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR
  ) {
    throw new SingleFileZipError(
      'ZIP64 end-of-central-directory locator is missing',
    );
  }
  if (locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) !== 1) {
    throw new SingleFileZipError(
      'Multi-volume ZIP64 archives are not supported',
    );
  }

  const zip64EocdOffset = safeNumber(
    locator.readBigUInt64LE(8),
    'end-of-central-directory offset',
  );
  if (zip64EocdOffset + 56 > locatorOffset) {
    throw new SingleFileZipError(
      'ZIP64 end-of-central-directory record is invalid',
    );
  }
  const record = await readExactly(handle, 56, zip64EocdOffset);
  if (record.readUInt32LE(0) !== ZIP64_END_OF_CENTRAL_DIRECTORY) {
    throw new SingleFileZipError(
      'ZIP64 end-of-central-directory record is invalid',
    );
  }
  const recordSize = safeNumber(
    record.readBigUInt64LE(4),
    'end-of-central-directory record size',
  );
  if (recordSize < 44 || zip64EocdOffset + 12 + recordSize > locatorOffset) {
    throw new SingleFileZipError(
      'ZIP64 end-of-central-directory record has an invalid size',
    );
  }
  if (record.readUInt32LE(16) !== 0 || record.readUInt32LE(20) !== 0) {
    throw new SingleFileZipError(
      'Multi-volume ZIP64 archives are not supported',
    );
  }
  const entriesOnDisk = safeNumber(
    record.readBigUInt64LE(24),
    'entry count',
  );
  const entriesTotal = safeNumber(
    record.readBigUInt64LE(32),
    'entry count',
  );
  if (entriesOnDisk !== entriesTotal) {
    throw new SingleFileZipError(
      'Multi-volume ZIP64 archives are not supported',
    );
  }

  const centralSize = safeNumber(
    record.readBigUInt64LE(40),
    'central-directory size',
  );
  const centralOffset = safeNumber(
    record.readBigUInt64LE(48),
    'central-directory offset',
  );
  if (centralOffset + centralSize > zip64EocdOffset) {
    throw new SingleFileZipError('ZIP64 central directory is invalid');
  }
  if (absoluteEocdOffset + 22 > stat.size) {
    throw new SingleFileZipError('ZIP archive is truncated');
  }

  return {
    entriesTotal,
    centralSize,
    centralOffset,
    metadataStart: zip64EocdOffset,
    zip64: true,
  };
}

/**
 * Open the only ordinary entry in a single-volume ZIP archive. The archive
 * itself may have arrived through a pipe/chunked HTTP request and may use data
 * descriptors or ZIP64. Directory entries are ignored; exactly one non-
 * directory entry must remain. JSON is never materialized as a whole.
 *
 * The compressed archive is intentionally seekable here: the upload layer
 * spools only compressed/raw transport bytes, which lets us validate the
 * central directory before a database transaction consumes the decoded entry.
 *
 * @param {string} zipPath
 * @param {{
 *   maxUncompressedBytes: number,
 *   maxCompressionRatio?: number,
 *   maxEntries?: number,
 *   signal?: AbortSignal
 * }} options
 */
export async function openSingleFileZip(zipPath, options) {
  const stat = await fsp.stat(zipPath);
  if (!stat.isFile() || stat.size < 22) {
    throw new SingleFileZipError('ZIP archive is empty or truncated');
  }

  const maxEntries = options.maxEntries ?? 64;
  const maxCompressionRatio = options.maxCompressionRatio ?? 1000;
  const handle = await fsp.open(zipPath, 'r');
  let selectedEntry;

  try {
    const tailLength = Math.min(stat.size, MAX_EOCD_SEARCH);
    const tailOffset = stat.size - tailLength;
    const tail = await readExactly(handle, tailLength, tailOffset);
    let eocdOffset = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) !== END_OF_CENTRAL_DIRECTORY) continue;
      const commentLength = tail.readUInt16LE(index + 20);
      if (index + 22 + commentLength !== tail.length) continue;
      eocdOffset = index;
      break;
    }
    if (eocdOffset < 0) {
      throw new SingleFileZipError(
        'ZIP end-of-central-directory record was not found',
      );
    }

    const directory = await directoryInfo(
      handle,
      stat,
      tail,
      tailOffset,
      eocdOffset,
    );
    if (directory.entriesTotal < 1) {
      throw new SingleFileZipError(
        'ZIP archive must contain exactly one ordinary entry',
      );
    }
    if (directory.entriesTotal > maxEntries) {
      throw new SingleFileZipError(
        `ZIP archive contains more than the configured ${maxEntries} entries`,
      );
    }
    if (
      directory.centralSize < 46 ||
      directory.centralOffset + directory.centralSize >
        directory.metadataStart
    ) {
      throw new SingleFileZipError('ZIP central directory is invalid');
    }

    let cursor = directory.centralOffset;
    const centralEnd = directory.centralOffset + directory.centralSize;
    let parsedEntries = 0;
    let regularEntries = 0;

    while (cursor < centralEnd) {
      const fixed = await readExactly(handle, 46, cursor);
      if (fixed.readUInt32LE(0) !== CENTRAL_DIRECTORY_HEADER) {
        throw new SingleFileZipError(
          'ZIP central directory header is invalid',
        );
      }
      const flags = fixed.readUInt16LE(8);
      const method = fixed.readUInt16LE(10);
      const expectedCrc = fixed.readUInt32LE(16);
      const compressed32 = fixed.readUInt32LE(20);
      const uncompressed32 = fixed.readUInt32LE(24);
      const fileNameLength = fixed.readUInt16LE(28);
      const extraLength = fixed.readUInt16LE(30);
      const commentLength = fixed.readUInt16LE(32);
      const diskStart16 = fixed.readUInt16LE(34);
      const localOffset32 = fixed.readUInt32LE(42);
      const variableLength =
        fileNameLength + extraLength + commentLength;
      if (cursor + 46 + variableLength > centralEnd) {
        throw new SingleFileZipError(
          'ZIP central-directory entry is truncated',
        );
      }
      const variable = await readExactly(
        handle,
        variableLength,
        cursor + 46,
      );
      const nameBytes = variable.subarray(0, fileNameLength);
      const extra = variable.subarray(
        fileNameLength,
        fileNameLength + extraLength,
      );
      const fileName = decodeFileName(nameBytes, flags);
      const values = centralZip64Values({
        compressed32,
        uncompressed32,
        localOffset32,
        diskStart16,
        extra,
      });
      if (values.diskStart !== 0) {
        throw new SingleFileZipError(
          'Multi-volume ZIP archives are not supported',
        );
      }

      const directoryEntry =
        fileName.endsWith('/') || fileName.endsWith('\\');
      if (!directoryEntry) {
        regularEntries += 1;
        if (regularEntries > 1) {
          throw new SingleFileZipError(
            'ZIP archive must contain exactly one ordinary entry',
          );
        }
        if (
          (flags & ZIP_FLAG_ENCRYPTED) !== 0 ||
          (flags & ZIP_FLAG_STRONG_ENCRYPTION) !== 0
        ) {
          throw new SingleFileZipError(
            'Encrypted ZIP entries are not supported',
          );
        }
        if (method !== 0 && method !== 8) {
          throw new SingleFileZipError(
            `ZIP compression method ${method} is not supported`,
          );
        }
        if (values.uncompressedSize === 0) {
          throw new SingleFileZipError('ZIP JSON entry is empty');
        }
        if (values.uncompressedSize > options.maxUncompressedBytes) {
          throw new SingleFileZipError(
            `ZIP JSON entry exceeds the configured decoded limit of ${options.maxUncompressedBytes} bytes`,
          );
        }
        if (
          values.compressedSize === 0 ||
          values.uncompressedSize / values.compressedSize >
            maxCompressionRatio
        ) {
          throw new SingleFileZipError(
            `ZIP compression ratio exceeds the configured limit of ${maxCompressionRatio}:1`,
          );
        }
        if (
          method === 0 &&
          values.compressedSize !== values.uncompressedSize
        ) {
          throw new SingleFileZipError(
            'Stored ZIP entry has inconsistent compressed and decoded sizes',
          );
        }

        selectedEntry = {
          fileName,
          flags,
          method,
          expectedCrc,
          compressedSize: values.compressedSize,
          uncompressedSize: values.uncompressedSize,
          localOffset: values.localOffset,
        };
      }

      parsedEntries += 1;
      cursor += 46 + variableLength;
    }

    if (cursor !== centralEnd || parsedEntries !== directory.entriesTotal) {
      throw new SingleFileZipError(
        'ZIP central-directory entry count is inconsistent',
      );
    }
    if (!selectedEntry || regularEntries !== 1) {
      throw new SingleFileZipError(
        'ZIP archive must contain exactly one ordinary entry',
      );
    }

    const local = await readExactly(
      handle,
      30,
      selectedEntry.localOffset,
    );
    if (local.readUInt32LE(0) !== LOCAL_FILE_HEADER) {
      throw new SingleFileZipError('ZIP local file header is invalid');
    }
    const localFlags = local.readUInt16LE(6);
    const localMethod = local.readUInt16LE(8);
    const localNameLength = local.readUInt16LE(26);
    const localExtraLength = local.readUInt16LE(28);
    if (
      localMethod !== selectedEntry.method ||
      (localFlags & ZIP_SUPPORTED_FLAGS_MASK) !==
        (selectedEntry.flags & ZIP_SUPPORTED_FLAGS_MASK)
    ) {
      throw new SingleFileZipError(
        'ZIP local and central-directory metadata do not match',
      );
    }
    const localName = await readExactly(
      handle,
      localNameLength,
      selectedEntry.localOffset + 30,
    );
    if (decodeFileName(localName, localFlags) !== selectedEntry.fileName) {
      throw new SingleFileZipError(
        'ZIP local and central-directory filenames do not match',
      );
    }

    const dataOffset =
      selectedEntry.localOffset +
      30 +
      localNameLength +
      localExtraLength;
    if (
      dataOffset + selectedEntry.compressedSize >
      directory.centralOffset
    ) {
      throw new SingleFileZipError(
        'ZIP compressed payload overlaps archive metadata',
      );
    }
    selectedEntry.dataOffset = dataOffset;
  } finally {
    await handle.close();
  }

  const compressed = fs.createReadStream(zipPath, {
    start: selectedEntry.dataOffset,
    end:
      selectedEntry.dataOffset +
      selectedEntry.compressedSize -
      1,
  });
  if (options.signal) addAbortSignal(options.signal, compressed);

  const decoded = selectedEntry.method === 8
    ? compressed.pipe(createInflateRaw())
    : compressed;

  let crc = 0xffffffff;
  let bytes = 0;
  const verifier = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > options.maxUncompressedBytes) {
        callback(new SingleFileZipError(
          `ZIP JSON entry exceeds the configured decoded limit of ${options.maxUncompressedBytes} bytes`,
        ));
        return;
      }
      crc = updateCrc32(crc, buffer);
      callback(null, buffer);
    },
    flush(callback) {
      if (bytes !== selectedEntry.uncompressedSize) {
        callback(new SingleFileZipError(
          'ZIP JSON entry size does not match the central directory',
        ));
        return;
      }
      if (
        selectedEntry.compressedSize > 0 &&
        bytes / selectedEntry.compressedSize >
          maxCompressionRatio
      ) {
        callback(new SingleFileZipError(
          `ZIP compression ratio exceeds the configured limit of ${maxCompressionRatio}:1`,
        ));
        return;
      }
      if (finalCrc32(crc) !== selectedEntry.expectedCrc) {
        callback(new SingleFileZipError(
          'ZIP JSON entry CRC32 check failed',
        ));
        return;
      }
      callback();
    },
  });
  if (options.signal) addAbortSignal(options.signal, verifier);
  decoded.on('error', (error) => verifier.destroy(error));
  decoded.pipe(verifier);

  return {
    stream: verifier,
    fileName: selectedEntry.fileName,
    compressedSize: selectedEntry.compressedSize,
    uncompressedSize: selectedEntry.uncompressedSize,
  };
}

function zip64LocalHeader(nameLength) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_FILE_HEADER, 0);
  header.writeUInt16LE(45, 4);
  header.writeUInt16LE(ZIP_FLAGS_UTF8_DATA_DESCRIPTOR, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0x21, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(MAX_UINT32, 18);
  header.writeUInt32LE(MAX_UINT32, 22);
  header.writeUInt16LE(nameLength, 26);
  header.writeUInt16LE(20, 28);

  const extra = Buffer.alloc(20);
  extra.writeUInt16LE(ZIP64_EXTRA_FIELD, 0);
  extra.writeUInt16LE(16, 2);
  extra.writeBigUInt64LE(0n, 4);
  extra.writeBigUInt64LE(0n, 12);
  return Buffer.concat([header, extra]);
}

function zip64DataDescriptor(crc, compressedSize, uncompressedSize) {
  const descriptor = Buffer.alloc(24);
  descriptor.writeUInt32LE(DATA_DESCRIPTOR, 0);
  descriptor.writeUInt32LE(crc, 4);
  descriptor.writeBigUInt64LE(compressedSize, 8);
  descriptor.writeBigUInt64LE(uncompressedSize, 16);
  return descriptor;
}

function zip64CentralHeader(
  nameLength,
  crc,
  compressedSize,
  uncompressedSize,
  localOffset,
) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_DIRECTORY_HEADER, 0);
  header.writeUInt16LE(45, 4);
  header.writeUInt16LE(45, 6);
  header.writeUInt16LE(ZIP_FLAGS_UTF8_DATA_DESCRIPTOR, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0x21, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(MAX_UINT32, 20);
  header.writeUInt32LE(MAX_UINT32, 24);
  header.writeUInt16LE(nameLength, 28);
  header.writeUInt16LE(28, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(MAX_UINT32, 42);

  const extra = Buffer.alloc(28);
  extra.writeUInt16LE(ZIP64_EXTRA_FIELD, 0);
  extra.writeUInt16LE(24, 2);
  extra.writeBigUInt64LE(uncompressedSize, 4);
  extra.writeBigUInt64LE(compressedSize, 12);
  extra.writeBigUInt64LE(localOffset, 20);
  return Buffer.concat([header, extra]);
}

function zip64EndOfCentralDirectory(
  centralSize,
  centralOffset,
) {
  const record = Buffer.alloc(56);
  record.writeUInt32LE(ZIP64_END_OF_CENTRAL_DIRECTORY, 0);
  record.writeBigUInt64LE(44n, 4);
  record.writeUInt16LE(45, 12);
  record.writeUInt16LE(45, 14);
  record.writeUInt32LE(0, 16);
  record.writeUInt32LE(0, 20);
  record.writeBigUInt64LE(1n, 24);
  record.writeBigUInt64LE(1n, 32);
  record.writeBigUInt64LE(centralSize, 40);
  record.writeBigUInt64LE(centralOffset, 48);
  return record;
}

function zip64Locator(zip64EocdOffset) {
  const record = Buffer.alloc(20);
  record.writeUInt32LE(ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR, 0);
  record.writeUInt32LE(0, 4);
  record.writeBigUInt64LE(zip64EocdOffset, 8);
  record.writeUInt32LE(1, 16);
  return record;
}

function zip64LegacyEndOfCentralDirectory() {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(MAX_UINT16, 8);
  record.writeUInt16LE(MAX_UINT16, 10);
  record.writeUInt32LE(MAX_UINT32, 12);
  record.writeUInt32LE(MAX_UINT32, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

/**
 * Produce a single-entry DEFLATE ZIP64 as a stream without materializing
 * either JSON or the archive. The local header is ZIP64 from the start, so the
 * source may be stdin/another stream and neither compressed nor decoded size
 * has to be known before bytes are emitted.
 *
 * @param {string} fileName
 * @param {AsyncIterable<Buffer | Uint8Array | string>} source
 * @param {{ signal?: AbortSignal, level?: number }} [options]
 */
export function createSingleFileZipStream(fileName, source, options = {}) {
  validateExportEntryName(fileName);
  const name = Buffer.from(fileName, 'utf8');
  if (name.length === 0 || name.length > MAX_UINT16) {
    throw new SingleFileZipError('ZIP filename is too long');
  }

  async function* generate() {
    const local = zip64LocalHeader(name.length);
    yield local;
    yield name;

    let crc = 0xffffffff;
    let uncompressedSize = 0n;
    let compressedSize = 0n;
    const tap = new Transform({
      transform(chunk, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        uncompressedSize += BigInt(buffer.length);
        crc = updateCrc32(crc, buffer);
        callback(null, buffer);
      },
    });
    const input = Readable.from(source);
    const deflate = createDeflateRaw({ level: options.level ?? 6 });
    if (options.signal) {
      addAbortSignal(options.signal, input);
      addAbortSignal(options.signal, tap);
      addAbortSignal(options.signal, deflate);
    }
    input.on('error', (error) => tap.destroy(error));
    tap.on('error', (error) => deflate.destroy(error));
    input.pipe(tap).pipe(deflate);

    for await (const chunk of deflate) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      compressedSize += BigInt(buffer.length);
      yield buffer;
    }

    const checksum = finalCrc32(crc);
    const descriptor = zip64DataDescriptor(
      checksum,
      compressedSize,
      uncompressedSize,
    );
    yield descriptor;

    const localSize = BigInt(local.length + name.length);
    const centralOffset = localSize + compressedSize + BigInt(descriptor.length);
    const central = zip64CentralHeader(
      name.length,
      checksum,
      compressedSize,
      uncompressedSize,
      0n,
    );
    yield central;
    yield name;

    const centralSize = BigInt(central.length + name.length);
    const zip64EocdOffset = centralOffset + centralSize;
    yield zip64EndOfCentralDirectory(centralSize, centralOffset);
    yield zip64Locator(zip64EocdOffset);
    yield zip64LegacyEndOfCentralDirectory();
  }

  return Readable.from(generate());
}
