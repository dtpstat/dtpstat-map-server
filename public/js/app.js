import { loadCities, loadCityGeometries, loadMapConfig } from './api.js';
import { createCityList } from './city-list.js';
import { createMapController } from './map-controller.js';

const mapMessage = document.querySelector('#map-message');
const cityList = createCityList({
  list: document.querySelector('#city-list'),
  status: document.querySelector('#status'),
  categoryButtons: document.querySelectorAll('[data-category]'),
});

let activeRequest = null;
let mapController = null;

function setMapMessage(message, isError = false) {
  mapMessage.hidden = !message;
  mapMessage.textContent = message;
  mapMessage.classList.toggle('is-error', isError);
}

async function selectCity(city) {
  activeRequest?.abort();
  activeRequest = new AbortController();
  cityList.select(city.id);
  cityList.setStatus(`Загружаем геометрии: ${city.name}…`);

  try {
    const geojson = await loadCityGeometries(city.id, activeRequest.signal);
    mapController.showCity(geojson, city.bounds);
    cityList.setStatus(
      `${city.name}: ${geojson.features.length} участков выделенных полос`,
    );
    setMapMessage('');
  } catch (error) {
    if (error.name === 'AbortError') return;
    cityList.setStatus(`Не удалось загрузить ${city.name}`, true);
    setMapMessage('Не удалось загрузить геометрии города', true);
    console.error(error);
  }
}

cityList.onSelect(selectCity);

async function start() {
  try {
    const mapConfig = await loadMapConfig();
    mapController = await createMapController(mapConfig);

    // The city request completes before the first city's geometry request.
    const cities = await loadCities();
    if (!cities.length) throw new Error('Список городов пуст');

    cityList.setCities(cities);
    cityList.setStatus(`Доступно городов: ${cities.length}`);

    const firstCity = cities.find((city) => city.category === 'large') ?? cities[0];
    await selectCity(firstCity);
  } catch (error) {
    cityList.setStatus('Приложение не удалось загрузить', true);
    setMapMessage(error.message || 'Ошибка запуска приложения', true);
    console.error(error);
  }
}

start();
