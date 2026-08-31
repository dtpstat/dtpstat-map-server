const SOURCE_ID = 'bus-lanes';
const LAYER_ID = 'bus-lanes-lines';

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

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  const firstSymbolLayer = map
    .getStyle()
    .layers?.find((layer) => layer.type === 'symbol')?.id;
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
    firstSymbolLayer,
  );

  return {
    /**
     * @param {GeoJSON.FeatureCollection} geojson
     * @param {[number, number, number, number]} bounds
     */
    showCity(geojson, bounds) {
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
