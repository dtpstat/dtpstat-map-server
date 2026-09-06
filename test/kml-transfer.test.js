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
  schemaVersion: 3,
  lineTypes: [
    {
      code: 0,
      name: 'default',
      title: 'Обычные',
      color: '#045b69',
      style: 'solid',
      width: 4,
    },
    {
      code: 7,
      name: 'Односторонние',
      title: 'Односторонние полосы',
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
          businessTypeCode: 7,
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
          businessTypeCode: 0,
        },
      },
    },
  ],
};

test('portable KML keeps geometry type, source name and numeric business type code', () => {
  const xml = serializeLinesKml(snapshot);

  assert.match(xml, new RegExp(KML_BUSINESS_TYPES_PROPERTY.replace('.', '\\.')));
  assert.ok(xml.indexOf(KML_BUSINESS_TYPES_PROPERTY) < xml.indexOf('<Placemark>'));
  assert.match(xml, /dtpstat\.businessTypeCode/);
  assert.match(xml, /<name>Улица 1<\/name>/);
  assert.match(xml, /<LineString>/);
  assert.match(xml, /<MultiGeometry>/);

  const parsed = parseLinesKml(xml);
  assert.deepEqual(parsed.lineTypes, snapshot.lineTypes);
  assert.equal(parsed.schemaVersion, 3);
  assert.equal(parsed.features[0].geometry.type, 'LineString');
  assert.equal(parsed.features[0].properties._dtpstat.businessTypeCode, 7);
  assert.equal(parsed.features[0].properties.lanes, 1);
  assert.equal(parsed.features[0].properties.placemarkName, 'Улица 1');
  assert.equal(parsed.features[1].geometry.type, 'MultiLineString');
  assert.equal(parsed.features[1].properties._dtpstat.businessTypeCode, 0);
  assert.equal(parsed.features[1].properties.lanes, 2);
});

test('portable KML validates the complete business type/style dictionary before geometry', () => {
  const invalidDictionary = JSON.stringify({
    schemaVersion: 2,
    lineTypes: [
      {
        code: 0,
        name: 'default',
        title: 'Обычные',
        color: '#045b69',
        style: 'zigzag',
        width: 4,
      },
    ],
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <ExtendedData>
      <Data name="dtpstat.businessLineTypes"><value><![CDATA[${invalidDictionary}]]></value></Data>
    </ExtendedData>
    <Placemark>
      <ExtendedData>
        <Data name="dtpstat.businessTypeCode"><value><![CDATA[99]]></value></Data>
        <Data name="dtpstat.multiple"><value><![CDATA[1]]></value></Data>
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

test('portable KML rejects a Placemark that references a numeric code outside the dictionary', () => {
  const xml = serializeLinesKml(snapshot)
    .replace('<![CDATA[7]]>', '<![CDATA[99]]>');

  assert.throws(
    () => parseLinesKml(xml),
    /unknown business type code: 99/,
  );
});

test('portable KML schema v1 string codes are translated through imported names', () => {
  const legacyDictionary = JSON.stringify({
    schemaVersion: 1,
    lineTypes: [
      { code: 'one-way', name: 'Односторонние', color: '#cc4400', style: 'dashed', width: 5 },
    ],
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<ExtendedData><Data name="dtpstat.businessLineTypes"><value><![CDATA[${legacyDictionary}]]></value></Data></ExtendedData>
<Placemark><ExtendedData>
<Data name="dtpstat.businessTypeCode"><value><![CDATA[one-way]]></value></Data>
<Data name="dtpstat.multiple"><value><![CDATA[1]]></value></Data>
</ExtendedData><LineString><coordinates>30,60 30.1,60.1</coordinates></LineString></Placemark>
</Document></kml>`;

  const parsed = parseLinesKml(xml);
  assert.equal(parsed.lineTypes[0].name, 'one-way');
  assert.equal(parsed.lineTypes[0].title, 'Односторонние');
  assert.equal(parsed.features[0].properties._dtpstat.businessTypeCode, 0);
});
