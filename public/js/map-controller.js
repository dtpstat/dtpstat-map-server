const SOURCE_ID = 'bus-lanes';
const LAYER_ID = 'bus-lanes-lines';
const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] };

/**
 * Map styles may contain an early symbol layer followed by road layers. The
 * correct anchor is therefore the first symbol in the final label block, not
 * simply the first symbol in the style.
 *
 * @param {Array<{ id: string, type: string }>} layers
 */
export function findTopLabelLayerId(layers = []) {
  let lastNonSymbolIndex = -1;
  for (const [index, layer] of layers.entries()) {
    if (layer.id !== LAYER_ID && layer.type !== 'symbol') {
      lastNonSymbolIndex = index;
    }
  }

  return layers
    .slice(lastNonSymbolIndex + 1)
    .find((layer) => layer.id !== LAYER_ID && layer.type === 'symbol')?.id;
}

function waitForMapLoad(map) {
  if (map.loaded()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    map.once('load', resolve);
    map.once('error', reject);
  });
}

/** @param {{ accessToken: string, styleUrl: string, initialCenter: [number, number], initialZoom: number }} config */
export async function createMapController(config) {
  if (!window.mapboxgl) {
    throw new Error('Mapbox GL не загрузился');
  }

  window.mapboxgl.accessToken = config.accessToken;
  const map = new window.mapboxgl.Map({
    container: 'map',
    style: config.styleUrl,
    center: config.initialCenter,
    zoom: config.initialZoom,
    attributionControl: true,
  });
  map.addControl(new window.mapboxgl.NavigationControl(), 'top-right');
  await waitForMapLoad(map);

  let currentGeoJson = EMPTY_COLLECTION;

  function ensureBusLaneLayer() {
    const labelLayerId = findTopLabelLayerId(map.getStyle().layers);
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: currentGeoJson,
      });
    }
    if (!map.getLayer(LAYER_ID)) {
      map.addLayer(
        {
          id: LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': 'rgba(4, 91, 105, 0.8)',
            'line-width': ['match', ['get', 'lanes'], 2, 8, 4],
          },
        },
        labelLayerId,
      );
    }

    // Roads and other geometry stay below; the final label block stays above.
    map.moveLayer(LAYER_ID, labelLayerId);
  }

  ensureBusLaneLayer();
  map.on('style.load', () => {
    ensureBusLaneLayer();
    map.getSource(SOURCE_ID).setData(currentGeoJson);
  });

  return {
    /**
     * @param {GeoJSON.FeatureCollection} geojson
     * @param {[number, number, number, number]} bounds
     */
    showCity(geojson, bounds) {
      currentGeoJson = geojson;
      ensureBusLaneLayer();
      map.getSource(SOURCE_ID).setData(geojson);
      const compact = window.matchMedia('(max-width: 760px)').matches;
      map.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        {
          padding: compact ? 24 : 42,
          duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 0
            : 500,
        },
      );
    },
  };
}
