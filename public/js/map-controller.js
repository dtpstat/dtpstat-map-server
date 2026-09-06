import { CITY_MARKER_ICON_URL } from './city-marker-icon.js';

const SOURCE_ID = 'bus-lanes';
const LAYER_PREFIX = 'bus-lanes-lines-';
const LABEL_LAYER_PREFIX = 'bus-lanes-labels-';
const CITY_SOURCE_ID = 'ranked-cities';
const CITY_LAYER_ID = 'ranked-cities-markers';
const CITY_IMAGE_ID = 'ranked-city-bus';
const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] };
const DEFAULT_LINE_TYPE = {
  code: 0,
  name: 'default',
  title: 'Выделенные полосы',
  color: '#045b69',
  style: 'solid',
  width: 4,
  geometryCount: 0,
};

export const ROAD_DATA_MIN_ZOOM = 8;

function isApplicationLineLayer(layer) {
  return layer.id.startsWith(LAYER_PREFIX) || layer.id.startsWith(LABEL_LAYER_PREFIX);
}

/** @param {Array<{ id: string, type: string }>} layers */
export function findTopLabelLayerId(layers = []) {
  let lastNonSymbolIndex = -1;
  for (const [index, layer] of layers.entries()) {
    if (!isApplicationLineLayer(layer) && layer.type !== 'symbol') {
      lastNonSymbolIndex = index;
    }
  }
  return layers
    .slice(lastNonSymbolIndex + 1)
    .find((layer) => !isApplicationLineLayer(layer) && layer.type === 'symbol')?.id;
}

/**
 * KML Placemark names are intentionally stored under placemarkName. The
 * generic GeoJSON property "name" is used by transfer formats for the city's
 * full name and must not become a line tooltip or persistent label by accident.
 *
 * @param {any} feature
 */
export function lineFeatureName(feature) {
  const value = feature?.properties?.placemarkName;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

/** @param {string} style */
function dashArray(style) {
  if (style === 'dashed') return [2.5, 1.5];
  if (style === 'dotted') return [0.1, 1.8];
  return null;
}

/** @param {any} city */
function markerCoordinates(city) {
  if (Array.isArray(city.center) && city.center.length === 2 && city.center.every(Number.isFinite)) {
    return city.center;
  }
  if (Array.isArray(city.bounds) && city.bounds.length === 4 && city.bounds.every(Number.isFinite)) {
    return [(city.bounds[0] + city.bounds[2]) / 2, (city.bounds[1] + city.bounds[3]) / 2];
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

/**
 * @param {{
 *   accessToken: string,
 *   styleUrl: string,
 *   initialCenter: [number, number],
 *   initialZoom: number,
 *   showLineLabels?: boolean
 * }} config
 */
export async function createMapController(config) {
  if (!window.mapboxgl) throw new Error('Mapbox GL не загрузился');
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

  const lineNamePopup = new window.mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 8,
  });
  let currentGeoJson = EMPTY_COLLECTION;
  let currentCities = EMPTY_COLLECTION;
  let currentLineTypes = [DEFAULT_LINE_TYPE];
  let viewportHandler = null;
  let citySelectHandler = null;
  const disabledLineTypes = new Set();
  let lineLayerIds = new Map();
  let lineLabelLayerIds = new Map();

  async function ensureCityMarkerLayer() {
    if (!map.hasImage(CITY_IMAGE_ID)) {
      const image = await loadMapImage(map, CITY_MARKER_ICON_URL);
      if (!map.hasImage(CITY_IMAGE_ID)) map.addImage(CITY_IMAGE_ID, image, { pixelRatio: 1 });
    }
    if (!map.getSource(CITY_SOURCE_ID)) {
      map.addSource(CITY_SOURCE_ID, { type: 'geojson', data: currentCities });
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
    lineNamePopup.remove();
    for (const layerId of [...lineLabelLayerIds.values(), ...lineLayerIds.values()]) {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    }
    lineLayerIds = new Map();
    lineLabelLayerIds = new Map();
  }

  function ensureBusLaneLayers() {
    const labelLayerId = findTopLabelLayerId(map.getStyle().layers);
    if (!map.getSource(SOURCE_ID)) map.addSource(SOURCE_ID, { type: 'geojson', data: currentGeoJson });

    for (const lineType of currentLineTypes) {
      const layerId = `${LAYER_PREFIX}${lineType.code}`;
      const labelId = `${LABEL_LAYER_PREFIX}${lineType.code}`;
      const visible = disabledLineTypes.has(lineType.code) ? 'none' : 'visible';
      lineLayerIds.set(lineType.code, layerId);
      if (!map.getLayer(layerId)) {
        const paint = {
          'line-color': lineType.color,
          'line-width': lineType.width,
        };
        const dash = dashArray(lineType.style);
        if (dash) paint['line-dasharray'] = dash;
        map.addLayer({
          id: layerId,
          type: 'line',
          source: SOURCE_ID,
          minzoom: ROAD_DATA_MIN_ZOOM,
          filter: ['==', ['get', 'businessTypeCode'], lineType.code],
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
            visibility: visible,
          },
          paint,
        }, labelLayerId);
      }
      map.moveLayer(layerId, labelLayerId);

      if (config.showLineLabels) {
        lineLabelLayerIds.set(lineType.code, labelId);
        if (!map.getLayer(labelId)) {
          map.addLayer({
            id: labelId,
            type: 'symbol',
            source: SOURCE_ID,
            minzoom: ROAD_DATA_MIN_ZOOM,
            filter: [
              'all',
              ['==', ['get', 'businessTypeCode'], lineType.code],
              ['has', 'placemarkName'],
            ],
            layout: {
              'symbol-placement': 'line',
              'text-field': ['get', 'placemarkName'],
              'text-size': 11,
              'text-max-angle': 35,
              'text-padding': 4,
              'text-rotation-alignment': 'map',
              'text-pitch-alignment': 'viewport',
              visibility: visible,
            },
            paint: {
              'text-color': '#17373b',
              'text-halo-color': 'rgba(255, 255, 255, 0.96)',
              'text-halo-width': 1.5,
            },
          }, labelLayerId);
        }
        map.moveLayer(labelId, labelLayerId);
      }
    }
  }

  async function ensureMapLayers() {
    await ensureCityMarkerLayer();
    ensureBusLaneLayers();
  }

  await ensureMapLayers();
  map.on('style.load', () => {
    lineNamePopup.remove();
    lineLayerIds = new Map();
    lineLabelLayerIds = new Map();
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
  map.on('mousemove', (event) => {
    const layers = [...lineLayerIds.values()].filter((layerId) => map.getLayer(layerId));
    if (layers.length === 0) {
      lineNamePopup.remove();
      return;
    }
    const feature = map
      .queryRenderedFeatures(event.point, { layers })
      .find((candidate) => lineFeatureName(candidate));
    const name = lineFeatureName(feature);
    if (!name) {
      lineNamePopup.remove();
      return;
    }
    lineNamePopup
      .setLngLat(event.lngLat)
      .setText(name)
      .addTo(map);
  });
  map.getCanvas().addEventListener?.('mouseleave', () => lineNamePopup.remove());
  map.on('click', CITY_LAYER_ID, (event) => {
    const cityId = Number(event.features?.[0]?.properties?.cityId);
    if (Number.isSafeInteger(cityId) && citySelectHandler) citySelectHandler(cityId);
  });
  map.on('mouseenter', CITY_LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', CITY_LAYER_ID, () => { map.getCanvas().style.cursor = ''; });

  return {
    setCities(cities) {
      currentCities = citiesToMarkerGeoJson(cities);
      map.getSource(CITY_SOURCE_ID).setData(currentCities);
    },
    setLineTypes(lineTypes) {
      const normalized = lineTypes.length > 0 ? lineTypes : [DEFAULT_LINE_TYPE];
      removeBusLaneLayers();
      currentLineTypes = normalized;
      ensureBusLaneLayers();
    },
    setLineTypeVisibility(code, enabled) {
      if (enabled) disabledLineTypes.delete(code);
      else disabledLineTypes.add(code);
      for (const layerId of [lineLayerIds.get(code), lineLabelLayerIds.get(code)]) {
        if (layerId && map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', enabled ? 'visible' : 'none');
        }
      }
      if (!enabled) lineNamePopup.remove();
    },
    onViewportChange(handler) {
      viewportHandler = handler;
      handler(readViewport(map));
    },
    refreshViewport() {
      if (viewportHandler) viewportHandler(readViewport(map));
    },
    onCitySelect(handler) {
      citySelectHandler = handler;
    },
    setViewportData(geojson) {
      lineNamePopup.remove();
      currentGeoJson = geojson;
      ensureBusLaneLayers();
      map.getSource(SOURCE_ID).setData(geojson);
    },
    clearViewportData() {
      lineNamePopup.remove();
      currentGeoJson = EMPTY_COLLECTION;
      map.getSource(SOURCE_ID).setData(EMPTY_COLLECTION);
    },
    focusCity(bounds) {
      lineNamePopup.remove();
      const compact = window.matchMedia('(max-width: 760px)').matches;
      map.fitBounds(
        [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
        {
          padding: compact ? 24 : 42,
          duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500,
        },
      );
    },
  };
}
