if (typeof document !== 'undefined') {
  const panel = document.querySelector('#admin-section-osm-objects');
  const treeHost = document.querySelector('#osm-boundary-tree');
  const searchInput = document.querySelector('#osm-boundary-search');
  const refreshButton = document.querySelector('#osm-boundary-refresh');
  const form = document.querySelector('#osm-boundary-form');
  const title = document.querySelector('#osm-boundary-selected-title');
  const meta = document.querySelector('#osm-boundary-meta');
  const message = document.querySelector('#osm-boundary-message');
  const mapHost = document.querySelector('#osm-boundary-map');

  if (panel && treeHost && searchInput && refreshButton && form && mapHost) {
    const state = {
      boundaries: [],
      selectedId: null,
      map: null,
      mapReady: null,
    };

    const field = (name) => form.elements.namedItem(name);
    const active = field('active');
    const displayName = field('displayName');
    const displayType = field('displayType');
    const population = field('population');
    const save = form.querySelector('button[type="submit"]');
    const enableBranch = document.querySelector('#osm-boundary-enable-branch');
    const disableBranch = document.querySelector('#osm-boundary-disable-branch');

    function setMessage(text, tone = '') {
      message.textContent = text;
      message.className = 'notice';
      if (tone) message.classList.add(`notice-${tone}`);
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        credentials: 'same-origin',
        ...options,
        headers: { Accept: 'application/json', ...(options.headers ?? {}) },
      });
      let payload = null;
      try { payload = await response.json(); } catch { /* empty */ }
      if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
      return payload;
    }

    function sourceLabel(item) {
      const classification = item.placeType
        ? `place=${item.placeType}`
        : item.adminLevel !== null
          ? `admin_level=${item.adminLevel}`
          : 'OSM';
      return `${classification} · ${item.osmType}/${item.osmId}`;
    }

    function normalizeSearchText(value) {
      return String(value ?? '')
        .toLocaleLowerCase('ru-RU')
        .replace(/\s+/gu, '');
    }

    function boundarySearchText(item) {
      return normalizeSearchText([
        item.displayName,
        item.osmName,
        item.displayType,
        item.placeType,
        item.adminLevel === null ? '' : `admin_level=${item.adminLevel}`,
        item.osmType,
        item.osmId,
        `${item.osmType}/${item.osmId}`,
        item.placeType ? `place=${item.placeType}` : 'administrative',
      ].join(' '));
    }

    function compareBoundaries(a, b) {
      const compareText = (left, right) => String(left ?? '').localeCompare(
        String(right ?? ''),
        'ru-RU',
        { sensitivity: 'base', numeric: true },
      );
      return compareText(a.displayName, b.displayName) ||
        compareText(a.displayType, b.displayType) ||
        compareText(a.osmType, b.osmType) ||
        compareText(a.osmId, b.osmId) ||
        a.id - b.id;
    }

    function subtreeItems(rootId) {
      const childrenByParent = new Map();
      for (const item of state.boundaries) {
        const children = childrenByParent.get(item.parentId) ?? [];
        children.push(item);
        childrenByParent.set(item.parentId, children);
      }

      const result = [];
      const stack = [rootId];
      while (stack.length) {
        const id = stack.pop();
        const item = state.boundaries.find((candidate) => candidate.id === id);
        if (!item) continue;
        result.push(item);
        for (const child of childrenByParent.get(id) ?? []) {
          stack.push(child.id);
        }
      }
      return result;
    }

    function updateBranchActions(item) {
      const controls = [enableBranch, disableBranch].filter(Boolean);
      if (!item) {
        for (const control of controls) control.disabled = true;
        if (enableBranch) enableBranch.textContent = 'Включить ветку';
        if (disableBranch) disableBranch.textContent = 'Отключить ветку';
        return;
      }

      const items = subtreeItems(item.id);
      const activeCount = items.filter((entry) => entry.active).length;
      const inactiveCount = items.length - activeCount;
      if (enableBranch) {
        enableBranch.disabled = inactiveCount === 0;
        enableBranch.textContent = `Включить ветку (${items.length})`;
      }
      if (disableBranch) {
        disableBranch.disabled = activeCount === 0;
        disableBranch.textContent = `Отключить ветку (${items.length})`;
      }
    }

    function node(item, childrenByParent) {
      const wrapper = document.createElement('div');
      wrapper.className = 'osm-boundary-node';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'osm-boundary-node-button';
      button.classList.toggle('is-selected', item.id === state.selectedId);

      const dot = document.createElement('span');
      dot.className = 'osm-boundary-active-dot';
      dot.classList.toggle('is-active', item.active);
      dot.title = item.active ? 'Активная геометрия' : 'Неактивная геометрия';

      const copy = document.createElement('span');
      copy.className = 'osm-boundary-node-copy';
      const name = document.createElement('span');
      name.className = 'osm-boundary-node-name';
      name.textContent = item.displayName;
      const source = document.createElement('span');
      source.className = 'osm-boundary-node-source';
      source.textContent = sourceLabel(item);
      copy.append(name, source);

      const type = document.createElement('span');
      type.className = 'osm-boundary-node-type';
      type.textContent = item.displayType;
      button.append(dot, copy, type);
      button.addEventListener('click', () => void selectBoundary(item.id));
      wrapper.append(button);

      const children = childrenByParent.get(item.id) ?? [];
      if (children.length) {
        const host = document.createElement('div');
        host.className = 'osm-boundary-children';
        for (const child of children) host.append(node(child, childrenByParent));
        wrapper.append(host);
      }
      return wrapper;
    }

    function renderTree() {
      treeHost.replaceChildren();
      const byId = new Map(state.boundaries.map((item) => [item.id, item]));
      const query = normalizeSearchText(searchInput.value);
      const visibleIds = new Set();

      if (query) {
        for (const item of state.boundaries) {
          if (!boundarySearchText(item).includes(query)) continue;
          let current = item;
          while (current && !visibleIds.has(current.id)) {
            visibleIds.add(current.id);
            current = byId.get(current.parentId);
          }
        }
      } else {
        for (const item of state.boundaries) visibleIds.add(item.id);
      }

      const childrenByParent = new Map();
      for (const item of state.boundaries) {
        if (!visibleIds.has(item.id)) continue;
        const parentId = visibleIds.has(item.parentId) ? item.parentId : null;
        const list = childrenByParent.get(parentId) ?? [];
        list.push(item);
        childrenByParent.set(parentId, list);
      }
      for (const items of childrenByParent.values()) {
        items.sort(compareBoundaries);
      }

      const roots = childrenByParent.get(null) ?? [];
      if (!roots.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = query
          ? 'По запросу ничего не найдено.'
          : 'OSM-объекты ещё не загружены.';
        treeHost.append(empty);
        return;
      }
      for (const item of roots) treeHost.append(node(item, childrenByParent));
    }

    function metaItem(label, value) {
      const wrapper = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = value ?? '—';
      wrapper.append(dt, dd);
      return wrapper;
    }

    function ensureType(value) {
      if ([...displayType.options].some((option) => option.value === value)) return;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      displayType.append(option);
    }

    function applySelection(item) {
      state.selectedId = item?.id ?? null;
      const enabled = Boolean(item);
      for (const control of [active, displayName, displayType, save]) {
        control.disabled = !enabled;
      }
      population.disabled = !enabled || !item?.active;
      if (!item) {
        population.value = '';
        population.dataset.initialValue = '';
        title.textContent = 'Выберите объект в дереве';
        meta.replaceChildren();
        updateBranchActions(null);
        renderTree();
        return;
      }
      ensureType(item.displayType);
      active.checked = Boolean(item.active);
      displayName.value = item.displayName;
      displayType.value = item.displayType;
      population.value = item.population ?? '';
      population.dataset.initialValue = item.population === null || item.population === undefined
        ? ''
        : String(item.population);
      population.disabled = !active.checked;
      title.textContent = item.displayName;
      meta.replaceChildren(
        metaItem('OSM', `${item.osmType}/${item.osmId}`),
        metaItem('Исходное имя', item.osmName),
        metaItem('Класс', item.placeType ? `place=${item.placeType}` : 'administrative'),
        metaItem('admin_level', item.adminLevel),
        metaItem('Площадь, км²', Number(item.areaKm2).toLocaleString('ru-RU', { maximumFractionDigits: 2 })),
        metaItem('DB city_id', item.cityId),
        metaItem('Население на дату', item.populationAsOf),
        metaItem('Источник населения', item.populationSource),
      );
      updateBranchActions(item);
      renderTree();
    }

    const MAP_SOURCE_ID = 'osm-boundary-selection';
    const MAP_FILL_LAYER_ID = 'osm-boundary-selection-fill';
    const MAP_LINE_LAYER_ID = 'osm-boundary-selection-line';

    function geometryBounds(feature) {
      let west = Infinity;
      let south = Infinity;
      let east = -Infinity;
      let north = -Infinity;

      const visitCoordinates = (coordinates) => {
        if (!Array.isArray(coordinates)) return;
        if (
          coordinates.length >= 2 &&
          Number.isFinite(coordinates[0]) &&
          Number.isFinite(coordinates[1])
        ) {
          west = Math.min(west, coordinates[0]);
          south = Math.min(south, coordinates[1]);
          east = Math.max(east, coordinates[0]);
          north = Math.max(north, coordinates[1]);
          return;
        }
        for (const coordinate of coordinates) visitCoordinates(coordinate);
      };

      const visitGeometry = (geometry) => {
        if (!geometry) return;
        if (geometry.type === 'GeometryCollection') {
          for (const child of geometry.geometries ?? []) visitGeometry(child);
          return;
        }
        visitCoordinates(geometry.coordinates);
      };

      visitGeometry(feature?.geometry);
      return [west, south, east, north].every(Number.isFinite)
        ? [[west, south], [east, north]]
        : null;
    }

    async function ensureMap() {
      if (state.mapReady) return state.mapReady;
      if (!globalThis.mapboxgl) {
        throw new Error('Mapbox GL не загрузился.');
      }

      state.mapReady = (async () => {
        const payload = await api('/api/config');
        const config = payload?.map;
        if (!config?.accessToken || !config?.styleUrl) {
          throw new Error('Настройки Mapbox для проекта не заданы.');
        }

        globalThis.mapboxgl.accessToken = config.accessToken;
        state.map = new globalThis.mapboxgl.Map({
          container: mapHost,
          style: config.styleUrl,
          center: config.initialCenter ?? [37.6173, 55.7558],
          zoom: config.initialZoom ?? 4,
        });
        state.map.addControl(
          new globalThis.mapboxgl.NavigationControl(),
          'top-right',
        );

        await new Promise((resolve, reject) => {
          const onLoad = () => {
            state.map.off('error', onError);
            resolve();
          };
          const onError = (event) => {
            if (state.map.loaded()) return;
            state.map.off('load', onLoad);
            reject(event?.error ?? new Error('Mapbox GL не смог загрузить стиль.'));
          };
          state.map.once('load', onLoad);
          state.map.on('error', onError);
        });

        state.map.addSource(MAP_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        state.map.addLayer({
          id: MAP_FILL_LAYER_ID,
          type: 'fill',
          source: MAP_SOURCE_ID,
          paint: {
            'fill-color': '#3388ff',
            'fill-opacity': 0.18,
          },
        });
        state.map.addLayer({
          id: MAP_LINE_LAYER_ID,
          type: 'line',
          source: MAP_SOURCE_ID,
          paint: {
            'line-color': '#3388ff',
            'line-width': 3,
          },
        });
        return state.map;
      })();

      try {
        return await state.mapReady;
      } catch (error) {
        state.mapReady = null;
        state.map?.remove();
        state.map = null;
        throw error;
      }
    }

    async function showGeometry(id) {
      const [map, feature] = await Promise.all([
        ensureMap(),
        api(`/api/admin/osm-boundaries/${encodeURIComponent(id)}/geometry`),
      ]);
      map.getSource(MAP_SOURCE_ID).setData(feature);
      const bounds = geometryBounds(feature);
      if (bounds) {
        map.fitBounds(bounds, {
          padding: 32,
          maxZoom: 15,
        });
      }
      window.setTimeout(() => map.resize(), 0);
    }

    async function selectBoundary(id) {
      const item = state.boundaries.find((candidate) => candidate.id === id);
      if (!item) return;
      applySelection(item);
      setMessage('');
      try {
        await showGeometry(id);
      } catch (error) {
        setMessage(`Не удалось загрузить геометрию: ${error.message}`, 'error');
      }
    }

    async function load({ keepSelection = true } = {}) {
      refreshButton.disabled = true;
      try {
        const payload = await api('/api/admin/osm-boundaries');
        state.boundaries = payload.boundaries ?? [];
        const selected = keepSelection
          ? state.boundaries.find((item) => item.id === state.selectedId)
          : null;
        applySelection(selected ?? null);
        if (!selected) renderTree();
        setMessage('');
      } catch (error) {
        setMessage(`Не удалось загрузить дерево: ${error.message}`, 'error');
      } finally {
        refreshButton.disabled = false;
      }
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!state.selectedId || !form.reportValidity()) return;
      save.disabled = true;
      setMessage('Сохраняем…');
      try {
        const payload = await api(
          `/api/admin/osm-boundaries/${encodeURIComponent(state.selectedId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify((() => {
              const changes = {
                active: active.checked,
                displayName: displayName.value.trim(),
                displayType: displayType.value,
              };
              const populationValue = population.value.trim();
              if (
                active.checked &&
                populationValue !== (population.dataset.initialValue ?? '')
              ) {
                changes.population = populationValue === ''
                  ? null
                  : Number(populationValue);
              }
              return changes;
            })()),
          },
        );
        await load();
        const updated = state.boundaries.find((item) => item.id === payload.boundary.id);
        if (updated) applySelection(updated);
        setMessage('Настройки OSM-объекта сохранены.', 'success');
        window.dispatchEvent(new CustomEvent('dtpstat:osm-boundary-changed'));
      } catch (error) {
        setMessage(error.message, 'error');
      } finally {
        save.disabled = !state.selectedId;
      }
    });

    active.addEventListener('change', () => {
      population.disabled = !state.selectedId || !active.checked;
    });

    searchInput.addEventListener('input', () => renderTree());
    refreshButton.addEventListener('click', () => void load());
    window.addEventListener('dtpstat:osm-boundary-editor-open', () => {
      void load();
      window.setTimeout(() => state.map?.resize(), 0);
    });
    window.addEventListener('dtpstat:osm-boundaries-reloaded', () => void load());
    void load({ keepSelection: false });
  }
}
