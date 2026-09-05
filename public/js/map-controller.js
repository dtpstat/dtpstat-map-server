import { CITY_MARKER_ICON_URL } from './city-marker-icon.js';

const SOURCE_ID = 'bus-lanes';
const LAYER_PREFIX = 'bus-lanes-lines-';
const CITY_SOURCE_ID = 'ranked-cities';
const CITY_LAYER_ID = 'ranked-cities-markers';
const CITY_IMAGE_ID = 'ranked-city-bus';
const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] };
const DEFAULT_LINE_TYPE = {
  type: 'default',
  name: 'Выделенные полосы',
  color: '#045b69',
  style: 'solid',
  width: 4,
  geometryCount: 0,
};

export const ROAD_DATA_MIN_ZOOM = 8;

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
    if (!layer.id.startsWith(LAYER_PREFIX) && layer.type !== 'symbol') {
      lastNonSymbolIndex = index;
    }
  }

  return layers
    .slice(lastNonSymbolIndex + 1)
    .find((layer) =>
      !layer.id.startsWith(LAYER_PREFIX) && layer.type === 'symbol')?.id;
}

/** @param {string} style */
function dashArray(style) {
  if (style === 'dashed') return [2.5, 1.5];
  if (style === 'dotted') return [0.1, 1.8];
  return null;
}

/** @param {any} city */
function markerCoordinates(city) {
  if (
    Array.isArray(city.center) &&
    city.center.length === 2 &&
    city.center.every(Number.isFinite)
  ) {
    return city.center;
  }
  if (
    Array.isArray(city.bounds) &&
    city.bounds.length === 4 &&
    city.bounds.every(Number.isFinite)
  ) {
    return [
      (city.bounds[0] + city.bounds[2]) / 2,
      (city.bounds[1] + city.bounds[3]) / 2,
    ];
  }
  return null;
}

/** @param {any[]} cities */
export function citiesToMarkerGeoJson(cities) {
  return {
    type: 'FeatureCollection',
    features: cities.flatMap((city) => {
      const coordinates = markerCoordinates(city);
      if (!coordinates) return [];
      return [{
        type: 'Feature',
        id: city.id,
        geometry: { type: 'Point', coordinates },
        properties: {
          cityId: city.id,
          name: city.name,
          priority: (city.category === 'large' ? 0 : 1000) + city.rank,
        },
      }];
    }),
  };
}

function waitForMapLoad(map) {
  if (map.loaded()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    map.once('load', resolve);
    map.once('error', reject);
  });
}

/** @param {any} map @param {string} url */
function loadMapImage(map, url) {
  return new Promise((resolve, reject) => {
    map.loadImage(url, (error, image) => {
      if (error) reject(error);
      else resolve(image);
    });
  });
}

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {number} longitude */
function normalizeLongitude(longitude) {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

/** @param {any} map */
function readViewport(map) {
  const bounds = map.getBounds();
  const center = map.getCenter();
  const normalizedCenterLng = normalizeLongitude(center.lng);
  const rawWorldOffset = center.lng - normalizedCenterLng;
  const worldOffset = Math.abs(rawWorldOffset) < 1e-9 ? 0 : rawWorldOffset;
  const west = clamp(bounds.getWest() - worldOffset, -180, 180);
  const east = clamp(bounds.getEast() - worldOffset, -180, 180);

  return {
    zoom: map.getZoom(),
    bbox: [
      Math.min(west, east),
      clamp(bounds.getSouth(), -90, 90),
      Math.max(west, east),
      clamp(bounds.getNorth(), -90, 90),
    ],
    center: [normalizedCenterLng, clamp(center.lat, -90, 90)],
  };
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
  let currentCities = EMPTY_COLLECTION;
  let currentLineTypes = [DEFAULT_LINE_TYPE];
  let viewportHandler = null;
  let citySelectHandler = null;
  const disabledLineTypes = new Set();
  let lineLayerIds = new Map();

  async function ensureCityMarkerLayer() {
    if (!map.hasImage(CITY_IMAGE_ID)) {
      const image = await loadMapImage(map, CITY_MARKER_ICON_URL);
      if (!map.hasImage(CITY_IMAGE_ID)) {
        map.addImage(CITY_IMAGE_ID, image, { pixelRatio: 1 });
      }
    }
    if (!map.getSource(CITY_SOURCE_ID)) {
      map.addSource(CITY_SOURCE_ID, {
        type: 'geojson',
        data: currentCities,
      });
    }
    if (!map.getLayer(CITY_LAYER_ID)) {
      map.addLayer({
        id: CITY_LAYER_ID,
        type: 'symbol',
        source: CITY_SOURCE_ID,
        maxzoom: ROAD_DATA_MIN_ZOOM,
        layout: {
          'icon-image': CITY_IMAGE_ID,
          'icon-size': 1,
          'icon-padding': 3,
          'text-field': ['get', 'name'],
          'text-size': 12,
          'text-offset': [0, 1.55],
          'text-anchor': 'top',
          'text-padding': 3,
          'symbol-sort-key': ['get', 'priority'],
        },
        paint: {
          'text-color': '#17373b',
          'text-halo-color': 'rgba(255, 255, 255, 0.95)',
          'text-halo-width': 1.5,
        },
      });
    }
  }

  function removeBusLaneLayers() {
    for (const layerId of lineLayerIds.values()) {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    }
    lineLayerIds = new Map();
  }

  function ensureBusLaneLayers() {
    const labelLayerId = findTopLabelLayerId(map.getStyle().layers);
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: currentGeoJson,
      });
    }

    for (const [index, lineType] of currentLineTypes.entries()) {
      const layerId = `${LAYER_PREFIX}${index}`;
      lineLayerIds.set(lineType.type, layerId);
      if (!map.getLayer(layerId)) {
        const paint = {
          'line-color': lineType.color,
          'line-width': lineType.width,
        };
        const dash = dashArray(lineType.style);
        if (dash) paint['line-dasharray'] = dash;
        map.addLayer(
          {
            id: layerId,
            type: 'line',
            source: SOURCE_ID,
            minzoom: ROAD_DATA_MIN_ZOOM,
            filter: ['==', ['get', 'lineType'], lineType.type],
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
              visibility: disabledLineTypes.has(lineType.type) ? 'none' : 'visible',
            },
            paint,
          },
          labelLayerId,
        );
      }
      map.moveLayer(layerId, labelLayerId);
    }
  }

  async function ensureMapLayers() {
    await ensureCityMarkerLayer();
    ensureBusLaneLayers();
  }

  await ensureMapLayers();
  map.on('style.load', () => {
    lineLayerIds = new Map();
    void ensureMapLayers()
      .then(() => {
        map.getSource(CITY_SOURCE_ID).setData(currentCities);
        map.getSource(SOURCE_ID).setData(currentGeoJson);
      })
      .catch((error) => console.error('Не удалось восстановить слои карты', error));
  });
  map.on('moveend', () => {
    if (viewportHandler) viewportHandler(readViewport(map));
  });
  map.on('click', CITY_LAYER_ID, (event) => {
    const cityId = Number(event.features?.[0]?.properties?.cityId);
    if (Number.isSafeInteger(cityId) && citySelectHandler) {
      citySelectHandler(cityId);
    }
  });
  map.on('mouseenter', CITY_LAYER_ID, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', CITY_LAYER_ID, () => {
    map.getCanvas().style.cursor = '';
  });

  return {
    /** @param {any[]} cities */
    setCities(cities) {
      currentCities = citiesToMarkerGeoJson(cities);
      map.getSource(CITY_SOURCE_ID).setData(currentCities);
    },

    /** @param {any[]} lineTypes */
    setLineTypes(lineTypes) {
      const normalized = lineTypes.length > 0 ? lineTypes : [DEFAULT_LINE_TYPE];
      removeBusLaneLayers();
      currentLineTypes = normalized;
      ensureBusLaneLayers();
    },

    /** @param {string} type @param {boolean} enabled */
    setLineTypeVisibility(type, enabled) {
      if (enabled) disabledLineTypes.delete(type);
      else disabledLineTypes.add(type);
      const layerId = lineLayerIds.get(type);
      if (layerId && map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', enabled ? 'visible' : 'none');
      }
    },

    /** @param {(viewport: { zoom: number, bbox: [number, number, number, number], center: [number, number] }) => void} handler */
    onViewportChange(handler) {
      viewportHandler = handler;
      handler(readViewport(map));
    },

    /** @param {(cityId: number) => void} handler */
    onCitySelect(handler) {
      citySelectHandler = handler;
    },

    /** @param {GeoJSON.FeatureCollection} geojson */
    setViewportData(geojson) {
      currentGeoJson = geojson;
      ensureBusLaneLayers();
      map.getSource(SOURCE_ID).setData(geojson);
    },

    clearViewportData() {
      currentGeoJson = EMPTY_COLLECTION;
      map.getSource(SOURCE_ID).setData(EMPTY_COLLECTION);
    },

    /** @param {[number, number, number, number]} bounds */
    focusCity(bounds) {
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
