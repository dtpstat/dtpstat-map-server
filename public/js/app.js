import {
  loadCities,
  loadLineTypes,
  loadMapConfig,
  loadProjectSettings,
  loadReportConfig,
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
const cityTable = document.querySelector('.city-table');
const cityTableHead = cityTable?.querySelector('thead');

function ensureTableStatus() {
  const existingStatus = document.querySelector('#status');
  const existingBody = existingStatus?.closest('tbody.city-table-status');

  if (existingStatus?.tagName === 'TD' && existingBody) {
    existingBody.hidden = true;
    existingStatus.hidden = true;
    if (cityTableHead && existingBody.previousElementSibling !== cityTableHead) {
      cityTableHead.after(existingBody);
    }
    return { status: existingStatus, body: existingBody };
  }

  // Compatibility with a server process that still has the previous index.html
  // template cached in memory: remove the old status paragraph from the header
  // and create the status row in the table without requiring a server restart.
  existingStatus?.remove();

  const body = document.createElement('tbody');
  body.className = 'city-table-status';
  body.hidden = true;

  const row = document.createElement('tr');
  const status = document.createElement('td');
  status.id = 'status';
  status.className = 'status column-city';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.colSpan = 1;
  status.hidden = true;

  row.append(status);
  body.append(row);
  cityTableHead?.after(body);

  return { status, body };
}

const { status: tableStatus, body: tableStatusBody } = ensureTableStatus();
const cityList = createCityList({
  list: document.querySelector('#city-list'),
  status: tableStatus,
  categoryButtons: document.querySelectorAll('[data-category]'),
});

let activeRequest = null;
let mapController = null;
let citiesById = new Map();
let focusedCityId = null;
let lineTypesSignature = '';
let lineTypesRefresh = null;
let lineDisplayRefresh = null;
let openMapRefresh = null;

function setMapMessage(message, isError = false) {
  mapMessage.hidden = !message;
  mapMessage.textContent = message;
  mapMessage.classList.toggle('is-error', isError);
}

function setCityStatus(message, isError = false) {
  tableStatusBody.hidden = !message;
  cityList.setStatus(message, isError);
}

/** @param {any[]} lineTypes */
function renderLineLegend(lineTypes) {
  document.querySelector('#line-legend')?.remove();
  const legendLineTypes = lineTypes.filter((lineType) => lineType.geometryCount > 0);
  if (legendLineTypes.length <= 1) return;

  const legend = document.createElement('section');
  legend.id = 'line-legend';
  legend.className = 'line-legend';
  legend.setAttribute('aria-label', 'Типы линий');

  const title = document.createElement('div');
  title.className = 'line-legend-title';
  title.textContent = 'Типы линий';
  legend.append(title);

  for (const lineType of legendLineTypes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'line-legend-item';
    button.setAttribute('aria-pressed', 'true');
    button.dataset.lineTypeCode = String(lineType.code);
    button.title = `Линий этого типа: ${lineType.geometryCount}`;

    const sample = document.createElement('span');
    sample.className = 'line-legend-sample';
    sample.style.borderTopColor = lineType.color;
    sample.style.borderTopStyle = lineType.style === 'solid' ? 'solid' : lineType.style;
    sample.style.borderTopWidth = `${Math.max(2, Math.min(8, lineType.width))}px`;

    const name = document.createElement('span');
    name.textContent = lineType.title ?? lineType.name;
    button.append(sample, name);
    button.addEventListener('click', () => {
      const enabled = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(enabled));
      button.classList.toggle('is-disabled', !enabled);
      mapController.setLineTypeVisibility(lineType.code, enabled);
    });
    legend.append(button);
  }

  mapPanel.append(legend);
}

/** @param {any[]} lineTypes */
function applyLineTypes(lineTypes) {
  const signature = JSON.stringify(
    lineTypes.map(({ code, name, title, color, style, width, geometryCount }) => ({
      code,
      name,
      title,
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

async function refreshLineDisplayOptions() {
  if (!mapController) return;
  if (lineDisplayRefresh) return lineDisplayRefresh;
  lineDisplayRefresh = (async () => {
    try {
      const projectSettings = await loadProjectSettings();
      mapController.setLineDisplayOptions({
        showLineLabels: Boolean(projectSettings.showLineLabels),
        showLinePopups: projectSettings.showLinePopups !== false,
      });
    } catch (error) {
      console.error('Не удалось обновить настройки отображения линий', error);
    } finally {
      lineDisplayRefresh = null;
    }
  })();
  return lineDisplayRefresh;
}

async function refreshOpenMap() {
  if (!mapController) return;
  if (openMapRefresh) return openMapRefresh;
  openMapRefresh = (async () => {
    try {
      await refreshLineDisplayOptions();
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
  setCityStatus('');
  mapController.focusCity(city.bounds);
}

async function updateViewport(viewport) {
  activeRequest?.abort();
  activeRequest = null;

  if (viewport.zoom < ROAD_DATA_MIN_ZOOM) {
    focusedCityId = null;
    mapController.clearViewportData();
    setCityStatus('');
    setMapMessage('');
    return;
  }

  const request = new AbortController();
  activeRequest = request;
  setCityStatus('');
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
    setCityStatus('');
    setMapMessage('');
  } catch (error) {
    if (error.name === 'AbortError') return;
    focusedCityId = null;
    setCityStatus('Не удалось загрузить данные видимого окна', true);
    setMapMessage('Не удалось загрузить данные видимого окна', true);
    console.error(error);
  } finally {
    if (activeRequest === request) activeRequest = null;
  }
}

cityList.onSelect(selectCity);

async function start() {
  try {
    const reportConfig = await loadReportConfig();
    cityList.setReportConfig(reportConfig);
    tableStatus.colSpan = Math.max(1, reportConfig.tableColumns.length);
    setCityStatus('Загружаем список городов…');

    const cities = await loadCities();
    cityList.setCities(cities);
    setCityStatus(cities.length ? '' : 'Данные пока не загружены');

    const [mapConfig, projectSettings, lineTypes] = await Promise.all([
      loadMapConfig(),
      loadProjectSettings(),
      loadLineTypes(),
    ]);
    mapController = await createMapController({
      ...mapConfig,
      showLineLabels: Boolean(projectSettings.showLineLabels),
      showLinePopups: projectSettings.showLinePopups !== false,
    });
    if (!lineTypes.length) throw new Error('Справочник типов линий пуст');

    applyLineTypes(lineTypes);
    citiesById = new Map(cities.map((city) => [city.id, city]));
    mapController.setCities(cities);
    mapController.onCitySelect((cityId) => {
      const city = citiesById.get(cityId);
      if (city) selectCity(city);
    });
    mapController.onViewportChange((viewport) => {
      void updateViewport(viewport);
    });

    if (!cities.length) {
      setMapMessage('Данные пока не загружены');
      return;
    }

    setCityStatus('');
    const firstCity = cities.find((city) => city.category === 'large') ?? cities[0];
    selectCity(firstCity);
  } catch (error) {
    setCityStatus('Приложение не удалось загрузить', true);
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