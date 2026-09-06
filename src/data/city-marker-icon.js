export const CITY_MARKER_ICON_MAX_BYTES = 256 * 1024;
export const CITY_MARKER_ICON_MIN_SIZE = 16;
export const CITY_MARKER_ICON_MAX_SIZE = 256;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class CityMarkerIconValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CityMarkerIconValidationError';
  }
}

function pngDimensions(data) {
  if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new CityMarkerIconValidationError('City marker icon must be a valid PNG file');
  }
  if (data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') {
    throw new CityMarkerIconValidationError('City marker PNG has an invalid IHDR header');
  }
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

/**
 * Validate a raster city marker before it is persisted. The map normalizes the
 * rendered marker to the historic 32px width, therefore uploads may use a
 * higher-resolution square PNG while keeping the same visual footprint.
 *
 * @param {Buffer | Uint8Array} input
 * @param {string | undefined | null} contentType
 */
export function validateCityMarkerIcon(input, contentType) {
  const data = Buffer.isBuffer(input) ? input : Buffer.from(input ?? []);
  const mime = String(contentType ?? '').split(';', 1)[0].trim().toLocaleLowerCase('en-US');
  if (mime !== 'image/png') {
    throw new CityMarkerIconValidationError('City marker icon must use Content-Type image/png');
  }
  if (data.length === 0) {
    throw new CityMarkerIconValidationError('City marker icon is empty');
  }
  if (data.length > CITY_MARKER_ICON_MAX_BYTES) {
    throw new CityMarkerIconValidationError(
      `City marker icon must not exceed ${CITY_MARKER_ICON_MAX_BYTES} bytes`,
    );
  }

  const { width, height } = pngDimensions(data);
  if (
    width !== height ||
    width < CITY_MARKER_ICON_MIN_SIZE ||
    width > CITY_MARKER_ICON_MAX_SIZE
  ) {
    throw new CityMarkerIconValidationError(
      `City marker icon must be a square PNG between ${CITY_MARKER_ICON_MIN_SIZE}x${CITY_MARKER_ICON_MIN_SIZE} and ${CITY_MARKER_ICON_MAX_SIZE}x${CITY_MARKER_ICON_MAX_SIZE} pixels`,
    );
  }

  return {
    data,
    mime: 'image/png',
    width,
    height,
  };
}
