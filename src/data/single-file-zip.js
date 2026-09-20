import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable, Transform, addAbortSignal } from 'node:stream';
import { createDeflateRaw, createInflateRaw } from 'node:zlib';

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const DATA_DESCRIPTOR = 0x08074b50;
const MAX_EOCD_SEARCH = 22 + 0xffff;
const MAX_UINT32 = 0xffffffff;
const ZIP_FLAGS_UTF8_DATA_DESCRIPTOR = 0x0808;

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

function decodeFileName(buffer, flags) {
  if ((flags & 0x0800) === 0) {
    // Portable exports created by this application are UTF-8. For external
    // archives without the UTF-8 flag, Node has no built-in CP437 decoder, so
    // accept ASCII only rather than silently mis-decoding a filename.
    if (buffer.some((byte) => byte > 0x7f)) {
      throw new SingleFileZipError(
        'ZIP entry filename must be UTF-8 or ASCII',
      );
    }
  }
  const name = buffer.toString('utf8');
  if (
    !name ||
    name.includes('\0') ||
    name.endsWith('/') ||
    name.endsWith('\\')
  ) {
    throw new SingleFileZipError(
      'ZIP archive must contain exactly one ordinary file',
    );
  }
  return name;
}

function validateEntryName(name) {
  if (
    name.includes('/') ||
    name.includes('\\') ||
    name === '.' ||
    name === '..'
  ) {
    throw new SingleFileZipError(
      'ZIP JSON entry must be a single file without directories',
    );
  }
}

/**
 * Open the only ordinary file in a conventional single-volume ZIP archive.
 * ZIP64 is rejected explicitly; decoded size is bounded both by directory
 * metadata and by the verifying output stream.
 *
 * @param {string} zipPath
 * @param {{ maxUncompressedBytes: number, signal?: AbortSignal }} options
 */
export async function openSingleFileZip(zipPath, options) {
  const stat = await fsp.stat(zipPath);
  if (!stat.isFile() || stat.size < 22) {
    throw new SingleFileZipError('ZIP archive is empty or truncated');
  }

  const handle = await fsp.open(zipPath, 'r');
  let entry;
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

    const diskNumber = tail.readUInt16LE(eocdOffset + 4);
    const centralDisk = tail.readUInt16LE(eocdOffset + 6);
    const entriesOnDisk = tail.readUInt16LE(eocdOffset + 8);
    const entriesTotal = tail.readUInt16LE(eocdOffset + 10);
    const centralSize = tail.readUInt32LE(eocdOffset + 12);
    const centralOffset = tail.readUInt32LE(eocdOffset + 16);
    if (diskNumber !== 0 || centralDisk !== 0) {
      throw new SingleFileZipError('Multi-volume ZIP archives are not supported');
    }
    if (entriesOnDisk !== 1 || entriesTotal !== 1) {
      throw new SingleFileZipError(
        'ZIP archive must contain exactly one file entry',
      );
    }
    if (
      entriesTotal === 0xffff ||
      centralSize === MAX_UINT32 ||
      centralOffset === MAX_UINT32
    ) {
      throw new SingleFileZipError(
        'ZIP64 archives are not supported by this transfer endpoint',
      );
    }
    const absoluteEocdOffset = tailOffset + eocdOffset;
    if (
      centralSize < 46 ||
      centralOffset + centralSize > absoluteEocdOffset
    ) {
      throw new SingleFileZipError('ZIP central directory is invalid');
    }

    const fixedCentral = await readExactly(handle, 46, centralOffset);
    if (fixedCentral.readUInt32LE(0) !== CENTRAL_DIRECTORY_HEADER) {
      throw new SingleFileZipError('ZIP central directory header is invalid');
    }
    const flags = fixedCentral.readUInt16LE(8);
    const method = fixedCentral.readUInt16LE(10);
    const expectedCrc = fixedCentral.readUInt32LE(16);
    const compressedSize = fixedCentral.readUInt32LE(20);
    const uncompressedSize = fixedCentral.readUInt32LE(24);
    const fileNameLength = fixedCentral.readUInt16LE(28);
    const extraLength = fixedCentral.readUInt16LE(30);
    const commentLength = fixedCentral.readUInt16LE(32);
    const localOffset = fixedCentral.readUInt32LE(42);
    if (
      compressedSize === MAX_UINT32 ||
      uncompressedSize === MAX_UINT32 ||
      localOffset === MAX_UINT32
    ) {
      throw new SingleFileZipError(
        'ZIP64 file entries are not supported by this transfer endpoint',
      );
    }
    if ((flags & 0x0001) !== 0) {
      throw new SingleFileZipError('Encrypted ZIP entries are not supported');
    }
    if (method !== 0 && method !== 8) {
      throw new SingleFileZipError(
        `ZIP compression method ${method} is not supported`,
      );
    }
    if (uncompressedSize === 0) {
      throw new SingleFileZipError('ZIP JSON entry is empty');
    }
    if (uncompressedSize > options.maxUncompressedBytes) {
      throw new SingleFileZipError(
        `ZIP JSON entry exceeds the configured decoded limit of ${options.maxUncompressedBytes} bytes`,
      );
    }
    if (
      46 + fileNameLength + extraLength + commentLength !== centralSize
    ) {
      throw new SingleFileZipError(
        'ZIP archive must contain one ordinary central-directory entry only',
      );
    }

    const centralName = await readExactly(
      handle,
      fileNameLength,
      centralOffset + 46,
    );
    const fileName = decodeFileName(centralName, flags);
    validateEntryName(fileName);

    const local = await readExactly(handle, 30, localOffset);
    if (local.readUInt32LE(0) !== LOCAL_FILE_HEADER) {
      throw new SingleFileZipError('ZIP local file header is invalid');
    }
    const localFlags = local.readUInt16LE(6);
    const localMethod = local.readUInt16LE(8);
    const localNameLength = local.readUInt16LE(26);
    const localExtraLength = local.readUInt16LE(28);
    if (localMethod !== method || localFlags !== flags) {
      throw new SingleFileZipError(
        'ZIP local and central directory metadata do not match',
      );
    }
    const localName = await readExactly(
      handle,
      localNameLength,
      localOffset + 30,
    );
    if (decodeFileName(localName, localFlags) !== fileName) {
      throw new SingleFileZipError(
        'ZIP local and central directory filenames do not match',
      );
    }

    const dataOffset =
      localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > centralOffset) {
      throw new SingleFileZipError('ZIP compressed payload overlaps metadata');
    }

    entry = {
      fileName,
      flags,
      method,
      expectedCrc,
      compressedSize,
      uncompressedSize,
      dataOffset,
    };
  } finally {
    await handle.close();
  }

  const compressed = fs.createReadStream(zipPath, {
    start: entry.dataOffset,
    end: entry.dataOffset + entry.compressedSize - 1,
  });
  if (options.signal) addAbortSignal(options.signal, compressed);

  const decoded = entry.method === 8
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
      if (bytes !== entry.uncompressedSize) {
        callback(new SingleFileZipError(
          'ZIP JSON entry size does not match the central directory',
        ));
        return;
      }
      if (finalCrc32(crc) !== entry.expectedCrc) {
        callback(new SingleFileZipError('ZIP JSON entry CRC32 check failed'));
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
    fileName: entry.fileName,
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
  };
}

function zipLocalHeader(nameLength) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_FILE_HEADER, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(ZIP_FLAGS_UTF8_DATA_DESCRIPTOR, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0x21, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(0, 18);
  header.writeUInt32LE(0, 22);
  header.writeUInt16LE(nameLength, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function zipDataDescriptor(crc, compressedSize, uncompressedSize) {
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(DATA_DESCRIPTOR, 0);
  descriptor.writeUInt32LE(crc, 4);
  descriptor.writeUInt32LE(compressedSize, 8);
  descriptor.writeUInt32LE(uncompressedSize, 12);
  return descriptor;
}

function zipCentralHeader(nameLength, crc, compressedSize, uncompressedSize) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_DIRECTORY_HEADER, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(ZIP_FLAGS_UTF8_DATA_DESCRIPTOR, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0x21, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(compressedSize, 20);
  header.writeUInt32LE(uncompressedSize, 24);
  header.writeUInt16LE(nameLength, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(0, 42);
  return header;
}

function zipEndOfCentralDirectory(centralSize, centralOffset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(1, 8);
  record.writeUInt16LE(1, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

/**
 * Produce a conventional single-entry DEFLATE ZIP as a stream without
 * materializing either JSON or the archive. Standard ZIP32 is deliberately
 * bounded to <4 GiB for both compressed and decoded data.
 *
 * @param {string} fileName
 * @param {AsyncIterable<Buffer | Uint8Array | string>} source
 * @param {{ signal?: AbortSignal, level?: number }} [options]
 */
export function createSingleFileZipStream(fileName, source, options = {}) {
  validateEntryName(fileName);
  const name = Buffer.from(fileName, 'utf8');
  if (name.length === 0 || name.length > 0xffff) {
    throw new SingleFileZipError('ZIP filename is too long');
  }

  async function* generate() {
    const local = zipLocalHeader(name.length);
    yield local;
    yield name;

    let crc = 0xffffffff;
    let uncompressedSize = 0;
    let compressedSize = 0;
    const tap = new Transform({
      transform(chunk, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        uncompressedSize += buffer.length;
        if (uncompressedSize > MAX_UINT32) {
          callback(new SingleFileZipError(
            'ZIP export exceeds the 4 GiB ZIP32 decoded-size limit',
          ));
          return;
        }
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
      compressedSize += buffer.length;
      if (compressedSize > MAX_UINT32) {
        throw new SingleFileZipError(
          'ZIP export exceeds the 4 GiB ZIP32 compressed-size limit',
        );
      }
      yield buffer;
    }

    const checksum = finalCrc32(crc);
    yield zipDataDescriptor(checksum, compressedSize, uncompressedSize);

    const centralOffset =
      local.length + name.length + compressedSize + 16;
    const central = zipCentralHeader(
      name.length,
      checksum,
      compressedSize,
      uncompressedSize,
    );
    yield central;
    yield name;
    const centralSize = central.length + name.length;
    yield zipEndOfCentralDirectory(centralSize, centralOffset);
  }

  return Readable.from(generate());
}
