import crypto from 'node:crypto';
import {
  deflateSync,
  inflateSync,
} from 'node:zlib';

export const POINT_TYPE_ICON_MAX_BYTES =
  512 * 1024;
export const POINT_TYPE_ICON_MAX_DIMENSION =
  4096;
export const POINT_TYPE_ICON_MAX_PIXELS =
  4 * 1024 * 1024;
export const POINT_TYPE_ICON_MAX_SVG_ELEMENTS =
  2000;
export const POINT_TYPE_ICON_MAX_SVG_DEPTH =
  32;

const PNG_SIGNATURE =
  Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
  ]);

const GIF_87A =
  Buffer.from('GIF87a', 'ascii');
const GIF_89A =
  Buffer.from('GIF89a', 'ascii');

const MIME_TO_EXTENSION =
  Object.freeze({
    'image/png': 'png',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
  });

const ALLOWED_DECLARED_TYPES =
  new Set([
    ...Object.keys(
      MIME_TO_EXTENSION,
    ),
    'application/octet-stream',
  ]);

const CRC_TABLE =
  (() => {
    const table =
      new Uint32Array(256);
    for (
      let index = 0;
      index < 256;
      index += 1
    ) {
      let value = index;
      for (
        let bit = 0;
        bit < 8;
        bit += 1
      ) {
        value =
          value & 1
            ? (
                0xedb88320 ^
                (value >>> 1)
              )
            : value >>> 1;
      }
      table[index] =
        value >>> 0;
    }
    return table;
  })();

export class PointTypeIconValidationError
  extends Error {
  constructor(message) {
    super(message);
    this.name =
      'PointTypeIconValidationError';
  }
}

function fail(message) {
  throw new PointTypeIconValidationError(
    message,
  );
}

function asBuffer(input) {
  const data =
    Buffer.isBuffer(input)
      ? input
      : Buffer.from(
        input ?? [],
      );

  if (data.length === 0) {
    fail('Point type icon is empty');
  }
  if (
    data.length >
    POINT_TYPE_ICON_MAX_BYTES
  ) {
    fail(
      'Point type icon exceeds the ' +
      POINT_TYPE_ICON_MAX_BYTES +
      ' byte limit',
    );
  }
  return data;
}

function dimensions(
  width,
  height,
  label,
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width >
      POINT_TYPE_ICON_MAX_DIMENSION ||
    height >
      POINT_TYPE_ICON_MAX_DIMENSION ||
    width * height >
      POINT_TYPE_ICON_MAX_PIXELS
  ) {
    fail(
      label +
      ' dimensions exceed the supported icon bounds',
    );
  }
  return {
    width,
    height,
  };
}

function crc32(parts) {
  let crc = 0xffffffff;

  for (const part of parts) {
    for (const byte of part) {
      crc =
        CRC_TABLE[
          (crc ^ byte) & 0xff
        ] ^
        (crc >>> 8);
    }
  }

  return (
    crc ^ 0xffffffff
  ) >>> 0;
}

function pngChunk(
  type,
  data,
) {
  const typeBytes =
    Buffer.from(
      type,
      'ascii',
    );
  const header =
    Buffer.allocUnsafe(8);
  header.writeUInt32BE(
    data.length,
    0,
  );
  typeBytes.copy(
    header,
    4,
  );

  const checksum =
    Buffer.allocUnsafe(4);
  checksum.writeUInt32BE(
    crc32([
      typeBytes,
      data,
    ]),
    0,
  );

  return Buffer.concat([
    header,
    data,
    checksum,
  ]);
}

function pngChannels(
  colorType,
  bitDepth,
) {
  const bitDepths = {
    0:
      new Set([
        1, 2, 4, 8, 16,
      ]),
    2:
      new Set([
        8, 16,
      ]),
    3:
      new Set([
        1, 2, 4, 8,
      ]),
    4:
      new Set([
        8, 16,
      ]),
    6:
      new Set([
        8, 16,
      ]),
  };
  const channels = {
    0: 1,
    2: 3,
    3: 1,
    4: 2,
    6: 4,
  };

  if (
    !bitDepths[colorType]
      ?.has(bitDepth)
  ) {
    fail(
      'PNG uses an unsupported color type or bit depth',
    );
  }

  return channels[colorType];
}

function sanitizePng(data) {
  if (
    data.length < 33 ||
    !data
      .subarray(0, 8)
      .equals(PNG_SIGNATURE)
  ) {
    fail('Invalid PNG signature');
  }

  let offset = 8;
  let ihdr = null;
  let palette = null;
  let transparency = null;
  const idat = [];
  let sawIdat = false;
  let endedIdat = false;
  let sawIend = false;

  while (
    offset < data.length
  ) {
    if (
      offset + 12 >
      data.length
    ) {
      fail('PNG chunk is truncated');
    }

    const length =
      data.readUInt32BE(
        offset,
      );
    const typeStart =
      offset + 4;
    const bodyStart =
      offset + 8;
    const bodyEnd =
      bodyStart + length;
    const crcOffset =
      bodyEnd;

    if (
      bodyEnd + 4 >
      data.length
    ) {
      fail('PNG chunk exceeds file bounds');
    }

    const typeBytes =
      data.subarray(
        typeStart,
        bodyStart,
      );
    const type =
      typeBytes.toString(
        'ascii',
      );

    if (
      !/^[A-Za-z]{4}$/u
        .test(type)
    ) {
      fail('PNG chunk type is invalid');
    }

    const body =
      data.subarray(
        bodyStart,
        bodyEnd,
      );
    const expectedCrc =
      data.readUInt32BE(
        crcOffset,
      );
    const actualCrc =
      crc32([
        typeBytes,
        body,
      ]);

    if (
      expectedCrc !==
      actualCrc
    ) {
      fail(
        'PNG chunk checksum is invalid',
      );
    }

    offset =
      bodyEnd + 4;

    if (!ihdr) {
      if (
        type !== 'IHDR' ||
        length !== 13
      ) {
        fail(
          'PNG must begin with one IHDR chunk',
        );
      }
      ihdr =
        Buffer.from(body);
      continue;
    }

    if (type === 'IHDR') {
      fail(
        'PNG contains more than one IHDR chunk',
      );
    }

    if (type === 'PLTE') {
      if (
        sawIdat ||
        palette
      ) {
        fail(
          'PNG palette is in an invalid position',
        );
      }
      if (
        length < 3 ||
        length > 768 ||
        length % 3 !== 0
      ) {
        fail(
          'PNG palette is invalid',
        );
      }
      palette =
        Buffer.from(body);
      continue;
    }

    if (type === 'tRNS') {
      if (
        sawIdat ||
        transparency
      ) {
        fail(
          'PNG transparency chunk is in an invalid position',
        );
      }
      transparency =
        Buffer.from(body);
      continue;
    }

    if (type === 'IDAT') {
      if (endedIdat) {
        fail(
          'PNG IDAT chunks must be consecutive',
        );
      }
      sawIdat = true;
      idat.push(
        Buffer.from(body),
      );
      continue;
    }

    if (sawIdat) {
      endedIdat = true;
    }

    if (type === 'IEND') {
      if (
        length !== 0 ||
        !sawIdat
      ) {
        fail('PNG IEND is invalid');
      }
      sawIend = true;
      break;
    }

    const isCritical =
      (
        typeBytes[0] &
        0x20
      ) === 0;

    if (isCritical) {
      fail(
        'PNG contains an unsupported critical chunk: ' +
        type,
      );
    }
  }

  if (
    !ihdr ||
    !sawIend ||
    offset !== data.length
  ) {
    fail(
      'PNG does not terminate cleanly',
    );
  }

  const width =
    ihdr.readUInt32BE(0);
  const height =
    ihdr.readUInt32BE(4);
  dimensions(
    width,
    height,
    'PNG',
  );

  const bitDepth =
    ihdr[8];
  const colorType =
    ihdr[9];
  const compression =
    ihdr[10];
  const filterMethod =
    ihdr[11];
  const interlace =
    ihdr[12];
  const channels =
    pngChannels(
      colorType,
      bitDepth,
    );

  if (
    compression !== 0 ||
    filterMethod !== 0 ||
    interlace !== 0
  ) {
    fail(
      'PNG must use standard non-interlaced compression and filtering',
    );
  }

  if (
    colorType === 3 &&
    !palette
  ) {
    fail(
      'Indexed PNG requires a palette',
    );
  }

  if (
    palette &&
    colorType === 3 &&
    palette.length / 3 >
      2 ** bitDepth
  ) {
    fail(
      'PNG palette exceeds the indexed bit depth',
    );
  }

  if (transparency) {
    if (
      colorType === 0 &&
      transparency.length !== 2
    ) {
      fail(
        'PNG grayscale transparency is invalid',
      );
    }
    if (
      colorType === 2 &&
      transparency.length !== 6
    ) {
      fail(
        'PNG RGB transparency is invalid',
      );
    }
    if (
      colorType === 3 &&
      (
        !palette ||
        transparency.length >
          palette.length / 3
      )
    ) {
      fail(
        'PNG indexed transparency is invalid',
      );
    }
    if (
      [4, 6].includes(
        colorType,
      )
    ) {
      fail(
        'PNG alpha color types cannot use tRNS',
      );
    }
  }

  const rowBytes =
    Math.ceil(
      (
        width *
        channels *
        bitDepth
      ) / 8,
    );
  const expectedRaw =
    (
      rowBytes + 1
    ) * height;

  let raw;
  try {
    raw =
      inflateSync(
        Buffer.concat(idat),
        {
          maxOutputLength:
            expectedRaw + 1,
        },
      );
  } catch {
    fail(
      'PNG compressed image data is invalid',
    );
  }

  if (
    raw.length !==
    expectedRaw
  ) {
    fail(
      'PNG decoded image size is inconsistent with IHDR',
    );
  }

  for (
    let row = 0;
    row < height;
    row += 1
  ) {
    if (
      raw[
        row *
        (rowBytes + 1)
      ] > 4
    ) {
      fail(
        'PNG scanline uses an invalid filter',
      );
    }
  }

  const canonicalIdat =
    deflateSync(
      raw,
      {
        level: 9,
      },
    );

  const chunks = [
    PNG_SIGNATURE,
    pngChunk(
      'IHDR',
      ihdr,
    ),
  ];

  if (palette) {
    chunks.push(
      pngChunk(
        'PLTE',
        palette,
      ),
    );
  }

  if (transparency) {
    chunks.push(
      pngChunk(
        'tRNS',
        transparency,
      ),
    );
  }

  chunks.push(
    pngChunk(
      'IDAT',
      canonicalIdat,
    ),
    pngChunk(
      'IEND',
      Buffer.alloc(0),
    ),
  );

  return {
    data:
      Buffer.concat(chunks),
    mime: 'image/png',
    width,
    height,
  };
}

function gifColorTableLength(
  packed,
) {
  if (
    (packed & 0x80) === 0
  ) {
    return 0;
  }
  return (
    3 *
    (
      1 <<
      (
        (packed & 0x07) +
        1
      )
    )
  );
}

function gifSubBlocks(
  data,
  start,
) {
  let offset = start;
  const parts = [];
  let bytes = 0;

  while (true) {
    if (
      offset >= data.length
    ) {
      fail(
        'GIF sub-block stream is truncated',
      );
    }

    const length =
      data[offset];
    offset += 1;

    if (length === 0) {
      break;
    }

    if (
      offset + length >
      data.length
    ) {
      fail(
        'GIF sub-block exceeds file bounds',
      );
    }

    const part =
      data.subarray(
        offset,
        offset + length,
      );
    parts.push(part);
    bytes += length;
    offset += length;

    if (
      bytes >
      POINT_TYPE_ICON_MAX_BYTES
    ) {
      fail(
        'GIF image data exceeds the icon limit',
      );
    }
  }

  return {
    data:
      Buffer.concat(parts),
    offset,
  };
}

function gifCanonicalSubBlocks(
  data,
) {
  const parts = [];
  for (
    let offset = 0;
    offset < data.length;
    offset += 255
  ) {
    const part =
      data.subarray(
        offset,
        offset + 255,
      );
    parts.push(
      Buffer.from([
        part.length,
      ]),
      part,
    );
  }
  parts.push(
    Buffer.from([0]),
  );
  return Buffer.concat(parts);
}

function validateGifLzw(
  encoded,
  minimumCodeSize,
  expectedPixels,
  paletteSize,
) {
  if (
    minimumCodeSize < 2 ||
    minimumCodeSize > 8
  ) {
    fail(
      'GIF LZW code size is unsupported',
    );
  }

  const clearCode =
    1 << minimumCodeSize;
  const endCode =
    clearCode + 1;
  const prefix =
    new Int16Array(4096);
  const suffix =
    new Uint8Array(4096);
  const stack =
    new Uint8Array(4096);

  prefix.fill(-1);

  for (
    let index = 0;
    index < clearCode;
    index += 1
  ) {
    suffix[index] =
      index;
  }

  let available =
    clearCode + 2;
  let codeSize =
    minimumCodeSize + 1;
  let bitOffset = 0;
  let oldCode = -1;
  let first = 0;
  let outputCount = 0;
  let ended = false;

  function readCode() {
    if (
      bitOffset + codeSize >
      encoded.length * 8
    ) {
      return null;
    }

    let value = 0;
    for (
      let bit = 0;
      bit < codeSize;
      bit += 1
    ) {
      const absolute =
        bitOffset + bit;
      const byte =
        encoded[
          absolute >>> 3
        ];
      const bitValue =
        (
          byte >>>
          (absolute & 7)
        ) & 1;
      value |=
        bitValue << bit;
    }

    bitOffset +=
      codeSize;
    return value;
  }

  function emit(value) {
    if (
      value >=
      paletteSize
    ) {
      fail(
        'GIF pixel references a color outside the palette',
      );
    }
    outputCount += 1;
    if (
      outputCount >
      expectedPixels
    ) {
      fail(
        'GIF LZW stream expands beyond the image bounds',
      );
    }
  }

  while (true) {
    let code =
      readCode();

    if (code === null) {
      break;
    }

    if (code === clearCode) {
      available =
        clearCode + 2;
      codeSize =
        minimumCodeSize + 1;
      oldCode = -1;
      continue;
    }

    if (code === endCode) {
      ended = true;
      break;
    }

    if (
      code > available ||
      code >= 4096
    ) {
      fail(
        'GIF LZW stream contains an invalid code',
      );
    }

    if (oldCode < 0) {
      if (
        code >= clearCode
      ) {
        fail(
          'GIF LZW stream does not start with a literal',
        );
      }
      first =
        suffix[code];
      emit(first);
      oldCode = code;
      continue;
    }

    const inputCode = code;
    let stackLength = 0;

    if (code === available) {
      stack[
        stackLength
      ] = first;
      stackLength += 1;
      code = oldCode;
    }

    let depth = 0;
    while (
      code >= clearCode
    ) {
      if (
        code >= available ||
        depth >= 4096 ||
        stackLength >=
          stack.length
      ) {
        fail(
          'GIF LZW dictionary chain is invalid',
        );
      }
      stack[
        stackLength
      ] = suffix[code];
      stackLength += 1;
      code =
        prefix[code];
      depth += 1;
    }

    if (
      code < 0 ||
      code >= clearCode ||
      stackLength >=
        stack.length
    ) {
      fail(
        'GIF LZW literal is invalid',
      );
    }

    first =
      suffix[code];
    stack[
      stackLength
    ] = first;
    stackLength += 1;

    for (
      let index =
        stackLength - 1;
      index >= 0;
      index -= 1
    ) {
      emit(
        stack[index],
      );
    }

    if (
      available < 4096
    ) {
      prefix[available] =
        oldCode;
      suffix[available] =
        first;
      available += 1;

      if (
        available ===
          (1 << codeSize) &&
        codeSize < 12
      ) {
        codeSize += 1;
      }
    }

    oldCode =
      inputCode;
  }

  if (!ended) {
    fail(
      'GIF LZW stream is missing the end code',
    );
  }

  if (
    outputCount !==
    expectedPixels
  ) {
    fail(
      'GIF decoded pixel count is inconsistent with the image bounds',
    );
  }
}

function sanitizeGif(data) {
  if (
    data.length < 14 ||
    (
      !data
        .subarray(0, 6)
        .equals(GIF_87A) &&
      !data
        .subarray(0, 6)
        .equals(GIF_89A)
    )
  ) {
    fail('Invalid GIF signature');
  }

  const width =
    data.readUInt16LE(6);
  const height =
    data.readUInt16LE(8);
  dimensions(
    width,
    height,
    'GIF',
  );

  const logical =
    Buffer.from(
      data.subarray(6, 13),
    );
  const globalPacked =
    logical[4];
  const globalTableLength =
    gifColorTableLength(
      globalPacked,
    );
  const globalPaletteSize =
    globalTableLength
      ? globalTableLength / 3
      : 0;

  let offset = 13;

  if (
    offset +
      globalTableLength >
    data.length
  ) {
    fail(
      'GIF global color table is truncated',
    );
  }

  const globalTable =
    globalTableLength
      ? Buffer.from(
        data.subarray(
          offset,
          offset +
            globalTableLength,
        ),
      )
      : null;

  offset +=
    globalTableLength;

  const output = [
    GIF_89A,
    logical,
  ];
  if (globalTable) {
    output.push(
      globalTable,
    );
  }

  let pendingGraphicControl =
    null;
  let frameCount = 0;
  let sawTrailer = false;

  while (
    offset < data.length
  ) {
    const marker =
      data[offset];
    offset += 1;

    if (marker === 0x3b) {
      sawTrailer = true;
      break;
    }

    if (marker === 0x21) {
      if (
        offset >= data.length
      ) {
        fail(
          'GIF extension is truncated',
        );
      }

      const label =
        data[offset];
      offset += 1;

      if (label === 0xf9) {
        if (
          offset + 6 >
          data.length ||
          data[offset] !== 4 ||
          data[offset + 5] !==
            0
        ) {
          fail(
            'GIF graphic control extension is invalid',
          );
        }

        const control =
          Buffer.from(
            data.subarray(
              offset + 1,
              offset + 5,
            ),
          );
        control[0] &=
          0x1f;

        pendingGraphicControl =
          Buffer.concat([
            Buffer.from([
              0x21,
              0xf9,
              0x04,
            ]),
            control,
            Buffer.from([0]),
          ]);

        offset += 6;
        continue;
      }

      if (
        label === 0xfe
      ) {
        const skipped =
          gifSubBlocks(
            data,
            offset,
          );
        offset =
          skipped.offset;
        continue;
      }

      if (
        label === 0xff ||
        label === 0x01
      ) {
        if (
          offset >= data.length
        ) {
          fail(
            'GIF extension header is truncated',
          );
        }

        const required =
          label === 0xff
            ? 11
            : 12;
        const headerLength =
          data[offset];
        offset += 1;

        if (
          headerLength !==
            required ||
          offset +
            headerLength >
            data.length
        ) {
          fail(
            'GIF extension header is invalid',
          );
        }

        offset +=
          headerLength;

        const skipped =
          gifSubBlocks(
            data,
            offset,
          );
        offset =
          skipped.offset;
        continue;
      }

      fail(
        'GIF contains an unsupported extension',
      );
    }

    if (marker !== 0x2c) {
      fail(
        'GIF contains an invalid block marker',
      );
    }

    frameCount += 1;
    if (frameCount > 1) {
      fail(
        'Animated GIF icons are not supported',
      );
    }

    if (
      offset + 9 >
      data.length
    ) {
      fail(
        'GIF image descriptor is truncated',
      );
    }

    const descriptor =
      Buffer.from(
        data.subarray(
          offset,
          offset + 9,
        ),
      );
    offset += 9;

    const left =
      descriptor.readUInt16LE(0);
    const top =
      descriptor.readUInt16LE(2);
    const imageWidth =
      descriptor.readUInt16LE(4);
    const imageHeight =
      descriptor.readUInt16LE(6);
    const packed =
      descriptor[8];

    dimensions(
      imageWidth,
      imageHeight,
      'GIF frame',
    );

    if (
      left + imageWidth >
        width ||
      top + imageHeight >
        height
    ) {
      fail(
        'GIF frame exceeds the logical canvas',
      );
    }

    descriptor[8] =
      packed & 0xe7;

    const localTableLength =
      gifColorTableLength(
        packed,
      );

    if (
      offset +
        localTableLength >
      data.length
    ) {
      fail(
        'GIF local color table is truncated',
      );
    }

    const localTable =
      localTableLength
        ? Buffer.from(
          data.subarray(
            offset,
            offset +
              localTableLength,
          ),
        )
        : null;

    offset +=
      localTableLength;

    const paletteSize =
      localTableLength
        ? localTableLength / 3
        : globalPaletteSize;

    if (!paletteSize) {
      fail(
        'GIF frame has no color table',
      );
    }

    if (
      offset >= data.length
    ) {
      fail(
        'GIF image data is missing',
      );
    }

    const minimumCodeSize =
      data[offset];
    offset += 1;

    const imageData =
      gifSubBlocks(
        data,
        offset,
      );
    offset =
      imageData.offset;

    validateGifLzw(
      imageData.data,
      minimumCodeSize,
      imageWidth *
        imageHeight,
      paletteSize,
    );

    if (
      pendingGraphicControl
    ) {
      const transparencyEnabled =
        (
          pendingGraphicControl[3] &
          0x01
        ) !== 0;
      const transparencyIndex =
        pendingGraphicControl[6];

      if (
        transparencyEnabled &&
        transparencyIndex >=
          paletteSize
      ) {
        fail(
          'GIF transparent color index is outside the palette',
        );
      }

      output.push(
        pendingGraphicControl,
      );
      pendingGraphicControl =
        null;
    }

    output.push(
      Buffer.from([0x2c]),
      descriptor,
    );

    if (localTable) {
      output.push(
        localTable,
      );
    }

    output.push(
      Buffer.from([
        minimumCodeSize,
      ]),
      gifCanonicalSubBlocks(
        imageData.data,
      ),
    );
  }

  if (
    !sawTrailer ||
    offset !== data.length ||
    frameCount !== 1
  ) {
    fail(
      'GIF must contain exactly one complete image',
    );
  }

  output.push(
    Buffer.from([0x3b]),
  );

  return {
    data:
      Buffer.concat(output),
    mime: 'image/gif',
    width,
    height,
  };
}

const SVG_TAGS =
  new Set([
    'svg',
    'g',
    'path',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'style',
  ]);

const SVG_COMMON_ATTRIBUTES =
  new Set([
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'fill-rule',
    'clip-rule',
    'opacity',
    'fill-opacity',
    'stroke-opacity',
    'transform',
    'style',
    'class',
    'id',
  ]);

const SVG_TAG_ATTRIBUTES =
  Object.freeze({
    svg:
      new Set([
        'xmlns',
        'viewBox',
        'width',
        'height',
        'preserveAspectRatio',
      ]),
    g:
      new Set(),
    path:
      new Set(['d']),
    rect:
      new Set([
        'x',
        'y',
        'width',
        'height',
        'rx',
        'ry',
      ]),
    circle:
      new Set([
        'cx',
        'cy',
        'r',
      ]),
    ellipse:
      new Set([
        'cx',
        'cy',
        'rx',
        'ry',
      ]),
    line:
      new Set([
        'x1',
        'y1',
        'x2',
        'y2',
      ]),
    polyline:
      new Set(['points']),
    polygon:
      new Set(['points']),
    style:
      new Set(['type']),
  });

const SVG_NUMBER =
  /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

function svgNumber(
  value,
  label,
  {
    minimum = -4096,
    maximum = 4096,
  } = {},
) {
  if (
    !SVG_NUMBER.test(value)
  ) {
    fail(
      'SVG ' +
      label +
      ' must be numeric',
    );
  }
  const number =
    Number(value);
  if (
    !Number.isFinite(number) ||
    number < minimum ||
    number > maximum
  ) {
    fail(
      'SVG ' +
      label +
      ' is outside supported bounds',
    );
  }
  return number;
}

function svgIntegerDimension(
  value,
  label,
) {
  const normalized =
    String(value)
      .replace(/px$/u, '');
  const number =
    svgNumber(
      normalized,
      label,
      {
        minimum: 1,
        maximum:
          POINT_TYPE_ICON_MAX_DIMENSION,
      },
    );

  if (
    !Number.isInteger(number)
  ) {
    fail(
      'SVG ' +
      label +
      ' must be an integer pixel size',
    );
  }
  return number;
}

function svgColor(
  value,
  label,
) {
  if (
    value === 'none' ||
    value === 'currentColor' ||
    value === 'transparent' ||
    /^#[0-9a-fA-F]{3,8}$/u
      .test(value) ||
    /^[A-Za-z]{1,32}$/u
      .test(value) ||
    /^rgba?\([0-9.%+,\s-]+\)$/u
      .test(value)
  ) {
    return;
  }
  fail(
    'SVG ' +
    label +
    ' contains an unsafe color value',
  );
}

function svgTransform(value) {
  if (
    value.length > 2048 ||
    !/^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\(\s*[0-9eE+.,\s-]+\)\s*)+$/u
      .test(value)
  ) {
    fail(
      'SVG transform is unsupported',
    );
  }
}

function svgPath(value) {
  if (
    value.length > 100000 ||
    !/^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$/u
      .test(value)
  ) {
    fail(
      'SVG path data is unsupported',
    );
  }
}

function svgPoints(value) {
  if (
    value.length > 100000 ||
    !/^[0-9eE+.,\s-]+$/u
      .test(value)
  ) {
    fail(
      'SVG points are unsupported',
    );
  }
}

const SVG_STYLE_PROPERTIES =
  new Set([
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'fill-rule',
    'clip-rule',
    'opacity',
    'fill-opacity',
    'stroke-opacity',
  ]);

function validateSvgStyle(
  value,
) {
  if (
    value.length > 4096 ||
    /(?:url\s*\(|@import|expression\s*\(|var\s*\(|--|javascript:|data:)/iu
      .test(value)
  ) {
    fail(
      'SVG style contains unsafe CSS',
    );
  }

  const declarations =
    value
      .split(';')
      .map(
        (entry) =>
          entry.trim(),
      )
      .filter(Boolean);

  if (
    declarations.length > 64
  ) {
    fail(
      'SVG style contains too many declarations',
    );
  }

  for (
    const declaration of
    declarations
  ) {
    const separator =
      declaration.indexOf(':');

    if (
      separator <= 0 ||
      declaration.indexOf(
        ':',
        separator + 1,
      ) !== -1
    ) {
      fail(
        'SVG style declaration is invalid',
      );
    }

    const property =
      declaration
        .slice(
          0,
          separator,
        )
        .trim();

    const styleValue =
      declaration
        .slice(
          separator + 1,
        )
        .trim();

    if (
      !SVG_STYLE_PROPERTIES
        .has(property) ||
      !styleValue
    ) {
      fail(
        'SVG style property is not allowed: ' +
        property,
      );
    }

    validateSvgAttribute(
      'g',
      property,
      styleValue,
    );
  }
}

function sanitizeSvgStyleSheet(
  value,
) {
  const source =
    String(value ?? '')
      .trim();

  if (!source) {
    return '';
  }

  if (
    source.length > 65536 ||
    /[@\\<>&]/u.test(source) ||
    /\/\*/u.test(source)
  ) {
    fail(
      'SVG stylesheet contains unsupported CSS syntax',
    );
  }

  const rules = [];
  let offset = 0;

  while (
    offset < source.length
  ) {
    const open =
      source.indexOf(
        '{',
        offset,
      );
    if (open < 0) {
      fail(
        'SVG stylesheet rule is incomplete',
      );
    }

    const close =
      source.indexOf(
        '}',
        open + 1,
      );
    if (
      close < 0 ||
      source.indexOf(
        '{',
        open + 1,
      ) < close
    ) {
      fail(
        'SVG stylesheet nesting is not allowed',
      );
    }

    const selectorText =
      source
        .slice(
          offset,
          open,
        )
        .trim();

    const selectors =
      selectorText
        .split(',')
        .map(
          (selector) =>
            selector.trim(),
        )
        .filter(Boolean);

    if (
      selectors.length === 0 ||
      selectors.length > 64
    ) {
      fail(
        'SVG stylesheet selector list is invalid',
      );
    }

    for (
      const selector of
      selectors
    ) {
      if (
        !/^(?:(?:svg|g|path|rect|circle|ellipse|line|polyline|polygon))?(?:[.#][A-Za-z_][A-Za-z0-9_-]*)+$/u
          .test(selector) &&
        !/^(?:svg|g|path|rect|circle|ellipse|line|polyline|polygon)$/u
          .test(selector)
      ) {
        fail(
          'SVG stylesheet selector is not allowed: ' +
          selector,
        );
      }
    }

    const declarations =
      source
        .slice(
          open + 1,
          close,
        )
        .trim();

    validateSvgStyle(
      declarations,
    );

    rules.push(
      selectors.join(',') +
      '{' +
      declarations +
      '}',
    );

    offset =
      close + 1;

    while (
      /\s/u.test(
        source[offset] ?? '',
      )
    ) {
      offset += 1;
    }
  }

  return rules.join('');
}

function validateSvgAttribute(
  tag,
  name,
  value,
) {
  if (
    !SVG_COMMON_ATTRIBUTES
      .has(name) &&
    !SVG_TAG_ATTRIBUTES[tag]
      ?.has(name)
  ) {
    fail(
      'SVG attribute is not allowed: ' +
      name,
    );
  }

  if (
    /^on/iu.test(name) ||
    name.includes(':') ||
    /url\s*\(/iu.test(value)
  ) {
    fail(
      'SVG active content is not allowed',
    );
  }

  if (
    name === 'fill' ||
    name === 'stroke'
  ) {
    svgColor(
      value,
      name,
    );
    return;
  }

  if (
    [
      'opacity',
      'fill-opacity',
      'stroke-opacity',
    ].includes(name)
  ) {
    svgNumber(
      value,
      name,
      {
        minimum: 0,
        maximum: 1,
      },
    );
    return;
  }

  if (
    name === 'stroke-width'
  ) {
    svgNumber(
      value,
      name,
      {
        minimum: 0,
        maximum: 256,
      },
    );
    return;
  }

  if (
    name ===
      'stroke-miterlimit'
  ) {
    svgNumber(
      value,
      name,
      {
        minimum: 0,
        maximum: 100,
      },
    );
    return;
  }

  if (
    name ===
      'stroke-linecap'
  ) {
    if (
      ![
        'butt',
        'round',
        'square',
      ].includes(value)
    ) {
      fail(
        'SVG stroke-linecap is unsupported',
      );
    }
    return;
  }

  if (
    name ===
      'stroke-linejoin'
  ) {
    if (
      ![
        'miter',
        'round',
        'bevel',
      ].includes(value)
    ) {
      fail(
        'SVG stroke-linejoin is unsupported',
      );
    }
    return;
  }

  if (
    name === 'fill-rule' ||
    name === 'clip-rule'
  ) {
    if (
      ![
        'nonzero',
        'evenodd',
      ].includes(value)
    ) {
      fail(
        'SVG fill rule is unsupported',
      );
    }
    return;
  }

  if (
    name === 'style'
  ) {
    validateSvgStyle(
      value,
    );
    return;
  }

  if (
    name === 'class'
  ) {
    if (
      value.length > 2048 ||
      !/^[A-Za-z_][A-Za-z0-9_-]*(?:\s+[A-Za-z_][A-Za-z0-9_-]*)*$/u
        .test(value)
    ) {
      fail(
        'SVG class is unsupported',
      );
    }
    return;
  }

  if (
    name === 'id'
  ) {
    if (
      value.length > 256 ||
      !/^[A-Za-z_][A-Za-z0-9_-]*$/u
        .test(value)
    ) {
      fail(
        'SVG id is unsupported',
      );
    }
    return;
  }

  if (
    name === 'type'
  ) {
    if (
      tag !== 'style' ||
      value !== 'text/css'
    ) {
      fail(
        'SVG style type is unsupported',
      );
    }
    return;
  }

  if (name === 'transform') {
    svgTransform(value);
    return;
  }

  if (name === 'd') {
    svgPath(value);
    return;
  }

  if (name === 'points') {
    svgPoints(value);
    return;
  }

  if (
    name === 'preserveAspectRatio'
  ) {
    if (
      !/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/u
        .test(value)
    ) {
      fail(
        'SVG preserveAspectRatio is unsupported',
      );
    }
    return;
  }

  if (name === 'xmlns') {
    if (
      tag !== 'svg' ||
      value !==
        'http://www.w3.org/2000/svg'
    ) {
      fail(
        'SVG namespace is invalid',
      );
    }
    return;
  }

  if (
    name === 'viewBox'
  ) {
    const parts =
      value
        .trim()
        .split(/\s+/u);
    if (parts.length !== 4) {
      fail(
        'SVG viewBox must contain four numbers',
      );
    }
    const numbers =
      parts.map(
        (part) =>
          svgNumber(
            part,
            'viewBox',
            {
              minimum:
                -POINT_TYPE_ICON_MAX_DIMENSION,
              maximum:
                POINT_TYPE_ICON_MAX_DIMENSION,
            },
          ),
      );
    if (
      numbers[2] <= 0 ||
      numbers[3] <= 0
    ) {
      fail(
        'SVG viewBox dimensions must be positive',
      );
    }
    return;
  }

  svgNumber(
    String(value)
      .replace(/px$/u, ''),
    name,
  );
}

function parseSvgAttributes(
  source,
  tag,
) {
  const attributes = new Map();
  let offset = 0;

  while (
    offset < source.length
  ) {
    while (
      /\s/u.test(
        source[offset] ?? '',
      )
    ) {
      offset += 1;
    }

    if (
      offset >= source.length
    ) {
      break;
    }

    const nameMatch =
      /^[A-Za-z][A-Za-z0-9-]*/u
        .exec(
          source.slice(offset),
        );

    if (!nameMatch) {
      fail(
        'SVG attribute syntax is invalid',
      );
    }

    const name =
      nameMatch[0];
    offset +=
      name.length;

    while (
      /\s/u.test(
        source[offset] ?? '',
      )
    ) {
      offset += 1;
    }

    if (
      source[offset] !== '='
    ) {
      fail(
        'SVG attributes must use quoted values',
      );
    }
    offset += 1;

    while (
      /\s/u.test(
        source[offset] ?? '',
      )
    ) {
      offset += 1;
    }

    const quote =
      source[offset];
    if (
      quote !== '"' &&
      quote !== "'"
    ) {
      fail(
        'SVG attributes must use quoted values',
      );
    }
    offset += 1;

    const end =
      source.indexOf(
        quote,
        offset,
      );

    if (end < 0) {
      fail(
        'SVG attribute value is unterminated',
      );
    }

    const value =
      source.slice(
        offset,
        end,
      );

    if (
      /[<>&]/u.test(value)
    ) {
      fail(
        'SVG entities and markup inside attributes are not allowed',
      );
    }

    if (
      attributes.has(name)
    ) {
      fail(
        'SVG contains a duplicate attribute: ' +
        name,
      );
    }

    validateSvgAttribute(
      tag,
      name,
      value,
    );

    attributes.set(
      name,
      value,
    );
    offset =
      end + 1;
  }

  return attributes;
}

function svgTagEnd(
  text,
  start,
) {
  let quote = null;

  for (
    let index =
      start + 1;
    index < text.length;
    index += 1
  ) {
    const character =
      text[index];

    if (quote) {
      if (
        character === quote
      ) {
        quote = null;
      }
      continue;
    }

    if (
      character === '"' ||
      character === "'"
    ) {
      quote = character;
      continue;
    }

    if (character === '<') {
      fail(
        'SVG tag syntax is invalid',
      );
    }

    if (character === '>') {
      return index;
    }
  }

  fail(
    'SVG tag is unterminated',
  );
}

function escapeXmlAttribute(
  value,
) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function sanitizeSvg(data) {
  let text;
  try {
    text =
      new TextDecoder(
        'utf-8',
        {
          fatal: true,
        },
      ).decode(data);
  } catch {
    fail(
      'SVG must be valid UTF-8',
    );
  }

  text =
    text
      .replace(/^\uFEFF/u, '')
      .trim();

  if (
    !text.startsWith('<svg') ||
    /<!|<\?|&/u.test(text)
  ) {
    fail(
      'SVG declarations, entities, comments and active XML features are not allowed',
    );
  }

  const stack = [];
  const output = [];
  let offset = 0;
  let elements = 0;
  let rootAttributes = null;

  while (
    offset < text.length
  ) {
    if (
      stack.at(-1) ===
        'style' &&
      !text.startsWith(
        '</style>',
        offset,
      )
    ) {
      const closing =
        text.indexOf(
          '</style>',
          offset,
        );

      if (closing < 0) {
        fail(
          'SVG style element is unterminated',
        );
      }

      output.push(
        sanitizeSvgStyleSheet(
          text.slice(
            offset,
            closing,
          ),
        ),
      );

      offset =
        closing;
      continue;
    }

    if (
      /\s/u.test(
        text[offset],
      )
    ) {
      offset += 1;
      continue;
    }

    if (
      text[offset] !== '<'
    ) {
      fail(
        'SVG text content is not supported',
      );
    }

    const end =
      svgTagEnd(
        text,
        offset,
      );
    let token =
      text
        .slice(
          offset + 1,
          end,
        )
        .trim();

    if (
      token.startsWith('/')
    ) {
      const name =
        token
          .slice(1)
          .trim();

      if (
        !/^[a-z][a-z0-9-]*$/u
          .test(name) ||
        stack.at(-1) !==
          name
      ) {
        fail(
          'SVG closing tag is invalid',
        );
      }

      stack.pop();
      output.push(
        '</' +
        name +
        '>',
      );
      offset =
        end + 1;
      continue;
    }

    let selfClosing = false;
    if (
      token.endsWith('/')
    ) {
      selfClosing = true;
      token =
        token
          .slice(0, -1)
          .trimEnd();
    }

    const match =
      /^([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/u
        .exec(token);

    if (!match) {
      fail(
        'SVG opening tag is invalid',
      );
    }

    const tag =
      match[1];

    if (
      !SVG_TAGS.has(tag)
    ) {
      fail(
        'SVG element is not allowed: ' +
        tag,
      );
    }

    if (
      elements === 0 &&
      tag !== 'svg'
    ) {
      fail(
        'SVG root element must be svg',
      );
    }

    if (
      elements > 0 &&
      stack.length === 0
    ) {
      fail(
        'SVG must contain exactly one root element',
      );
    }

    if (
      elements > 0 &&
      tag === 'svg'
    ) {
      fail(
        'Nested svg elements are not supported',
      );
    }

    elements += 1;
    if (
      elements >
      POINT_TYPE_ICON_MAX_SVG_ELEMENTS
    ) {
      fail(
        'SVG contains too many elements',
      );
    }

    const attributes =
      parseSvgAttributes(
        match[2] ?? '',
        tag,
      );

    if (
      elements === 1
    ) {
      if (
        !attributes.has(
          'xmlns',
        )
      ) {
        attributes.set(
          'xmlns',
          'http://www.w3.org/2000/svg',
        );
      }

      rootAttributes =
        attributes;
    }

    const renderedAttributes =
      [
        ...attributes.entries(),
      ]
        .sort(
          ([left], [right]) =>
            left.localeCompare(
              right,
              'en',
            ),
        )
        .map(
          ([name, value]) =>
            ' ' +
            name +
            '="' +
            escapeXmlAttribute(
              value,
            ) +
            '"',
        )
        .join('');

    if (selfClosing) {
      output.push(
        '<' +
        tag +
        renderedAttributes +
        '/>',
      );
    } else {
      stack.push(tag);
      if (
        stack.length >
        POINT_TYPE_ICON_MAX_SVG_DEPTH
      ) {
        fail(
          'SVG nesting is too deep',
        );
      }
      output.push(
        '<' +
        tag +
        renderedAttributes +
        '>',
      );
    }

    offset =
      end + 1;
  }

  if (
    elements === 0 ||
    stack.length !== 0 ||
    !rootAttributes
  ) {
    fail(
      'SVG document is incomplete',
    );
  }

  const viewBox =
    rootAttributes
      .get('viewBox');
  const viewBoxParts =
    viewBox
      ? viewBox
          .trim()
          .split(/\s+/u)
          .map(Number)
      : null;

  let width =
    rootAttributes
      .has('width')
      ? svgIntegerDimension(
        rootAttributes
          .get('width'),
        'width',
      )
      : null;
  let height =
    rootAttributes
      .has('height')
      ? svgIntegerDimension(
        rootAttributes
          .get('height'),
        'height',
      )
      : null;

  if (
    width === null ||
    height === null
  ) {
    if (
      !viewBoxParts ||
      viewBoxParts.length !== 4 ||
      !Number.isInteger(
        viewBoxParts[2],
      ) ||
      !Number.isInteger(
        viewBoxParts[3],
      )
    ) {
      fail(
        'SVG needs integer width/height or an integer-sized viewBox',
      );
    }
    width ??=
      viewBoxParts[2];
    height ??=
      viewBoxParts[3];
  }

  dimensions(
    width,
    height,
    'SVG',
  );

  const canonical =
    Buffer.from(
      output.join(''),
      'utf8',
    );

  return {
    data: canonical,
    mime: 'image/svg+xml',
    width,
    height,
  };
}

function detectedMime(data) {
  if (
    data.length >= 8 &&
    data
      .subarray(0, 8)
      .equals(PNG_SIGNATURE)
  ) {
    return 'image/png';
  }

  if (
    data.length >= 6 &&
    (
      data
        .subarray(0, 6)
        .equals(GIF_87A) ||
      data
        .subarray(0, 6)
        .equals(GIF_89A)
    )
  ) {
    return 'image/gif';
  }

  return 'image/svg+xml';
}

function declaredMime(
  contentType,
) {
  const mime =
    String(
      contentType ?? '',
    )
      .split(';', 1)[0]
      .trim()
      .toLocaleLowerCase(
        'en-US',
      );

  if (!mime) {
    return null;
  }

  if (
    !ALLOWED_DECLARED_TYPES
      .has(mime)
  ) {
    fail(
      'Point type icon Content-Type is unsupported',
    );
  }

  return mime;
}

export function sanitizePointTypeIcon(
  input,
  contentType,
) {
  const source =
    asBuffer(input);
  const actualMime =
    detectedMime(source);
  const declared =
    declaredMime(
      contentType,
    );

  if (
    declared &&
    declared !==
      'application/octet-stream' &&
    declared !==
      actualMime
  ) {
    fail(
      'Point type icon Content-Type does not match its content',
    );
  }

  const sanitized =
    actualMime === 'image/png'
      ? sanitizePng(source)
      : (
          actualMime ===
            'image/gif'
            ? sanitizeGif(source)
            : sanitizeSvg(source)
        );

  const sha256 =
    crypto
      .createHash('sha256')
      .update(
        sanitized.data,
      )
      .digest('hex');

  return {
    ...sanitized,
    sha256,
    extension:
      MIME_TO_EXTENSION[
        sanitized.mime
      ],
  };
}

export function pointTypeIconFileName(
  pointTypeId,
  icon,
) {
  const id =
    Number(pointTypeId);
  if (
    !Number.isSafeInteger(id) ||
    id <= 0
  ) {
    fail(
      'Point type id must be a positive integer',
    );
  }

  if (
    !/^[0-9a-f]{64}$/u
      .test(
        icon?.sha256 ??
        '',
      ) ||
    !Object.values(
      MIME_TO_EXTENSION,
    ).includes(
      icon?.extension,
    )
  ) {
    fail(
      'Point type icon metadata is invalid',
    );
  }

  return (
    id +
    '-' +
    icon.sha256 +
    '.' +
    icon.extension
  );
}

export function isPointTypeIconFileName(
  value,
) {
  return /^\d+-[0-9a-f]{64}\.(?:png|gif|svg)$/u
    .test(
      String(
        value ?? '',
      ),
    );
}
