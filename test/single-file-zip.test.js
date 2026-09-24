import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import test from 'node:test';
import {
  createSingleFileZipStream,
  openSingleFileZip,
  SingleFileZipError,
} from '../src/shared/streaming/single-file-zip.js';

async function collect(source) {
  const chunks = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries) {
  const locals = [];
  const centrals = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data ?? '');
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localRecord = Buffer.concat([local, name, data]);
    locals.push(localRecord);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centrals.push(Buffer.concat([central, name]));
    localOffset += localRecord.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, centralDirectory, eocd]);
}

function classicDescriptorZip(nameValue, dataValue) {
  const name = Buffer.from(nameValue, 'utf8');
  const data = Buffer.from(dataValue);
  const compressed = deflateRawSync(data);
  const checksum = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0808, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(name.length, 26);

  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(checksum, 4);
  descriptor.writeUInt32LE(compressed.length, 8);
  descriptor.writeUInt32LE(data.length, 12);

  const centralOffset =
    local.length + name.length + compressed.length + descriptor.length;
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0808, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const centralRecord = Buffer.concat([central, name]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralRecord.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);

  return Buffer.concat([
    local,
    name,
    compressed,
    descriptor,
    centralRecord,
    eocd,
  ]);
}

function directoryInfo(buffer) {
  const eocd = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(eocd), 0x06054b50);
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const zip64 =
    entries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff;

  if (!zip64) {
    return {
      eocd,
      zip64: false,
      zip64Eocd: null,
      centralOffset,
    };
  }

  const locator = eocd - 20;
  assert.equal(buffer.readUInt32LE(locator), 0x07064b50);
  const zip64Eocd = Number(buffer.readBigUInt64LE(locator + 8));
  assert.equal(buffer.readUInt32LE(zip64Eocd), 0x06064b50);
  return {
    eocd,
    locator,
    zip64: true,
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

function sevenZipAvailable() {
  const result = spawnSync('7z', ['i'], {
    stdio: 'ignore',
  });
  return result.status === 0;
}

async function sevenZipFromStdin(file, payload) {
  const child = spawn(
    '7z',
    ['a', '-tzip', '-mx=6', file, '-si'],
    {
      stdio: ['pipe', 'ignore', 'pipe'],
    },
  );
  const errors = [];
  child.stderr.on('data', (chunk) => errors.push(Buffer.from(chunk)));
  child.stdin.end(payload);
  const [code] = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (...args) => resolve(args));
  });
  if (code !== 0) {
    const message = Buffer.concat(errors).toString('utf8');
    if (/E_NOTIMPL|not implemented/i.test(message)) return false;
    throw new Error(
      `7z failed with exit code ${code}: ` + message,
    );
  }
  return true;
}

async function sevenZipExtractStdout(file) {
  const child = spawn(
    '7z',
    ['x', '-so', file],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const output = [];
  const errors = [];
  child.stdout.on('data', (chunk) => output.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => errors.push(Buffer.from(chunk)));
  const [code] = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (...args) => resolve(args));
  });
  if (code !== 0) {
    throw new Error(
      `7z extraction failed with exit code ${code}: ` +
      Buffer.concat(errors).toString('utf8'),
    );
  }
  return Buffer.concat(output);
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
    const directory = directoryInfo(buffer);
    if (directory.zip64) {
      buffer.writeBigUInt64LE(2n, directory.zip64Eocd + 24);
      buffer.writeBigUInt64LE(2n, directory.zip64Eocd + 32);
    } else {
      buffer.writeUInt16LE(2, directory.eocd + 8);
      buffer.writeUInt16LE(2, directory.eocd + 10);
    }
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
    const { centralOffset } = directoryInfo(buffer);
    const originalCrc = buffer.readUInt32LE(centralOffset + 16);
    const wrongCrc = (originalCrc + 1) >>> 0;
    buffer.writeUInt32LE(wrongCrc, centralOffset + 16);
    const descriptorOffset = centralOffset - 24;
    assert.equal(buffer.readUInt32LE(descriptorOffset), 0x08074b50);
    buffer.writeUInt32LE(wrongCrc, descriptorOffset + 4);
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


test('streaming writer keeps ZIP64 local metadata but uses a classic directory for small output', async () => {
  const json = Buffer.from('{"stream":true}');
  const archive = await collect(createSingleFileZipStream(
    'stdin',
    (async function* () {
      yield json.subarray(0, 4);
      yield json.subarray(4);
    })(),
  ));

  const directory = directoryInfo(archive);
  assert.equal(directory.zip64, false);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.readUInt16LE(4), 45);
  assert.equal(archive.readUInt16LE(6) & 0x0008, 0x0008);
  assert.equal(archive.readUInt32LE(18), 0xffffffff);
  assert.equal(archive.readUInt32LE(22), 0xffffffff);
  assert.equal(archive.readUInt32LE(directory.centralOffset), 0x02014b50);
  assert.notEqual(
    archive.readUInt32LE(directory.centralOffset + 20),
    0xffffffff,
  );
  assert.notEqual(
    archive.readUInt32LE(directory.centralOffset + 24),
    0xffffffff,
  );
  assert.equal(
    archive.readUInt32LE(directory.centralOffset - 24),
    0x08074b50,
  );
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


test('ZIP reader ignores directory entries and accepts one extensionless data entry', async () => {
  await withTempZip(async (file) => {
    const json = Buffer.from('{"from":"stdin"}');
    await fs.writeFile(file, storedZip([
      { name: 'payload/' },
      { name: 'payload/stdin', data: json },
    ]));

    const entry = await openSingleFileZip(file, {
      maxUncompressedBytes: 1024,
    });
    assert.equal(entry.fileName, 'payload/stdin');
    assert.deepEqual(await collect(entry.stream), json);
  });
});

test('ZIP reader rejects two actual ordinary entries even when directories are present', async () => {
  await withTempZip(async (file) => {
    await fs.writeFile(file, storedZip([
      { name: 'payload/' },
      { name: 'payload/one', data: '{}' },
      { name: 'payload/two', data: '{}' },
    ]));

    await assert.rejects(
      openSingleFileZip(file, { maxUncompressedBytes: 1024 }),
      /exactly one ordinary entry/,
    );
  });
});


test('ZIP reader accepts classic streamed data-descriptor archive with extensionless entry', async () => {
  await withTempZip(async (file) => {
    const json = Buffer.from('{"producer":"stdin"}');
    await fs.writeFile(file, classicDescriptorZip('stdin', json));

    const entry = await openSingleFileZip(file, {
      maxUncompressedBytes: 1024,
    });
    assert.equal(entry.fileName, 'stdin');
    assert.deepEqual(await collect(entry.stream), json);
  });
});

test('ZIP reader rejects a data descriptor that disagrees with central metadata', async () => {
  await withTempZip(async (file) => {
    const json = Buffer.from('{"value":1}');
    const archive = await collect(
      createSingleFileZipStream('stdin', [json]),
    );
    const { centralOffset } = directoryInfo(archive);
    const descriptorOffset = centralOffset - 24;
    assert.equal(archive.readUInt32LE(descriptorOffset), 0x08074b50);
    const crc = archive.readUInt32LE(descriptorOffset + 4);
    archive.writeUInt32LE((crc + 1) >>> 0, descriptorOffset + 4);
    await fs.writeFile(file, archive);

    await assert.rejects(
      openSingleFileZip(file, { maxUncompressedBytes: 1024 }),
      /data descriptor does not match/,
    );
  });
});


test(
  'ZIP reader accepts an archive whose only entry was created by 7-Zip from stdin',
  { skip: !sevenZipAvailable() },
  async (context) => {
    await withTempZip(async (file) => {
      const json = Buffer.from(JSON.stringify({
        producer: '7z-stdin',
        values: Array.from({ length: 200 }, (_value, index) => index),
      }));

      if (!await sevenZipFromStdin(file, json)) {
        context.skip('installed 7-Zip does not support creating ZIP from stdin');
        return;
      }

      const entry = await openSingleFileZip(file, {
        maxUncompressedBytes: 1024 * 1024,
      });
      assert.ok(
        entry.fileName === null ||
        entry.fileName === 'stdin' ||
        entry.fileName === '[Content]' ||
        entry.fileName.length > 0,
      );
      assert.deepEqual(await collect(entry.stream), json);
    });
  },
);

test(
  'streaming ZIP writer produces archives readable by 7-Zip',
  { skip: !sevenZipAvailable() },
  async () => {
    await withTempZip(async (file) => {
      const json = Buffer.from(JSON.stringify({
        producer: 'dtpstat-stream',
        message: 'проверка ZIP64/data descriptor',
      }));
      async function* source() {
        for (let offset = 0; offset < json.length; offset += 5) {
          yield json.subarray(offset, offset + 5);
        }
      }

      await pipeline(
        createSingleFileZipStream('stdin', source()),
        createWriteStream(file),
      );

      const testResult = spawnSync(
        '7z',
        ['t', file],
        { encoding: 'utf8' },
      );
      assert.equal(
        testResult.status,
        0,
        testResult.stderr || testResult.stdout,
      );
      assert.deepEqual(await sevenZipExtractStdout(file), json);
    });
  },
);
