import assert from 'node:assert/strict';
import test from 'node:test';
import {
  citiesToMarkerGeoJson,
  createMapController,
  findTopLabelLayerId,
  ROAD_DATA_MIN_ZOOM,
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

test('ranked cities become low-zoom marker points', () => {
  assert.deepEqual(citiesToMarkerGeoJson([
    {
      id: 7,
      name: 'Москва',
      category: 'large',
      rank: 3,
      center: [37.62, 55.75],
      bounds: [37.3, 55.5, 37.9, 55.9],
    },
    {
      id: 8,
      name: 'Тест',
      category: 'small',
      rank: 2,
      bounds: [30, 50, 32, 52],
    },
  ]), {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 7,
        geometry: { type: 'Point', coordinates: [37.62, 55.75] },
        properties: {
          cityId: 7,
          name: 'Москва',
          priority: 3,
        },
      },
      {
        type: 'Feature',
        id: 8,
        geometry: { type: 'Point', coordinates: [31, 51] },
        properties: {
          cityId: 8,
          name: 'Тест',
          priority: 1002,
        },
      },
    ],
  });
});

test('bus-lane layer stays above roads and below the final label block', async () => {
  const calls = [];
  let map;

  class FakeMap {
    constructor() {
      this.sources = new Map();
      this.layers = new Map();
      this.images = new Map();
      this.handlers = new Map();
      this.canvas = { style: { cursor: '' } };
      this.zoom = 6;
      this.center = { lng: 37.62, lat: 55.75 };
      this.bounds = {
        getWest: () => 30,
        getSouth: () => 50,
        getEast: () => 40,
        getNorth: () => 60,
      };
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

    hasImage(id) {
      return this.images.has(id);
    }

    loadImage(_url, callback) {
      callback(null, 'city-marker-image');
    }

    addImage(id, image) {
      this.images.set(id, image);
      calls.push(['addImage', id]);
    }

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

    on(event, layerOrHandler, delegatedHandler) {
      const delegated = typeof layerOrHandler === 'string';
      const key = delegated ? `${event}:${layerOrHandler}` : event;
      this.handlers.set(key, delegated ? delegatedHandler : layerOrHandler);
    }

    getCanvas() {
      return this.canvas;
    }

    getBounds() {
      return this.bounds;
    }

    getCenter() {
      return this.center;
    }

    getZoom() {
      return this.zoom;
    }

    fitBounds(bounds) {
      calls.push(['fitBounds', bounds]);
    }
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

    assert.deepEqual(calls.find((call) => call[0] === 'addImage'), [
      'addImage',
      'ranked-city-bus',
    ]);
    assert.deepEqual(calls.find((call) => call[1] === 'ranked-cities-markers'), [
      'addLayer',
      'ranked-cities-markers',
      undefined,
    ]);
    assert.deepEqual(calls.find((call) => call[1] === 'bus-lanes-lines'), [
      'addLayer',
      'bus-lanes-lines',
      'road-label',
    ]);
    assert.deepEqual(calls.find((call) => call[0] === 'moveLayer'), [
      'moveLayer',
      'bus-lanes-lines',
      'road-label',
    ]);
    assert.equal(map.getLayer('ranked-cities-markers').maxzoom, ROAD_DATA_MIN_ZOOM);
    assert.equal(map.getLayer('bus-lanes-lines').minzoom, ROAD_DATA_MIN_ZOOM);

    const cities = [{
      id: 1,
      name: 'Казань',
      category: 'large',
      rank: 1,
      center: [49.1, 55.8],
    }];
    controller.setCities(cities);
    assert.equal(map.getSource('ranked-cities').data.features[0].id, 1);

    let selectedCityId = null;
    controller.onCitySelect((cityId) => {
      selectedCityId = cityId;
    });
    map.handlers.get('click:ranked-cities-markers')({
      features: [{ properties: { cityId: 1 } }],
    });
    assert.equal(selectedCityId, 1);
    map.handlers.get('mouseenter:ranked-cities-markers')();
    assert.equal(map.canvas.style.cursor, 'pointer');
    map.handlers.get('mouseleave:ranked-cities-markers')();
    assert.equal(map.canvas.style.cursor, '');

    const geojson = {
      type: 'FeatureCollection',
      features: [],
    };
    controller.setViewportData(geojson);
    assert.equal(map.getSource('bus-lanes').data, geojson);
    assert.deepEqual(calls.at(-2), [
      'moveLayer',
      'bus-lanes-lines',
      'road-label',
    ]);
    assert.deepEqual(calls.at(-1), ['setData', 'bus-lanes']);

    let viewport;
    controller.onViewportChange((nextViewport) => {
      viewport = nextViewport;
    });
    assert.deepEqual(viewport, {
      zoom: 6,
      bbox: [30, 50, 40, 60],
      center: [37.620000000000005, 55.75],
    });

    map.zoom = 9;
    map.center = { lng: 49.12, lat: 55.79 };
    map.bounds = {
      getWest: () => 49,
      getSouth: () => 55.7,
      getEast: () => 49.2,
      getNorth: () => 55.9,
    };
    map.handlers.get('moveend')();
    assert.equal(viewport.zoom, 9);
    assert.deepEqual(viewport.bbox, [49, 55.7, 49.2, 55.9]);

    controller.focusCity([48.9, 55.7, 49.3, 55.9]);
    assert.deepEqual(calls.at(-1), [
      'fitBounds',
      [[48.9, 55.7], [49.3, 55.9]],
    ]);

    map.sources.clear();
    map.layers.clear();
    map.images.clear();
    map.handlers.get('style.load')();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(map.getSource('ranked-cities').data.features[0].id, 1);
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
