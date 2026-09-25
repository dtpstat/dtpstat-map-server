import { adminConfirm } from './admin-dialog.js';
import { createDraftStore } from './draft-store.js';
import { publishDerivedDataChange } from './derived-data-events.js';
import {
  realtimeClientId,
  realtimeMutationHeaders,
  subscribeAdminRealtime,
} from './realtime-client.js';

export function buildBoundaryTreeIndex(items) {
  const byId = new Map();
  const childrenByParent = new Map();
  for (const item of items) {
    byId.set(item.id, item);
    const children = childrenByParent.get(item.parentId) ?? [];
    children.push(item);
    childrenByParent.set(item.parentId, children);
  }
  return { byId, childrenByParent };
}

export function aggregateBoundaryBranchStatus(
  item,
  childrenByParent,
  memo = new Map(),
) {
  if (memo.has(item.id)) return memo.get(item.id);

  let totalCount = 1;
  let activeCount = item.active ? 1 : 0;
  for (const child of childrenByParent.get(item.id) ?? []) {
    const childStatus = aggregateBoundaryBranchStatus(
      child,
      childrenByParent,
      memo,
    );
    totalCount += childStatus.totalCount;
    activeCount += childStatus.activeCount;
  }

  const status = activeCount === 0
    ? 'inactive'
    : activeCount === totalCount
      ? 'active'
      : 'partial';
  const result = { status, activeCount, totalCount };
  memo.set(item.id, result);
  return result;
}

if (typeof document !== 'undefined') {
  const panel = document.querySelector('#admin-section-osm-objects');
  const treeHost = document.querySelector('#osm-boundary-tree');
  const searchInput = document.querySelector('#osm-boundary-search');
  const refreshButton = document.querySelector('#osm-boundary-refresh');
  const form = document.querySelector('#osm-boundary-form');
  const title = document.querySelector('#osm-boundary-selected-title');
  const sourceMeta = document.querySelector('#osm-boundary-source-meta');
  const geometryMeta = document.querySelector('#osm-boundary-geometry-meta');
  const message = document.querySelector('#osm-boundary-message');
  const mapHost = document.querySelector('#osm-boundary-map');

  if (panel && treeHost && searchInput && refreshButton && form && mapHost) {
    const state = {
      boundaries: [],
      serverBoundaries: [],
      selectedId: null,
      expandedIds: new Set(),
      map: null,
      mapReady: null,
    };

    const field = (name) => form.elements.namedItem(name);
    const active = field('active');
    const displayName = field('displayName');
    const displayType = field('displayType');
    const population = field('population');
    const populationAsOf = field('populationAsOf');
    const populationSource = field('populationSource');
    const attributes = field('attributes');
    const save = document.querySelector('#osm-boundary-save');
    const enableBranch = document.querySelector('#osm-boundary-enable-branch');
    const disableBranch = document.querySelector('#osm-boundary-disable-branch');
    const drafts = createDraftStore({
      namespace: 'osm-boundaries',
    });

    function serverBoundary(id) {
      return state.serverBoundaries.find((item) => item.id === id) ?? null;
    }

    function draftFor(id) {
      return drafts.get(id);
    }

    function withDraft(item) {
      const draft = item ? draftFor(item.id) : null;
      return draft
        ? {
          ...item,
          ...draft.changes,
          _draft: true,
          _conflict: Boolean(draft.conflict),
        }
        : item;
    }

    function rebuildDraftOverlay() {
      state.boundaries = state.serverBoundaries.map(withDraft);
    }

    function refreshDraftControls() {
      const entries = drafts.list();
      const conflicts = entries.filter((draft) => draft.conflict).length;
      if (draftCount) {
        draftCount.textContent = conflicts
          ? `Черновики: ${entries.length} · конфликтов: ${conflicts}`
          : `Черновики: ${entries.length}`;
      }
      if (saveAll) saveAll.disabled = entries.length === 0;
      if (discardAll) discardAll.disabled = entries.length === 0;
      if (persistDrafts) persistDrafts.checked = drafts.isPersistent();
    }

    function setMessage(text, tone = '') {
      message.textContent = text;
      message.className = 'notice';
      if (tone) message.classList.add(`notice-${tone}`);
    }

    async function api(path, options = {}) {
      const method = String(options.method ?? 'GET').toUpperCase();
      const headers = {
        Accept: 'application/json',
        ...(options.headers ?? {}),
      };
      const response = await fetch(path, {
        credentials: 'same-origin',
        ...options,
        headers: ['GET', 'HEAD'].includes(method)
          ? headers
          : realtimeMutationHeaders(headers),
      });
      let payload = null;
      try { payload = await response.json(); } catch { /* empty */ }
      if (!response.ok) {
        const error = new Error(payload?.error ?? `HTTP ${response.status}`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
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
      const { byId, childrenByParent } = buildBoundaryTreeIndex(state.boundaries);
      const result = [];
      const stack = [rootId];
      while (stack.length) {
        const id = stack.pop();
        const item = byId.get(id);
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

    function node(
      item,
      childrenByParent,
      fullChildrenByParent,
      statusMemo,
      searchMode,
    ) {
      const wrapper = document.createElement('div');
      wrapper.className = 'osm-boundary-node';

      const children = childrenByParent.get(item.id) ?? [];
      const hasChildren = children.length > 0;
      const expanded = hasChildren && (
        searchMode || state.expandedIds.has(item.id)
      );

      const row = document.createElement('div');
      row.className = 'osm-boundary-node-row';

      if (hasChildren) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'osm-boundary-toggle';
        toggle.disabled = searchMode;
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute(
          'aria-label',
          searchMode
            ? 'Поиск автоматически раскрывает ветку'
            : expanded
              ? 'Свернуть ветку'
              : 'Развернуть ветку',
        );
        toggle.textContent = expanded ? '▾' : '▸';
        toggle.addEventListener('click', () => {
          if (state.expandedIds.has(item.id)) {
            state.expandedIds.delete(item.id);
          } else {
            state.expandedIds.add(item.id);
          }
          renderTree();
        });
        row.append(toggle);
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'osm-boundary-toggle-spacer';
        row.append(spacer);
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'osm-boundary-node-button';
      button.classList.toggle('is-selected', item.id === state.selectedId);
      button.classList.toggle('has-draft', Boolean(item._draft));
      button.classList.toggle('has-conflict', Boolean(item._conflict));

      const aggregate = aggregateBoundaryBranchStatus(item, fullChildrenByParent, statusMemo);
      const dot = document.createElement('span');
      dot.className = 'osm-boundary-active-dot';
      dot.classList.add(`is-${aggregate.status}`);
      dot.title = aggregate.status === 'active'
        ? `Ветка полностью включена (${aggregate.activeCount}/${aggregate.totalCount})`
        : aggregate.status === 'inactive'
          ? `Ветка полностью выключена (0/${aggregate.totalCount})`
          : `Ветка включена частично (${aggregate.activeCount}/${aggregate.totalCount})`;

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
      row.append(button);
      wrapper.append(row);

      if (expanded) {
        const host = document.createElement('div');
        host.className = 'osm-boundary-children';
        for (const child of children) {
          host.append(node(
            child,
            childrenByParent,
            fullChildrenByParent,
            statusMemo,
            searchMode,
          ));
        }
        wrapper.append(host);
      }
      return wrapper;
    }

    function renderTree() {
      treeHost.replaceChildren();
      const { byId, childrenByParent: fullChildrenByParent } = buildBoundaryTreeIndex(state.boundaries);
      const query = normalizeSearchText(searchInput.value);
      const searchMode = Boolean(query);
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
      const statusMemo = new Map();
      for (const item of roots) {
        treeHost.append(node(
          item,
          childrenByParent,
          fullChildrenByParent,
          statusMemo,
          searchMode,
        ));
      }
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
      const localDraft = item ? draftFor(item.id) : null;
      const enabled = Boolean(item);
      for (const control of [
        active,
        displayName,
        displayType,
        population,
        populationAsOf,
        populationSource,
        attributes,
        save,
      ]) {
        control.disabled = !enabled;
      }
      if (!item) {
        population.value = '';
        population.dataset.initialValue = '';
        populationAsOf.value = '';
        populationAsOf.dataset.initialValue = '';
        populationSource.value = '';
        populationSource.dataset.initialValue = '';
        attributes.value = '{}';
        attributes.dataset.initialValue = '{}';
        title.textContent = 'Выберите объект в дереве';
        sourceMeta?.replaceChildren();
        geometryMeta?.replaceChildren();
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
      populationAsOf.value = item.populationAsOf
        ? String(item.populationAsOf).slice(0, 10)
        : '';
      populationAsOf.dataset.initialValue = populationAsOf.value;
      populationSource.value = item.populationSource ?? '';
      populationSource.dataset.initialValue = populationSource.value;
      const territoryAttributes = item.attributes ?? {};
      attributes.value = JSON.stringify(territoryAttributes, null, 2);
      attributes.dataset.initialValue = JSON.stringify(territoryAttributes);
      title.textContent = item.displayName;
      sourceMeta?.replaceChildren(
        metaItem('OSM', `${item.osmType}/${item.osmId}`),
        metaItem('Исходное имя', item.osmName),
        metaItem('Класс', item.placeType ? `place=${item.placeType}` : 'administrative'),
        metaItem('admin_level', item.adminLevel),
        metaItem('DB city_id', item.cityId),
      );
      geometryMeta?.replaceChildren(
        metaItem(
          'Площадь, км²',
          Number(item.areaKm2).toLocaleString('ru-RU', { maximumFractionDigits: 2 }),
        ),
      );
      updateBranchActions(item);
      if (localDraft?.conflict) {
        setMessage(
          'Серверная версия изменилась после создания локального черновика. Проверьте изменения перед сохранением.',
          'error',
        );
      }
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

    function formChanges(baseItem) {
      if (!baseItem) return {};

      const changes = {};
      if (active.checked !== Boolean(baseItem.active)) {
        changes.active = active.checked;
      }

      const displayNameValue = displayName.value.trim();
      if (displayNameValue !== String(baseItem.displayName ?? '')) {
        changes.displayName = displayNameValue;
      }

      if (displayType.value !== String(baseItem.displayType ?? '')) {
        changes.displayType = displayType.value;
      }

      const populationValue = population.value.trim();
      const normalizedPopulation = populationValue === ''
        ? null
        : Number(populationValue);
      if (normalizedPopulation !== (baseItem.population ?? null)) {
        changes.population = normalizedPopulation;
      }

      const populationAsOfValue = populationAsOf.value.trim();
      const normalizedPopulationAsOf =
        populationAsOfValue === '' ? null : populationAsOfValue;
      const basePopulationAsOf = baseItem.populationAsOf
        ? String(baseItem.populationAsOf).slice(0, 10)
        : null;
      if (normalizedPopulationAsOf !== basePopulationAsOf) {
        changes.populationAsOf = normalizedPopulationAsOf;
      }

      const populationSourceValue = populationSource.value.trim();
      const normalizedPopulationSource =
        populationSourceValue === '' ? null : populationSourceValue;
      if (normalizedPopulationSource !== (baseItem.populationSource ?? null)) {
        changes.populationSource = normalizedPopulationSource;
      }

      let attributesValue;
      try {
        attributesValue = JSON.parse(attributes.value.trim() || '{}');
      } catch {
        throw new Error('Атрибуты территории должны быть корректным JSON object.');
      }
      if (
        !attributesValue ||
        typeof attributesValue !== 'object' ||
        Array.isArray(attributesValue)
      ) {
        throw new Error('Атрибуты территории должны быть JSON object.');
      }
      if (
        JSON.stringify(attributesValue) !==
        JSON.stringify(baseItem.attributes ?? {})
      ) {
        changes.attributes = attributesValue;
      }

      return changes;
    }

    function captureSelectedDraft() {
      if (!state.selectedId) return;
      const baseItem = serverBoundary(state.selectedId);
      if (!baseItem) return;

      const changes = formChanges(baseItem);
      const keys = Object.keys(changes);
      if (keys.length === 0) {
        drafts.remove(state.selectedId);
      } else {
        const current = draftFor(state.selectedId);
        drafts.upsert(state.selectedId, {
          baseUpdatedAt: current?.baseUpdatedAt ?? baseItem.updatedAt,
          changes,
          conflict: Boolean(current?.conflict),
        });
      }

      rebuildDraftOverlay();
      refreshDraftControls();
      renderTree();
    }

    function reconcileDrafts() {
      for (const draft of drafts.list()) {
        const item = serverBoundary(Number(draft.id));
        if (!item) {
          drafts.markConflict(draft.id, true);
          continue;
        }
        if (
          draft.baseUpdatedAt &&
          String(item.updatedAt) !== String(draft.baseUpdatedAt)
        ) {
          drafts.markConflict(draft.id, true);
        }
      }
      rebuildDraftOverlay();
      refreshDraftControls();
    }

    async function saveDraftEntries(entries) {
      if (!entries.length) return null;
      const payload = await api('/api/admin/osm-boundaries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: entries.map((draft) => ({
            id: Number(draft.id),
            baseUpdatedAt: draft.baseUpdatedAt,
            changes: draft.changes,
          })),
        }),
      });
      for (const draft of entries) drafts.remove(draft.id);
      await load();
      publishDerivedDataChange('osm-boundary');
      publishDerivedDataChange('osm-boundary-subtree');
      window.dispatchEvent(new CustomEvent('dtpstat:osm-boundary-changed'));
      return payload;
    }

    async function selectBoundary(id) {
      const item = state.boundaries.find((candidate) => candidate.id === id);
      if (!item) return;
      applySelection(item);
      if (!draftFor(id)?.conflict) setMessage('');
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
        state.serverBoundaries = payload.boundaries ?? [];
        reconcileDrafts();
        const validIds = new Set(state.boundaries.map((item) => item.id));
        state.expandedIds = new Set(
          [...state.expandedIds].filter((id) => validIds.has(id)),
        );
        const selected = keepSelection
          ? state.boundaries.find((item) => item.id === state.selectedId)
          : null;
        applySelection(selected ?? null);
        if (!selected) renderTree();
        if (!selected || !draftFor(selected.id)?.conflict) {
          setMessage('');
        }
      } catch (error) {
        setMessage(`Не удалось загрузить дерево: ${error.message}`, 'error');
      } finally {
        refreshButton.disabled = false;
      }
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!state.selectedId || !form.reportValidity()) return;

      try {
        captureSelectedDraft();
      } catch (error) {
        setMessage(error.message, 'error');
        return;
      }

      const draft = draftFor(state.selectedId);
      if (!draft) {
        setMessage('Нет несохранённых изменений.');
        return;
      }

      save.disabled = true;
      setMessage('Сохраняем локальный черновик…');
      try {
        await saveDraftEntries([
          {
            id: String(state.selectedId),
            ...draft,
          },
        ]);
        setMessage(
          'Настройки OSM-объекта сохранены. Таблица и линии пересчитаны.',
          'success',
        );
      } catch (error) {
        if (error.status === 409) {
          for (const conflict of error.payload?.details?.conflicts ?? []) {
            drafts.markConflict(conflict.id, true);
          }
          refreshDraftControls();
          rebuildDraftOverlay();
          renderTree();
        }
        setMessage(error.message, 'error');
      } finally {
        save.disabled = !state.selectedId;
      }
    });

    async function setBranchActive(nextActive) {
      const item = state.boundaries.find(
        (candidate) => candidate.id === state.selectedId,
      );
      if (!item) return;

      const items = subtreeItems(item.id);
      const changedCount = items.filter(
        (entry) => entry.active !== nextActive,
      ).length;
      if (changedCount === 0) return;

      const confirmed = await adminConfirm({
        title: nextActive ? 'Включить ветку?' : 'Отключить ветку?',
        message:
          `${nextActive ? 'Будут включены' : 'Будут отключены'} выбранный объект ` +
          `«${item.displayName}» и вложенные объекты. ` +
          `Объектов в ветке: ${items.length}; изменится: ${changedCount}.`,
        confirmLabel: nextActive ? 'Включить ветку' : 'Отключить ветку',
        cancelLabel: 'Отмена',
        destructive: !nextActive,
      });
      if (!confirmed) return;

      for (const control of [save, enableBranch, disableBranch]) {
        if (control) control.disabled = true;
      }
      setMessage(nextActive ? 'Включаем ветку…' : 'Отключаем ветку…');

      try {
        const payload = await api(
          `/api/admin/osm-boundaries/${encodeURIComponent(item.id)}/subtree`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: nextActive }),
          },
        );
        await load();
        const updated = state.boundaries.find(
          (candidate) => candidate.id === item.id,
        );
        if (updated) applySelection(updated);
        const result = payload.subtree;
        setMessage(
          `${nextActive ? 'Включено' : 'Отключено'} объектов: ` +
          `${result.changedCount} из ${result.affectedCount}.`,
          'success',
        );
        window.dispatchEvent(new CustomEvent('dtpstat:osm-boundary-changed'));
      } catch (error) {
        setMessage(error.message, 'error');
        updateBranchActions(item);
      } finally {
        save.disabled = !state.selectedId;
      }
    }

    for (const control of [
      active,
      displayName,
      displayType,
      population,
      populationAsOf,
      populationSource,
      attributes,
    ]) {
      control?.addEventListener('input', () => {
        try {
          captureSelectedDraft();
          setMessage('');
        } catch (error) {
          setMessage(error.message, 'error');
        }
      });
      control?.addEventListener('change', () => {
        try {
          captureSelectedDraft();
        } catch (error) {
          setMessage(error.message, 'error');
        }
      });
    }

    saveAll?.addEventListener('click', async () => {
      const entries = drafts.list();
      if (!entries.length) return;
      saveAll.disabled = true;
      setMessage(`Сохраняем черновики: ${entries.length}…`);
      try {
        const payload = await saveDraftEntries(entries);
        setMessage(
          `Сохранено объектов: ${payload.changedCount}. Все локальные черновики применены.`,
          'success',
        );
      } catch (error) {
        if (error.status === 409) {
          for (const conflict of error.payload?.details?.conflicts ?? []) {
            drafts.markConflict(conflict.id, true);
          }
          refreshDraftControls();
          rebuildDraftOverlay();
          const selected = state.boundaries.find((item) => item.id === state.selectedId);
          if (selected) applySelection(selected);
        }
        setMessage(error.message, 'error');
      } finally {
        refreshDraftControls();
      }
    });

    discardAll?.addEventListener('click', async () => {
      const entries = drafts.list();
      if (!entries.length) return;
      const confirmed = await adminConfirm({
        title: 'Сбросить локальные черновики?',
        message: `Будут удалены локальные изменения объектов: ${entries.length}. Серверные данные не изменятся.`,
        confirmLabel: 'Сбросить черновики',
        cancelLabel: 'Отмена',
        destructive: true,
      });
      if (!confirmed) return;
      drafts.clear();
      await load();
      setMessage('Локальные черновики удалены.');
    });

    persistDrafts?.addEventListener('change', () => {
      drafts.setPersistent(persistDrafts.checked);
      refreshDraftControls();
      setMessage(
        drafts.isPersistent()
          ? 'Черновики будут храниться в localStorage между сессиями.'
          : 'Черновики хранятся только в sessionStorage текущей вкладки.',
      );
    });

    subscribeAdminRealtime((message) => {
      if (
        message?.type !== 'data-change' ||
        message.change?.resource !== 'osm-boundaries' ||
        message.change?.originClientId === realtimeClientId()
      ) {
        return;
      }

      void load().then(() => {
        const conflicts = drafts.list().filter((draft) => draft.conflict).length;
        setMessage(
          conflicts
            ? `OSM-данные синхронизированы. Локальных конфликтов: ${conflicts}.`
            : 'OSM-данные автоматически синхронизированы.',
          conflicts ? 'error' : 'success',
        );
      });
    });

    enableBranch?.addEventListener('click', () => void setBranchActive(true));
    disableBranch?.addEventListener('click', () => void setBranchActive(false));
    searchInput.addEventListener('input', () => renderTree());
    refreshButton.addEventListener('click', () => void load());
    window.addEventListener('dtpstat:osm-boundary-editor-open', () => {
      void load();
      window.setTimeout(() => state.map?.resize(), 0);
    });
    window.addEventListener('dtpstat:osm-boundaries-reloaded', () => void load());
    refreshDraftControls();
    void load({ keepSelection: false });
  }
}
