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
    controller,
    /export function pointFeatureHint/u,
  );
  assert.match(
    controller,
    /feature\.properties[\s\S]*\.tooltip/u,
  );
  assert.match(
    controller,
    /POINT_LAYER_ID,[\s\S]*POINT_FALLBACK_LAYER_ID/u,
  );
  assert.match(
    controller,
    /setDOMContent\([\s\S]*pointContent/u,
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


test('public map exposes independent POI type toggles and polygon layers', async () => {
  const [
    app,
    controller,
    styles,
  ] =
    await Promise.all([
      read('public/js/app.js'),
      read('public/js/map-controller.js'),
      read('public/css/line-types.css'),
    ]);

  assert.match(
    app,
    /function renderPointLegend/u,
  );
  assert.match(
    app,
    /point-legend-item/u,
  );
  assert.match(
    app,
    /setPointTypeVisibility/u,
  );
  assert.match(
    controller,
    /setPointTypeVisibility/u,
  );
  assert.match(
    controller,
    /project-polygon-geometries-fill/u,
  );
  assert.match(
    controller,
    /project-polygon-geometries-line/u,
  );
  assert.match(
    styles,
    /\.point-legend/u,
  );
});


test('public map timeline is setting-controlled and exposes horizontal playback controls', async () => {
  const [
    html,
    app,
    api,
    styles,
    legendStyles,
  ] =
    await Promise.all([
      read('index.html'),
      read('public/js/app.js'),
      read('public/js/api.js'),
      read('public/css/app.css'),
      read('public/css/line-types.css'),
    ]);

  assert.match(
    html,
    /id="geometry-timeline"[\s\S]*id="geometry-timeline-play"[\s\S]*id="geometry-timeline-range"/u,
  );
  assert.match(
    api,
    /export function loadGeometryTimeline/u,
  );
  assert.match(
    app,
    /showGeometryTimeline/u,
  );
  assert.match(
    app,
    /function configureGeometryTimeline/u,
  );
  assert.match(
    app,
    /setTimelineDate/u,
  );
  assert.match(
    app,
    /setInterval\([\s\S]*120/u,
  );
  assert.match(
    app,
    /span[\s\S]*240/u,
  );
  assert.match(
    styles,
    /\.geometry-timeline \{[\s\S]*position: absolute[\s\S]*input\[type="range"\]/u,
  );
  assert.match(
    legendStyles,
    /has-geometry-timeline[\s\S]*\.line-legend[\s\S]*\.point-legend/u,
  );
});
