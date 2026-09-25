import { adminConfirm } from './admin-dialog.js';
import { createDraftStore } from './draft-store.js';
import {
  applyGeometryDraft,
  geometryDraftChanges,
  geometryDraftIsStale,
} from './geometry-draft.js';
import { publishDerivedDataChange } from './derived-data-events.js';
import {
  realtimeClientId,
  realtimeMutationHeaders,
  subscribeAdminRealtime,
} from './realtime-client.js';

const section = document.querySelector('#admin-section-geometries');

if (section) {
  const citySelect = document.querySelector('#geometry-editor-city');
  const searchInput = document.querySelector('#geometry-editor-search');
  const listHost = document.querySelector('#geometry-editor-list');
  const refreshButton = document.querySelector('#geometry-editor-refresh');
  const recalculateButton = document.querySelector('#geometry-editor-recalculate');
  const draftCount = document.querySelector('#geometry-editor-draft-count');
  const persistDrafts = document.querySelector('#geometry-editor-persist-drafts');
  const saveAll = document.querySelector('#geometry-editor-save-all');
  const discardAll = document.querySelector('#geometry-editor-discard-all');
  const form = document.querySelector('#geometry-editor-form');
  const title = document.querySelector('#geometry-editor-selected-title');
  const lineFields = document.querySelector('#geometry-line-fields');
  const polygonActions = document.querySelector('#geometry-polygon-actions');
  const message = document.querySelector('#geometry-editor-message');
  const conflictMessage = document.querySelector('#geometry-editor-conflict');
  const meta = document.querySelector('#geometry-editor-meta');
  const sourceTags = document.querySelector('#geometry-source-tags');
  const mergeButton = document.querySelector('#geometry-merge-selected');
  const deleteButton = document.querySelector('#geometry-delete');
  const revertButton = document.querySelector('#geometry-revert');
  const cutButton = document.querySelector('#geometry-cut-area');
  const undoButton = document.querySelector('#geometry-undo');
  const redoButton = document.querySelector('#geometry-redo');
  const finishDrawButton = document.querySelector('#geometry-finish-draw');
  const cancelDrawButton = document.querySelector('#geometry-cancel-draw');
  const modeLabel = document.querySelector('#geometry-editor-mode');


  const MAP_SOURCE = 'geometry-editor-items';
  const SELECTED_SOURCE = 'geometry-editor-selected';
  const HANDLE_SOURCE = 'geometry-editor-handles';
  const DRAW_SOURCE = 'geometry-editor-draw';
  const BOUNDARY_SOURCE = 'geometry-editor-boundary';
  const DELETE_VERTEX_CURSOR =
    'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2228%22 height=%2228%22 viewBox=%220 0 28 28%22%3E%3Cpath d=%22M3 2l8.6 18.8 2.8-7.1 7.2-2.8L3 2z%22 fill=%22white%22 stroke=%22%2310181b%22 stroke-width=%221.5%22 stroke-linejoin=%22round%22/%3E%3Ccircle cx=%2220%22 cy=%2220%22 r=%226.5%22 fill=%22%23d84f57%22 stroke=%22white%22 stroke-width=%221.5%22/%3E%3Cpath d=%22M16.5 20h7%22 stroke=%22white%22 stroke-width=%222%22 stroke-linecap=%22round%22/%3E%3C/svg%3E") 3 2, pointer';

  const state = {
    cities: [],
    lineTypes: [],
    lineTypesLoaded: false,
    lineTypesPromise: null,
    city: null,
    serverGeometries: [],
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
    hoveredVertex: false,
    hoveredSegment: false,
    deleteModifier: false,
    suppressMapClick: false,
  };

  const drafts = createDraftStore({
    namespace: 'city-geometries',
  });

  function draftFor(id) {
    return drafts.get(id);
  }

  function effectiveSummary(item) {
    const draft = item ? draftFor(item.id) : null;
    const effective = draft ? applyGeometryDraft(item, draft) : item;
    if (!effective) return item;
    const result = {
      ...effective,
      family: familyOf(effective.geometry),
      geometryType: geometryType(effective.geometry),
    };
    const lineType = state.lineTypes.find(
      (candidate) => candidate.id === result.lineTypeId,
    );
    if (lineType) {
      result.lineTypeName = lineType.name;
      result.lineTypeColor = lineType.color;
      result.lineTypeWidth = lineType.width;
    }
    return result;
  }

  function rebuildDraftOverlay() {
    state.geometries = state.serverGeometries.map(effectiveSummary);
  }

  function refreshDraftControls() {
    const entries = drafts.list();
    const conflicts = entries.filter((draft) => draft.conflict).length;
    if (draftCount) {
      draftCount.textContent = conflicts
        ? 'Черновики: ' + entries.length + ' · конфликтов: ' + conflicts
        : 'Черновики: ' + entries.length;
    }
    if (saveAll) saveAll.disabled = entries.length === 0;
    if (discardAll) discardAll.disabled = entries.length === 0;
    if (persistDrafts) persistDrafts.checked = drafts.isPersistent();
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
    try { payload = await response.json(); } catch { /* empty response */ }
    if (!response.ok) {
      const error = new Error(payload?.error ?? ('HTTP ' + response.status));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
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

  function editingModeText(item) {
    return item
      ? `Редактирование: ${displayName(item)} · клик по сегменту — добавить узел · Ctrl+клик по узлу — удалить`
      : 'Выберите геометрию';
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
          properties: {
            kind: 'vertex',
            path: pathKey([]),
            selected: pathKey(state.selectedVertexPath) === pathKey([]),
          },
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
          properties: {
            kind: 'vertex',
            path: pathKey(vertexPath),
            selected: pathKey(state.selectedVertexPath) === pathKey(vertexPath),
          },
        });
        const nextIndex = sequence.closed
          ? (index + 1) % uniqueLength
          : index + 1;
        if (nextIndex >= uniqueLength) continue;
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [coords[index], coords[nextIndex]],
          },
          properties: {
            kind: 'segment',
            path: pathKey([...sequence.prefix, index]),
            nextIndex,
          },
        });
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
        id: 'geometry-editor-segment-hit',
        type: 'line',
        source: HANDLE_SOURCE,
        filter: ['==', ['get', 'kind'], 'segment'],
        paint: {
          'line-color': '#35c6b4',
          'line-width': 18,
          'line-opacity': 0.01,
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-vertices',
        type: 'circle',
        source: HANDLE_SOURCE,
        filter: ['==', ['get', 'kind'], 'vertex'],
        paint: {
          'circle-radius': [
            'case',
            ['==', ['get', 'selected'], true],
            8,
            6,
          ],
          'circle-color': [
            'case',
            ['==', ['get', 'selected'], true],
            '#ff6b6b',
            '#f3b74e',
          ],
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

      function refreshHandleCursor() {
        const canvas = map.getCanvas();
        if (state.dragPath) {
          canvas.style.cursor = 'move';
          return;
        }
        if (state.hoveredVertex) {
          canvas.style.cursor = state.deleteModifier
            ? DELETE_VERTEX_CURSOR
            : 'move';
          return;
        }
        if (state.hoveredSegment) {
          canvas.style.cursor = 'copy';
          return;
        }
        canvas.style.cursor = '';
      }

      function projectedSegmentCoordinate(candidate, event) {
        const coordinates = candidate?.geometry?.coordinates;
        if (!Array.isArray(coordinates) || coordinates.length !== 2) {
          return event.lngLat.toArray();
        }

        const start = map.project(coordinates[0]);
        const end = map.project(coordinates[1]);
        const click = event.point;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared <= Number.EPSILON) return coordinates[0];

        const t = Math.max(0, Math.min(1,
          ((click.x - start.x) * dx + (click.y - start.y) * dy) / lengthSquared,
        ));
        return map.unproject([
          start.x + dx * t,
          start.y + dy * t,
        ]).toArray();
      }

      map.on('click', 'geometry-editor-segment-hit', (event) => {
        const candidate = event.features?.[0];
        if (!candidate || !state.draft || state.drawing || state.suppressMapClick) return;

        // A vertex sits on the same line, so it wins over the wider segment hitbox.
        const vertexHits = map.queryRenderedFeatures(event.point, {
          layers: ['geometry-editor-vertices'],
        });
        if (vertexHits.length > 0) return;

        event.originalEvent?.stopPropagation?.();
        state.suppressMapClick = true;
        const prefixAndIndex = JSON.parse(candidate.properties.path);
        insertMidpoint(
          prefixAndIndex,
          projectedSegmentCoordinate(candidate, event),
        );
        window.setTimeout(() => { state.suppressMapClick = false; }, 0);
      });

      map.on('click', 'geometry-editor-vertices', (event) => {
        const candidate = event.features?.[0];
        if (!candidate || !state.draft || state.drawing) return;
        const originalEvent = event.originalEvent;
        if (!(originalEvent?.ctrlKey || originalEvent?.metaKey)) return;

        originalEvent?.preventDefault?.();
        originalEvent?.stopPropagation?.();
        state.suppressMapClick = true;
        deleteVertexAtPath(JSON.parse(candidate.properties.path));
        window.setTimeout(() => { state.suppressMapClick = false; }, 0);
      });

      map.on('mousedown', 'geometry-editor-vertices', (event) => {
        const candidate = event.features?.[0];
        if (!candidate || !state.draft || state.drawing) return;
        event.preventDefault();
        const originalEvent = event.originalEvent;
        if (originalEvent?.ctrlKey || originalEvent?.metaKey) return;

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
        captureCurrentDraft();
        refreshHandleCursor();
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
          if (state.drawing || state.suppressMapClick) return;
          const vertexHits = map.queryRenderedFeatures(event.point, {
            layers: ['geometry-editor-vertices'],
          });
          if (vertexHits.length > 0) return;

          const id = Number(event.features?.[0]?.properties?.id);
          if (Number.isSafeInteger(id) && id > 0) void selectGeometry(id);
        });
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { if (!state.dragPath) map.getCanvas().style.cursor = ''; });
      }
      map.on('mouseenter', 'geometry-editor-vertices', () => {
        state.hoveredVertex = true;
        refreshHandleCursor();
      });
      map.on('mouseleave', 'geometry-editor-vertices', () => {
        state.hoveredVertex = false;
        refreshHandleCursor();
      });
      map.on('mouseenter', 'geometry-editor-segment-hit', () => {
        state.hoveredSegment = true;
        refreshHandleCursor();
      });
      map.on('mouseleave', 'geometry-editor-segment-hit', () => {
        state.hoveredSegment = false;
        refreshHandleCursor();
      });
      map.on('mouseenter', 'geometry-editor-midpoints', () => {
        state.hoveredSegment = true;
        refreshHandleCursor();
      });
      map.on('mouseleave', 'geometry-editor-midpoints', () => {
        state.hoveredSegment = false;
        refreshHandleCursor();
      });

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

    const backgroundGeometries = state.draft && state.current?.id
      ? state.geometries.filter((item) => item.id !== state.current.id)
      : state.geometries;
    map.getSource(MAP_SOURCE)?.setData(featureCollection(backgroundGeometries));
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
        ? {
            type: 'Feature',
            geometry: state.city.boundaryGeometry,
            properties: {},
          }
        : emptyCollection(),
    );
  }

  function captureCurrentDraft() {
    if (!state.current?.id || !state.draft) {
      updateMapSources();
      return null;
    }

    const changes = geometryDraftChanges(
      state.current,
      payloadFromForm(),
    );
    const existing = draftFor(state.current.id);

    if (Object.keys(changes).length === 0) {
      drafts.remove(state.current.id);
    } else {
      drafts.upsert(state.current.id, {
        baseUpdatedAt: existing?.baseUpdatedAt ?? state.current.updatedAt,
        changes,
        conflict: Boolean(existing?.conflict),
      });
    }

    rebuildDraftOverlay();
    refreshDraftControls();
    renderList();
    updateMapSources();
    renderFormState();
    return draftFor(state.current.id);
  }

  function reconcileCurrentCityDrafts(previousIds = new Set()) {
    const currentIds = new Set(state.serverGeometries.map((item) => item.id));

    for (const item of state.serverGeometries) {
      const draft = draftFor(item.id);
      if (!draft) continue;
      drafts.markConflict(
        item.id,
        geometryDraftIsStale(item.updatedAt, draft),
      );
    }

    for (const id of previousIds) {
      if (!currentIds.has(id) && draftFor(id)) {
        drafts.markConflict(id, true);
      }
    }

    refreshDraftControls();
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
  }

  function undo() {
    if (!state.history.length || !state.draft) return;
    state.future.push(clone(state.draft));
    state.draft = state.history.pop();
    state.selectedVertexPath = null;
    updateDraftMap();
    captureCurrentDraft();
    modeLabel.textContent = editingModeText(state.current);
  }


  function redo() {
    if (!state.future.length || !state.draft) return;
    state.history.push(clone(state.draft));
    state.draft = state.future.pop();
    state.selectedVertexPath = null;
    updateDraftMap();
    captureCurrentDraft();
    modeLabel.textContent = editingModeText(state.current);
  }


  function selectVertex(path) {
    state.selectedVertexPath = path;
    updateMapSources();
    renderHistoryControls();
    modeLabel.textContent =
      `Узел ${path.length ? path.join('.') : 'Point'} выбран · Ctrl+клик по узлу — удалить`;
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
    if (record) captureCurrentDraft();
  }


  function insertMidpoint(prefixAndIndex, coordinate) {
    if (!state.draft || state.draft.type === 'Point') return;
    pushHistory();
    const prefix = prefixAndIndex.slice(0, -1);
    const index = prefixAndIndex[prefixAndIndex.length - 1];
    const coords = getAt(state.draft.coordinates, prefix);
    const closed = samePosition(coords[0], coords[coords.length - 1]);
    const uniqueLength = closed ? coords.length - 1 : coords.length;
    const insertAt = index === uniqueLength - 1 && closed
      ? uniqueLength
      : index + 1;
    coords.splice(insertAt, 0, coordinate);
    if (closed) coords[coords.length - 1] = [...coords[0]];
    state.selectedVertexPath = [
      ...prefix,
      insertAt % (closed ? coords.length - 1 : coords.length),
    ];
    updateDraftMap();
    captureCurrentDraft();
    modeLabel.textContent =
      'Новый узел добавлен · перетащите его или Ctrl+кликните для удаления';
  }


  function deleteVertexAtPath(path) {
    if (!path || !state.draft) return;
    if (state.draft.type === 'Point') {
      setMessage(
        'У Point нельзя удалить единственную координату. Удалите всю геометрию.',
        'error',
      );
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
    captureCurrentDraft();
    modeLabel.textContent = editingModeText(state.current);
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

    const localDraft = item?.id ? draftFor(item.id) : null;
    if (conflictMessage) {
      conflictMessage.hidden = !localDraft?.conflict;
      conflictMessage.textContent = localDraft?.conflict
        ? 'Серверная версия изменилась после создания черновика. Локальные правки сохранены, но требуют разрешения конфликта.'
        : '';
    }

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
    polygonActions.hidden = true;

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
      item.id,
      displayName(item),
      item.geometryType,
      item.lineTypeName,
    ].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU');
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
      row.classList.toggle('has-draft', Boolean(item._draft));
      row.classList.toggle('has-conflict', Boolean(item._conflict));

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
      const details = document.createElement('span');
      details.className = 'geometry-editor-row-tags';
      details.textContent = [
        item.lineTypeName,
        item._draft ? 'черновик' : null,
        item._conflict ? 'конфликт' : null,
        item.isVisible === false ? 'скрыта' : null,
      ].filter(Boolean).join(' · ') || typeLabel(item);
      copy.append(name, details);

      const type = document.createElement('span');
      type.className = 'geometry-editor-row-type';
      type.textContent = typeLabel(item);
      row.append(copy, type);
      row.addEventListener('click', () => void selectGeometry(item.id));
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

  function summaryFromDetail(item) {
    return {
      id: item.id,
      cityId: item.cityId,
      boundaryId: item.boundaryId,
      family: item.family,
      geometryType: item.geometryType,
      displayName: item.displayName,
      isVisible: item.isVisible,
      updatedAt: item.updatedAt,
      lineTypeId: item.lineTypeId,
      lineTypeName: item.lineTypeName,
      lineTypeColor: item.lineTypeColor,
      lineTypeWidth: item.lineTypeWidth,
      geometry: clone(item.geometry),
    };
  }

  function sortGeometrySummaries() {
    state.serverGeometries.sort((left, right) => {
      const byName = displayName(left).localeCompare(
        displayName(right),
        'ru-RU',
        { sensitivity: 'base' },
      );
      return byName || left.id - right.id;
    });
  }

  function upsertGeometrySummary(item) {
    const summary = summaryFromDetail(item);
    const index = state.serverGeometries.findIndex(
      (candidate) => candidate.id === item.id,
    );
    if (index >= 0) state.serverGeometries[index] = summary;
    else state.serverGeometries.push(summary);
    sortGeometrySummaries();
    rebuildDraftOverlay();
  }


  function adoptGeometryDetail(item, { focus = false } = {}) {
    let local = draftFor(item.id);
    if (local && geometryDraftIsStale(item.updatedAt, local)) {
      drafts.markConflict(item.id, true);
      local = draftFor(item.id);
    }

    const effective = local ? applyGeometryDraft(item, local) : item;
    state.selectedId = item.id;
    state.current = item;
    state.draft = clone(effective.geometry);
    state.history = [];
    state.future = [];
    state.selectedVertexPath = null;
    applyForm(effective);
    rebuildDraftOverlay();
    renderList();
    updateMapSources();
    renderHistoryControls();
    refreshDraftControls();
    modeLabel.textContent = editingModeText(effective);
    if (focus) focusGeometry(effective.geometry);

    if (local?.conflict) {
      setMessage(
        'Локальный черновик сохранён, но серверная версия уже изменилась.',
        'error',
      );
    }
  }


  async function selectGeometry(id, { focus = true } = {}) {
    if (state.drawing) cancelDrawing();
    const summary = state.geometries.find((candidate) => candidate.id === id);
    if (!summary) return;

    state.selectedId = id;
    state.current = null;
    state.draft = null;
    state.history = [];
    state.future = [];
    state.selectedVertexPath = null;
    applyForm(null);
    renderList();
    updateMapSources();
    renderHistoryControls();
    modeLabel.textContent = `Загрузка: ${displayName(summary)}…`;
    setMessage('');
    if (focus) focusGeometry(summary.geometry);

    try {
      const payload = await api(
        `/api/admin/geometry-editor/geometries/${encodeURIComponent(id)}`,
      );
      if (state.selectedId !== id) return;
      const item = payload.geometry;
      if (item.family === 'line') await ensureLineTypes();
      if (state.selectedId !== id) return;

      adoptGeometryDetail(item);
    } catch (error) {
      if (state.selectedId !== id) return;
      clearSelection();
      setMessage(error.message, 'error');
    }
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

  function renderLineTypes() {
    form.elements.lineTypeId.replaceChildren(...state.lineTypes.map((lineType) => {
      const option = document.createElement('option');
      option.value = String(lineType.id);
      option.textContent = lineType.title && lineType.title !== lineType.name
        ? `${lineType.title} — ${lineType.name}`
        : lineType.name;
      return option;
    }));
  }

  async function ensureLineTypes() {
    if (state.lineTypesLoaded) return state.lineTypes;
    if (state.lineTypesPromise) return state.lineTypesPromise;

    state.lineTypesPromise = api('/api/line-types')
      .then((payload) => {
        state.lineTypes = payload.lineTypes ?? [];
        state.lineTypesLoaded = true;
        renderLineTypes();
        rebuildDraftOverlay();
        renderList();
        updateMapSources();
        return state.lineTypes;
      })
      .finally(() => {
        state.lineTypesPromise = null;
      });
    return state.lineTypesPromise;
  }

  async function loadCities() {
    const payload = await api('/api/admin/geometry-editor/cities');
    state.cities = payload.cities ?? [];

    if (state.cities.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = Number(payload.cityLinkState?.activeBoundaries ?? 0) === 0
        ? 'Нет активных городов в OSM-дереве'
        : 'Активные OSM-объекты не удалось связать с городами';
      option.disabled = true;
      option.selected = true;
      citySelect.replaceChildren(option);
    } else {
      citySelect.replaceChildren(...state.cities.map((city) => {
      const option = document.createElement('option');
      option.value = String(city.id);
        option.textContent = `${city.name} (${city.geometryCount})`;
        return option;
      }));
    }
    if (!state.city && state.cities[0]) citySelect.value = String(state.cities[0].id);
  }

  async function loadCity(cityId, { keepSelection = false, fit = true } = {}) {
    if (!cityId) {
      state.city = null;
      state.serverGeometries = [];
      state.geometries = [];
      clearSelection();
      return;
    }

    const previousIds = state.city?.id === cityId
      ? new Set(state.serverGeometries.map((item) => item.id))
      : new Set();
    const previousId = keepSelection ? state.selectedId : null;

    const payload = await api(
      '/api/admin/geometry-editor/cities/' +
      encodeURIComponent(cityId) +
      '/geometries',
    );

    state.city = payload.city;
    state.serverGeometries = payload.geometries ?? [];
    reconcileCurrentCityDrafts(previousIds);
    rebuildDraftOverlay();
    citySelect.value = String(state.city.id);

    const previous = previousId &&
      state.geometries.find((item) => item.id === previousId);
    if (previous) await selectGeometry(previous.id, { focus: false });
    else clearSelection();

    renderList();
    updateMapSources();

    if (fit && Array.isArray(state.city.bounds) && state.map) {
      state.map.fitBounds(
        [
          [state.city.bounds[0], state.city.bounds[1]],
          [state.city.bounds[2], state.city.bounds[3]],
        ],
        { padding: 42, duration: 250 },
      );
    }
  }


  async function refresh({ keepSelection = true, fit = false } = {}) {
    try {
      await ensureMap();
      const cityId = Number(citySelect.value || state.city?.id || state.cities[0]?.id);
      await loadCities();
      const resolvedId = Number.isSafeInteger(cityId) && cityId > 0
        ? cityId
        : state.cities[0]?.id;
      if (resolvedId) {
        await loadCity(resolvedId, { keepSelection, fit });
        const conflicts = drafts.list().filter((draft) => draft.conflict).length;
        if (!conflicts) setMessage('');
      } else {
        setMessage(
          'В редакторе нет активных городов. Проверьте активность объектов в OSM-дереве.',
          'error',
        );
      }
      window.setTimeout(() => state.map?.resize(), 0);
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

  async function startDrawing(mode) {
    if (!state.city) {
      setMessage('Сначала выберите город.', 'error');
      return;
    }
    if (mode === 'line') {
      try {
        const lineTypes = await ensureLineTypes();
        if (lineTypes.length === 0) {
          setMessage('Нет доступных типов линий.', 'error');
          return;
        }
      } catch (error) {
        setMessage(error.message, 'error');
        return;
      }
    }

    state.drawing = { mode, coordinates: [] };
    state.current = draftItemFor(
      mode === 'point'
        ? 'Point'
        : mode === 'line'
          ? 'LineString'
          : 'Polygon',
    );
    state.selectedId = null;
    state.draft = null;
    state.history = [];
    state.future = [];
    state.selectedVertexPath = null;
    applyForm(state.current);
    renderList();
    updateMapSources();
    updateDrawControls();
    setMessage(
      'Новая геометрия хранится только в текущем редакторе до первого сохранения.',
    );
  }


  function updateDrawControls() {
    const drawing = state.drawing;
    const active = Boolean(drawing);
    finishDrawButton.hidden = !active || drawing?.mode === 'point';
    cancelDrawButton.hidden = !active;

    let canFinish = false;
    if (drawing?.mode === 'line') {
      canFinish = drawing.coordinates.length >= 2;
    }
    if (drawing?.mode === 'polygon') {
      canFinish = drawing.coordinates.length >= 3;
    }
    finishDrawButton.disabled = !canFinish;

    modeLabel.textContent = drawing
      ? 'Рисование ' + drawing.mode + ': точек ' + drawing.coordinates.length
      : editingModeText(state.current);
    renderHistoryControls();
  }


  function cancelDrawing() {
    state.drawing = null;
    if (!state.selectedId) clearSelection();
    updateMapSources();
    updateDrawControls();
  }


  function finishDrawing() {
    const drawing = state.drawing;
    if (!drawing) return;

    if (drawing.mode === 'point') {
      if (!drawing.coordinates[0]) return;
      state.draft = {
        type: 'Point',
        coordinates: drawing.coordinates[0],
      };
      state.current = {
        ...draftItemFor('Point'),
        geometry: state.draft,
      };
    } else if (drawing.mode === 'line') {
      if (drawing.coordinates.length < 2) return;
      state.draft = {
        type: 'LineString',
        coordinates: clone(drawing.coordinates),
      };
      state.current = {
        ...draftItemFor('LineString'),
        geometry: state.draft,
      };
    } else {
      if (drawing.coordinates.length < 3) return;
      const ring = [
        ...drawing.coordinates.map((item) => [...item]),
        [...drawing.coordinates[0]],
      ];
      state.draft = {
        type: 'Polygon',
        coordinates: [ring],
      };
      state.current = {
        ...draftItemFor('Polygon'),
        geometry: state.draft,
      };
    }

    state.drawing = null;
    state.history = [];
    state.future = [];
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

  async function saveCurrent() {
    if (!state.draft || state.drawing || !state.city || !form.reportValidity()) return;

    const currentId = state.current?.id;
    if (!currentId) {
      const body = payloadFromForm();
      body.cityId = state.city.id;
      try {
        setMessage('Создаём геометрию…');
        const payload = await api('/api/admin/geometry-editor/geometries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        upsertGeometrySummary(payload.geometry);
        adoptGeometryDetail(payload.geometry);
        setMessage(
          'Геометрия создана. Для обновления основной карты и статистики нажмите «Пересчитать».',
          'success',
        );
      } catch (error) {
        setMessage(error.message, 'error');
      }
      return;
    }

    const local = captureCurrentDraft();
    if (!local) {
      setMessage('Нет несохранённых изменений.');
      return;
    }

    try {
      setMessage('Сохраняем локальный черновик…');
      const payload = await api(
        '/api/admin/geometry-editor/geometries/' + encodeURIComponent(currentId),
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-DTPStat-Base-Revision': local.baseUpdatedAt,
          },
          body: JSON.stringify(local.changes),
        },
      );
      drafts.remove(currentId);
      upsertGeometrySummary(payload.geometry);
      adoptGeometryDetail(payload.geometry);
      setMessage(
        'Геометрия сохранена. Для обновления основной карты и статистики нажмите «Пересчитать».',
        'success',
      );
    } catch (error) {
      if (error.status === 409) {
        drafts.markConflict(currentId, true);
        rebuildDraftOverlay();
        renderList();
        renderFormState();
        refreshDraftControls();
      }
      setMessage(error.message, 'error');
    }
  }

  async function saveDraftEntries(entries) {
    const updates = entries
      .map((entry) => ({
        id: Number(entry.id),
        baseUpdatedAt: entry.baseUpdatedAt,
        changes: entry.changes,
      }))
      .filter((entry) => Number.isSafeInteger(entry.id) && entry.id > 0);

    const payload = await api('/api/admin/geometry-editor/geometries', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    });

    for (const geometry of payload.geometries ?? []) {
      drafts.remove(geometry.id);
      if (!state.city || geometry.cityId === state.city.id) {
        upsertGeometrySummary(geometry);
      }
    }

    const selected = (payload.geometries ?? []).find(
      (geometry) => geometry.id === state.selectedId,
    );
    if (selected) adoptGeometryDetail(selected);
    else {
      rebuildDraftOverlay();
      renderList();
      updateMapSources();
    }
    refreshDraftControls();
    return payload;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveCurrent();
  });

  for (const control of [
    form.elements.displayName,
    form.elements.tooltip,
    form.elements.tags,
    form.elements.isVisible,
    form.elements.lineTypeId,
    form.elements.lanes,
  ]) {
    control?.addEventListener('input', () => captureCurrentDraft());
    control?.addEventListener('change', () => captureCurrentDraft());
  }


  revertButton.addEventListener('click', () => {
    if (!state.current?.id) {
      clearSelection();
      return;
    }
    drafts.remove(state.current.id);
    rebuildDraftOverlay();
    refreshDraftControls();
    adoptGeometryDetail(state.current);
  });

  deleteButton.addEventListener('click', async () => {
    const item = state.current;
    if (!item?.id) return;
    const confirmed = await adminConfirm({
      title: 'Удалить геометрию?',
      message: '«' + displayName(item) + '» будет удалена. Это действие необратимо.',
      confirmLabel: 'Удалить геометрию',
      cancelLabel: 'Отмена',
      destructive: true,
    });
    if (!confirmed) return;

    const local = draftFor(item.id);
    try {
      await api('/api/admin/geometry-editor/geometries/' + item.id, {
        method: 'DELETE',
        headers: {
          'X-DTPStat-Base-Revision': local?.baseUpdatedAt ?? item.updatedAt,
        },
      });
      drafts.remove(item.id);
      state.selectedSet.delete(item.id);
      state.serverGeometries = state.serverGeometries.filter(
        (candidate) => candidate.id !== item.id,
      );
      rebuildDraftOverlay();
      clearSelection();
      refreshDraftControls();
      setMessage(
        'Геометрия удалена. Для обновления основной карты и статистики нажмите «Пересчитать».',
        'success',
      );
    } catch (error) {
      if (error.status === 409 && local) {
        drafts.markConflict(item.id, true);
        rebuildDraftOverlay();
        renderList();
        renderFormState();
        refreshDraftControls();
      }
      setMessage(error.message, 'error');
    }
  });


  mergeButton.addEventListener('click', () => {
    setMessage('Объединение геометрий будет перенесено отдельным блоком.', 'error');
  });


  async function recalculateDerived() {
    const selectedId = state.selectedId;
    try {
      recalculateButton.disabled = true;
      refreshButton.disabled = true;
      setMessage('Пересчитываем список городов, основную карту и статистику…');
      const result = await api('/api/admin/geometry-editor/recalculate', {
        method: 'POST',
      });
      await refresh({ keepSelection: Boolean(selectedId), fit: false });
      publishDerivedDataChange('geometry-editor');
      setMessage(
        'Пересчёт завершён: обновлены города, основная карта, статистика, рейтинги и публичные данные.',
        'success',
      );
      window.dispatchEvent(new CustomEvent('dtpstat:geometry-changed', {
        detail: result,
      }));
    } catch (error) {
      setMessage(error.message, 'error');
    } finally {
      recalculateButton.disabled = false;
      refreshButton.disabled = false;
    }
  }

  saveAll?.addEventListener('click', async () => {
    captureCurrentDraft();
    const entries = drafts.list();
    if (!entries.length) return;
    saveAll.disabled = true;
    setMessage('Сохраняем черновики: ' + entries.length + '…');
    try {
      const payload = await saveDraftEntries(entries);
      setMessage(
        'Сохранено геометрий: ' + payload.changedCount +
        '. Все локальные черновики применены атомарно.',
        'success',
      );
    } catch (error) {
      if (error.status === 409) {
        for (const conflict of error.payload?.details?.conflicts ?? []) {
          drafts.markConflict(conflict.id, true);
        }
        rebuildDraftOverlay();
        renderList();
        renderFormState();
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
      message:
        'Будут удалены локальные изменения геометрий: ' +
        entries.length + '. Серверные данные не изменятся.',
      confirmLabel: 'Сбросить черновики',
      cancelLabel: 'Отмена',
      destructive: true,
    });
    if (!confirmed) return;
    drafts.clear();
    refreshDraftControls();
    await refresh({ keepSelection: true, fit: false });
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

  subscribeAdminRealtime((realtimeMessage) => {
    if (
      realtimeMessage?.type !== 'data-change' ||
      realtimeMessage.change?.resource !== 'city-geometries' ||
      realtimeMessage.change?.originClientId === realtimeClientId()
    ) {
      return;
    }

    void refresh({ keepSelection: true, fit: false }).then(() => {
      const conflicts = drafts.list().filter((draft) => draft.conflict).length;
      setMessage(
        conflicts
          ? 'Геометрии синхронизированы. Локальных конфликтов: ' + conflicts + '.'
          : 'Геометрии автоматически синхронизированы.',
        conflicts ? 'error' : 'success',
      );
    });
  });


  cutButton.addEventListener('click', () => {
    setMessage('Вырезание области будет перенесено отдельным блоком.', 'error');
  });


  undoButton.addEventListener('click', undo);
  redoButton.addEventListener('click', redo);
  finishDrawButton.addEventListener('click', () => void finishDrawing());
  cancelDrawButton.addEventListener('click', cancelDrawing);
  document.querySelector('#geometry-new-point').addEventListener('click', () => void startDrawing('point'));
  document.querySelector('#geometry-new-line').addEventListener('click', () => void startDrawing('line'));
  document.querySelector('#geometry-new-polygon').addEventListener('click', () => void startDrawing('polygon'));

  citySelect.addEventListener('change', () => {
    state.selectedSet.clear();
    void loadCity(Number(citySelect.value), { keepSelection: false, fit: true })
      .catch((error) => setMessage(error.message, 'error'));
  });
  searchInput.addEventListener('input', renderList);
  refreshButton.addEventListener('click', () => void refresh({ keepSelection: true }));
  recalculateButton.addEventListener('click', () => void recalculateDerived());
  window.addEventListener('dtpstat:geometry-editor-open', () => {
    void refresh({ keepSelection: true, fit: false });
    window.setTimeout(() => state.map?.resize(), 0);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Control' || event.key === 'Meta') {
      state.deleteModifier = true;
      if (!section.hidden && state.map) {
        const canvas = state.map.getCanvas();
        if (state.hoveredVertex) canvas.style.cursor = DELETE_VERTEX_CURSOR;
      }
    }
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
    if (!editingText && event.key === 'Escape' && state.drawing) cancelDrawing();
  });

  window.addEventListener('keyup', (event) => {
    if (event.key !== 'Control' && event.key !== 'Meta') return;
    state.deleteModifier = false;
    if (!section.hidden && state.map) {
      const canvas = state.map.getCanvas();
      if (state.hoveredVertex) canvas.style.cursor = 'move';
      else if (state.hoveredSegment) canvas.style.cursor = 'copy';
      else if (!state.dragPath) canvas.style.cursor = '';
    }
  });

  window.addEventListener('blur', () => {
    state.deleteModifier = false;
    if (!section.hidden && state.map && !state.dragPath) {
      const canvas = state.map.getCanvas();
      if (state.hoveredVertex) canvas.style.cursor = 'move';
      else if (state.hoveredSegment) canvas.style.cursor = 'copy';
      else canvas.style.cursor = '';
    }
  });

  refreshDraftControls();
  void refresh({ keepSelection: false, fit: true });
}
