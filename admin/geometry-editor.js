const section = document.querySelector('#admin-section-geometries');

if (section) {
  const citySelect = document.querySelector('#geometry-editor-city');
  const searchInput = document.querySelector('#geometry-editor-search');
  const listHost = document.querySelector('#geometry-editor-list');
  const refreshButton = document.querySelector('#geometry-editor-refresh');
  const form = document.querySelector('#geometry-editor-form');
  const title = document.querySelector('#geometry-editor-selected-title');
  const lineFields = document.querySelector('#geometry-line-fields');
  const polygonActions = document.querySelector('#geometry-polygon-actions');
  const message = document.querySelector('#geometry-editor-message');
  const meta = document.querySelector('#geometry-editor-meta');
  const sourceTags = document.querySelector('#geometry-source-tags');
  const mergeButton = document.querySelector('#geometry-merge-selected');
  const deleteButton = document.querySelector('#geometry-delete');
  const revertButton = document.querySelector('#geometry-revert');
  const cutButton = document.querySelector('#geometry-cut-area');
  const undoButton = document.querySelector('#geometry-undo');
  const redoButton = document.querySelector('#geometry-redo');
  const deleteNodeButton = document.querySelector('#geometry-delete-node');
  const finishDrawButton = document.querySelector('#geometry-finish-draw');
  const cancelDrawButton = document.querySelector('#geometry-cancel-draw');
  const modeLabel = document.querySelector('#geometry-editor-mode');

  const MAP_SOURCE = 'geometry-editor-items';
  const SELECTED_SOURCE = 'geometry-editor-selected';
  const HANDLE_SOURCE = 'geometry-editor-handles';
  const DRAW_SOURCE = 'geometry-editor-draw';
  const BOUNDARY_SOURCE = 'geometry-editor-boundary';

  const state = {
    cities: [],
    lineTypes: [],
    knownTags: [],
    city: null,
    geometries: [],
    selectedId: null,
    selectedSet: new Set(),
    current: null,
    draft: null,
    history: [],
    future: [],
    selectedVertexPath: null,
    drawing: null,
    map: null,
    mapReady: null,
    dragPath: null,
    suppressMapClick: false,
  };

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { Accept: 'application/json', ...(options.headers ?? {}) },
    });
    let payload = null;
    try { payload = await response.json(); } catch { /* empty response */ }
    if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
    return payload;
  }

  function clone(value) {
    return value === null || value === undefined ? value : structuredClone(value);
  }

  function setMessage(text, tone = '') {
    message.textContent = text ?? '';
    message.className = `notice${tone ? ` notice-${tone}` : ''}`;
  }

  function typeLabel(item) {
    const labels = {
      POINT: 'Точка',
      LINESTRING: 'Линия',
      MULTILINESTRING: 'Мультилиния',
      POLYGON: 'Полигон',
      MULTIPOLYGON: 'Мультиполигон',
    };
    return labels[item?.geometryType] ?? item?.geometryType ?? 'Геометрия';
  }

  function displayName(item) {
    if (item?.displayName?.trim()) return item.displayName.trim();
    const id = item?.id ?? 'новая';
    return `${typeLabel(item)} #${id}`;
  }

  function geometryType(geometry) {
    return geometry?.type?.toUpperCase?.() ?? '';
  }

  function familyOf(geometry) {
    if (geometry?.type === 'Point') return 'point';
    if (geometry?.type === 'LineString' || geometry?.type === 'MultiLineString') return 'line';
    if (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') return 'polygon';
    return null;
  }

  function feature(item) {
    return {
      type: 'Feature',
      id: item.id ?? undefined,
      geometry: item.geometry,
      properties: {
        id: item.id ?? -1,
        family: item.family ?? familyOf(item.geometry),
        isVisible: item.isVisible !== false,
        lineColor: item.lineTypeColor ?? '#35c6b4',
        lineWidth: item.lineTypeWidth ?? 4,
        name: displayName(item),
      },
    };
  }

  function featureCollection(items) {
    return { type: 'FeatureCollection', features: items.filter((item) => item?.geometry).map(feature) };
  }

  function emptyCollection() {
    return { type: 'FeatureCollection', features: [] };
  }

  function geometryBounds(geometry) {
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    const visit = (value) => {
      if (!Array.isArray(value)) return;
      if (
        value.length >= 2 &&
        typeof value[0] === 'number' &&
        typeof value[1] === 'number'
      ) {
        west = Math.min(west, value[0]);
        east = Math.max(east, value[0]);
        south = Math.min(south, value[1]);
        north = Math.max(north, value[1]);
        return;
      }
      for (const child of value) visit(child);
    };
    visit(geometry?.coordinates);
    return [west, south, east, north].every(Number.isFinite)
      ? [[west, south], [east, north]]
      : null;
  }

  function midpoint(a, b) {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }

  function pathKey(path) {
    return JSON.stringify(path);
  }

  function getAt(root, path) {
    let value = root;
    for (const index of path) value = value[index];
    return value;
  }

  function setAt(root, path, value) {
    const parent = getAt(root, path.slice(0, -1));
    parent[path[path.length - 1]] = value;
  }

  function samePosition(a, b) {
    return a?.[0] === b?.[0] && a?.[1] === b?.[1];
  }

  function editableSequences(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Point') {
      return [{ prefix: [], coordinates: [geometry.coordinates], point: true }];
    }
    if (geometry.type === 'LineString') {
      return [{ prefix: [], coordinates: geometry.coordinates, closed: false }];
    }
    if (geometry.type === 'MultiLineString') {
      return geometry.coordinates.map((coordinates, lineIndex) => ({
        prefix: [lineIndex], coordinates, closed: false,
      }));
    }
    if (geometry.type === 'Polygon') {
      return geometry.coordinates.map((coordinates, ringIndex) => ({
        prefix: [ringIndex], coordinates, closed: true,
      }));
    }
    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.flatMap((polygon, polygonIndex) =>
        polygon.map((coordinates, ringIndex) => ({
          prefix: [polygonIndex, ringIndex], coordinates, closed: true,
        })));
    }
    return [];
  }

  function normalizeClosedRings(geometry) {
    for (const sequence of editableSequences(geometry)) {
      if (!sequence.closed) continue;
      const coords = getAt(geometry.coordinates, sequence.prefix);
      if (coords.length < 1) continue;
      if (!samePosition(coords[0], coords[coords.length - 1])) {
        coords[coords.length - 1] = [...coords[0]];
      }
    }
    return geometry;
  }

  function handleFeatures() {
    const geometry = state.draft;
    if (!geometry || state.drawing) return emptyCollection();
    const features = [];
    for (const sequence of editableSequences(geometry)) {
      if (sequence.point) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: geometry.coordinates },
          properties: { kind: 'vertex', path: pathKey([]) },
        });
        continue;
      }
      const coords = getAt(geometry.coordinates, sequence.prefix);
      const uniqueLength = sequence.closed ? Math.max(0, coords.length - 1) : coords.length;
      for (let index = 0; index < uniqueLength; index += 1) {
        const vertexPath = [...sequence.prefix, index];
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: coords[index] },
          properties: { kind: 'vertex', path: pathKey(vertexPath) },
        });
        const nextIndex = sequence.closed
          ? (index + 1) % uniqueLength
          : index + 1;
        if (nextIndex >= uniqueLength) continue;
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: midpoint(coords[index], coords[nextIndex]) },
          properties: {
            kind: 'midpoint',
            path: pathKey([...sequence.prefix, index]),
            nextIndex,
          },
        });
      }
    }
    return { type: 'FeatureCollection', features };
  }

  function drawingFeature() {
    const drawing = state.drawing;
    if (!drawing || drawing.coordinates.length === 0) return emptyCollection();
    let geometry;
    if (drawing.mode === 'point') {
      geometry = { type: 'Point', coordinates: drawing.coordinates[0] };
    } else if (drawing.mode === 'line') {
      if (drawing.coordinates.length === 1) {
        geometry = { type: 'Point', coordinates: drawing.coordinates[0] };
      } else {
        geometry = { type: 'LineString', coordinates: drawing.coordinates };
      }
    } else {
      const coords = [...drawing.coordinates];
      if (coords.length >= 2) coords.push([...coords[0]]);
      geometry = coords.length >= 4
        ? { type: 'Polygon', coordinates: [coords] }
        : { type: 'LineString', coordinates: drawing.coordinates };
    }
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry, properties: {} }],
    };
  }

  function addLayerSafe(map, layer, before) {
    if (!map.getLayer(layer.id)) map.addLayer(layer, before);
  }

  async function ensureMap() {
    if (state.mapReady) return state.mapReady;
    state.mapReady = (async () => {
      const configPayload = await api('/api/config');
      const config = configPayload.map;
      if (!config?.accessToken || !config?.styleUrl) {
        throw new Error('Настройки Mapbox для проекта не заданы.');
      }
      globalThis.mapboxgl.accessToken = config.accessToken;
      const map = new globalThis.mapboxgl.Map({
        container: 'geometry-editor-map',
        style: config.styleUrl,
        center: config.initialCenter ?? [37.6173, 55.7558],
        zoom: config.initialZoom ?? 4,
      });
      map.addControl(new globalThis.mapboxgl.NavigationControl(), 'top-right');
      await new Promise((resolve, reject) => {
        map.once('load', resolve);
        map.once('error', (event) => reject(event?.error ?? new Error('Mapbox GL error')));
      });

      map.addSource(BOUNDARY_SOURCE, { type: 'geojson', data: emptyCollection() });
      map.addSource(MAP_SOURCE, { type: 'geojson', data: emptyCollection() });
      map.addSource(SELECTED_SOURCE, { type: 'geojson', data: emptyCollection() });
      map.addSource(HANDLE_SOURCE, { type: 'geojson', data: emptyCollection() });
      map.addSource(DRAW_SOURCE, { type: 'geojson', data: emptyCollection() });

      addLayerSafe(map, {
        id: 'geometry-editor-boundary-fill',
        type: 'fill',
        source: BOUNDARY_SOURCE,
        paint: { 'fill-color': '#35c6b4', 'fill-opacity': 0.035 },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-boundary-line',
        type: 'line',
        source: BOUNDARY_SOURCE,
        paint: { 'line-color': '#35c6b4', 'line-width': 1.5, 'line-opacity': 0.45, 'line-dasharray': [3, 2] },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-polygons',
        type: 'fill',
        source: MAP_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': '#6f8da0',
          'fill-opacity': ['case', ['get', 'isVisible'], 0.2, 0.07],
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-polygon-lines',
        type: 'line',
        source: MAP_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'line-color': '#91a5ab',
          'line-width': 2,
          'line-opacity': ['case', ['get', 'isVisible'], 0.8, 0.3],
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-lines',
        type: 'line',
        source: MAP_SOURCE,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['coalesce', ['get', 'lineColor'], '#35c6b4'],
          'line-width': ['coalesce', ['get', 'lineWidth'], 4],
          'line-opacity': ['case', ['get', 'isVisible'], 0.88, 0.28],
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-points',
        type: 'circle',
        source: MAP_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 6,
          'circle-color': '#91a5ab',
          'circle-stroke-color': '#061311',
          'circle-stroke-width': 1,
          'circle-opacity': ['case', ['get', 'isVisible'], 0.95, 0.3],
        },
      });

      addLayerSafe(map, {
        id: 'geometry-editor-selected-fill',
        type: 'fill',
        source: SELECTED_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#f3b74e', 'fill-opacity': 0.24 },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-selected-line',
        type: 'line',
        source: SELECTED_SOURCE,
        filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#f3b74e', 'line-width': 5 },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-selected-point',
        type: 'circle',
        source: SELECTED_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 9, 'circle-color': '#f3b74e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-draw-line',
        type: 'line',
        source: DRAW_SOURCE,
        paint: { 'line-color': '#ff6b72', 'line-width': 4, 'line-dasharray': [2, 1.2] },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-draw-fill',
        type: 'fill',
        source: DRAW_SOURCE,
        paint: { 'fill-color': '#ff6b72', 'fill-opacity': 0.18 },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-vertices',
        type: 'circle',
        source: HANDLE_SOURCE,
        filter: ['==', ['get', 'kind'], 'vertex'],
        paint: {
          'circle-radius': 6,
          'circle-color': '#f3b74e',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5,
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-midpoints',
        type: 'circle',
        source: HANDLE_SOURCE,
        filter: ['==', ['get', 'kind'], 'midpoint'],
        paint: {
          'circle-radius': 4,
          'circle-color': '#35c6b4',
          'circle-stroke-color': '#061311',
          'circle-stroke-width': 1,
        },
      });

      map.on('click', 'geometry-editor-midpoints', (event) => {
        const candidate = event.features?.[0];
        if (!candidate || !state.draft || state.drawing) return;
        event.originalEvent?.stopPropagation?.();
        state.suppressMapClick = true;
        const prefixAndIndex = JSON.parse(candidate.properties.path);
        insertMidpoint(prefixAndIndex, event.lngLat.toArray());
        window.setTimeout(() => { state.suppressMapClick = false; }, 0);
      });

      map.on('mousedown', 'geometry-editor-vertices', (event) => {
        const candidate = event.features?.[0];
        if (!candidate || !state.draft || state.drawing) return;
        event.preventDefault();
        const path = JSON.parse(candidate.properties.path);
        selectVertex(path);
        state.dragPath = path;
        map.dragPan.disable();
        pushHistory();
      });
      map.on('mousemove', (event) => {
        if (!state.dragPath || !state.draft) return;
        moveVertex(state.dragPath, event.lngLat.toArray(), { record: false });
      });
      map.on('mouseup', () => {
        if (!state.dragPath) return;
        state.dragPath = null;
        map.dragPan.enable();
        updateDraftMap();
      });

      map.on('click', (event) => {
        if (state.suppressMapClick || !state.drawing) return;
        const coordinate = event.lngLat.toArray();
        if (state.drawing.mode === 'point') {
          state.drawing.coordinates = [coordinate];
          finishDrawing();
          return;
        }
        state.drawing.coordinates.push(coordinate);
        updateMapSources();
        updateDrawControls();
      });

      for (const layerId of [
        'geometry-editor-lines', 'geometry-editor-polygon-lines',
        'geometry-editor-polygons', 'geometry-editor-points',
      ]) {
        map.on('click', layerId, (event) => {
          if (state.drawing) return;
          const id = Number(event.features?.[0]?.properties?.id);
          if (Number.isSafeInteger(id) && id > 0) selectGeometry(id);
        });
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { if (!state.dragPath) map.getCanvas().style.cursor = ''; });
      }
      map.on('mouseenter', 'geometry-editor-vertices', () => { map.getCanvas().style.cursor = 'move'; });
      map.on('mouseleave', 'geometry-editor-vertices', () => { if (!state.dragPath) map.getCanvas().style.cursor = ''; });
      map.on('mouseenter', 'geometry-editor-midpoints', () => { map.getCanvas().style.cursor = 'copy'; });
      map.on('mouseleave', 'geometry-editor-midpoints', () => { if (!state.dragPath) map.getCanvas().style.cursor = ''; });

      state.map = map;
      return map;
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

  function updateMapSources() {
    const map = state.map;
    if (!map) return;
    map.getSource(MAP_SOURCE)?.setData(featureCollection(state.geometries));
    map.getSource(SELECTED_SOURCE)?.setData(
      state.draft
        ? featureCollection([{
            ...(state.current ?? {}),
            id: state.current?.id ?? null,
            family: familyOf(state.draft),
            geometryType: geometryType(state.draft),
            geometry: state.draft,
          }])
        : emptyCollection(),
    );
    map.getSource(HANDLE_SOURCE)?.setData(handleFeatures());
    map.getSource(DRAW_SOURCE)?.setData(drawingFeature());
    map.getSource(BOUNDARY_SOURCE)?.setData(
      state.city?.boundaryGeometry
        ? { type: 'Feature', geometry: state.city.boundaryGeometry, properties: {} }
        : emptyCollection(),
    );
  }

  function pushHistory() {
    if (!state.draft) return;
    state.history.push(clone(state.draft));
    if (state.history.length > 50) state.history.shift();
    state.future = [];
    renderHistoryControls();
  }

  function renderHistoryControls() {
    undoButton.disabled = state.history.length === 0 || Boolean(state.drawing);
    redoButton.disabled = state.future.length === 0 || Boolean(state.drawing);
    deleteNodeButton.disabled = !state.selectedVertexPath || !state.draft || Boolean(state.drawing);
  }

  function undo() {
    if (!state.history.length || !state.draft) return;
    state.future.push(clone(state.draft));
    state.draft = state.history.pop();
    state.selectedVertexPath = null;
    updateDraftMap();
  }

  function redo() {
    if (!state.future.length || !state.draft) return;
    state.history.push(clone(state.draft));
    state.draft = state.future.pop();
    state.selectedVertexPath = null;
    updateDraftMap();
  }

  function selectVertex(path) {
    state.selectedVertexPath = path;
    renderHistoryControls();
    modeLabel.textContent = `Узел ${path.length ? path.join('.') : 'Point'} выбран`;
  }

  function moveVertex(path, coordinate, { record = true } = {}) {
    if (!state.draft) return;
    if (record) pushHistory();
    if (state.draft.type === 'Point') {
      state.draft.coordinates = coordinate;
    } else {
      setAt(state.draft.coordinates, path, coordinate);
      const sequence = editableSequences(state.draft).find((entry) =>
        pathKey(entry.prefix) === pathKey(path.slice(0, -1)));
      if (sequence?.closed && path[path.length - 1] === 0) {
        const coords = getAt(state.draft.coordinates, sequence.prefix);
        coords[coords.length - 1] = [...coordinate];
      }
    }
    normalizeClosedRings(state.draft);
    updateDraftMap();
  }

  function insertMidpoint(prefixAndIndex, coordinate) {
    if (!state.draft || state.draft.type === 'Point') return;
    pushHistory();
    const prefix = prefixAndIndex.slice(0, -1);
    const index = prefixAndIndex[prefixAndIndex.length - 1];
    const coords = getAt(state.draft.coordinates, prefix);
    const closed = samePosition(coords[0], coords[coords.length - 1]);
    const uniqueLength = closed ? coords.length - 1 : coords.length;
    const insertAt = index === uniqueLength - 1 && closed ? uniqueLength : index + 1;
    coords.splice(insertAt, 0, coordinate);
    if (closed) coords[coords.length - 1] = [...coords[0]];
    state.selectedVertexPath = [...prefix, insertAt % (closed ? coords.length - 1 : coords.length)];
    updateDraftMap();
  }

  function deleteSelectedVertex() {
    const path = state.selectedVertexPath;
    if (!path || !state.draft) return;
    if (state.draft.type === 'Point') {
      setMessage('У Point нельзя удалить единственную координату. Удалите всю геометрию.', 'error');
      return;
    }
    const prefix = path.slice(0, -1);
    const index = path[path.length - 1];
    const coords = getAt(state.draft.coordinates, prefix);
    const closed = samePosition(coords[0], coords[coords.length - 1]);
    const uniqueLength = closed ? coords.length - 1 : coords.length;
    const minimum = closed ? 3 : 2;
    if (uniqueLength <= minimum) {
      setMessage(
        closed
          ? 'В кольце должно остаться минимум три узла.'
          : 'В линии должно остаться минимум два узла.',
        'error',
      );
      return;
    }
    pushHistory();
    coords.splice(index, 1);
    if (closed) {
      coords.pop();
      coords.push([...coords[0]]);
    }
    state.selectedVertexPath = null;
    updateDraftMap();
  }

  function updateDraftMap() {
    updateMapSources();
    renderHistoryControls();
    renderFormState();
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

  function numeric(value, unit, decimals = 2) {
    if (!Number.isFinite(Number(value))) return '—';
    return `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: decimals })} ${unit}`;
  }

  function renderFormState() {
    const item = state.current;
    const draft = state.draft;
    const enabled = Boolean(draft);
    for (const control of form.elements) {
      if (control.name === 'lineTypeId' || control.name === 'lanes') continue;
      if (['displayName', 'tooltip', 'tags', 'isVisible'].includes(control.name)) {
        control.disabled = !enabled;
      }
    }
    form.querySelector('button[type="submit"]').disabled = !enabled;
    revertButton.disabled = !enabled;
    deleteButton.disabled = !item?.id;

    if (!draft) {
      title.textContent = 'Выберите геометрию';
      lineFields.hidden = true;
      polygonActions.hidden = true;
      meta.replaceChildren();
      sourceTags.textContent = '—';
      return;
    }

    const family = familyOf(draft);
    const pseudo = {
      ...(item ?? {}),
      geometryType: geometryType(draft),
      family,
    };
    title.textContent = item?.id ? displayName(pseudo) : `Новая: ${typeLabel(pseudo)}`;
    lineFields.hidden = family !== 'line';
    polygonActions.hidden = family !== 'polygon' || !item?.id;

    if (family === 'line') {
      form.elements.lineTypeId.disabled = false;
      form.elements.lanes.disabled = false;
    } else {
      form.elements.lineTypeId.disabled = true;
      form.elements.lanes.disabled = true;
    }

    meta.replaceChildren(
      metaItem('Тип', typeLabel(pseudo)),
      metaItem('ID', item?.id ?? 'ещё не сохранена'),
      metaItem('Изменялась вручную', item?.wasEdited ? 'да' : (item?.id ? 'нет' : 'новая')),
      metaItem('Длина', family === 'line' ? numeric(item?.lengthMeters, 'м') : '—'),
      metaItem('Периметр', family === 'polygon' ? numeric(item?.perimeterMeters, 'м') : '—'),
      metaItem('Площадь', family === 'polygon' ? numeric(item?.areaSquareMeters, 'м²') : '—'),
    );
    sourceTags.textContent = JSON.stringify(item?.sourceTags ?? {}, null, 2);
  }

  function applyForm(item) {
    form.elements.displayName.value = item?.displayName ?? '';
    form.elements.tooltip.value = item?.tooltip ?? '';
    form.elements.tags.value = (item?.tags ?? []).join(', ');
    form.elements.isVisible.checked = item?.isVisible !== false;
    if (item?.lineTypeId) form.elements.lineTypeId.value = String(item.lineTypeId);
    else if (state.lineTypes[0]) form.elements.lineTypeId.value = String(state.lineTypes[0].id);
    form.elements.lanes.value = String(item?.lanes ?? 1);
    renderFormState();
  }

  function geometryMatchesSearch(item, query) {
    if (!query) return true;
    const haystack = [
      item.id, displayName(item), item.geometryType,
      ...(item.tags ?? []),
    ].join(' ').toLocaleLowerCase('ru-RU');
    return haystack.includes(query);
  }

  function renderList() {
    const query = searchInput.value.trim().toLocaleLowerCase('ru-RU');
    const visible = state.geometries.filter((item) => geometryMatchesSearch(item, query));
    listHost.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = state.city ? 'Геометрий нет.' : 'Выберите город…';
      listHost.append(empty);
    }
    for (const item of visible) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'geometry-editor-row';
      row.classList.toggle('is-selected', item.id === state.selectedId);
      row.classList.toggle('is-hidden', item.isVisible === false);

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = state.selectedSet.has(item.id);
      check.title = 'Выбрать для групповой операции';
      check.addEventListener('click', (event) => {
        event.stopPropagation();
        if (check.checked) state.selectedSet.add(item.id);
        else state.selectedSet.delete(item.id);
        renderMergeState();
      });

      const copy = document.createElement('span');
      copy.className = 'geometry-editor-row-copy';
      const name = document.createElement('span');
      name.className = 'geometry-editor-row-name';
      name.textContent = displayName(item);
      const tags = document.createElement('span');
      tags.className = 'geometry-editor-row-tags';
      tags.textContent = (item.tags ?? []).join(' · ') || (item.isVisible ? 'без тегов' : 'скрыта');
      copy.append(name, tags);

      const type = document.createElement('span');
      type.className = 'geometry-editor-row-type';
      type.textContent = typeLabel(item);
      row.append(check, copy, type);
      row.addEventListener('click', () => selectGeometry(item.id));
      listHost.append(row);
    }
    renderMergeState();
  }

  function renderMergeState() {
    const selected = state.geometries.filter((item) => state.selectedSet.has(item.id));
    const families = new Set(selected.map((item) => item.family));
    mergeButton.disabled =
      selected.length < 2 ||
      families.size !== 1 ||
      families.has('point');
  }

  function focusGeometry(geometry) {
    const bounds = geometryBounds(geometry);
    if (!bounds || !state.map) return;
    state.map.fitBounds(bounds, { padding: 70, maxZoom: 17, duration: 250 });
  }

  function selectGeometry(id, { focus = true } = {}) {
    if (state.drawing) cancelDrawing();
    const item = state.geometries.find((candidate) => candidate.id === id);
    if (!item) return;
    state.selectedId = id;
    state.current = item;
    state.draft = clone(item.geometry);
    state.history = [];
    state.future = [];
    state.selectedVertexPath = null;
    applyForm(item);
    renderList();
    updateMapSources();
    renderHistoryControls();
    modeLabel.textContent = `Редактирование: ${displayName(item)}`;
    setMessage('');
    if (focus) focusGeometry(item.geometry);
  }

  function clearSelection() {
    state.selectedId = null;
    state.current = null;
    state.draft = null;
    state.history = [];
    state.future = [];
    state.selectedVertexPath = null;
    applyForm(null);
    renderList();
    updateMapSources();
    renderHistoryControls();
    modeLabel.textContent = 'Выберите геометрию';
  }

  async function loadCatalog() {
    const payload = await api('/api/admin/geometry-editor/cities');
    state.cities = payload.cities ?? [];
    state.lineTypes = payload.lineTypes ?? [];
    state.knownTags = payload.tags ?? [];
    citySelect.replaceChildren(...state.cities.map((city) => {
      const option = document.createElement('option');
      option.value = String(city.id);
      option.textContent = `${city.name} (${city.geometryCount})`;
      return option;
    }));
    form.elements.lineTypeId.replaceChildren(...state.lineTypes.map((lineType) => {
      const option = document.createElement('option');
      option.value = String(lineType.id);
      option.textContent = lineType.title && lineType.title !== lineType.name
        ? `${lineType.title} — ${lineType.name}`
        : lineType.name;
      return option;
    }));
    if (!state.city && state.cities[0]) citySelect.value = String(state.cities[0].id);
  }

  async function loadCity(cityId, { keepSelection = false, fit = true } = {}) {
    if (!cityId) {
      state.city = null;
      state.geometries = [];
      clearSelection();
      return;
    }
    const payload = await api(`/api/admin/geometry-editor/cities/${encodeURIComponent(cityId)}`);
    const previousId = keepSelection ? state.selectedId : null;
    state.city = payload.city;
    state.geometries = payload.geometries ?? [];
    state.selectedSet = new Set(
      [...state.selectedSet].filter((id) => state.geometries.some((item) => item.id === id)),
    );
    citySelect.value = String(state.city.id);
    const previous = previousId && state.geometries.find((item) => item.id === previousId);
    if (previous) selectGeometry(previous.id, { focus: false });
    else clearSelection();
    updateMapSources();
    if (fit && Array.isArray(state.city.bounds) && state.map) {
      state.map.fitBounds(
        [[state.city.bounds[0], state.city.bounds[1]], [state.city.bounds[2], state.city.bounds[3]]],
        { padding: 42, duration: 250 },
      );
    }
  }

  async function refresh({ keepSelection = true, fit = false } = {}) {
    try {
      await ensureMap();
      const cityId = Number(citySelect.value || state.city?.id || state.cities[0]?.id);
      await loadCatalog();
      const resolvedId = Number.isSafeInteger(cityId) && cityId > 0
        ? cityId
        : state.cities[0]?.id;
      if (resolvedId) await loadCity(resolvedId, { keepSelection, fit });
      window.setTimeout(() => state.map?.resize(), 0);
      setMessage('');
    } catch (error) {
      setMessage(error.message, 'error');
    }
  }

  function draftItemFor(type) {
    return {
      id: null,
      cityId: state.city?.id,
      geometryType: type.toUpperCase(),
      family: type === 'Point' ? 'point' : type === 'LineString' ? 'line' : 'polygon',
      displayName: null,
      tooltip: null,
      tags: [],
      sourceTags: {},
      isVisible: true,
      wasEdited: true,
      lineTypeId: type === 'LineString' ? state.lineTypes[0]?.id ?? null : null,
      lanes: type === 'LineString' ? 1 : null,
    };
  }

  function startDrawing(mode) {
    if (!state.city) {
      setMessage('Сначала выберите город.', 'error');
      return;
    }
    state.drawing = { mode, coordinates: [] };
    state.current = mode === 'cut' ? state.current : draftItemFor(
      mode === 'point' ? 'Point' : mode === 'line' ? 'LineString' : 'Polygon',
    );
    if (mode !== 'cut') {
      state.selectedId = null;
      state.draft = null;
      state.history = [];
      state.future = [];
      state.selectedVertexPath = null;
      applyForm(state.current);
      renderList();
    }
    updateMapSources();
    updateDrawControls();
    setMessage('');
  }

  function updateDrawControls() {
    const drawing = state.drawing;
    const active = Boolean(drawing);
    finishDrawButton.hidden = !active || drawing?.mode === 'point';
    cancelDrawButton.hidden = !active;
    let canFinish = false;
    if (drawing?.mode === 'line') canFinish = drawing.coordinates.length >= 2;
    if (drawing?.mode === 'polygon' || drawing?.mode === 'cut') canFinish = drawing.coordinates.length >= 3;
    finishDrawButton.disabled = !canFinish;
    if (!drawing) {
      modeLabel.textContent = state.current ? `Редактирование: ${displayName(state.current)}` : 'Выберите геометрию';
    } else if (drawing.mode === 'cut') {
      modeLabel.textContent = `Вырез: поставьте минимум 3 точки (${drawing.coordinates.length})`;
    } else {
      modeLabel.textContent = `Рисование ${drawing.mode}: точек ${drawing.coordinates.length}`;
    }
    renderHistoryControls();
  }

  function cancelDrawing() {
    const wasCut = state.drawing?.mode === 'cut';
    state.drawing = null;
    if (!wasCut && !state.selectedId) clearSelection();
    updateMapSources();
    updateDrawControls();
  }

  async function finishDrawing() {
    const drawing = state.drawing;
    if (!drawing) return;
    if (drawing.mode === 'point') {
      if (!drawing.coordinates[0]) return;
      state.draft = { type: 'Point', coordinates: drawing.coordinates[0] };
      state.current = { ...draftItemFor('Point'), geometry: state.draft };
      state.drawing = null;
      applyForm(state.current);
      updateDraftMap();
      updateDrawControls();
      return;
    }
    if (drawing.mode === 'line') {
      if (drawing.coordinates.length < 2) return;
      state.draft = { type: 'LineString', coordinates: clone(drawing.coordinates) };
      state.current = { ...draftItemFor('LineString'), geometry: state.draft };
      state.drawing = null;
      applyForm(state.current);
      updateDraftMap();
      updateDrawControls();
      return;
    }
    if (drawing.coordinates.length < 3) return;
    const ring = [...drawing.coordinates.map((item) => [...item]), [...drawing.coordinates[0]]];
    const polygon = { type: 'Polygon', coordinates: [ring] };
    if (drawing.mode === 'cut') {
      const target = state.current;
      state.drawing = null;
      updateMapSources();
      updateDrawControls();
      if (!target?.id) return;
      try {
        setMessage('Вырезаем область…');
        const payload = await api(
          `/api/admin/geometry-editor/geometries/${target.id}/cut`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ geometry: polygon }),
          },
        );
        await loadCity(target.cityId, { keepSelection: false, fit: false });
        selectGeometry(payload.geometry.id, { focus: false });
        setMessage('Область вырезана.', 'success');
      } catch (error) {
        setMessage(error.message, 'error');
      }
      return;
    }

    state.draft = polygon;
    state.current = { ...draftItemFor('Polygon'), geometry: state.draft };
    state.drawing = null;
    applyForm(state.current);
    updateDraftMap();
    updateDrawControls();
  }

  function payloadFromForm() {
    const family = familyOf(state.draft);
    const tags = form.elements.tags.value
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return {
      geometry: state.draft,
      displayName: form.elements.displayName.value.trim() || null,
      tooltip: form.elements.tooltip.value.trim() || null,
      tags,
      isVisible: form.elements.isVisible.checked,
      ...(family === 'line'
        ? {
            lineTypeId: Number(form.elements.lineTypeId.value),
            lanes: Number(form.elements.lanes.value),
          }
        : {}),
    };
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.draft || state.drawing || !state.city) return;
    try {
      const currentId = state.current?.id;
      const body = payloadFromForm();
      if (!currentId) body.cityId = state.city.id;
      setMessage(currentId ? 'Сохраняем изменения…' : 'Создаём геометрию…');
      const payload = await api(
        currentId
          ? `/api/admin/geometry-editor/geometries/${currentId}`
          : '/api/admin/geometry-editor/geometries',
        {
          method: currentId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      await loadCity(state.city.id, { keepSelection: false, fit: false });
      selectGeometry(payload.geometry.id, { focus: false });
      await loadCatalog();
      setMessage('Геометрия сохранена.', 'success');
      window.dispatchEvent(new CustomEvent('dtpstat:geometry-changed'));
    } catch (error) {
      setMessage(error.message, 'error');
    }
  });

  revertButton.addEventListener('click', () => {
    if (!state.current?.id) {
      clearSelection();
      return;
    }
    const current = state.geometries.find((item) => item.id === state.current.id);
    if (current) selectGeometry(current.id, { focus: false });
  });

  deleteButton.addEventListener('click', async () => {
    const item = state.current;
    if (!item?.id) return;
    if (!window.confirm(`Удалить «${displayName(item)}»? Это действие необратимо.`)) return;
    try {
      await api(`/api/admin/geometry-editor/geometries/${item.id}`, { method: 'DELETE' });
      state.selectedSet.delete(item.id);
      await loadCity(item.cityId, { keepSelection: false, fit: false });
      await loadCatalog();
      setMessage('Геометрия удалена.', 'success');
      window.dispatchEvent(new CustomEvent('dtpstat:geometry-changed'));
    } catch (error) {
      setMessage(error.message, 'error');
    }
  });

  mergeButton.addEventListener('click', async () => {
    const ids = [...state.selectedSet];
    if (ids.length < 2) return;
    if (!window.confirm(`Объединить выбранные геометрии (${ids.length})? Исходные записи, кроме первой, будут удалены.`)) return;
    try {
      const payload = await api('/api/admin/geometry-editor/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      state.selectedSet.clear();
      await loadCity(payload.geometry.cityId, { keepSelection: false, fit: false });
      selectGeometry(payload.geometry.id, { focus: false });
      await loadCatalog();
      setMessage('Геометрии объединены.', 'success');
      window.dispatchEvent(new CustomEvent('dtpstat:geometry-changed'));
    } catch (error) {
      setMessage(error.message, 'error');
    }
  });

  cutButton.addEventListener('click', () => {
    if (state.current?.family === 'polygon' && state.current.id) startDrawing('cut');
  });

  undoButton.addEventListener('click', undo);
  redoButton.addEventListener('click', redo);
  deleteNodeButton.addEventListener('click', deleteSelectedVertex);
  finishDrawButton.addEventListener('click', () => void finishDrawing());
  cancelDrawButton.addEventListener('click', cancelDrawing);
  document.querySelector('#geometry-new-point').addEventListener('click', () => startDrawing('point'));
  document.querySelector('#geometry-new-line').addEventListener('click', () => startDrawing('line'));
  document.querySelector('#geometry-new-polygon').addEventListener('click', () => startDrawing('polygon'));

  citySelect.addEventListener('change', () => {
    state.selectedSet.clear();
    void loadCity(Number(citySelect.value), { keepSelection: false, fit: true })
      .catch((error) => setMessage(error.message, 'error'));
  });
  searchInput.addEventListener('input', renderList);
  refreshButton.addEventListener('click', () => void refresh({ keepSelection: true }));
  window.addEventListener('dtpstat:geometry-editor-open', () => {
    void refresh({ keepSelection: true, fit: false });
    window.setTimeout(() => state.map?.resize(), 0);
  });

  window.addEventListener('keydown', (event) => {
    if (section.hidden) return;
    const editingText = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
    if ((event.ctrlKey || event.metaKey) && !editingText && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !editingText && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (!editingText && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      deleteSelectedVertex();
      return;
    }
    if (!editingText && event.key === 'Escape' && state.drawing) cancelDrawing();
  });

  void refresh({ keepSelection: false, fit: true });
}
