import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GeometryEditorValidationError,
  geometryFamily,
  normalizeGeometryEditorPayload,
  normalizeGeometryIdList,
  normalizeGeometryTags,
  validateEditorGeometry,
} from '../src/data/geometry-editor.js';

test('geometry editor accepts all supported geometry families', () => {
  const cases = [
    [{ type: 'Point', coordinates: [30, 60] }, 'point'],
    [{ type: 'LineString', coordinates: [[30, 60], [31, 61]] }, 'line'],
    [{ type: 'MultiLineString', coordinates: [[[30, 60], [31, 61]]] }, 'line'],
    [{ type: 'Polygon', coordinates: [[[30, 60], [31, 60], [31, 61], [30, 60]]] }, 'polygon'],
    [{ type: 'MultiPolygon', coordinates: [[[[30, 60], [31, 60], [31, 61], [30, 60]]]] }, 'polygon'],
  ];
  for (const [geometry, family] of cases) {
    assert.equal(geometryFamily(validateEditorGeometry(geometry)), family);
  }
});

test('line editor payload requires line type and lanes while polygons reject them', () => {
  const line = normalizeGeometryEditorPayload({
    cityId: 4,
    geometry: { type: 'LineString', coordinates: [[30, 60], [31, 61]] },
    lineTypeId: 7,
    lanes: 2,
    tags: [' Центр ', 'центр', 'Обособленная'],
    isVisible: false,
  }, { creating: true });
  assert.equal(line.family, 'line');
  assert.equal(line.lineTypeId, 7);
  assert.equal(line.lanes, 2);
  assert.deepEqual(line.tags, ['Центр', 'Обособленная']);
  assert.equal(line.isVisible, false);

  assert.throws(
    () => normalizeGeometryEditorPayload({
      geometry: { type: 'Polygon', coordinates: [[[30, 60], [31, 60], [31, 61], [30, 60]]] },
      lineTypeId: 7,
      lanes: 1,
    }),
    GeometryEditorValidationError,
  );
});

test('polygon rings must be closed and WGS84 coordinates stay in range', () => {
  assert.throws(
    () => validateEditorGeometry({
      type: 'Polygon',
      coordinates: [[[30, 60], [31, 60], [31, 61], [30, 61]]],
    }),
    /closed/,
  );
  assert.throws(
    () => validateEditorGeometry({
      type: 'Point',
      coordinates: [200, 60],
    }),
    /outside WGS84/,
  );
});

test('geometry tags are case-insensitively unique but preserve display spelling', () => {
  assert.deepEqual(
    normalizeGeometryTags(['Трамвай', ' трамвай ', 'Центр']),
    ['Трамвай', 'Центр'],
  );
});

test('merge id normalization rejects duplicates-only selections', () => {
  assert.deepEqual(normalizeGeometryIdList([3, 4, 3]), [3, 4]);
  assert.throws(() => normalizeGeometryIdList([3, 3]), /at least two distinct/);
});


test('geometry editor repository does not load a global tag catalog', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(
    new URL('../src/db/geometry-editor-repository.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /async listTags\(/);
  assert.doesNotMatch(source, /CROSS JOIN LATERAL unnest\(geometry\.tags\)/);
});
