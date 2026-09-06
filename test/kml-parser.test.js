import assert from 'node:assert/strict';
import test from 'node:test';
import { parseKmlSource } from '../src/data/kml-parser.js';

const source = {
  URL: 'https://www.google.com/maps/d/viewer?mid=test',
  mapId: 'test',
  layers: [
    { name: 'Двусторонние', multiple: 2, type: 'Двусторонние' },
    { name: 'Односторонние', multiple: 1, type: 'Односторонние' },
  ],
};

const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Тестовая карта</name>
    <Folder>
      <name>Двусторонние</name>
      <Placemark>
        <name>Проспект</name>
        <LineString><coordinates>49.1,55.7,0 49.2,55.8,0</coordinates></LineString>
      </Placemark>
      <Placemark>
        <name>Не линия</name>
        <Point><coordinates>49.1,55.7,0</coordinates></Point>
      </Placemark>
    </Folder>
    <Folder>
      <name>Односторонние</name>
      <Placemark>
        <name>Две части</name>
        <MultiGeometry>
          <LineString><coordinates>30,60 30.1,60.1</coordinates></LineString>
          <LineString><coordinates>30.2,60.2 30.3,60.3</coordinates></LineString>
        </MultiGeometry>
      </Placemark>
    </Folder>
    <Folder>
      <name>Не выбран</name>
      <Placemark><LineString><coordinates>1,1 2,2</coordinates></LineString></Placemark>
    </Folder>
  </Document>
</kml>`;

test('KML parser keeps geometry type separate from imported business type name', () => {
  const result = parseKmlSource(kml, source);

  assert.equal(result.documentName, 'Тестовая карта');
  assert.equal(result.selectedPlacemarks, 3);
  assert.equal(result.ignoredNonLines, 1);
  assert.equal(result.features.length, 2);
  assert.equal(result.features[0].multiple, 2);
  assert.equal(result.features[0].businessTypeName, 'Двусторонние');
  assert.equal(result.features[0].properties.placemarkName, 'Проспект');
  assert.equal('businessTypeName' in result.features[0].properties, false);
  assert.equal(result.features[0].geometry.type, 'LineString');
  assert.equal(result.features[1].multiple, 1);
  assert.equal(result.features[1].businessTypeName, 'Односторонние');
  assert.equal(result.features[1].properties.placemarkName, 'Две части');
  assert.equal(result.features[1].geometry.type, 'MultiLineString');
  assert.equal(result.features[1].geometry.coordinates.length, 2);
  assert.equal(result.features[0].fingerprint.length, 64);
});

test('KML parser rejects missing layers, entities, and invalid coordinates', () => {
  assert.throws(
    () => parseKmlSource(kml, {
      ...source,
      layers: [{ name: 'Нет слоя', multiple: 1, type: 'default' }],
    }),
    /layer not found/,
  );
  assert.throws(
    () => parseKmlSource('<!DOCTYPE kml><kml/>', source),
    /declarations are not allowed/,
  );
  assert.throws(
    () => parseKmlSource(kml.replace('49.1,55.7,0', '500,55.7,0'), source),
    /outside WGS84/,
  );
});
