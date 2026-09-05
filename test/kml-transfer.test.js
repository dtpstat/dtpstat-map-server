import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KML_BUSINESS_TYPES_PROPERTY,
  KmlTransferValidationError,
  parseLinesKml,
  serializeLinesKml,
} from '../src/data/kml-transfer.js';

const snapshot = {
  type: 'FeatureCollection',
  schemaVersion: 2,
  lineTypes: [
    {
      type: 'default',
      name: 'Обычные',
      color: '#045b69',
      style: 'solid',
      width: 4,
    },
    {
      type: 'one-way',
      name: 'Односторонние',
      color: '#cc4400',
      style: 'dashed',
      width: 5.5,
    },
  ],
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[30, 60], [30.1, 60.1]],
      },
      properties: {
        short_name: 'Тестоград',
        name: 'Тестоград',
        lanes: 1,
        placemarkName: 'Улица 1',
        _dtpstat: {
          citySlug: 'testograd',
          boundaryOsmType: 'relation',
          boundaryOsmId: 123,
          lineType: 'one-way',
        },
      },
    },
    {
      type: 'Feature',
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [[31, 61], [31.1, 61.1]],
          [[31.2, 61.2], [31.3, 61.3]],
        ],
      },
      properties: {
        short_name: 'Другоград',
        name: 'Другоград',
        lanes: 2,
        _dtpstat: {
          citySlug: 'drugograd',
          boundaryOsmType: 'way',
          boundaryOsmId: 456,
          lineType: 'default',
        },
      },
    },
  ],
};

test('portable KML keeps geometry type separate from business line type code', () => {
  const xml = serializeLinesKml(snapshot);

  assert.match(xml, new RegExp(KML_BUSINESS_TYPES_PROPERTY.replace('.', '\\.')));
  assert.ok(xml.indexOf(KML_BUSINESS_TYPES_PROPERTY) < xml.indexOf('<Placemark>'));
  assert.match(xml, /dtpstat\.businessTypeCode/);
  assert.match(xml, /<LineString>/);
  assert.match(xml, /<MultiGeometry>/);

  const parsed = parseLinesKml(xml);
  assert.deepEqual(parsed.lineTypes, snapshot.lineTypes);
  assert.equal(parsed.features[0].geometry.type, 'LineString');
  assert.equal(parsed.features[0].properties._dtpstat.lineType, 'one-way');
  assert.equal(parsed.features[0].properties.lanes, 1);
  assert.equal(parsed.features[1].geometry.type, 'MultiLineString');
  assert.equal(parsed.features[1].properties._dtpstat.lineType, 'default');
  assert.equal(parsed.features[1].properties.lanes, 2);
});

test('portable KML validates the complete business type/style dictionary before geometry', () => {
  const invalidDictionary = JSON.stringify({
    schemaVersion: 1,
    lineTypes: [
      { code: 'default', name: 'Обычные', color: '#045b69', style: 'zigzag', width: 4 },
    ],
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <ExtendedData>
      <Data name="dtpstat.businessLineTypes"><value>${invalidDictionary}</value></Data>
    </ExtendedData>
    <Placemark>
      <ExtendedData>
        <Data name="dtpstat.businessTypeCode"><value>missing</value></Data>
        <Data name="dtpstat.multiple"><value>1</value></Data>
      </ExtendedData>
      <LineString><coordinates>not-a-coordinate</coordinates></LineString>
    </Placemark>
  </Document>
</kml>`;

  assert.throws(
    () => parseLinesKml(xml),
    (error) =>
      error instanceof KmlTransferValidationError &&
      /style.*must be one of/i.test(error.message),
  );
});

test('portable KML rejects a Placemark that references a business code outside the dictionary', () => {
  const xml = serializeLinesKml(snapshot)
    .replace(
      '<value>one-way</value>',
      '<value>unknown-code</value>',
    );

  assert.throws(
    () => parseLinesKml(xml),
    /unknown business type code: unknown-code/,
  );
});
