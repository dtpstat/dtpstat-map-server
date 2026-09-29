import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GeometryCoordinateError,
  coordinateSequences,
  normalizeCoordinate,
  normalizeCoordinateInput,
  parseCoordinateText,
  replaceCoordinateSequence,
  translateGeometry,
} from '../admin/geometry-coordinate-model.js';

test('coordinate text parser accepts bounded WGS84 rows and common separators', () => {
  assert.deepEqual(
    parseCoordinateText(
      '37.61 55.75\n37.62;55.76\n37.63,55.77\n37.64\t55.78',
    ),
    [
      [37.61, 55.75],
      [37.62, 55.76],
      [37.63, 55.77],
      [37.64, 55.78],
    ],
  );

  assert.deepEqual(
    normalizeCoordinate(
      '-180',
      '90',
    ),
    [-180, 90],
  );
});

test('coordinate text parser normalizes decimal commas and rejects malformed oversized and out-of-range input', () => {
  assert.deepEqual(
    parseCoordinateText(
      '37,615 55,75\n37,620;55,760',
    ),
    [
      [37.615, 55.75],
      [37.62, 55.76],
    ],
  );

  assert.equal(
    normalizeCoordinateInput(
      ' 37,615 ',
    ),
    '37.615',
  );

  assert.throws(
    () =>
      parseCoordinateText(
        '37,615,55,75',
      ),
    GeometryCoordinateError,
  );

  assert.throws(
    () =>
      normalizeCoordinate(
        '',
        '0',
      ),
    /Долгота должна быть числом/u,
  );

  assert.throws(
    () =>
      parseCoordinateText(
        '181 0',
      ),
    /-180…180/u,
  );

  assert.throws(
    () =>
      parseCoordinateText(
        '0 91',
      ),
    /-90…90/u,
  );

  assert.throws(
    () =>
      parseCoordinateText(
        '1 2\n3 4',
        {
          maxPoints: 1,
        },
      ),
    /Слишком много/u,
  );
});

test('coordinate sequence model preserves polygon closure and multi geometry identity', () => {
  const polygon = {
    type: 'Polygon',
    coordinates: [[
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 1],
    ]],
  };

  const [ring] =
    coordinateSequences(
      polygon,
    );

  assert.equal(
    ring.closed,
    true,
  );
  assert.equal(
    ring.minimum,
    3,
  );
  assert.deepEqual(
    ring.coordinates,
    [
      [1, 1],
      [2, 1],
      [2, 2],
    ],
  );

  const replaced =
    replaceCoordinateSequence(
      polygon,
      ring.path,
      [
        [10, 10],
        [11, 10],
        [11, 11],
      ],
    );

  assert.deepEqual(
    replaced.coordinates[0],
    [
      [10, 10],
      [11, 10],
      [11, 11],
      [10, 10],
    ],
  );

  const multi =
    coordinateSequences({
      type: 'MultiPolygon',
      coordinates: [
        [[
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 1],
        ]],
        [[
          [3, 3],
          [4, 3],
          [4, 4],
          [3, 3],
        ]],
      ],
    });

  assert.deepEqual(
    multi.map(
      (item) =>
        item.path,
    ),
    [
      [0, 0],
      [1, 0],
    ],
  );
});

test('coordinate sequence replacement enforces geometry minimums', () => {
  assert.throws(
    () =>
      replaceCoordinateSequence(
        {
          type: 'LineString',
          coordinates: [
            [1, 1],
            [2, 2],
          ],
        },
        [],
        [[1, 1]],
      ),
    /минимум точек: 2/u,
  );

  assert.throws(
    () =>
      replaceCoordinateSequence(
        {
          type: 'Point',
          coordinates: [1, 1],
        },
        [],
        [
          [1, 1],
          [2, 2],
        ],
      ),
    /ровно одну/u,
  );
});

test('whole geometry translation preserves nested topology and rejects world bounds overflow', () => {
  const source = {
    type: 'MultiLineString',
    coordinates: [
      [
        [10, 20],
        [11, 21],
      ],
      [
        [12, 22],
        [13, 23],
      ],
    ],
  };

  const moved =
    translateGeometry(
      source,
      1.5,
      -2,
    );

  assert.deepEqual(
    moved.coordinates,
    [
      [
        [11.5, 18],
        [12.5, 19],
      ],
      [
        [13.5, 20],
        [14.5, 21],
      ],
    ],
  );

  assert.deepEqual(
    source.coordinates[0][0],
    [10, 20],
  );

  assert.throws(
    () =>
      translateGeometry(
        {
          type: 'Point',
          coordinates: [179, 0],
        },
        2,
        0,
      ),
    /-180…180/u,
  );
});
