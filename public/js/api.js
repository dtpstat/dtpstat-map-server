async function getJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    ...options,
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = await response.json();
      if (body.error) message = body.error;
    } catch {
      // The status code remains a useful error when the body is not JSON.
    }
    throw new Error(message);
  }

  return response.json();
}

export async function loadMapConfig() {
  const payload = await getJson('/api/config');
  return payload.map;
}

export async function loadCities() {
  const payload = await getJson('/api/cities');
  return payload.cities;
}

export function loadCityGeometries(cityId, signal) {
  return getJson(`/api/cities/${cityId}/geometries`, { signal });
}
