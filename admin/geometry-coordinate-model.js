const DEFAULT_MAX_POINTS = 10_000;
const DEFAULT_MAX_TEXT_CHARS = 1_000_000;

const NUMBER_TOKEN =
  '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?';

const COORDINATE_LINE =
  new RegExp(
    '^\\s*(' +
      NUMBER_TOKEN +
      ')\\s*(?:[,;\\t]|\\s+)\\s*(' +
      NUMBER_TOKEN +
      ')\\s*$',
    'u',
  );

export class GeometryCoordinateError extends Error {
  constructor(
    message,
    code = 'invalid-coordinate',
  ) {
    super(message);
    this.name =
      'GeometryCoordinateError';
    this.code = code;
  }
}

function clone(value) {
  return structuredClone(value);
}

function pathKey(path) {
  return JSON.stringify(path);
}

function getAt(root, path) {
  let value = root;
  for (const index of path) {
    value = value[index];
  }
  return value;
}

function setAt(root, path, value) {
  if (path.length === 0) {
    throw new GeometryCoordinateError(
      'Нельзя заменить корневое значение через sequence path.',
      'invalid-path',
    );
  }
  const parent =
    getAt(
      root,
      path.slice(0, -1),
    );
  parent[path.at(-1)] =
    value;
}

export function normalizeCoordinate(
  longitude,
  latitude,
) {
  const lon = Number(longitude);
  const lat = Number(latitude);

  if (
    !Number.isFinite(lon) ||
    !Number.isFinite(lat)
  ) {
    throw new GeometryCoordinateError(
      'Координаты должны быть конечными числами.',
    );
  }

  if (
    lon < -180 ||
    lon > 180
  ) {
    throw new GeometryCoordinateError(
      'Долгота должна быть в диапазоне -180…180.',
      'longitude-out-of-range',
    );
  }

  if (
    lat < -90 ||
    lat > 90
  ) {
    throw new GeometryCoordinateError(
      'Широта должна быть в диапазоне -90…90.',
      'latitude-out-of-range',
    );
  }

  return [lon, lat];
}

export function parseCoordinateText(
  text,
  {
    maxPoints =
      DEFAULT_MAX_POINTS,
    maxTextChars =
      DEFAULT_MAX_TEXT_CHARS,
  } = {},
) {
  const source =
    String(text ?? '');

  if (
    source.length >
    maxTextChars
  ) {
    throw new GeometryCoordinateError(
      'Слишком большой блок координат.',
      'text-too-large',
    );
  }

  const lines =
    source
      .split(/\r?\n/u)
      .map(
        (line) =>
          line.trim(),
      )
      .filter(Boolean);

  if (
    lines.length === 0
  ) {
    throw new GeometryCoordinateError(
      'Нет координат для вставки.',
      'empty-input',
    );
  }

  if (
    lines.length >
    maxPoints
  ) {
    throw new GeometryCoordinateError(
      'Слишком много координат в одном вводе.',
      'too-many-points',
    );
  }

  return lines.map(
    (line, index) => {
      const match =
        COORDINATE_LINE.exec(
          line,
        );

      if (!match) {
        throw new GeometryCoordinateError(
          'Строка ' +
            (index + 1) +
            ': ожидается «долгота широта» с точкой как десятичным разделителем.',
          'invalid-line',
        );
      }

      return normalizeCoordinate(
        match[1],
        match[2],
      );
    },
  );
}

function samePosition(
  left,
  right,
) {
  return (
    left?.[0] === right?.[0] &&
    left?.[1] === right?.[1]
  );
}

function sequence(
  path,
  label,
  coordinates,
  {
    closed = false,
    minimum = 1,
  } = {},
) {
  const editable =
    closed &&
    coordinates.length > 1 &&
    samePosition(
      coordinates[0],
      coordinates.at(-1),
    )
      ? coordinates.slice(0, -1)
      : coordinates;

  return {
    key: pathKey(path),
    path: [...path],
    label,
    closed,
    minimum,
    coordinates:
      editable.map(
        (coordinate) =>
          normalizeCoordinate(
            coordinate?.[0],
            coordinate?.[1],
          ),
      ),
  };
}

export function coordinateSequences(
  geometry,
) {
  if (!geometry) {
    return [];
  }

  switch (geometry.type) {
    case 'Point':
      return [
        sequence(
          [],
          'Точка',
          [geometry.coordinates],
        ),
      ];

    case 'LineString':
      return [
        sequence(
          [],
          'Линия',
          geometry.coordinates,
          { minimum: 2 },
        ),
      ];

    case 'MultiLineString':
      return geometry.coordinates.map(
        (coordinates, lineIndex) =>
          sequence(
            [lineIndex],
            'Линия ' +
              (lineIndex + 1),
            coordinates,
            { minimum: 2 },
          ),
      );

    case 'Polygon':
      return geometry.coordinates.map(
        (coordinates, ringIndex) =>
          sequence(
            [ringIndex],
            ringIndex === 0
              ? 'Внешнее кольцо'
              : 'Отверстие ' +
                  ringIndex,
            coordinates,
            {
              closed: true,
              minimum: 3,
            },
          ),
      );

    case 'MultiPolygon':
      return geometry.coordinates
        .flatMap(
          (
            polygon,
            polygonIndex,
          ) =>
            polygon.map(
              (
                coordinates,
                ringIndex,
              ) =>
                sequence(
                  [
                    polygonIndex,
                    ringIndex,
                  ],
                  'Полигон ' +
                    (polygonIndex + 1) +
                    ' · ' +
                    (
                      ringIndex === 0
                        ? 'внешнее кольцо'
                        : 'отверстие ' +
                          ringIndex
                    ),
                  coordinates,
                  {
                    closed: true,
                    minimum: 3,
                  },
                ),
            ),
        );

    default:
      throw new GeometryCoordinateError(
        'Неподдерживаемый тип геометрии.',
        'unsupported-geometry',
      );
  }
}

export function replaceCoordinateSequence(
  geometry,
  path,
  coordinates,
) {
  const result =
    clone(geometry);
  const descriptors =
    coordinateSequences(result);
  const target =
    descriptors.find(
      (item) =>
        item.key ===
        pathKey(path),
    );

  if (!target) {
    throw new GeometryCoordinateError(
      'Последовательность координат больше не существует.',
      'sequence-not-found',
    );
  }

  const normalized =
    coordinates.map(
      (coordinate) =>
        normalizeCoordinate(
          coordinate?.[0],
          coordinate?.[1],
        ),
    );

  if (
    normalized.length <
    target.minimum
  ) {
    throw new GeometryCoordinateError(
      'Для этой геометрии нужно минимум точек: ' +
        target.minimum +
        '.',
      'too-few-points',
    );
  }

  if (
    result.type === 'Point'
  ) {
    if (
      normalized.length !== 1
    ) {
      throw new GeometryCoordinateError(
        'Point должен содержать ровно одну координату.',
        'point-count',
      );
    }
    result.coordinates =
      normalized[0];
    return result;
  }

  const replacement =
    target.closed
      ? [
          ...normalized,
          [...normalized[0]],
        ]
      : normalized;

  if (path.length === 0) {
    result.coordinates =
      replacement;
  } else {
    setAt(
      result.coordinates,
      path,
      replacement,
    );
  }

  return result;
}

export function translateGeometry(
  geometry,
  deltaLongitude,
  deltaLatitude,
) {
  const dx =
    Number(deltaLongitude);
  const dy =
    Number(deltaLatitude);

  if (
    !Number.isFinite(dx) ||
    !Number.isFinite(dy)
  ) {
    throw new GeometryCoordinateError(
      'Смещение геометрии должно быть конечным числом.',
      'invalid-translation',
    );
  }

  const result =
    clone(geometry);

  function translate(value) {
    if (!Array.isArray(value)) {
      throw new GeometryCoordinateError(
        'Повреждена структура координат.',
        'invalid-geometry',
      );
    }

    if (
      value.length >= 2 &&
      typeof value[0] ===
        'number' &&
      typeof value[1] ===
        'number'
    ) {
      const [
        lon,
        lat,
      ] =
        normalizeCoordinate(
          value[0] + dx,
          value[1] + dy,
        );

      return [
        lon,
        lat,
        ...value.slice(2),
      ];
    }

    return value.map(
      translate,
    );
  }

  result.coordinates =
    translate(
      result.coordinates,
    );

  return result;
}
