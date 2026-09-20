if (typeof document !== 'undefined') {
  const panel = document.querySelector('#admin-section-osm-objects');
  const treeHost = document.querySelector('#osm-boundary-tree');
  const refreshButton = document.querySelector('#osm-boundary-refresh');
  const form = document.querySelector('#osm-boundary-form');
  const title = document.querySelector('#osm-boundary-selected-title');
  const meta = document.querySelector('#osm-boundary-meta');
  const message = document.querySelector('#osm-boundary-message');
  const mapHost = document.querySelector('#osm-boundary-map');

  if (panel && treeHost && refreshButton && form && mapHost) {
    const state = {
      boundaries: [],
      selectedId: null,
      map: null,
      layer: null,
    };

    const field = (name) => form.elements.namedItem(name);
    const active = field('active');
    const displayName = field('displayName');
    const displayType = field('displayType');
    const population = field('population');
    const save = form.querySelector('button[type="submit"]');

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
      const childrenByParent = new Map();
      for (const item of state.boundaries) {
        const parentId = byId.has(item.parentId) ? item.parentId : null;
        const list = childrenByParent.get(parentId) ?? [];
        list.push(item);
        childrenByParent.set(parentId, list);
      }
      const sort = (items) => items.sort((a, b) =>
        Number(b.active) - Number(a.active) ||
        a.displayName.localeCompare(b.displayName, 'ru-RU') ||
        a.id - b.id);
      for (const items of childrenByParent.values()) sort(items);

      const roots = childrenByParent.get(null) ?? [];
      if (!roots.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'OSM-объекты ещё не загружены.';
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
      renderTree();
    }

    function ensureMap() {
      if (state.map || !globalThis.L) return;
      state.map = globalThis.L.map(mapHost, { preferCanvas: true }).setView([55.75, 37.62], 4);
      globalThis.L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        },
      ).addTo(state.map);
    }

    async function showGeometry(id) {
      ensureMap();
      if (!state.map) {
        setMessage('Leaflet не загрузился.', 'error');
        return;
      }
      const feature = await api(
        `/api/admin/osm-boundaries/${encodeURIComponent(id)}/geometry`,
      );
      if (state.layer) state.map.removeLayer(state.layer);
      state.layer = globalThis.L.geoJSON(feature, {
        style: { weight: 3, fillOpacity: 0.18 },
      }).addTo(state.map);
      const bounds = state.layer.getBounds();
      if (bounds.isValid()) state.map.fitBounds(bounds, { padding: [20, 20] });
      window.setTimeout(() => state.map.invalidateSize(), 0);
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

    refreshButton.addEventListener('click', () => void load());
    window.addEventListener('dtpstat:osm-boundary-editor-open', () => {
      void load();
      window.setTimeout(() => state.map?.invalidateSize(), 0);
    });
    window.addEventListener('dtpstat:osm-boundaries-reloaded', () => void load());
    void load({ keepSelection: false });
  }
}
