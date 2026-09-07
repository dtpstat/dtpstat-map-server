import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapController } from '../public/js/map-controller.js';

test('persistent line labels and hover popups are independent map settings', async () => {
  let map;
  let popup;
  let queryCount = 0;

  class FakePopup {
    constructor() {
      this.removed = true;
      popup = this;
    }
    setLngLat(value) { this.lngLat = value; return this; }
    setText(value) { this.text = value; return this; }
    addTo(target) { this.target = target; this.removed = false; return this; }
    remove() { this.removed = true; return this; }
  }

  class FakeMap {
    constructor() {
      this.sources = new Map();
      this.layers = new Map();
      this.images = new Map();
      this.handlers = new Map();
      this.renderedFeatures = [];
      this.styleLayers = [
        { id: 'background', type: 'background' },
        { id: 'road', type: 'line' },
        { id: 'road-label', type: 'symbol' },
      ];
      this.canvas = {
        style: {},
        addEventListener() {},
      };
      map = this;
    }
    loaded() { return true; }
    addControl() {}
    hasImage(id) { return this.images.has(id); }
    loadImage(_url, callback) { callback(null, { width: 32 }); }
    addImage(id, image) { this.images.set(id, image); }
    getSource(id) { return this.sources.get(id); }
    addSource(id, definition) {
      const source = {
        data: definition.data,
        setData(data) { source.data = data; },
      };
      this.sources.set(id, source);
    }
    getLayer(id) { return this.layers.get(id); }
    getStyle() { return { layers: this.styleLayers }; }
    addLayer(layer) { this.layers.set(layer.id, structuredClone(layer)); }
    removeLayer(id) { this.layers.delete(id); }
    moveLayer() {}
    setLayoutProperty(id, property, value) {
      this.layers.get(id).layout[property] = value;
    }
    on(event, layerOrHandler, delegatedHandler) {
      const delegated = typeof layerOrHandler === 'string';
      this.handlers.set(
        delegated ? `${event}:${layerOrHandler}` : event,
        delegated ? delegatedHandler : layerOrHandler,
      );
    }
    queryRenderedFeatures() {
      queryCount += 1;
      return this.renderedFeatures;
    }
    getCanvas() { return this.canvas; }
    getBounds() {
      return {
        getWest: () => 30,
        getSouth: () => 50,
        getEast: () => 40,
        getNorth: () => 60,
      };
    }
    getCenter() { return { lng: 35, lat: 55 }; }
    getZoom() { return 9; }
    fitBounds() {}
  }

  const previousWindow = globalThis.window;
  globalThis.window = {
    mapboxgl: {
      Map: FakeMap,
      Popup: FakePopup,
      NavigationControl: class {},
      accessToken: '',
    },
    matchMedia() { return { matches: false }; },
  };

  try {
    const controller = await createMapController({
      accessToken: 'pk.test',
      styleUrl: 'mapbox://styles/test/style',
      initialCenter: [0, 0],
      initialZoom: 1,
      showLineLabels: false,
      showLinePopups: false,
    });

    controller.setLineTypes([{
      code: 7,
      name: 'tram',
      title: 'Трамвай',
      color: '#008844',
      style: 'solid',
      width: 4,
      geometryCount: 1,
    }]);

    assert.equal(map.getLayer('bus-lanes-labels-7'), undefined);
    map.renderedFeatures = [{ properties: { placemarkName: 'Коломна' } }];
    map.handlers.get('mousemove')({ point: { x: 1, y: 1 }, lngLat: { lng: 1, lat: 1 } });
    assert.equal(queryCount, 0);
    assert.equal(popup.removed, true);

    controller.setLineDisplayOptions({
      showLineLabels: true,
      showLinePopups: false,
    });
    assert.ok(map.getLayer('bus-lanes-labels-7'));
    map.handlers.get('mousemove')({ point: { x: 1, y: 1 }, lngLat: { lng: 1, lat: 1 } });
    assert.equal(queryCount, 0);

    controller.setLineDisplayOptions({
      showLineLabels: false,
      showLinePopups: true,
    });
    assert.equal(map.getLayer('bus-lanes-labels-7'), undefined);
    map.handlers.get('mousemove')({ point: { x: 2, y: 2 }, lngLat: { lng: 2, lat: 2 } });
    assert.equal(queryCount, 1);
    assert.equal(popup.text, 'Коломна');
    assert.equal(popup.removed, false);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
