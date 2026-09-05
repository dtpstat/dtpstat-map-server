import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  buildLineTypesPlan,
  LineTypeValidationError,
  normalizeLineTypeCode,
} from './line-types.js';

export const KML_TRANSFER_SCHEMA_VERSION = 1;
export const KML_BUSINESS_TYPES_PROPERTY = 'dtpstat.businessLineTypes';

const parser = new XMLParser({
  cdataPropName: '#cdata',
  ignoreAttributes: false,
  parseTagValue: false,
  processEntities: false,
  removeNSPrefix: true,
  trimValues: false,
});

export class KmlTransferValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KmlTransferValidationError';
  }
}

/** @param {unknown} value */
function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** @param {unknown} value */
function textValue(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim().normalize('NFC');
  }
  if (value && typeof value === 'object') {
    if ('#cdata' in value) return textValue(value['#cdata']);
    if ('#text' in value) return textValue(value['#text']);
  }
  return '';
}

/** @param {unknown} extendedData */
function extendedDataMap(extendedData) {
  const values = new Map();
  for (const entry of asArray(extendedData?.Data)) {
    if (!entry || typeof entry !== 'object') continue;
    const name = textValue(entry['@_name']);
    if (!name || values.has(name)) continue;
    values.set(name, textValue(entry.value));
  }
  return values;
}

/** @param {string} text */
function escapeXml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** @param {unknown} value */
function cdata(value) {
  return `<![CDATA[${String(value).replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
}

/** @param {string} name @param {unknown} value */
function dataElement(name, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<Data name="${escapeXml(name)}"><value>${cdata(value)}</value></Data>`;
}

/** @param {string} color */
function kmlColor(color) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) return 'ff695b04';
  return `ff${match[3]}${match[2]}${match[1]}`.toLowerCase();
}

/** @param {unknown} position */
function coordinateText(position) {
  if (!Array.isArray(position) || position.length < 2) {
    throw new KmlTransferValidationError('KML export contains an invalid coordinate');
  }
  const longitude = Number(position[0]);
  const latitude = Number(position[1]);
  const altitude = position.length > 2 && Number.isFinite(Number(position[2]))
    ? Number(position[2])
    : 0;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new KmlTransferValidationError('KML export contains a non-numeric coordinate');
  }
  return `${longitude},${latitude},${altitude}`;
}

/** @param {number[][]} line */
function lineStringXml(line) {
  if (!Array.isArray(line) || line.length < 2) {
    throw new KmlTransferValidationError('KML export line must contain at least two points');
  }
  return `<LineString><tessellate>1</tessellate><coordinates>${line.map(coordinateText).join(' ')}</coordinates></LineString>`;
}

/** @param {{ type: string, coordinates: any }} geometry */
function geometryXml(geometry) {
  if (geometry?.type === 'LineString') {
    return lineStringXml(geometry.coordinates);
  }
  if (geometry?.type === 'MultiLineString') {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
      throw new KmlTransferValidationError('KML export MultiLineString is empty');
    }
    return `<MultiGeometry>${geometry.coordinates.map(lineStringXml).join('')}</MultiGeometry>`;
  }
  throw new KmlTransferValidationError(
    `Unsupported geometry type for KML export: ${geometry?.type ?? 'missing'}`,
  );
}

/** @param {Record<string, unknown>} properties */
function exportedSourceProperties(properties) {
  const output = { ...properties };
  for (const key of [
    'short_name',
    'name',
    'lanes',
    'length',
    'lanes_length',
    '_dtpstat',
    'lineType',
  ]) {
    delete output[key];
  }
  return output;
}

/**
 * Serialize the canonical line GeoJSON snapshot as portable KML.
 * Geometry type and business line type are deliberately separate concepts:
 * geometry is encoded with KML LineString/MultiGeometry, while the business
 * category is stored only as dtpstat.businessTypeCode.
 *
 * @param {any} collection
 */
export function serializeLinesKml(collection) {
  if (
    !collection ||
    collection.type !== 'FeatureCollection' ||
    !Array.isArray(collection.lineTypes) ||
    !Array.isArray(collection.features)
  ) {
    throw new KmlTransferValidationError('Line KML export requires canonical GeoJSON v2');
  }

  let lineTypes;
  try {
    lineTypes = buildLineTypesPlan({ lineTypes: collection.lineTypes }).lineTypes;
  } catch (error) {
    if (error instanceof LineTypeValidationError) {
      throw new KmlTransferValidationError(error.message);
    }
    throw error;
  }

  const dictionary = {
    schemaVersion: KML_TRANSFER_SCHEMA_VERSION,
    lineTypes: lineTypes.map(({ type, ...lineType }) => ({
      code: type,
      ...lineType,
    })),
  };
  const knownCodes = new Set(lineTypes.map((lineType) => lineType.type));
  const styleIds = new Map(
    lineTypes.map((lineType, index) => [lineType.type, `dtpstat-business-type-${index + 1}`]),
  );

  const stylesXml = lineTypes.map((lineType) => `
    <Style id="${styleIds.get(lineType.type)}">
      <LineStyle>
        <color>${kmlColor(lineType.color)}</color>
        <width>${lineType.width}</width>
      </LineStyle>
    </Style>`).join('');

  const placemarksXml = collection.features.map((feature, index) => {
    if (!feature || feature.type !== 'Feature' || !feature.properties) {
      throw new KmlTransferValidationError(`KML export feature ${index} is invalid`);
    }
    let businessTypeCode;
    try {
      businessTypeCode = normalizeLineTypeCode(
        feature.properties._dtpstat?.lineType,
        `feature ${index} businessTypeCode`,
      );
    } catch (error) {
      if (error instanceof LineTypeValidationError) {
        throw new KmlTransferValidationError(error.message);
      }
      throw error;
    }
    if (!knownCodes.has(businessTypeCode)) {
      throw new KmlTransferValidationError(
        `KML export feature ${index} references unknown business type code: ${businessTypeCode}`,
      );
    }
    const multiple = Number(feature.properties.lanes);
    if (multiple !== 1 && multiple !== 2) {
      throw new KmlTransferValidationError(
        `KML export feature ${index} has invalid multiple: ${feature.properties.lanes}`,
      );
    }

    const metadata = feature.properties._dtpstat ?? {};
    const sourceProperties = exportedSourceProperties(feature.properties);
    const placemarkName = sourceProperties.placemarkName
      ?? feature.properties.short_name
      ?? `Линия ${index + 1}`;
    const extended = [
      dataElement('dtpstat.businessTypeCode', businessTypeCode),
      dataElement('dtpstat.multiple', multiple),
      dataElement('dtpstat.citySlug', metadata.citySlug),
      dataElement('dtpstat.cityName', feature.properties.short_name),
      dataElement('dtpstat.cityFullName', feature.properties.name),
      dataElement('dtpstat.boundaryOsmType', metadata.boundaryOsmType),
      dataElement('dtpstat.boundaryOsmId', metadata.boundaryOsmId),
      Object.keys(sourceProperties).length > 0
        ? dataElement('dtpstat.properties', JSON.stringify(sourceProperties))
        : '',
    ].join('');

    return `
    <Placemark>
      <name>${escapeXml(placemarkName)}</name>
      <styleUrl>#${styleIds.get(businessTypeCode)}</styleUrl>
      <ExtendedData>${extended}</ExtendedData>
      ${geometryXml(feature.geometry)}
    </Placemark>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>dtpstat-buslines-lines</name>
    <ExtendedData>
      ${dataElement('dtpstat.schemaVersion', KML_TRANSFER_SCHEMA_VERSION)}
      ${dataElement(KML_BUSINESS_TYPES_PROPERTY, JSON.stringify(dictionary))}
    </ExtendedData>${stylesXml}${placemarksXml}
  </Document>
</kml>\n`;
}

/** @param {unknown} value @param {string} label */
function parseJsonObject(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    throw new KmlTransferValidationError(`${label} must contain valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new KmlTransferValidationError(`${label} must contain a JSON object`);
  }
  return parsed;
}

/** @param {unknown} value @param {string} label */
function parseCoordinates(value, label) {
  const raw = textValue(value);
  if (!raw) throw new KmlTransferValidationError(`${label} has empty coordinates`);
  const coordinates = raw.split(/\s+/).map((token) => {
    const parts = token.split(',');
    const longitude = Number(parts[0]);
    const latitude = Number(parts[1]);
    if (
      parts.length < 2 ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      longitude < -180 || longitude > 180 ||
      latitude < -90 || latitude > 90
    ) {
      throw new KmlTransferValidationError(`${label} contains coordinates outside WGS84`);
    }
    return [longitude, latitude];
  });
  if (coordinates.length < 2) {
    throw new KmlTransferValidationError(`${label} must contain at least two points`);
  }
  return coordinates;
}

/** @param {unknown} node @param {unknown[]} output */
function collectLineStrings(node, output) {
  if (!node || typeof node !== 'object') return;
  for (const lineString of asArray(node.LineString)) output.push(lineString);
  for (const multiGeometry of asArray(node.MultiGeometry)) {
    collectLineStrings(multiGeometry, output);
  }
}

/** @param {unknown} node @param {unknown[]} output */
function collectPlacemarks(node, output) {
  if (!node || typeof node !== 'object') return;
  output.push(...asArray(node.Placemark));
  for (const folder of asArray(node.Folder)) collectPlacemarks(folder, output);
}

/**
 * Parse a portable KML snapshot into the canonical GeoJSON v2 transfer shape.
 * The document-level business type/style dictionary is validated completely
 * before any Placemark geometry is processed.
 *
 * @param {string} xml
 */
export function parseLinesKml(xml) {
  if (typeof xml !== 'string' || !xml.trim()) {
    throw new KmlTransferValidationError('KML upload is empty');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new KmlTransferValidationError('KML document type declarations are not allowed');
  }
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new KmlTransferValidationError(`KML is not valid XML: ${validation.err.msg}`);
  }

  let document;
  try {
    document = parser.parse(xml)?.kml?.Document;
  } catch (error) {
    throw new KmlTransferValidationError(
      `Cannot parse KML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!document || typeof document !== 'object') {
    throw new KmlTransferValidationError('KML does not contain kml/Document');
  }

  // Business metadata is deliberately parsed first. No geometry is inspected
  // until the complete type/style dictionary has passed validation.
  const documentData = extendedDataMap(document.ExtendedData);
  const rawDictionary = documentData.get(KML_BUSINESS_TYPES_PROPERTY);
  if (!rawDictionary) {
    throw new KmlTransferValidationError(
      `Portable KML is missing ${KML_BUSINESS_TYPES_PROPERTY}`,
    );
  }
  const dictionary = parseJsonObject(rawDictionary, KML_BUSINESS_TYPES_PROPERTY);
  if (Number(dictionary.schemaVersion) !== KML_TRANSFER_SCHEMA_VERSION) {
    throw new KmlTransferValidationError(
      `Unsupported KML transfer schemaVersion: ${dictionary.schemaVersion}`,
    );
  }
  if (!Array.isArray(dictionary.lineTypes) || dictionary.lineTypes.length === 0) {
    throw new KmlTransferValidationError('KML business line type dictionary is empty');
  }

  let lineTypes;
  try {
    lineTypes = buildLineTypesPlan({
      lineTypes: dictionary.lineTypes.map((lineType, index) => {
        if (!lineType || typeof lineType !== 'object' || Array.isArray(lineType)) {
          throw new LineTypeValidationError(`lineTypes[${index}] must be an object`);
        }
        const { code, ...style } = lineType;
        return { type: code, ...style };
      }),
    }).lineTypes;
  } catch (error) {
    if (error instanceof LineTypeValidationError) {
      throw new KmlTransferValidationError(error.message);
    }
    throw error;
  }
  const knownCodes = new Set(lineTypes.map((lineType) => lineType.type));

  const placemarks = [];
  collectPlacemarks(document, placemarks);
  if (placemarks.length === 0) {
    throw new KmlTransferValidationError('Portable KML contains no Placemarks');
  }

  const features = placemarks.map((placemark, index) => {
    const data = extendedDataMap(placemark?.ExtendedData);
    const rawBusinessTypeCode = data.get('dtpstat.businessTypeCode');
    if (!rawBusinessTypeCode) {
      throw new KmlTransferValidationError(
        `Placemark ${index} is missing dtpstat.businessTypeCode`,
      );
    }
    let businessTypeCode;
    try {
      businessTypeCode = normalizeLineTypeCode(
        rawBusinessTypeCode,
        `Placemark ${index} businessTypeCode`,
      );
    } catch (error) {
      if (error instanceof LineTypeValidationError) {
        throw new KmlTransferValidationError(error.message);
      }
      throw error;
    }
    if (!knownCodes.has(businessTypeCode)) {
      throw new KmlTransferValidationError(
        `Placemark ${index} references unknown business type code: ${businessTypeCode}`,
      );
    }
    const multiple = Number(data.get('dtpstat.multiple'));
    if (multiple !== 1 && multiple !== 2) {
      throw new KmlTransferValidationError(
        `Placemark ${index} dtpstat.multiple must equal 1 or 2`,
      );
    }

    const lineNodes = [];
    collectLineStrings(placemark, lineNodes);
    if (lineNodes.length === 0) {
      throw new KmlTransferValidationError(`Placemark ${index} contains no line geometry`);
    }
    const lines = lineNodes.map((lineNode, lineIndex) =>
      parseCoordinates(
        lineNode?.coordinates,
        `Placemark ${index} LineString ${lineIndex}`,
      ));
    const geometry = lines.length === 1
      ? { type: 'LineString', coordinates: lines[0] }
      : { type: 'MultiLineString', coordinates: lines };

    let sourceProperties = {};
    const rawProperties = data.get('dtpstat.properties');
    if (rawProperties) {
      sourceProperties = parseJsonObject(rawProperties, `Placemark ${index} dtpstat.properties`);
      delete sourceProperties.lineType;
      delete sourceProperties._dtpstat;
    }

    const cityName = data.get('dtpstat.cityName') || null;
    const cityFullName = data.get('dtpstat.cityFullName') || cityName;
    const citySlug = data.get('dtpstat.citySlug') || null;
    const boundaryOsmType = data.get('dtpstat.boundaryOsmType') || null;
    const boundaryOsmIdRaw = data.get('dtpstat.boundaryOsmId') || null;
    const boundaryOsmId = boundaryOsmIdRaw === null ? null : Number(boundaryOsmIdRaw);

    return {
      type: 'Feature',
      geometry,
      properties: {
        ...sourceProperties,
        ...(cityName ? { short_name: cityName } : {}),
        ...(cityFullName ? { name: cityFullName } : {}),
        lanes: multiple,
        _dtpstat: {
          ...(citySlug ? { citySlug } : {}),
          ...(boundaryOsmType ? { boundaryOsmType } : {}),
          ...(boundaryOsmId !== null ? { boundaryOsmId } : {}),
          // Adapter field for the existing canonical GeoJSON import plan only.
          // It is converted to LINE_TYPE_ID and is not stored in properties.
          lineType: businessTypeCode,
        },
      },
    };
  });

  return {
    type: 'FeatureCollection',
    schemaVersion: 2,
    lineTypes,
    features,
  };
}
