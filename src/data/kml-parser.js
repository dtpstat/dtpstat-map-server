import crypto from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { KmlUpdateValidationError } from './kml-update-options.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  processEntities: false,
  removeNSPrefix: true,
  trimValues: false,
});

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
  if (value && typeof value === 'object' && '#text' in value) {
    return textValue(value['#text']);
  }
  return '';
}

/** @param {unknown} node @param {unknown[]} output */
function collectLineStringNodes(node, output) {
  if (!node || typeof node !== 'object') return;
  for (const lineString of asArray(node.LineString)) {
    output.push(lineString);
  }
  for (const multiGeometry of asArray(node.MultiGeometry)) {
    collectLineStringNodes(multiGeometry, output);
  }
}

/** @param {unknown} value @param {string} label */
function parseCoordinates(value, label) {
  const raw = textValue(value);
  if (!raw) {
    throw new KmlUpdateValidationError(`${label} has empty coordinates`);
  }
  const coordinates = raw.split(/\s+/).map((token) => {
    const parts = token.split(',');
    const longitude = Number(parts[0]);
    const latitude = Number(parts[1]);
    if (
      parts.length < 2 ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90
    ) {
      throw new KmlUpdateValidationError(
        `${label} contains coordinates outside WGS84`,
      );
    }
    return [longitude, latitude];
  });
  if (coordinates.length < 2) {
    throw new KmlUpdateValidationError(`${label} must contain at least two points`);
  }
  return coordinates;
}

/** @param {number[][]} line */
function canonicalLine(line) {
  const forward = JSON.stringify(line);
  const reverse = JSON.stringify([...line].reverse());
  return forward <= reverse ? forward : reverse;
}

/** @param {{ type: string, coordinates: any }} geometry */
function geometryFingerprint(geometry) {
  const lines = geometry.type === 'LineString'
    ? [canonicalLine(geometry.coordinates)]
    : geometry.coordinates.map(canonicalLine).sort();
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(lines))
    .digest('hex');
}

/**
 * @param {string} xml
 * @param {{ URL: string, mapId: string | null, layers: Array<{ name: string, multiple: number, type: string }> }} source
 */
export function parseKmlSource(xml, source) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new KmlUpdateValidationError('KML document type declarations are not allowed');
  }
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new KmlUpdateValidationError(
      `KML is not valid XML: ${validation.err.msg}`,
    );
  }

  let document;
  try {
    const parsed = parser.parse(xml);
    document = parsed?.kml?.Document;
  } catch (error) {
    throw new KmlUpdateValidationError(
      `Cannot parse KML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!document || typeof document !== 'object') {
    throw new KmlUpdateValidationError('XML document does not contain kml/Document');
  }

  const configuredLayers = new Map(
    source.layers.map((layer) => [layer.name, layer]),
  );
  const foundLayers = new Set();
  const layerLineCounts = new Map(source.layers.map((layer) => [layer.name, 0]));
  const features = [];
  let selectedPlacemarks = 0;
  let ignoredNonLines = 0;
  const documentName = textValue(document.name);

  function walkFolders(folders) {
    for (const folder of asArray(folders)) {
      if (!folder || typeof folder !== 'object') continue;
      const layerName = textValue(folder.name);
      const layer = configuredLayers.get(layerName);
      if (layer) {
        foundLayers.add(layerName);
        for (const [placemarkIndex, placemark] of asArray(folder.Placemark).entries()) {
          selectedPlacemarks += 1;
          const lineNodes = [];
          collectLineStringNodes(placemark, lineNodes);
          if (lineNodes.length === 0) {
            ignoredNonLines += 1;
            continue;
          }
          const placemarkName = textValue(placemark?.name);
          const lines = lineNodes.map((lineNode, lineIndex) =>
            parseCoordinates(
              lineNode?.coordinates,
              `${layerName}/${placemarkName || placemarkIndex}/LineString ${lineIndex}`,
            ),
          );
          const geometry = lines.length === 1
            ? { type: 'LineString', coordinates: lines[0] }
            : { type: 'MultiLineString', coordinates: lines };
          const fingerprint = geometryFingerprint(geometry);
          features.push({
            geometry,
            multiple: layer.multiple,
            lineType: layer.type,
            fingerprint,
            properties: {
              source: 'kml',
              sourceURL: source.URL,
              sourceMapId: source.mapId,
              documentName,
              layer: layerName,
              placemarkName: placemarkName || null,
              multiple: layer.multiple,
              fingerprint,
            },
          });
          layerLineCounts.set(layerName, layerLineCounts.get(layerName) + 1);
        }
      }
      walkFolders(folder.Folder);
    }
  }

  walkFolders(document.Folder);
  for (const layer of source.layers) {
    if (!foundLayers.has(layer.name)) {
      throw new KmlUpdateValidationError(
        `Configured KML layer not found: ${layer.name}`,
      );
    }
    if (layerLineCounts.get(layer.name) === 0) {
      throw new KmlUpdateValidationError(
        `Configured KML layer contains no lines: ${layer.name}`,
      );
    }
  }

  return {
    documentName,
    features,
    selectedPlacemarks,
    ignoredNonLines,
  };
}
