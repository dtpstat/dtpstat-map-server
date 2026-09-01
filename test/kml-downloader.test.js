import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadKml, KmlDownloadError } from '../src/data/kml-downloader.js';

const source = {
  fetchURL: 'https://www.google.com/maps/d/kml?mid=test&forcekml=1',
};
const options = {
  timeoutMs: 1000,
  maxFileBytes: 1024,
  allowedHosts: new Set(['www.google.com']),
};

test('KML downloader follows allowed redirects and counts actual bytes', async () => {
  const calls = [];
  const fetchImplementation = async (url) => {
    calls.push(url.toString());
    if (calls.length === 1) {
      return new Response(null, {
        status: 302,
        headers: { Location: '/maps/d/export.kml' },
      });
    }
    return new Response('<kml><Document/></kml>', {
      status: 200,
      headers: { 'Content-Type': 'application/xml' },
    });
  };

  const result = await downloadKml(source, options, fetchImplementation);

  assert.equal(result.xml, '<kml><Document/></kml>');
  assert.equal(result.bytes, Buffer.byteLength(result.xml));
  assert.equal(result.finalURL, 'https://www.google.com/maps/d/export.kml');
  assert.equal(calls.length, 2);
});

test('KML downloader blocks redirect hosts and oversized responses', async () => {
  await assert.rejects(
    downloadKml(source, options, async () =>
      new Response(null, {
        status: 302,
        headers: { Location: 'https://internal.example/map.kml' },
      })),
    KmlDownloadError,
  );

  await assert.rejects(
    downloadKml(source, { ...options, maxFileBytes: 4 }, async () =>
      new Response('<kml/>', { status: 200 })),
    /size limit/,
  );
});
