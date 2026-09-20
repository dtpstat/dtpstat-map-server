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
    const eocd = buffer.length - 22;
    assert.equal(buffer.readUInt32LE(eocd), 0x06054b50);
    buffer.writeUInt16LE(2, eocd + 8);
    buffer.writeUInt16LE(2, eocd + 10);
    await fs.writeFile(file, buffer);

    await assert.rejects(
      openSingleFileZip(file, { maxUncompressedBytes: 1024 }),
      (error) =>
        error instanceof SingleFileZipError &&
        /exactly one file entry/.test(error.message),
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
    const eocd = buffer.length - 22;
    const centralOffset = buffer.readUInt32LE(eocd + 16);
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
      /without directories/.test(error.message),
  );
});
