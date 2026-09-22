import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseStreamingJsonObject,
  StreamingJsonError,
} from '../src/data/streaming-json.js';

async function* chunked(buffer, sizes = [1, 2, 3, 5, 8]) {
  let offset = 0;
  let index = 0;
  while (offset < buffer.length) {
    const size = sizes[index % sizes.length];
    yield buffer.subarray(offset, Math.min(buffer.length, offset + size));
    offset += size;
    index += 1;
  }
}

test('streaming JSON parser preserves UTF-8 across chunk boundaries and metadata order', async () => {
  const document = {
    exportedAt: '2026-09-20T12:00:00.000Z',
    features: [
      { name: 'Москва', nested: { value: 'ёж' } },
      { name: 'Санкт-Петербург', values: [1, 2, 3] },
    ],
    type: 'FeatureCollection',
    schemaVersion: 3,
  };
  const buffer = Buffer.from(JSON.stringify(document));
  const items = [];
  const result = await parseStreamingJsonObject(chunked(buffer), {
    arrayKey: 'features',
    metadataKeys: new Set(['type', 'schemaVersion', 'exportedAt']),
    maxBytes: buffer.length,
    maxItemBytes: 1024,
    async onItem(item) {
      items.push(item);
    },
  });

  assert.deepEqual(items, document.features);
  assert.deepEqual(result.metadata, {
    exportedAt: document.exportedAt,
    type: document.type,
    schemaVersion: 3,
  });
  assert.equal(result.itemCount, 2);
  assert.equal(result.decodedBytes, buffer.length);
});

test('streaming JSON parser emits progress without retaining the whole array', async () => {
  const document = {
    type: 'FeatureCollection',
    features: Array.from({ length: 205 }, (_value, index) => ({
      id: index,
      text: `feature-${index}`,
    })),
  };
  const buffer = Buffer.from(JSON.stringify(document));
  let previous = -1;
  const progress = [];
  const result = await parseStreamingJsonObject(chunked(buffer, [17]), {
    arrayKey: 'features',
    metadataKeys: new Set(['type']),
    maxBytes: buffer.length + 1,
    maxItemBytes: 4096,
    onItem(item, index) {
      assert.equal(item.id, index);
      assert.equal(index, previous + 1);
      previous = index;
    },
    onProgress(value) {
      progress.push(value);
    },
  });

  assert.equal(result.itemCount, 205);
  assert.deepEqual(
    progress.filter((value) => value.phase === 'parse')
      .map((value) => value.items),
    [100, 200],
  );
  assert.equal(progress.at(-1).phase, 'parsed');
});

test('streaming JSON parser rejects duplicate keys missing arrays and trailing data', async () => {
  const cases = [
    ['{"features":[],"features":[]}', /Duplicate top-level JSON property/],
    ['{"type":"FeatureCollection"}', /must contain the features array/],
    ['{"features":[]} true', /trailing data/],
  ];

  for (const [text, pattern] of cases) {
    await assert.rejects(
      parseStreamingJsonObject(chunked(Buffer.from(text)), {
        arrayKey: 'features',
        maxBytes: 4096,
        maxItemBytes: 1024,
        onItem() {},
      }),
      pattern,
    );
  }
});

test('streaming JSON parser enforces decoded and per-item limits in UTF-8 bytes', async () => {
  const text = '{"features":[{"name":"ёж"}]}';
  const buffer = Buffer.from(text);

  await assert.rejects(
    parseStreamingJsonObject(chunked(buffer), {
      arrayKey: 'features',
      maxBytes: buffer.length - 1,
      maxItemBytes: 1024,
      onItem() {},
    }),
    (error) =>
      error instanceof StreamingJsonError &&
      /Decoded JSON exceeds/.test(error.message),
  );

  const itemText = JSON.stringify({ name: 'ёж' });
  const itemBytes = Buffer.byteLength(itemText);
  await assert.rejects(
    parseStreamingJsonObject(chunked(buffer), {
      arrayKey: 'features',
      maxBytes: buffer.length,
      maxItemBytes: itemBytes - 1,
      onItem() {},
    }),
    (error) =>
      error instanceof StreamingJsonError &&
      /item limit/.test(error.message) &&
      /bytes/.test(error.message),
  );
});

test('streaming JSON parser rejects malformed JSON after previously delivered items', async () => {
  const seen = [];
  await assert.rejects(
    parseStreamingJsonObject(
      chunked(Buffer.from('{"features":[{"id":1},{"id":2}],BROKEN')),
      {
        arrayKey: 'features',
        maxBytes: 4096,
        maxItemBytes: 1024,
        onItem(item) {
          seen.push(item.id);
        },
      },
    ),
    /Expected a JSON string|valid JSON/,
  );
  assert.deepEqual(seen, [1, 2]);
});


test('streaming JSON parser rejects excessive nesting depth', async () => {
  const text = '{"features":[{"a":{"b":{"c":1}}}]}';
  await assert.rejects(
    parseStreamingJsonObject(chunked(Buffer.from(text)), {
      arrayKey: 'features',
      maxBytes: 4096,
      maxItemBytes: 4096,
      maxDepth: 2,
      maxItems: 10,
      onItem() {},
    }),
    (error) =>
      error instanceof StreamingJsonError &&
      /nesting depth/.test(error.message),
  );
});

test('streaming JSON parser rejects excessive selected-array item count', async () => {
  const seen = [];
  const text = '{"populations":[{"id":1},{"id":2},{"id":3}]}';
  await assert.rejects(
    parseStreamingJsonObject(chunked(Buffer.from(text)), {
      arrayKey: 'populations',
      maxBytes: 4096,
      maxItemBytes: 4096,
      maxDepth: 16,
      maxItems: 2,
      onItem(item) {
        seen.push(item);
      },
    }),
    (error) =>
      error instanceof StreamingJsonError &&
      /more than the configured 2 items/.test(error.message),
  );
  assert.deepEqual(seen, [{ id: 1 }, { id: 2 }]);
});


test('streaming JSON parser reports byte progress while one large item is still being read', async () => {
  const largeText = 'x'.repeat(5 * 1024 * 1024);
  const document = {
    type: 'FeatureCollection',
    features: [{ id: 1, text: largeText }],
  };
  const buffer = Buffer.from(JSON.stringify(document));
  const progress = [];

  const result = await parseStreamingJsonObject(
    chunked(buffer, [256 * 1024]),
    {
      arrayKey: 'features',
      metadataKeys: new Set(['type']),
      maxBytes: buffer.length + 1,
      maxItemBytes: buffer.length,
      maxDepth: 16,
      maxItems: 10,
      onItem() {},
      onProgress(value) {
        progress.push(value);
      },
    },
  );

  assert.equal(result.itemCount, 1);
  const reading = progress.filter((value) =>
    value.phase === 'parse' && value.activity === 'read');
  assert.ok(reading.length >= 1);
  assert.ok(reading.some((value) => value.items === 0));
  assert.ok(reading.some((value) => value.decodedBytes >= 4 * 1024 * 1024));
  assert.equal(progress.at(-1).phase, 'parsed');
});
