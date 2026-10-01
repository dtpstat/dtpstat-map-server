import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PointTypeValidationError,
  normalizePointTypeCreate,
  normalizePointTypeId,
  normalizePointTypeUpdate,
} from '../src/modules/points/type-policy.js';
import {
  readFile,
} from 'node:fs/promises';

test('point type policy normalizes size anchor activity and name', () => {
  assert.deepEqual(
    normalizePointTypeCreate({
      name: '  Остановка   трамвая ',
    }),
    {
      name: 'Остановка трамвая',
      isActive: true,
      displayWidth: 32,
      displayHeight: 32,
      anchorX: 16,
      anchorY: 16,
      minZoom: null,
      maxZoom: null,
    },
  );

  const updated =
    normalizePointTypeUpdate(
      {
        displayWidth: 48,
        displayHeight: 24,
        anchorX: 12,
        anchorY: 24,
        isActive: false,
        minZoom: 10.5,
        maxZoom: 17,
      },
      {
        name: 'Остановка',
        isActive: true,
        displayWidth: 32,
        displayHeight: 32,
        anchorX: 16,
        anchorY: 16,
        minZoom: null,
        maxZoom: null,
      },
    );

  assert.deepEqual(
    updated,
    {
      name: 'Остановка',
      isActive: false,
      displayWidth: 48,
      displayHeight: 24,
      anchorX: 12,
      anchorY: 24,
      minZoom: 10.5,
      maxZoom: 17,
    },
  );
});

test('point type policy rejects invalid ids names sizes and anchors', () => {
  assert.throws(
    () =>
      normalizePointTypeId(0),
    PointTypeValidationError,
  );
  assert.throws(
    () =>
      normalizePointTypeCreate({
        name: '',
      }),
    PointTypeValidationError,
  );
  assert.throws(
    () =>
      normalizePointTypeCreate({
        name: 'Тип',
        displayWidth: 7,
      }),
    /displayWidth/u,
  );
  assert.throws(
    () =>
      normalizePointTypeCreate({
        name: 'Тип',
        anchorX: 33,
      }),
    /anchorX/u,
  );
  assert.throws(
    () =>
      normalizePointTypeCreate({
        name: 'Тип',
        minZoom: 18,
        maxZoom: 12,
      }),
    /minZoom/u,
  );
  assert.throws(
    () =>
      normalizePointTypeCreate({
        name: 'Тип',
        minZoom: 25,
      }),
    /minZoom/u,
  );
  assert.throws(
    () =>
      normalizePointTypeUpdate(
        {
          displayHeight: 12,
        },
        {
          name: 'Тип',
          isActive: true,
          displayWidth: 32,
          displayHeight: 32,
          anchorX: 16,
          anchorY: 16,
          minZoom: null,
          maxZoom: null,
        },
      ),
    /anchorY/u,
  );
});

test('V060 adds optional point type zoom limits', async () => {
  const sql =
    await readFile(
      new URL(
        '../db/migrations/V060__point_type_zoom_range.sql',
        import.meta.url,
      ),
      'utf8',
    );

  assert.match(sql, /ALTER TABLE BUSLANES\.POINT_TYPES/u);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS MIN_ZOOM DOUBLE PRECISION/u);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS MAX_ZOOM DOUBLE PRECISION/u);
  assert.match(sql, /POINT_TYPES_ZOOM_RANGE/u);
  assert.match(sql, /MIN_ZOOM <= MAX_ZOOM/u);
});

test('V050 adds point types and keeps point category exclusive to points', async () => {
  const sql =
    await readFile(
      new URL(
        '../db/migrations/V050__point_types.sql',
        import.meta.url,
      ),
      'utf8',
    );

  assert.match(
    sql,
    /CREATE TABLE BUSLANES\.POINT_TYPES/u,
  );
  assert.match(
    sql,
    /ADD COLUMN POINT_TYPE_ID BIGINT/u,
  );
  assert.match(
    sql,
    /REFERENCES BUSLANES\.POINT_TYPES\(ID\)/u,
  );
  assert.match(
    sql,
    /ON DELETE SET NULL/u,
  );
  assert.match(
    sql,
    /GEOMETRYTYPE\(GEOM\) = 'POINT'/u,
  );
  assert.match(
    sql,
    /POINT_TYPE_ID IS NULL[\s\S]*POLYGON/u,
  );
  assert.match(
    sql,
    /ICON_MIME IN \([\s\S]*image\/png[\s\S]*image\/gif[\s\S]*image\/svg\+xml/u,
  );
  assert.match(
    sql,
    /NEW\.POINT_TYPE_ID IS DISTINCT FROM OLD\.POINT_TYPE_ID/u,
  );
});
