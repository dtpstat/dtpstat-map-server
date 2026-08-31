import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMapController,
  findTopLabelLayerId,
} from '../public/js/map-controller.js';

test('label anchor is selected after all non-symbol road layers', () => {
  assert.equal(
    findTopLabelLayerId([
      { id: 'background', type: 'background' },
      { id: 'early-icon', type: 'symbol' },
      { id: 'road-casing', type: 'line' },
      { id: 'road', type: 'line' },
      { id: 'road-label', type: 'symbol' },
      { id: 'place-label', type: 'symbol' },
    ]),
    'road-label',
  );
});

test('bus-lane layer stays above roads and below the final label block', async () => {
  const calls = [];
  let map;

  class FakeMap {
    constructor() {
      this.sources = new Map();
      this.layers = new Map();
      this.handlers = new Map();
      this.styleLayers = [
        { id: 'background', type: 'background' },
        { id: 'early-icon', type: 'symbol' },
        { id: 'road-casing', type: 'line' },
        { id: 'road', type: 'line' },
        { id: 'road-label', type: 'symbol' },
        { id: 'place-label', type: 'symbol' },
      ];
      map = this;
    }

    loaded() {
      return true;
    }

    addControl() {}

    getSource(id) {
      return this.sources.get(id);
    }

    addSource(id, definition) {
      const source = {
        data: definition.data,
        setData(data) {
          source.data = data;
          calls.push(['setData', id]);
        },
      };
      this.sources.set(id, source);
    }

    getLayer(id) {
      return this.layers.get(id);
    }

    getStyle() {
      return { layers: this.styleLayers };
    }

    addLayer(layer, beforeId) {
      this.layers.set(layer.id, layer);
      calls.push(['addLayer', layer.id, beforeId]);
    }

    moveLayer(id, beforeId) {
      calls.push(['moveLayer', id, beforeId]);
    }

    on(event, handler) {
      this.handlers.set(event, handler);
    }

    fitBounds() {}
  }

  const previousWindow = globalThis.window;
  globalThis.window = {
    mapboxgl: {
      Map: FakeMap,
      NavigationControl: class {},
      accessToken: '',
    },
    matchMedia() {
      return { matches: false };
    },
  };

  try {
    const controller = await createMapController({
      accessToken: 'pk.test',
      styleUrl: 'mapbox://styles/test/style',
      initialCenter: [0, 0],
      initialZoom: 1,
    });

    assert.deepEqual(calls[0], [
      'addLayer',
      'bus-lanes-lines',
      'road-label',
    ]);
    assert.deepEqual(calls[1], [
      'moveLayer',
      'bus-lanes-lines',
      'road-label',
    ]);

    const geojson = {
      type: 'FeatureCollection',
      features: [],
    };
    controller.showCity(geojson, [0, 0, 1, 1]);
    assert.equal(map.getSource('bus-lanes').data, geojson);
    assert.deepEqual(calls.at(-2), [
      'moveLayer',
      'bus-lanes-lines',
      'road-label',
    ]);
    assert.deepEqual(calls.at(-1), ['setData', 'bus-lanes']);

    map.sources.clear();
    map.layers.clear();
    map.handlers.get('style.load')();
    assert.equal(map.getSource('bus-lanes').data, geojson);
    assert.deepEqual(calls.at(-1), ['setData', 'bus-lanes']);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});
