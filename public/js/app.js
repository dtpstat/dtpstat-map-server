import {
  loadCities,
  loadLineTypes,
  loadMapConfig,
  loadViewportGeometries,
} from './api.js';
import { createCityList } from './city-list.js';
import {
  createMapController,
  ROAD_DATA_MIN_ZOOM,
} from './map-controller.js';

const legendStylesheet = document.createElement('link');
legendStylesheet.rel = 'stylesheet';
legendStylesheet.href = '/css/line-types.css';
document.head.append(legendStylesheet);

const mapMessage = document.querySelector('#map-message');
const mapPanel = document.querySelector('.map-panel');
const cityList = createCityList({
  list: document.querySelector('#city-list'),
  status: document.querySelector('#status'),
  categoryButtons: document.querySelectorAll('[data-category]'),
});

let activeRequest = null;
let mapController = null;
let citiesById = new Map();
let focusedCityId = null;
let lineTypesSignature = '';
let lineTypesRefresh = null;
let openMapRefresh = null;

function setMapMessage(message, isError = false) {
  mapMessage.hidden = !message;
  mapMessage.textContent = message;
  mapMessage.classList.toggle('is-error', isError);
}

/** @param {any[]} lineTypes */
function renderLineLegend(lineTypes) {
  document.querySelector('#line-legend')?.remove();
  if (lineTypes.length <= 1) return;

  const legend = document.createElement('section');
  legend.id = 'line-legend';
  legend.className = 'line-legend';
  legend.setAttribute('aria-label', 'Типы линий');

  const title = document.createElement('div');
  title.className = 'line-legend-title';
  title.textContent = 'Типы линий';
  legend.append(title);

  for (const lineType of lineTypes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'line-legend-item';
    button.setAttribute('aria-pressed', 'true');
    button.dataset.lineType = lineType.type;
    button.title = lineType.geometryCount === 0
      ? 'Сейчас линий этого типа нет'
      : `Линий этого типа: ${lineType.geometryCount}`;

    const sample = document.createElement('span');
    sample.className = 'line-legend-sample';
    sample.style.borderTopColor = lineType.color;
    sample.style.borderTopStyle = lineType.style === 'solid' ? 'solid' : lineType.style;
    sample.style.borderTopWidth = `${Math.max(2, Math.min(8, lineType.width))}px`;

    const name = document.createElement('span');
    name.textContent = lineType.name;
    button.append(sample, name);
    button.addEventListener('click', () => {
      const enabled = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(enabled));
      button.classList.toggle('is-disabled', !enabled);
      mapController.setLineTypeVisibility(lineType.type, enabled);
    });
    legend.append(button);
  }

  mapPanel.append(legend);
}

/** @param {any[]} lineTypes */
function applyLineTypes(lineTypes) {
  const signature = JSON.stringify(
    lineTypes.map(({ type, name, color, style, width, geometryCount }) => ({
      type,
      name,
      color,
      style,
      width,
      geometryCount,
    })),
  );
  if (signature === lineTypesSignature) return false;
  lineTypesSignature = signature;
  mapController.setLineTypes(lineTypes);
  renderLineLegend(lineTypes);
  return true;
}

async function refreshLineTypes() {
  if (!mapController) return;
  if (lineTypesRefresh) return lineTypesRefresh;
  lineTypesRefresh = (async () => {
    try {
      const lineTypes = await loadLineTypes();
      if (!lineTypes.length) return;
      applyLineTypes(lineTypes);
    } catch (error) {
      console.error('Не удалось обновить справочник типов линий', error);
    } finally {
      lineTypesRefresh = null;
    }
  })();
  return lineTypesRefresh;
}

async function refreshOpenMap() {
  if (!mapController) return;
  if (openMapRefresh) return openMapRefresh;
  openMapRefresh = (async () => {
    try {
      await refreshLineTypes();
      mapController.refreshViewport();
    } finally {
      openMapRefresh = null;
    }
  })();
  return openMapRefresh;
}

function selectCity(city) {
  activeRequest?.abort();
  activeRequest = null;
  focusedCityId = city.id;
  cityList.select(city.id, { scrollIntoView: true });
  cityList.setStatus(`Позиционируем карту: ${city.name}…`);
  mapController.focusCity(city.bounds);
}

async function updateViewport(viewport) {
  activeRequest?.abort();
  activeRequest = null;

  if (viewport.zoom < ROAD_DATA_MIN_ZOOM) {
    focusedCityId = null;
    mapController.clearViewportData();
    cityList.setStatus('Выберите город или увеличьте карту для показа полос');
    setMapMessage('');
    return;
  }

  const request = new AbortController();
  activeRequest = request;
  cityList.setStatus('Загружаем данные видимого окна…');
  setMapMessage('Загружаем данные видимого окна…');

  try {
    const geojson = await loadViewportGeometries(viewport, request.signal);
    if (activeRequest !== request) return;
    mapController.setViewportData(geojson);

    const centerCity = citiesById.get(focusedCityId)
      ?? citiesById.get(geojson.centerCityId);
    focusedCityId = null;
    cityList.select(centerCity?.id ?? null, {
      scrollIntoView: Boolean(centerCity),
    });
    const cityMessage = centerCity ? `; город — ${centerCity.name}` : '';
    cityList.setStatus(
      `В видимом окне: ${geojson.features.length} участков${cityMessage}`,
    );
    setMapMessage('');
  } catch (error) {
    if (error.name === 'AbortError') return;
    focusedCityId = null;
    cityList.setStatus('Не удалось загрузить данные видимого окна', true);
    setMapMessage('Не удалось загрузить данные видимого окна', true);
    console.error(error);
  } finally {
    if (activeRequest === request) activeRequest = null;
  }
}

cityList.onSelect(selectCity);

async function start() {
  try {
    const mapConfig = await loadMapConfig();
    mapController = await createMapController(mapConfig);

    const [cities, lineTypes] = await Promise.all([
      loadCities(),
      loadLineTypes(),
    ]);
    if (!cities.length) throw new Error('Список городов пуст');
    if (!lineTypes.length) throw new Error('Справочник типов линий пуст');

    applyLineTypes(lineTypes);
    cityList.setCities(cities);
    citiesById = new Map(cities.map((city) => [city.id, city]));
    mapController.setCities(cities);
    mapController.onCitySelect((cityId) => {
      const city = citiesById.get(cityId);
      if (city) selectCity(city);
    });
    mapController.onViewportChange((viewport) => {
      void updateViewport(viewport);
    });
    cityList.setStatus(`Доступно городов: ${cities.length}`);

    const firstCity = cities.find((city) => city.category === 'large') ?? cities[0];
    selectCity(firstCity);
  } catch (error) {
    cityList.setStatus('Приложение не удалось загрузить', true);
    setMapMessage(error.message || 'Ошибка запуска приложения', true);
    console.error(error);
  }
}

window.addEventListener('focus', () => {
  void refreshOpenMap();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refreshOpenMap();
});

start();
