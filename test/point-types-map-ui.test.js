import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  fileURLToPath,
} from 'node:url';

const root =
  path.resolve(
    path.dirname(
      fileURLToPath(
        import.meta.url,
      ),
    ),
    '..',
  );

const read =
  (relativePath) =>
    fs.readFile(
      path.join(
        root,
        relativePath,
      ),
      'utf8',
    );

test('public map loads point types and renders only loaded versioned icons', async () => {
  const [
    controller,
    api,
    app,
    icons,
  ] =
    await Promise.all([
      read('public/js/map-controller.js'),
      read('public/js/api.js'),
      read('public/js/app.js'),
      read('public/js/point-type-map-icons.js'),
    ]);

  assert.match(
    api,
    /export async function loadPointTypes/u,
  );
  assert.match(
    api,
    /\/api\/point-types/u,
  );
  assert.match(
    app,
    /loadPointTypes/u,
  );
  assert.match(
    app,
    /setPointTypes/u,
  );

  assert.match(
    controller,
    /POINT_LAYER_ID = 'project-point-geometries'/u,
  );
  assert.match(
    controller,
    /POINT_FALLBACK_LAYER_ID/u,
  );
  assert.match(
    controller,
    /decoratePointFeatures/u,
  );
  assert.match(
    controller,
    /map\.hasImage\([\s\S]*imageId/u,
  );
  assert.match(
    controller,
    /pointTypeIconOffset/u,
  );
  assert.match(
    controller,
    /syncPointTypeImages/u,
  );
  assert.match(
    controller,
    /async setPointTypes/u,
  );

  assert.match(
    icons,
    /new Image\(\)/u,
  );
  assert.match(
    icons,
    /canvas\.getContext/u,
  );
  assert.match(
    icons,
    /map\.addImage/u,
  );
  assert.match(
    icons,
    /map\.removeImage/u,
  );
});
