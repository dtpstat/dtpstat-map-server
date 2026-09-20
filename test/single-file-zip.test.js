import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import test from 'node:test';
import {
  createSingleFileZipStream,
  openSingleFileZip,
  SingleFileZipError,
} from '../src/data/single-file-zip.js';

async function collect(source) {
  const chunks = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function zip64DirectoryInfo(buffer) {
  const eocd = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(eocd), 0x06054b50);
  const locator = eocd - 20;
  assert.equal(buffer.readUInt32LE(locator), 0x07064b50);
  const zip64Eocd = Number(buffer.readBigUInt64LE(locator + 8));
  assert.equal(buffer.readUInt32LE(zip64Eocd), 0x06064b50);
  return {
    eocd,
    locator,
    zip64Eocd,
    centralOffset: Number(buffer.readBigUInt64LE(zip64Eocd + 48)),
  };
}

async function withTempZip(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dtpstat-zip-'));
  const file = path.join(directory, 'transfer.zip');
  try {
    await callback(file);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('single-file ZIP writer and reader round-trip streamed UTF-8 JSON', async () => {
  await withTempZip(async (file) => {
    const json = Buffer.from(JSON.stringify({
      type: 'FeatureCollection',
      features: [{ name: 'Москва' }, { name: 'Казань' }],
    }));
    async function* source() {
      for (let offset = 0; offset < json.length; offset += 7) {
        yield json.subarray(offset, offset + 7);
      }
    }

    await pipeline(
      createSingleFileZipStream('cities.geojson', source()),
      createWriteStream(file),
    );

    const entry = await openSingleFileZip(file, {
      maxUncompressedBytes: json.length,
    });
    assert.equal(entry.fileName, 'cities.geojson');
    assert.equal(entry.uncompressedSize, json.length);
    assert.deepEqual(await collect(entry.stream), json);
  });
});

test('single-file ZIP reader rejects archives that claim multiple entries', async () => {
  await withTempZip(async (file) => {
    await pipeline(
      createSingleFileZipStream(
        'data.json',
        [Buffer.from('{"value":1}')],
      ),
      createWriteStream(file),
    );
    const buffer = await fs.readFile(file);
    const { zip64Eocd } = zip64DirectoryInfo(buffer);
    buffer.writeBigUInt64LE(2n, zip64Eocd + 24);
    buffer.writeBigUInt64LE(2n, zip64Eocd + 32);
    await fs.writeFile(file, buffer);

    await assert.rejects(
      openSingleFileZip(file, { maxUncompressedBytes: 1024 }),
      (error) =>
        error instanceof SingleFileZipError &&
        /entry count|exactly one ordinary entry/.test(error.message),
    );
  });
});

test('single-file ZIP reader verifies CRC and decoded size limits', async () => {
  await withTempZip(async (file) => {
    const json = Buffer.from('{"value":"test"}');
    await pipeline(
      createSingleFileZipStream('data.json', [json]),
      createWriteStream(file),
    );

    await assert.rejects(
      openSingleFileZip(file, {
        maxUncompressedBytes: json.length - 1,
      }),
      /decoded limit/,
    );

    const buffer = await fs.readFile(file);
    const { centralOffset } = zip64DirectoryInfo(buffer);
    const originalCrc = buffer.readUInt32LE(centralOffset + 16);
    buffer.writeUInt32LE((originalCrc + 1) >>> 0, centralOffset + 16);
    await fs.writeFile(file, buffer);

    const entry = await openSingleFileZip(file, {
      maxUncompressedBytes: 1024,
    });
    await assert.rejects(
      collect(entry.stream),
      /CRC32 check failed/,
    );
  });
});

test('ZIP writer refuses directory paths as the only JSON entry', () => {
  assert.throws(
    () => createSingleFileZipStream(
      'directory/data.json',
      [Buffer.from('{}')],
    ),
    (error) =>
      error instanceof SingleFileZipError &&
      /ordinary file/.test(error.message),
  );
});


test('ZIP64 writer uses a data descriptor so source size can remain unknown', async () => {
  const json = Buffer.from('{"stream":true}');
  const archive = await collect(createSingleFileZipStream(
    'stdin',
    (async function* () {
      yield json.subarray(0, 4);
      yield json.subarray(4);
    })(),
  ));

  const { zip64Eocd, centralOffset } = zip64DirectoryInfo(archive);
  assert.ok(zip64Eocd > centralOffset);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.readUInt16LE(6) & 0x0008, 0x0008);
  assert.equal(archive.readUInt32LE(18), 0xffffffff);
  assert.equal(archive.readUInt32LE(22), 0xffffffff);
  assert.equal(archive.readUInt32LE(centralOffset), 0x02014b50);
  assert.equal(archive.readUInt32LE(centralOffset + 20), 0xffffffff);
  assert.equal(archive.readUInt32LE(centralOffset + 24), 0xffffffff);
});

test('single-file ZIP reader enforces compression-ratio limit', async () => {
  await withTempZip(async (file) => {
    const json = Buffer.from(JSON.stringify({
      value: 'x'.repeat(128 * 1024),
    }));
    await pipeline(
      createSingleFileZipStream('stdin', [json]),
      createWriteStream(file),
    );

    await assert.rejects(
      openSingleFileZip(file, {
        maxUncompressedBytes: json.length,
        maxCompressionRatio: 2,
      }),
      /compression ratio/,
    );
  });
});
