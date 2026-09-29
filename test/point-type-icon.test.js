import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CITY_MARKER_ICON,
} from '../public/js/city-marker-icon.js';
import {
  POINT_TYPE_ICON_MAX_BYTES,
  PointTypeIconValidationError,
  pointTypeIconFileName,
  sanitizePointTypeIcon,
} from '../src/modules/points/type-icon.js';
import {
  createPointTypeIconFileStore,
} from '../src/modules/points/icon-file-store.js';

const bundledPng =
  Buffer.from(
    CITY_MARKER_ICON.split(
      ',',
    )[1],
    'base64',
  );

const onePixelGif =
  Buffer.from(
    'R0lGODdhAQABAIEAAAAAAAAAAAAAAAAAACwAAAAAAQABAAAIBAABBAQAOw==',
    'base64',
  );

test('point type icon sanitizer canonicalizes PNG GIF and safe styled SVG', () => {
  const png =
    sanitizePointTypeIcon(
      bundledPng,
      'image/png',
    );

  assert.equal(
    png.mime,
    'image/png',
  );
  assert.equal(
    png.width,
    32,
  );
  assert.equal(
    png.height,
    32,
  );
  assert.match(
    png.sha256,
    /^[0-9a-f]{64}$/u,
  );
  assert.equal(
    png.extension,
    'png',
  );

  const imageMarker =
    onePixelGif.indexOf(
      0x2c,
    );
  assert.ok(
    imageMarker > 0,
  );

  const gifWithComment =
    Buffer.concat([
      onePixelGif.subarray(
        0,
        imageMarker,
      ),
      Buffer.from([
        0x21,
        0xfe,
        0x07,
      ]),
      Buffer.from(
        'comment',
        'ascii',
      ),
      Buffer.from([0]),
      onePixelGif.subarray(
        imageMarker,
      ),
    ]);

  const gif =
    sanitizePointTypeIcon(
      gifWithComment,
      'image/gif',
    );

  assert.equal(
    gif.mime,
    'image/gif',
  );
  assert.equal(
    gif.width,
    1,
  );
  assert.equal(
    gif.height,
    1,
  );
  assert.equal(
    gif.data
      .includes(
        Buffer.from(
          'comment',
          'ascii',
        ),
      ),
    false,
  );

  const svgSource =
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24" viewBox="0 0 32 24">' +
      '<path style="fill:#123456;stroke:#000;stroke-width:1;opacity:.8" d="M0 0 L32 0 L16 24 Z"/>' +
      '</svg>',
      'utf8',
    );
  const svg =
    sanitizePointTypeIcon(
      svgSource,
      'image/svg+xml; charset=utf-8',
    );

  assert.equal(
    svg.mime,
    'image/svg+xml',
  );
  assert.equal(
    svg.width,
    32,
  );
  assert.equal(
    svg.height,
    24,
  );
  assert.match(
    svg.data.toString(
      'utf8',
    ),
    /style="fill:#123456;stroke:#000;stroke-width:1;opacity:.8"/u,
  );

  const styled =
    sanitizePointTypeIcon(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
        '<style type="text/css">.st0 { fill:#abcdef; stroke:#111; }</style>' +
        '<circle class="st0" cx="12" cy="12" r="10"/>' +
        '</svg>',
        'utf8',
      ),
      'image/svg+xml',
    );

  const styledText =
    styled.data.toString(
      'utf8',
    );

  assert.match(
    styledText,
    /<style type="text\/css">\.st0\{fill:#abcdef; stroke:#111;\}<\/style>/u,
  );
  assert.match(
    styledText,
    /class="st0"/u,
  );
});

test('point type icon sanitizer rejects active SVG mismatches and oversized input', () => {
  assert.throws(
    () =>
      sanitizePointTypeIcon(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">' +
          '<script>alert(1)</script></svg>',
          'utf8',
        ),
        'image/svg+xml',
      ),
    PointTypeIconValidationError,
  );

  assert.throws(
    () =>
      sanitizePointTypeIcon(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">' +
          '<path style="fill:url(https://evil.example/x.svg)" d="M0 0L1 1"/></svg>',
          'utf8',
        ),
        'image/svg+xml',
      ),
    /unsafe CSS/u,
  );

  assert.throws(
    () =>
      sanitizePointTypeIcon(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">' +
          '<style>.st0{@import url(https://evil.example/a.css);fill:red}</style>' +
          '<path class="st0" d="M0 0L1 1"/>' +
          '</svg>',
          'utf8',
        ),
        'image/svg+xml',
      ),
    /unsupported CSS syntax|unsafe CSS/u,
  );

  assert.throws(
    () =>
      sanitizePointTypeIcon(
        bundledPng,
        'image/gif',
      ),
    /does not match/u,
  );

  assert.throws(
    () =>
      sanitizePointTypeIcon(
        Buffer.alloc(
          POINT_TYPE_ICON_MAX_BYTES +
          1,
        ),
        'application/octet-stream',
      ),
    /exceeds/u,
  );
});

test('point type icon store accepts only server-derived immutable names', async () => {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'dtpstat-point-icon-',
      ),
    );

  try {
    const store =
      createPointTypeIconFileStore(
        directory,
      );
    const icon =
      sanitizePointTypeIcon(
        bundledPng,
        'image/png',
      );
    const fileName =
      pointTypeIconFileName(
        7,
        icon,
      );

    const saved =
      await store.save(
        fileName,
        icon.data,
      );

    assert.equal(
      saved.fileName,
      fileName,
    );
    assert.deepEqual(
      await store.read(
        fileName,
      ),
      icon.data,
    );

    await assert.rejects(
      store.save(
        '../escape.svg',
        Buffer.from(
          '<svg/>',
        ),
      ),
      /Unsafe point type icon file name/u,
    );

    const orphan =
      '8-' +
      'b'.repeat(64) +
      '.svg';
    const missing =
      '9-' +
      'c'.repeat(64) +
      '.png';

    await fs.writeFile(
      path.join(
        directory,
        orphan,
      ),
      '<svg/>',
    );
    await fs.writeFile(
      path.join(
        directory,
        '.point-type-icon-crash.tmp',
      ),
      'partial',
    );

    assert.deepEqual(
      await store.reconcile([
        fileName,
        missing,
      ]),
      {
        referenced: 2,
        removed: 1,
        removedTemporary: 1,
        missing: 1,
      },
    );

    assert.deepEqual(
      await store.read(
        fileName,
      ),
      icon.data,
    );

    await assert.rejects(
      fs.access(
        path.join(
          directory,
          orphan,
        ),
      ),
      (error) =>
        error?.code ===
        'ENOENT',
    );

    assert.equal(
      await store.remove(
        fileName,
      ),
      true,
    );
    assert.equal(
      await store.remove(
        fileName,
      ),
      false,
    );
  } finally {
    await fs.rm(
      directory,
      {
        recursive: true,
        force: true,
      },
    );
  }
});
