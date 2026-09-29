import { adminConfirm } from './admin-dialog.js';
import { createDraftStore } from './draft-store.js';
import {
  applyGeometryDraft,
  geometryDraftChanges,
  geometryDraftIsStale,
} from './geometry-draft.js';
import {
  coordinateSequences,
  normalizeCoordinate,
  parseCoordinateText,
  replaceCoordinateSequence,
  translateGeometry,
} from './geometry-coordinate-model.js';
import { publishDerivedDataChange } from './derived-data-events.js';
import {
  realtimeClientId,
  realtimeMutationHeaders,
  subscribeAdminRealtime,
} from './realtime-client.js';

const section = document.querySelector('#admin-section-geometries');

if (section) {
  const adminSession =
    await globalThis.dtpstatAdminSession;
  const currentUser =
    adminSession.user;

  const citySelect = document.querySelector('#geometry-editor-city');
  const cityWithGeometries =
    document.querySelector(
      '#geometry-editor-city-with-geometries',
    );
  const searchInput = document.querySelector('#geometry-editor-search');
  const listHost = document.querySelector('#geometry-editor-list');
  const refreshButton = document.querySelector('#geometry-editor-refresh');
  const recalculateButton = document.querySelector('#geometry-editor-recalculate');
  const draftCount = document.querySelector('#geometry-editor-draft-count');
  const beginEditButton = document.querySelector('#geometry-begin-edit');
  const takeoverEditButton = document.querySelector('#geometry-takeover-edit');
  const editLockStatus = document.querySelector('#geometry-edit-lock-status');
  const saveAll = document.querySelector('#geometry-editor-save-all');
  const discardAll = document.querySelector('#geometry-editor-discard-all');
  const form = document.querySelector('#geometry-editor-form');
  const title = document.querySelector('#geometry-editor-selected-title');
  const lineFields = document.querySelector('#geometry-line-fields');
  const topologyActions = document.querySelector('#geometry-topology-actions');
  const message = document.querySelector('#geometry-editor-message');
  const conflictMessage = document.querySelector('#geometry-editor-conflict');
  const meta = document.querySelector('#geometry-editor-meta');
  const sourceTags = document.querySelector('#geometry-source-tags');
  const mergeButton = document.querySelector('#geometry-merge-selected');
  const deleteButton = document.querySelector('#geometry-delete');
  const revertButton = document.querySelector('#geometry-revert');
  const cutButton = document.querySelector('#geometry-cut-area');
  const cutSelectedButton = document.querySelector('#geometry-cut-selected');
  const splitButton = document.querySelector('#geometry-split');
  const undoButton = document.querySelector('#geometry-undo');
  const redoButton = document.querySelector('#geometry-redo');
  const finishDrawButton = document.querySelector('#geometry-finish-draw');
  const cancelDrawButton = document.querySelector('#geometry-cancel-draw');
  const moveGeometryButton = document.querySelector('#geometry-move-toggle');
  const coordinateOpenButton = document.querySelector('#geometry-coordinate-open');
  const coordinateWindow = document.querySelector('#geometry-coordinate-window');
  const coordinateCloseButton = document.querySelector('#geometry-coordinate-close');
  const coordinateSequence = document.querySelector('#geometry-coordinate-sequence');
  const coordinateTableBody = document.querySelector('#geometry-coordinate-table-body');
  const coordinateAddRow = document.querySelector('#geometry-coordinate-add-row');
  const coordinatePaste = document.querySelector('#geometry-coordinate-paste');
  const coordinateImport = document.querySelector('#geometry-coordinate-import');
  const coordinateApply = document.querySelector('#geometry-coordinate-apply');
  const coordinateMessage = document.querySelector('#geometry-coordinate-message');
  const modeLabel = document.querySelector('#geometry-editor-mode');
  const newPointButton = document.querySelector('#geometry-new-point');
  const newLineButton = document.querySelector('#geometry-new-line');
  const newPolygonButton = document.querySelector('#geometry-new-polygon');
  const importPanel = document.querySelector('#geometry-import-conflicts');
  const importTitle = document.querySelector('#geometry-import-conflicts-title');
  const importSummary = document.querySelector('#geometry-import-conflicts-summary');
  const importList = document.querySelector('#geometry-import-conflict-list');
  const importApply = document.querySelector('#geometry-import-apply');
  const importDiscard = document.querySelector('#geometry-import-discard');
  const conflictDecision = document.querySelector('#geometry-conflict-decision');
  const conflictTitle = document.querySelector('#geometry-conflict-title');
  const conflictDescription = document.querySelector('#geometry-conflict-description');
  const conflictCandidates = document.querySelector('#geometry-conflict-candidates');
  const conflictKeep = document.querySelector('#geometry-conflict-keep');
  const conflictAdd = document.querySelector('#geometry-conflict-add');
  const conflictReplace = document.querySelector('#geometry-conflict-replace');

  const MAP_SOURCE = 'geometry-editor-items';
  const SELECTED_SOURCE = 'geometry-editor-selected';
  const HANDLE_SOURCE = 'geometry-editor-handles';
  const DRAW_SOURCE = 'geometry-editor-draw';
  const BOUNDARY_SOURCE = 'geometry-editor-boundary';
  const IMPORT_SOURCE = 'geometry-editor-import-conflict';
  const ADD_VERTEX_CURSOR =
    'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2228%22 height=%2228%22 viewBox=%220 0 28 28%22%3E%3Cpath d=%22M3 2l8.6 18.8 2.8-7.1 7.2-2.8L3 2z%22 fill=%22white%22 stroke=%22%2310181b%22 stroke-width=%221.5%22 stroke-linejoin=%22round%22/%3E%3Ccircle cx=%2220%22 cy=%2220%22 r=%226.5%22 fill=%22%232f9d71%22 stroke=%22white%22 stroke-width=%221.5%22/%3E%3Cpath d=%22M16.5 20h7M20 16.5v7%22 stroke=%22white%22 stroke-width=%222%22 stroke-linecap=%22round%22/%3E%3C/svg%3E") 3 2, pointer';
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
    moveGeometryMode: false,
    geometryDrag: null,
    coordinateWindowOpen: false,
    hoveredVertex: false,
    hoveredSegment: false,
    hoveredGeometry: false,
    deleteModifier: false,
    suppressMapClick: false,
    importSession: null,
    activeConflictId: null,
    conflictDecisions: new Map(),
    pendingExternalDraftSync: false,
    workspaceKey: null,
    editing: false,
    editLease: null,
    blockedLease: null,
    editLeases: new Map(),
    validatedEditTokens: new Map(),
    beginEditPendingId: null,
  };

  const REMOTE_SYNC_DELAY_MS = 75;
  let remoteSyncTimer = null;
  const remoteSyncReasons = new Set();

  const drafts = createDraftStore({
    namespace: 'city-geometries',
  });

  function blockForDraftStorage(
    compatibility,
  ) {
    const found =
      compatibility
        ?.foundVersion;
    const expected =
      compatibility
        ?.expectedVersion;

    message.textContent =
      compatibility?.corrupt
        ? 'Локальное хранилище геометрий повреждено. Оно сохранено без изменений; обновите страницу или восстановите localStorage вручную.'
        : 'Локальная схема геометрий новее текущего клиента' +
          (
            found === null ||
            found === undefined
              ? ''
              : ' (v' + found + ')'
          ) +
          '. Требуется обновить страницу' +
          (
            expected
              ? ' до клиента с поддержкой v' +
                expected
              : ''
          ) +
          '.';

    message.className =
      'notice notice-error';

    section
      .querySelectorAll(
        'button,input,select,textarea',
      )
      .forEach(
        (control) => {
          control.disabled =
            true;
        },
      );

    section.dataset
      .storageBlocked =
      'true';
  }

  const draftCompatibility =
    drafts.compatibility();

  if (
    !draftCompatibility
      .compatible
  ) {
    blockForDraftStorage(
      draftCompatibility,
    );
    throw new Error(
      draftCompatibility
        .message,
    );
  }

  drafts.setPersistent(true);

  function isLocalGeometryId(value) {
    return typeof value === 'string' &&
      value.startsWith('local:');
  }

  function draftFor(id) {
    return drafts.get(id);
  }

  function effectiveSummary(item) {
    const draft = item ? draftFor(item.id) : null;
    const effective =
      draft && draft.kind !== 'create'
        ? applyGeometryDraft(item, draft)
        : item;
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

  function localCreateSummary(entry) {
    const value = clone(entry.value ?? {});
    const result = {
      ...value,
      id: entry.localId ?? entry.id,
      localId: entry.localId ?? entry.id,
      _local: true,
      _draft: true,
      family: familyOf(value.geometry),
      geometryType: geometryType(value.geometry),
      workspaceKey: entry.workspaceKey ?? 'unlinked',
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
    const server = state.serverGeometries.map(effectiveSummary);
    const local = drafts.list()
      .filter(
        (entry) =>
          entry.kind === 'create' &&
          (entry.workspaceKey ?? 'unlinked') ===
            (state.workspaceKey ?? 'unlinked'),
      )
      .map(localCreateSummary);
    state.geometries = [...server, ...local];
  }

  function syncableDraftEntries() {
    return drafts.list().filter((entry) => {
      if (entry.kind === 'create') {
        return Boolean(entry.value?.geometry);
      }
      return Boolean(
        entry.editToken &&
        Object.keys(entry.changes ?? {}).length > 0,
      );
    });
  }

  function refreshDraftControls() {
    const entries = drafts.list();
    const syncable = syncableDraftEntries();
    const conflicts = entries.filter((draft) => draft.conflict).length;
    const created = entries.filter((draft) => draft.kind === 'create').length;
    const edited = entries.filter(
      (draft) =>
        draft.kind !== 'create' &&
        Object.keys(draft.changes ?? {}).length > 0,
    ).length;

    if (draftCount) {
      draftCount.textContent =
        'Локально: ' + entries.length +
        (created ? ' · новых: ' + created : '') +
        (edited ? ' · изменено: ' + edited : '') +
        (conflicts ? ' · конфликтов: ' + conflicts : '');
    }
    if (saveAll) {
      saveAll.disabled =
        syncable.length === 0 ||
        conflicts > 0 ||
        Boolean(state.importSession);
    }
    if (discardAll) {
      discardAll.disabled = entries.length === 0;
    }
  }

  function selectedDraftChanged(change) {
    if (!state.selectedId) return false;
    const id = String(state.selectedId);
    return (
      change.changedIds?.includes(id) ||
      change.removedIds?.includes(id)
    );
  }

  function syncSelectedDraftFromStorage() {
    if (
      !state.selectedId ||
      !state.current ||
      state.importSession
    ) {
      return;
    }

    const local = draftFor(state.selectedId);

    if (isLocalGeometryId(state.selectedId)) {
      if (!local?.value) {
        clearSelection();
        return;
      }
      const item = localCreateSummary(local);
      state.current = item;
      state.draft = clone(item.geometry);
      state.editing = true;
      state.editLease = null;
      state.blockedLease = null;
      applyForm(item);
      rebuildDraftOverlay();
      renderList();
      updateMapSources();
      renderHistoryControls();
      refreshDraftControls();
      return;
    }

    if (!local) {
      state.editing = false;
      state.editLease = null;
      scheduleGeometryServerSync('draft-removed');
      return;
    }

    if (
      geometryDraftIsStale(
        state.current.updatedAt,
        local,
      )
    ) {
      drafts.markConflict(
        state.selectedId,
        true,
      );
    }

    const currentDraft = draftFor(state.selectedId);
    const effective =
      applyGeometryDraft(
        state.current,
        currentDraft,
      );

    state.editing =
      Boolean(
        currentDraft?.editToken &&
        state.validatedEditTokens.get(
          String(state.selectedId),
        ) === currentDraft.editToken,
      );
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
  }

  function flushPendingExternalDraftSync() {
    if (
      !state.pendingExternalDraftSync ||
      state.dragPath ||
      state.geometryDrag ||
      state.coordinateWindowOpen ||
      state.drawing
    ) {
      return;
    }

    state.pendingExternalDraftSync = false;
    syncSelectedDraftFromStorage();
  }

  function handleExternalDraftChange(change) {
    rebuildDraftOverlay();
    refreshDraftControls();
    renderList();

    if (state.importSession) {
      renderImportConflicts();
    }

    if (selectedDraftChanged(change)) {
      if (
        state.dragPath ||
        state.drawing
      ) {
        state.pendingExternalDraftSync = true;
        updateMapSources();
        setMessage(
          'Общий черновик изменён в другой вкладке. Изменение будет применено после завершения текущего действия.',
          'error',
        );
        return;
      }

      syncSelectedDraftFromStorage();
    } else {
      updateMapSources();
    }

    if (change.modeChanged) {
      refreshDraftControls();
    }
  }

  function scheduleGeometryServerSync(reason) {
    remoteSyncReasons.add(reason);
    if (remoteSyncTimer !== null) {
      window.clearTimeout(
        remoteSyncTimer,
      );
    }

    remoteSyncTimer =
      window.setTimeout(
        async () => {
          remoteSyncTimer = null;
          const reasons =
            new Set(remoteSyncReasons);
          remoteSyncReasons.clear();

          await refresh({
            keepSelection: true,
            fit: false,
          });

          if (state.importSession) {
            return;
          }

          const conflicts =
            drafts.list()
              .filter(
                (draft) =>
                  draft.conflict,
              )
              .length;

          const fromRealtime =
            reasons.has(
              'realtime',
            );

          setMessage(
            conflicts
              ? 'Данные синхронизированы. Локальных конфликтов: ' + conflicts + '.'
              : fromRealtime
                ? 'Геометрии автоматически синхронизированы.'
                : 'Общий черновик синхронизирован с серверным состоянием.',
            conflicts
              ? 'error'
              : 'success',
          );
        },
        REMOTE_SYNC_DELAY_MS,
      );
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
    if (!item) return 'Выберите геометрию';
    return state.editing
      ? `Редактирование: ${displayName(item)} · клик по сегменту — добавить узел · Ctrl+клик по узлу — удалить`
      : `Просмотр: ${displayName(item)} · нажмите «Начать редактирование» для изменений`;
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
        isEditLocked:
          Number.isSafeInteger(Number(item.id)) &&
          state.editLeases.has(Number(item.id)),
        isActiveEdit:
          state.editing &&
          String(item.id) === String(state.current?.id),
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
    if (
      !geometry ||
      !state.editing ||
      state.drawing ||
      state.moveGeometryMode
    ) {
      return emptyCollection();
    }
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
    const drawing =
      state.drawing;

    if (!drawing) {
      return emptyCollection();
    }

    const fixed =
      drawing.coordinates.map(
        (coordinate) =>
          [...coordinate],
      );
    const preview =
      drawing.previewCoordinate
        ? [
            ...drawing
              .previewCoordinate,
          ]
        : null;

    let geometry;

    if (
      drawing.mode ===
      'point'
    ) {
      const coordinate =
        fixed[0] ??
        preview;

      if (!coordinate) {
        return emptyCollection();
      }

      geometry = {
        type: 'Point',
        coordinates:
          coordinate,
      };
    } else if (
      drawing.mode === 'line' ||
      drawing.mode === 'split'
    ) {
      const coordinates =
        fixed.length > 0 &&
        preview
          ? [
              ...fixed,
              preview,
            ]
          : fixed;

      if (
        coordinates.length === 0
      ) {
        return emptyCollection();
      }

      geometry =
        coordinates.length === 1
          ? {
              type: 'Point',
              coordinates:
                coordinates[0],
            }
          : {
              type: 'LineString',
              coordinates,
            };
    } else {
      const coordinates =
        fixed.length > 0 &&
        preview
          ? [
              ...fixed,
              preview,
            ]
          : fixed;

      if (
        coordinates.length === 0
      ) {
        return emptyCollection();
      }

      if (
        coordinates.length < 3
      ) {
        geometry =
          coordinates.length === 1
            ? {
                type: 'Point',
                coordinates:
                  coordinates[0],
              }
            : {
                type: 'LineString',
                coordinates,
              };
      } else {
        geometry = {
          type: 'Polygon',
          coordinates: [[
            ...coordinates,
            [
              ...coordinates[0],
            ],
          ]],
        };
      }
    }

    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry,
        properties: {},
      }],
    };
  }

  function updateDrawingPreview() {
    state.map
      ?.getSource(
        DRAW_SOURCE,
      )
      ?.setData(
        drawingFeature(),
      );
  }

  function addLayerSafe(map, layer, before) {
    if (!map.getLayer(layer.id)) map.addLayer(layer, before);
  }

  function refreshMapCursor() {
    const canvas = state.map?.getCanvas();
    if (!canvas) return;
    if (state.drawing) {
      canvas.style.cursor = 'crosshair';
      return;
    }
    if (state.geometryDrag) {
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (state.moveGeometryMode) {
      canvas.style.cursor =
        state.hoveredGeometry
          ? 'grab'
          : 'move';
      return;
    }
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
      canvas.style.cursor = ADD_VERTEX_CURSOR;
      return;
    }
    canvas.style.cursor = state.hoveredGeometry
      ? 'pointer'
      : '';
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
      map.addSource(IMPORT_SOURCE, { type: 'geojson', data: emptyCollection() });

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
          'fill-color': [
            'case',
            ['get', 'isEditLocked'],
            '#737d82',
            '#6f8da0',
          ],
          'fill-opacity': ['case', ['get', 'isVisible'], 0.2, 0.07],
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-polygon-lines',
        type: 'line',
        source: MAP_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'line-color': [
            'case',
            ['get', 'isEditLocked'],
            '#737d82',
            '#91a5ab',
          ],
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
          'line-color': [
            'case',
            ['get', 'isEditLocked'],
            '#737d82',
            ['coalesce', ['get', 'lineColor'], '#35c6b4'],
          ],
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
          'circle-color': [
            'case',
            ['get', 'isEditLocked'],
            '#737d82',
            '#91a5ab',
          ],
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
        paint: {
          'fill-color': [
            'case',
            ['get', 'isActiveEdit'],
            '#f3b74e',
            ['get', 'isEditLocked'],
            '#737d82',
            '#f3b74e',
          ],
          'fill-opacity': 0.24,
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-selected-line',
        type: 'line',
        source: SELECTED_SOURCE,
        filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'case',
            ['get', 'isActiveEdit'],
            '#f3b74e',
            ['get', 'isEditLocked'],
            '#737d82',
            '#f3b74e',
          ],
          'line-width': 5,
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-selected-point',
        type: 'circle',
        source: SELECTED_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 9,
          'circle-color': [
            'case',
            ['get', 'isActiveEdit'],
            '#f3b74e',
            ['get', 'isEditLocked'],
            '#737d82',
            '#f3b74e',
          ],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      });

      const selectedDragLayers = [
        'geometry-editor-selected-fill',
        'geometry-editor-selected-line',
        'geometry-editor-selected-point',
      ];

      const beginGeometryDrag =
        (event) => {
          if (
            !state.moveGeometryMode ||
            !state.editing ||
            !state.draft ||
            state.drawing ||
            state.geometryDrag
          ) {
            return;
          }

          event.preventDefault();
          event.originalEvent
            ?.preventDefault?.();
          event.originalEvent
            ?.stopPropagation?.();

          state.suppressMapClick =
            true;
          state.geometryDrag = {
            origin:
              event.lngLat
                .toArray(),
            original:
              clone(
                state.draft,
              ),
            moved: false,
          };

          pushHistory();
          map.dragPan.disable();
          refreshMapCursor();
        };

      for (
        const layerId of
        selectedDragLayers
      ) {
        map.on(
          'mousedown',
          layerId,
          beginGeometryDrag,
        );
        map.on(
          'mouseenter',
          layerId,
          () => {
            state.hoveredGeometry =
              true;
            refreshMapCursor();
          },
        );
        map.on(
          'mouseleave',
          layerId,
          () => {
            state.hoveredGeometry =
              false;
            refreshMapCursor();
          },
        );
      }

      addLayerSafe(map, {
        id: 'geometry-editor-draw-line',
        type: 'line',
        source: DRAW_SOURCE,
        filter: [
          'in',
          ['geometry-type'],
          ['literal', ['LineString', 'Polygon']],
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#f3b74e', 'line-width': 5 },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-draw-fill',
        type: 'fill',
        source: DRAW_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#f3b74e', 'fill-opacity': 0.18 },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-import-existing',
        type: 'line',
        source: IMPORT_SOURCE,
        filter: ['==', ['get', 'role'], 'existing'],
        paint: {
          'line-color': '#b86cff',
          'line-width': 6,
          'line-opacity': 0.85,
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-import-incoming',
        type: 'line',
        source: IMPORT_SOURCE,
        filter: ['==', ['get', 'role'], 'incoming'],
        paint: {
          'line-color': '#ff5d67',
          'line-width': 8,
          'line-opacity': 0.9,
          'line-dasharray': [1.6, 1],
        },
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
        if (
          !candidate ||
          !state.draft ||
          state.drawing ||
          state.moveGeometryMode ||
          state.suppressMapClick
        ) return;

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
        if (
          !candidate ||
          !state.draft ||
          state.drawing ||
          state.moveGeometryMode
        ) return;
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
        if (
          !candidate ||
          !state.draft ||
          state.drawing ||
          state.moveGeometryMode
        ) return;
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
        if (
          state.geometryDrag &&
          state.draft
        ) {
          const current =
            event.lngLat
              .toArray();
          const dx =
            current[0] -
            state.geometryDrag
              .origin[0];
          const dy =
            current[1] -
            state.geometryDrag
              .origin[1];

          try {
            state.draft =
              translateGeometry(
                state.geometryDrag
                  .original,
                dx,
                dy,
              );
            state.geometryDrag
              .moved =
              Math.abs(dx) >
                Number.EPSILON ||
              Math.abs(dy) >
                Number.EPSILON;
            updateMapSources();
          } catch {
            // Keep the last valid position when pointer crosses WGS84 bounds.
          }
          return;
        }

        if (
          state.dragPath &&
          state.draft
        ) {
          moveVertex(
            state.dragPath,
            event.lngLat.toArray(),
            {
              record: false,
            },
          );
          return;
        }

        if (!state.drawing) {
          return;
        }

        state.drawing
          .previewCoordinate =
          event.lngLat.toArray();

        updateDrawingPreview();
      });
      map.on('mouseup', () => {
        if (
          state.geometryDrag
        ) {
          const drag =
            state.geometryDrag;
          state.geometryDrag =
            null;
          map.dragPan.enable();

          if (!drag.moved) {
            state.history.pop();
            renderHistoryControls();
          } else {
            updateDraftMap();

            if (
              state.pendingExternalDraftSync
            ) {
              flushPendingExternalDraftSync();
            } else {
              captureCurrentDraft();
              setMessage(
                'Геометрия перемещена в локальном черновике.',
                'success',
              );
            }
          }

          window.setTimeout(
            () => {
              state.suppressMapClick =
                false;
            },
            0,
          );
          refreshMapCursor();
          return;
        }

        if (!state.dragPath) return;
        state.dragPath = null;
        map.dragPan.enable();
        updateDraftMap();

        if (
          state.pendingExternalDraftSync
        ) {
          flushPendingExternalDraftSync();
        } else {
          captureCurrentDraft();
        }

        refreshMapCursor();
      });

      map.on('click', (event) => {
        if (state.suppressMapClick || !state.drawing) return;
        const coordinate =
          event.lngLat.toArray();

        state.drawing
          .previewCoordinate =
          null;

        if (
          state.drawing.mode ===
          'point'
        ) {
          state.drawing.coordinates =
            [coordinate];
          finishDrawing();
          return;
        }

        state.drawing
          .coordinates
          .push(
            coordinate,
          );
        updateMapSources();
        updateDrawControls();
      });

      const addVertexHint =
        new globalThis.mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 10,
        });

      for (const layerId of [
        'geometry-editor-lines', 'geometry-editor-polygon-lines',
        'geometry-editor-polygons', 'geometry-editor-points',
      ]) {
        map.on('click', layerId, (event) => {
          if (
            state.drawing ||
            state.moveGeometryMode ||
            state.suppressMapClick
          ) return;
          const vertexHits = map.queryRenderedFeatures(event.point, {
            layers: ['geometry-editor-vertices'],
          });
          if (vertexHits.length > 0) return;

          const id = Number(event.features?.[0]?.properties?.id);
          if (Number.isSafeInteger(id) && id > 0) void selectGeometry(id);
        });
        map.on('mouseenter', layerId, () => {
          state.hoveredGeometry = true;
          refreshMapCursor();
        });
        map.on('mouseleave', layerId, () => {
          state.hoveredGeometry = false;
          refreshMapCursor();
        });
      }
      map.on('mouseenter', 'geometry-editor-vertices', () => {
        state.hoveredVertex = true;
        refreshMapCursor();
      });
      map.on('mouseleave', 'geometry-editor-vertices', () => {
        state.hoveredVertex = false;
        refreshMapCursor();
      });
      map.on('mouseenter', 'geometry-editor-segment-hit', () => {
        state.hoveredSegment = true;
        refreshMapCursor();
      });
      map.on('mouseleave', 'geometry-editor-segment-hit', () => {
        state.hoveredSegment = false;
        refreshMapCursor();
      });
      map.on('mouseenter', 'geometry-editor-midpoints', (event) => {
        state.hoveredSegment = true;
        refreshMapCursor();
        if (
          !state.drawing &&
          !state.moveGeometryMode &&
          event.lngLat
        ) {
          addVertexHint
            .setLngLat(event.lngLat)
            .setText('Добавить узел')
            .addTo(map);
        }
      });
      map.on('mouseleave', 'geometry-editor-midpoints', () => {
        state.hoveredSegment = false;
        addVertexHint.remove();
        refreshMapCursor();
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

  function relationLabel(relation) {
    const labels = {
      'equals-different-tags':
        'геометрия равна, исходные теги различаются',
      'within-same-tags':
        'одна линия входит в другую при одинаковых исходных тегах',
      overlaps:
        'линии частично совпадают',
    };
    return labels[relation] ?? relation;
  }

  function activeConflict() {
    if (!state.importSession) return null;
    return state.importSession.conflicts.find(
      (item) =>
        item.incomingId ===
        state.activeConflictId,
    ) ?? null;
  }

  function importConflictFeatures() {
    const conflict = activeConflict();
    if (!conflict) return emptyCollection();

    const features = [{
      type: 'Feature',
      geometry: conflict.geometry,
      properties: {
        role: 'incoming',
        id: conflict.incomingId,
        name:
          conflict.displayName ??
          'Incoming #' +
            conflict.incomingId,
      },
    }];

    for (const candidate of conflict.candidates) {
      features.push({
        type: 'Feature',
        geometry:
          candidate.existing
            .geometry,
        properties: {
          role: 'existing',
          id:
            candidate.existing.id,
          name:
            candidate.existing
              .displayName ??
            'Geometry #' +
              candidate.existing.id,
          relation:
            candidate.relation,
        },
      });
    }

    return {
      type: 'FeatureCollection',
      features,
    };
  }

  function fitFeatureCollection(collection) {
    if (
      !state.map ||
      !collection?.features?.length
    ) {
      return;
    }

    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;

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

    for (const item of collection.features) {
      visit(item.geometry?.coordinates);
    }

    if (
      [west, south, east, north]
        .every(Number.isFinite)
    ) {
      state.map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        {
          padding: 80,
          maxZoom: 18,
          duration: 250,
        },
      );
    }
  }


  function updateMapSources() {
    const map = state.map;
    if (!map) return;

    const showEditable =
      Boolean(
        state.editing &&
        state.draft &&
        state.current?.id,
      );
    const backgroundGeometries = showEditable
      ? state.geometries.filter(
          (item) =>
            String(item.id) !==
            String(state.current.id),
        )
      : state.geometries;
    const selectedSummary =
      state.geometries.find(
        (item) =>
          String(item.id) ===
          String(state.selectedId),
      ) ??
      null;
    const selectedGeometry =
      showEditable
        ? {
            ...(state.current ?? selectedSummary ?? {}),
            id:
              state.current?.id ??
              selectedSummary?.id ??
              null,
            family:
              familyOf(state.draft),
            geometryType:
              geometryType(state.draft),
            geometry:
              state.draft,
          }
        : (
            selectedSummary ??
            state.current
          );

    map.getSource(MAP_SOURCE)?.setData(
      featureCollection(
        backgroundGeometries,
      ),
    );
    map.getSource(SELECTED_SOURCE)?.setData(
      selectedGeometry
        ? featureCollection([
            selectedGeometry,
          ])
        : emptyCollection(),
    );
    map.getSource(HANDLE_SOURCE)?.setData(handleFeatures());
    map.getSource(DRAW_SOURCE)?.setData(drawingFeature());
    map.getSource(IMPORT_SOURCE)?.setData(
      importConflictFeatures(),
    );

    const conflictBoundary =
      activeConflict()
        ?.boundaryGeometry;

    map.getSource(BOUNDARY_SOURCE)?.setData(
      conflictBoundary
        ? {
            type: 'Feature',
            geometry: conflictBoundary,
            properties: {},
          }
        : state.city?.boundaryGeometry
          ? {
              type: 'Feature',
              geometry: state.city.boundaryGeometry,
              properties: {},
            }
          : emptyCollection(),
    );
  }

  function captureCurrentDraft() {
    if (
      !state.current?.id ||
      !state.draft ||
      !state.editing
    ) {
      updateMapSources();
      return null;
    }

    if (isLocalGeometryId(state.current.id)) {
      const existing = draftFor(state.current.id);
      drafts.upsert(state.current.id, {
        ...(existing ?? {}),
        kind: 'create',
        localId: state.current.id,
        workspaceKey:
          existing?.workspaceKey ??
          state.workspaceKey ??
          'unlinked',
        value: payloadFromForm(),
        conflict: false,
      });
      rebuildDraftOverlay();
      refreshDraftControls();
      renderList();
      updateMapSources();
      renderFormState();
      return draftFor(state.current.id);
    }

    const changes = geometryDraftChanges(
      state.current,
      payloadFromForm(),
    );
    const existing = draftFor(state.current.id);

    drafts.upsert(state.current.id, {
      ...(existing ?? {}),
      kind: 'update',
      baseUpdatedAt:
        existing?.baseUpdatedAt ??
        state.current.updatedAt,
      editToken:
        existing?.editToken ??
        state.editLease?.token ??
        null,
      changes,
      conflict: Boolean(existing?.conflict),
    });

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
    undoButton.disabled =
      !state.editing ||
      state.history.length === 0 ||
      Boolean(state.drawing);
    redoButton.disabled =
      !state.editing ||
      state.future.length === 0 ||
      Boolean(state.drawing);
  }

  function undo() {
    if (
      !state.editing ||
      !state.history.length ||
      !state.draft
    ) {
      return;
    }
    state.future.push(clone(state.draft));
    state.draft = state.history.pop();
    state.selectedVertexPath = null;
    updateDraftMap();
    captureCurrentDraft();
    modeLabel.textContent = editingModeText(state.current);
  }


  function redo() {
    if (
      !state.editing ||
      !state.future.length ||
      !state.draft
    ) {
      return;
    }
    state.history.push(clone(state.draft));
    state.draft = state.future.pop();
    state.selectedVertexPath = null;
    updateDraftMap();
    captureCurrentDraft();
    modeLabel.textContent = editingModeText(state.current);
  }


  function selectVertex(path) {
    if (!state.editing) return;
    state.selectedVertexPath = path;
    updateMapSources();
    renderHistoryControls();
    modeLabel.textContent =
      `Узел ${path.length ? path.join('.') : 'Point'} выбран · Ctrl+клик по узлу — удалить`;
  }

  function moveVertex(path, coordinate, { record = true } = {}) {
    if (!state.editing || !state.draft) return;
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
    if (
      !state.editing ||
      !state.draft ||
      state.draft.type === 'Point'
    ) {
      return;
    }
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
    if (
      !state.editing ||
      !path ||
      !state.draft
    ) {
      return;
    }
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


  function setCoordinateMessage(
    text,
    tone = '',
  ) {
    coordinateMessage.textContent =
      text ?? '';
    coordinateMessage.className =
      'notice geometry-coordinate-message' +
      (
        tone
          ? ' notice-' + tone
          : ''
      );
  }

  function currentCoordinateSequence() {
    if (!state.draft) {
      return null;
    }

    const sequences =
      coordinateSequences(
        state.draft,
      );
    const selected =
      coordinateSequence.value;

    return (
      sequences.find(
        (item) =>
          item.key ===
          selected,
      ) ??
      sequences[0] ??
      null
    );
  }

  function coordinateRow(
    coordinate,
    index,
  ) {
    const row =
      document.createElement(
        'tr',
      );

    const number =
      document.createElement(
        'td',
      );
    number.textContent =
      String(index + 1);

    const lonCell =
      document.createElement(
        'td',
      );
    const lon =
      document.createElement(
        'input',
      );
    lon.type = 'text';
    lon.inputMode = 'decimal';
    lon.autocomplete = 'off';
    lon.dataset.coordinate =
      'longitude';
    lon.value =
      String(
        coordinate?.[0] ??
        '',
      );
    lonCell.append(lon);

    const latCell =
      document.createElement(
        'td',
      );
    const lat =
      document.createElement(
        'input',
      );
    lat.type = 'text';
    lat.inputMode = 'decimal';
    lat.autocomplete = 'off';
    lat.dataset.coordinate =
      'latitude';
    lat.value =
      String(
        coordinate?.[1] ??
        '',
      );
    latCell.append(lat);

    const actionCell =
      document.createElement(
        'td',
      );
    const remove =
      document.createElement(
        'button',
      );
    remove.type = 'button';
    remove.className =
      'secondary';
    remove.textContent = '×';
    remove.title =
      'Удалить строку';
    remove.setAttribute(
      'aria-label',
      'Удалить координату ' +
        (index + 1),
    );
    remove.addEventListener(
      'click',
      () => {
        row.remove();
        renumberCoordinateRows();
      },
    );
    actionCell.append(remove);

    row.append(
      number,
      lonCell,
      latCell,
      actionCell,
    );

    return row;
  }

  function renumberCoordinateRows() {
    [
      ...coordinateTableBody
        .querySelectorAll('tr'),
    ].forEach(
      (row, index) => {
        row.children[0]
          .textContent =
          String(index + 1);
        row.querySelector(
          'button',
        )?.setAttribute(
          'aria-label',
          'Удалить координату ' +
            (index + 1),
        );
      },
    );
  }

  function renderCoordinateRows(
    coordinates,
  ) {
    coordinateTableBody
      .replaceChildren(
        ...coordinates.map(
          coordinateRow,
        ),
      );
  }

  function readCoordinateRows() {
    const rows = [
      ...coordinateTableBody
        .querySelectorAll('tr'),
    ];

    return rows.map(
      (row) =>
        normalizeCoordinate(
          row.querySelector(
            '[data-coordinate="longitude"]',
          )?.value,
          row.querySelector(
            '[data-coordinate="latitude"]',
          )?.value,
        ),
    );
  }

  function renderCoordinateSequence() {
    const descriptor =
      currentCoordinateSequence();

    if (!descriptor) {
      renderCoordinateRows(
        [],
      );
      coordinateApply.disabled =
        true;
      coordinateAddRow.disabled =
        true;
      return;
    }

    renderCoordinateRows(
      descriptor.coordinates,
    );
    coordinateApply.disabled =
      false;
    coordinateAddRow.disabled =
      state.draft?.type ===
      'Point';
    setCoordinateMessage('');
  }

  function refreshCoordinateWindow() {
    if (
      !state.coordinateWindowOpen ||
      !state.draft
    ) {
      return;
    }

    const previous =
      coordinateSequence.value;
    const sequences =
      coordinateSequences(
        state.draft,
      );

    coordinateSequence
      .replaceChildren(
        ...sequences.map(
          (descriptor) => {
            const option =
              document.createElement(
                'option',
              );
            option.value =
              descriptor.key;
            option.textContent =
              descriptor.label;
            return option;
          },
        ),
      );

    if (
      sequences.some(
        (descriptor) =>
          descriptor.key ===
          previous,
      )
    ) {
      coordinateSequence.value =
        previous;
    }

    renderCoordinateSequence();
  }

  function closeCoordinateWindow() {
    state.coordinateWindowOpen =
      false;
    coordinateWindow.hidden =
      true;
    setCoordinateMessage('');
    flushPendingExternalDraftSync();
  }

  function openCoordinateWindow() {
    if (
      !state.editing ||
      !state.draft ||
      state.drawing ||
      state.importSession
    ) {
      return;
    }

    state.moveGeometryMode =
      false;
    state.coordinateWindowOpen =
      true;
    coordinateWindow.hidden =
      false;
    coordinatePaste.value =
      '';
    refreshCoordinateWindow();
    renderGeometryToolState();
    refreshMapCursor();
  }

  function renderGeometryToolState() {
    const enabled =
      Boolean(
        state.editing &&
        state.draft &&
        !state.drawing &&
        !state.importSession,
      );

    moveGeometryButton.disabled =
      !enabled;
    coordinateOpenButton.disabled =
      !enabled;

    if (
      !enabled &&
      state.moveGeometryMode
    ) {
      state.moveGeometryMode =
        false;
    }

    if (
      !enabled &&
      state.coordinateWindowOpen
    ) {
      closeCoordinateWindow();
    }

    moveGeometryButton.classList
      .toggle(
        'is-active',
        state.moveGeometryMode,
      );
    moveGeometryButton.textContent =
      state.moveGeometryMode
        ? 'Перемещение включено'
        : 'Переместить';
    moveGeometryButton.setAttribute(
      'aria-pressed',
      String(
        state.moveGeometryMode,
      ),
    );
  }

  function setMoveGeometryMode(
    enabled,
  ) {
    const next =
      Boolean(enabled);

    if (
      next &&
      (
        !state.editing ||
        !state.draft ||
        state.drawing ||
        state.importSession
      )
    ) {
      return;
    }

    if (
      state.geometryDrag
    ) {
      return;
    }

    state.moveGeometryMode =
      next;
    state.selectedVertexPath =
      null;

    if (next) {
      closeCoordinateWindow();
      modeLabel.textContent =
        'Перемещение геометрии · перетащите объект целиком';
    } else {
      modeLabel.textContent =
        editingModeText(
          state.current,
        );
    }

    updateMapSources();
    renderGeometryToolState();
    refreshMapCursor();
  }

  function applyCoordinateTable() {
    const descriptor =
      currentCoordinateSequence();

    if (
      !descriptor ||
      !state.draft ||
      !state.editing
    ) {
      return;
    }

    try {
      const coordinates =
        readCoordinateRows();
      const next =
        replaceCoordinateSequence(
          state.draft,
          descriptor.path,
          coordinates,
        );

      pushHistory();
      state.draft = next;
      state.selectedVertexPath =
        null;
      updateDraftMap();
      captureCurrentDraft();
      refreshCoordinateWindow();
      setCoordinateMessage(
        'Координаты применены к локальному черновику.',
        'success',
      );
    } catch (error) {
      setCoordinateMessage(
        error.message,
        'error',
      );
    }
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
    const localItem = isLocalGeometryId(item?.id);
    const localDraft = item?.id ? draftFor(item.id) : null;
    const activeLease =
      !localItem && item?.id
        ? (
            state.blockedLease ??
            state.editLeases.get(Number(item.id)) ??
            null
          )
        : null;
    const enabled =
      Boolean(draft) &&
      state.editing &&
      !state.drawing &&
      !state.importSession;

    renderGeometryToolState();

    for (const control of form.elements) {
      if (control.name === 'lineTypeId' || control.name === 'lanes') continue;
      if (['displayName', 'tooltip', 'tags', 'isVisible'].includes(control.name)) {
        control.disabled = !enabled;
      }
    }

    form.querySelector('button[type="submit"]').disabled = !enabled;
    revertButton.disabled = !enabled;
    deleteButton.disabled =
      !item?.id ||
      localItem ||
      !state.editing ||
      Boolean(state.drawing) ||
      Boolean(state.importSession);

    const blockedByOther =
      Boolean(
        activeLease &&
        activeLease.clientId !== realtimeClientId(),
      );
    const leasedByThisClient =
      Boolean(
        activeLease &&
        activeLease.clientId === realtimeClientId(),
      );

    beginEditButton.hidden =
      !item?.id ||
      localItem ||
      state.editing;
    beginEditButton.disabled =
      Boolean(state.importSession) ||
      Boolean(state.drawing) ||
      state.beginEditPendingId !== null ||
      blockedByOther;

    takeoverEditButton.hidden =
      !(
        currentUser?.isSuperuser &&
        item?.id &&
        !localItem &&
        !state.editing &&
        blockedByOther
      );

    if (editLockStatus) {
      editLockStatus.textContent =
        localItem
          ? 'Новая геометрия · localStorage'
          : state.editing
            ? 'Редактирование заблокировано за вами'
            : blockedByOther
              ? 'Редактирует: ' +
                (activeLease.username ?? 'другой пользователь')
              : leasedByThisClient
                ? 'Локально сохранено · блокировка остаётся за вами'
                : item?.id
                  ? 'Режим просмотра'
                  : '';
    }

    if (conflictMessage) {
      conflictMessage.hidden = !localDraft?.conflict;
      conflictMessage.textContent = localDraft?.conflict
        ? 'Серверная версия изменилась после создания локального черновика.'
        : '';
    }

    if (!draft) {
      title.textContent = 'Выберите геометрию';
      lineFields.hidden = true;
      topologyActions.hidden = true;
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

    title.textContent =
      localItem
        ? 'Новая: ' + typeLabel(pseudo)
        : displayName(pseudo);
    lineFields.hidden = family !== 'line';
    renderTopologyState();

    if (family === 'line') {
      form.elements.lineTypeId.disabled = !enabled;
      form.elements.lanes.disabled = !enabled;
    } else {
      form.elements.lineTypeId.disabled = true;
      form.elements.lanes.disabled = true;
    }

    meta.replaceChildren(
      metaItem('Тип', typeLabel(pseudo)),
      metaItem(
        'ID',
        localItem
          ? 'локальная · ещё не синхронизирована'
          : item?.id ?? '—',
      ),
      metaItem(
        'Административная привязка',
        item?.boundaryId
          ? 'OSM-область #' + item.boundaryId
          : 'нет привязки',
      ),
      metaItem(
        'Изменялась вручную',
        item?.wasEdited
          ? 'да'
          : localItem
            ? 'новая'
            : 'нет',
      ),
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
      item._draft ? 'черновик' : null,
      item._conflict ? 'конфликт' : null,
      !item.boundaryId ? 'без административной привязки' : null,
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
      const row = document.createElement('div');
      row.className = 'geometry-editor-row';
      const rowLease =
        state.editLeases.get(
          Number(item.id),
        );
      row.classList.toggle('is-selected', item.id === state.selectedId);
      row.classList.toggle('is-hidden', item.isVisible === false);
      row.classList.toggle('has-draft', Boolean(item._draft));
      row.classList.toggle('has-conflict', Boolean(item._conflict));
      row.classList.toggle('is-unlinked', !item.boundaryId);

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'geometry-editor-row-select';
      check.checked = state.selectedSet.has(item.id);
      check.disabled = Boolean(
        state.importSession ||
        item._local ||
        item._draft ||
        item._conflict ||
        state.editLeases.has(Number(item.id))
      );
      check.title = check.disabled
        ? 'Сначала сохраните или сбросьте локальный черновик'
        : 'Выбрать для групповой или topology-операции';
      check.setAttribute(
        'aria-label',
        'Выбрать для операции: ' + displayName(item),
      );
      check.addEventListener('change', () => {
        if (check.checked) state.selectedSet.add(item.id);
        else state.selectedSet.delete(item.id);
        renderMergeState();
      });

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'geometry-editor-row-main';

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
        rowLease
          ? 'редактирует: ' +
            (rowLease.username ?? 'другой пользователь')
          : null,
        !item.boundaryId ? 'без привязки' : null,
        item.isVisible === false ? 'скрыта' : null,
      ].filter(Boolean).join(' · ') || typeLabel(item);
      copy.append(name, details);

      const type = document.createElement('span');
      type.className = 'geometry-editor-row-type';
      type.textContent = typeLabel(item);

      open.append(copy, type);
      open.addEventListener('click', () => void selectGeometry(item.id));

      row.append(check, open);
      listHost.append(row);
    }

    renderMergeState();
  }

  function selectedMergeItems() {
    return [...state.selectedSet]
      .sort((left, right) => left - right)
      .map((id) => state.geometries.find((item) => item.id === id))
      .filter(Boolean);
  }

  function mergeProblem(items) {
    if (state.importSession) {
      return 'Сначала разрешите конфликты подготовленного импорта.';
    }
    if (items.length < 2) return 'Выберите минимум две геометрии.';
    if (items.some((item) => item._draft || item._conflict)) {
      return 'Сначала сохраните или сбросьте локальные черновики выбранных геометрий.';
    }

    const first = items[0];
    if (first.family === 'point') {
      return 'Точечные геометрии объединять нельзя.';
    }

    if (
      items.some((item) =>
        item.cityId !== first.cityId ||
        item.boundaryId !== first.boundaryId ||
        item.family !== first.family)
    ) {
      return 'Геометрии должны принадлежать одному городу, OSM-объекту и типу геометрии.';
    }

    if (
      items.some((item) =>
        item.isVisible !== first.isVisible)
    ) {
      return 'У объединяемых геометрий должна совпадать видимость.';
    }

    if (
      first.family === 'line' &&
      items.some((item) =>
        item.lineTypeId !== first.lineTypeId ||
        item.lanes !== first.lanes)
    ) {
      return 'У объединяемых линий должны совпадать тип линии и коэффициент полос.';
    }

    if (
      items.some((item) =>
        !item.updatedAt)
    ) {
      return 'Для одной из геометрий неизвестна серверная ревизия. Обновите список.';
    }

    return null;
  }

  function selectedCutterGeometry() {
    const targetId =
      state.current?.id;

    const candidates =
      selectedMergeItems()
        .filter(
          (item) =>
            item.id !== targetId,
        );

    if (
      candidates.length !== 1
    ) {
      return null;
    }

    const cutter =
      candidates[0];

    if (
      cutter.family !== 'polygon' ||
      !cutter.updatedAt ||
      cutter._draft ||
      cutter._conflict ||
      state.editLeases.has(
        Number(cutter.id),
      )
    ) {
      return null;
    }

    return cutter;
  }

  function topologyTargetReady(
    families,
  ) {
    const item =
      state.current;
    const local =
      item?.id
        ? draftFor(item.id)
        : null;
    const family =
      familyOf(
        state.draft,
      );

    return Boolean(
      item?.id &&
      !isLocalGeometryId(
        item.id,
      ) &&
      state.editing &&
      !state.drawing &&
      !state.importSession &&
      families.includes(
        family,
      ) &&
      item.updatedAt &&
      local?.editToken &&
      Object.keys(
        local.changes ?? {},
      ).length === 0
    );
  }

  function renderTopologyState() {
    const item =
      state.current;
    const family =
      familyOf(
        state.draft,
      );
    const saved =
      Boolean(
        item?.id &&
        !isLocalGeometryId(
          item.id,
        ),
      );

    topologyActions.hidden =
      !saved ||
      ![
        'line',
        'polygon',
      ].includes(family);

    if (
      topologyActions.hidden
    ) {
      topologyActions.open =
        false;
    }

    cutButton.hidden =
      family !== 'polygon';
    cutSelectedButton.hidden =
      family !== 'polygon';
    splitButton.hidden =
      ![
        'line',
        'polygon',
      ].includes(family);

    const polygonReady =
      topologyTargetReady([
        'polygon',
      ]);
    const splitReady =
      topologyTargetReady([
        'line',
        'polygon',
      ]);
    const cutter =
      selectedCutterGeometry();

    cutButton.disabled =
      !polygonReady;
    cutButton.title =
      polygonReady
        ? 'Нарисовать polygon, который будет вычтен из текущего'
        : 'Сначала начните редактирование и синхронизируйте локальные изменения';

    cutSelectedButton.disabled =
      !polygonReady ||
      !cutter;
    cutSelectedButton.title =
      cutter
        ? 'Cutter: ' +
          displayName(
            cutter,
          )
        : 'Отметьте ровно один сохранённый polygon без черновика и блокировки';

    splitButton.disabled =
      !splitReady;
    splitButton.title =
      splitReady
        ? 'Нарисовать линию, которая разделит геометрию ровно на две части'
        : 'Сначала начните редактирование и синхронизируйте локальные изменения';
  }

  function renderMergeState() {
    const selected = selectedMergeItems();
    const problem = mergeProblem(selected);
    mergeButton.disabled =
      Boolean(problem) ||
      Boolean(state.drawing);
    mergeButton.hidden =
      selected.length === 0;
    mergeButton.textContent =
      `Объединить (${selected.length})`;
    mergeButton.title =
      problem ?? '';
    renderTopologyState();
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
      lanes: item.lanes,
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


  function adoptLocalGeometry(entry, { focus = false } = {}) {
    const item = localCreateSummary(entry);
    state.selectedId = item.id;
    state.current = item;
    state.draft = clone(item.geometry);
    state.editing = true;
    state.editLease = null;
    state.blockedLease = null;
    state.history = [];
    state.future = [];
    state.selectedVertexPath = null;
    applyForm(item);
    rebuildDraftOverlay();
    renderList();
    updateMapSources();
    renderHistoryControls();
    refreshDraftControls();
    modeLabel.textContent = editingModeText(item);
    if (focus) focusGeometry(item.geometry);
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
    state.editing =
      Boolean(
        local?.editToken &&
        state.validatedEditTokens.get(
          String(item.id),
        ) === local.editToken,
      );
    state.editLease =
      state.editing
        ? {
            ...(state.editLeases.get(item.id) ?? {}),
            token: local.editToken,
          }
        : null;
    state.blockedLease = null;
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
    setMoveGeometryMode(false);
    closeCoordinateWindow();

    if (state.importSession) {
      setMessage(
        'Сначала разрешите конфликты подготовленного импорта.',
        'error',
      );
      return;
    }
    if (state.drawing) cancelDrawing();
    const summary = state.geometries.find((candidate) => candidate.id === id);
    if (!summary) return;

    if (isLocalGeometryId(id)) {
      const local = draftFor(id);
      if (local?.kind === 'create') {
        adoptLocalGeometry(local, { focus });
      }
      return;
    }

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
      if (
        !item.boundaryId &&
        !draftFor(item.id)?.conflict
      ) {
        setMessage(
          'Геометрия сейчас не имеет административной привязки. Это нормальное редактируемое состояние.',
        );
      }
    } catch (error) {
      if (state.selectedId !== id) return;
      clearSelection();
      setMessage(error.message, 'error');
    }
  }

  async function beginEditing() {
    const item = state.current;
    if (
      !item?.id ||
      isLocalGeometryId(item.id) ||
      state.editing ||
      state.beginEditPendingId !== null
    ) {
      return;
    }

    const requestedId = item.id;
    const knownLease =
      state.editLeases.get(
        Number(requestedId),
      );
    if (
      knownLease &&
      knownLease.clientId !==
        realtimeClientId()
    ) {
      state.blockedLease =
        knownLease;
      renderFormState();
      setMessage(
        'Эта геометрия уже редактируется пользователем «' +
          (knownLease.username ?? 'другой пользователь') +
          '».',
        'error',
      );
      return;
    }

    const existingDraft =
      draftFor(requestedId);
    const reusableToken =
      existingDraft?.editToken &&
      state.validatedEditTokens.get(
        String(requestedId),
      ) === existingDraft.editToken
        ? existingDraft.editToken
        : null;

    if (
      reusableToken &&
      (
        !knownLease ||
        knownLease.clientId ===
          realtimeClientId()
      )
    ) {
      state.editing = true;
      state.editLease = {
        ...(knownLease ?? {}),
        geometryId: Number(requestedId),
        clientId: realtimeClientId(),
        token: reusableToken,
      };
      state.blockedLease = null;
      const effective =
        applyGeometryDraft(
          item,
          existingDraft,
        );
      state.draft =
        clone(effective.geometry);
      applyForm(effective);
      updateMapSources();
      renderHistoryControls();
      renderFormState();
      setMessage(
        'Редактирование продолжено с сохранённой блокировкой.',
        'success',
      );
      return;
    }

    state.beginEditPendingId =
      requestedId;
    renderFormState();

    try {
      setMessage('Получаем блокировку редактирования…');
      const payload = await api(
        '/api/admin/geometry-editor/geometries/' +
          encodeURIComponent(requestedId) +
          '/edit-lock',
        { method: 'POST' },
      );
      const lease = payload.lease;

      if (
        String(state.selectedId) !==
          String(requestedId) ||
        String(state.current?.id) !==
          String(requestedId)
      ) {
        await releaseDraftLease({
          id: requestedId,
          kind: 'update',
          editToken: lease.token,
        }).catch(
          (error) =>
            console.warn(
              'Failed to release stale geometry edit lease',
              error,
            ),
        );
        return;
      }

      const existing = draftFor(requestedId);
      drafts.upsert(requestedId, {
        ...(existing ?? {}),
        kind: 'update',
        baseUpdatedAt:
          existing?.baseUpdatedAt ??
          item.updatedAt,
        editToken: lease.token,
        changes: existing?.changes ?? {},
        conflict: Boolean(existing?.conflict),
      });
      state.validatedEditTokens.set(
        String(requestedId),
        lease.token,
      );
      state.editing = true;
      state.editLease = lease;
      state.blockedLease = null;
      state.editLeases.set(Number(requestedId), {
        ...lease,
        token: undefined,
      });

      const effective =
        applyGeometryDraft(
          item,
          draftFor(requestedId),
        );
      state.draft = clone(effective.geometry);
      applyForm(effective);
      updateMapSources();
      renderHistoryControls();
      refreshDraftControls();
      setMessage(
        'Редактирование начато. Изменения автоматически сохраняются в localStorage.',
        'success',
      );
    } catch (error) {
      if (
        String(state.selectedId) ===
          String(requestedId) &&
        error.status === 409
      ) {
        state.blockedLease =
          error.payload?.details?.lease ??
          null;
      }
      if (
        String(state.selectedId) ===
        String(requestedId)
      ) {
        setMessage(error.message, 'error');
      }
    } finally {
      if (
        String(state.beginEditPendingId) ===
        String(requestedId)
      ) {
        state.beginEditPendingId =
          null;
      }
      renderFormState();
    }
  }

  async function takeoverEditing() {
    const item = state.current;
    if (
      !currentUser?.isSuperuser ||
      !item?.id ||
      isLocalGeometryId(item.id)
    ) {
      return;
    }

    const owner =
      state.blockedLease?.username ??
      state.editLeases.get(Number(item.id))?.username ??
      'другой пользователь';

    const confirmed = await adminConfirm({
      title: 'Перехватить редактирование?',
      message:
        'Блокировка пользователя «' + owner +
        '» будет отозвана. Его несинхронизированный локальный черновик этой геометрии будет сброшен до текущего состояния БД.',
      confirmLabel: 'Перехватить',
      cancelLabel: 'Отмена',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      const payload = await api(
        '/api/admin/geometry-editor/geometries/' +
          encodeURIComponent(item.id) +
          '/edit-lock/takeover',
        { method: 'POST' },
      );

      drafts.remove(item.id);
      drafts.upsert(item.id, {
        kind: 'update',
        baseUpdatedAt: item.updatedAt,
        editToken: payload.lease.token,
        changes: {},
        conflict: false,
      });

      state.validatedEditTokens.set(
        String(item.id),
        payload.lease.token,
      );
      state.editing = true;
      state.editLease = payload.lease;
      state.blockedLease = null;
      state.editLeases.set(Number(item.id), {
        ...payload.lease,
        token: undefined,
      });
      state.draft = clone(item.geometry);
      state.history = [];
      state.future = [];
      applyForm(item);
      updateMapSources();
      renderHistoryControls();
      refreshDraftControls();
      setMessage(
        'Блокировка принудительно перехвачена. Редактирование начато.',
        'success',
      );
    } catch (error) {
      setMessage(error.message, 'error');
    }
  }

  function clearSelection() {
    state.moveGeometryMode =
      false;
    state.geometryDrag =
      null;
    closeCoordinateWindow();
    state.selectedId = null;
    state.current = null;
    state.draft = null;
    state.history = [];
    state.future = [];
    state.selectedVertexPath = null;
    state.editing = false;
    state.editLease = null;
    state.blockedLease = null;
    applyForm(null);
    renderList();
    updateMapSources();
    renderHistoryControls();
    modeLabel.textContent = 'Выберите геометрию';
  }

  function renderConflictDecision() {
    const conflict = activeConflict();
    conflictDecision.hidden = !conflict;
    if (!conflict) {
      conflictCandidates.replaceChildren();
      return;
    }

    conflictTitle.textContent =
      conflict.displayName ??
      'Incoming #' +
        conflict.incomingId;

    conflictDescription.textContent =
      conflict.cityName +
      '; тип линии: ' +
      conflict.lineTypeName +
      '; sourceTags incoming: ' +
      JSON.stringify(
        conflict.sourceTags ??
        {},
      ) +
      (
        conflict.autoExistingId
          ? '; точное совпадение уже существует: geometry #' +
            conflict.autoExistingId
          : ''
      );

    conflictAdd.disabled =
      Boolean(
        conflict.autoExistingId,
      );
    conflictAdd.title =
      conflict.autoExistingId
        ? 'Нельзя создать дубль: incoming уже имеет точное совпадение с теми же source_tags'
        : '';

    const decision =
      state.conflictDecisions.get(
        conflict.incomingId,
      );
    const selectedIds =
      new Set(
        decision
          ?.replaceExistingIds ??
        [],
      );

    const rows =
      conflict.candidates.map(
        (candidate) => {
          const localDraft =
            draftFor(
              candidate.existing.id,
            );
          const label =
            document.createElement(
              'label',
            );
          label.className =
            'geometry-conflict-candidate';
          label.classList.toggle(
            'has-local-draft',
            Boolean(localDraft),
          );

          const checkbox =
            document.createElement(
              'input',
            );
          checkbox.type =
            'checkbox';
          checkbox.value =
            String(
              candidate.existing.id,
            );
          checkbox.checked =
            selectedIds.has(
              candidate.existing.id,
            );
          checkbox.disabled =
            Boolean(localDraft);
          checkbox.title =
            localDraft
              ? 'У этой геометрии есть локальный черновик. Для замены сначала сбросьте его.'
              : '';

          const copy =
            document.createElement(
              'span',
            );
          const name =
            document.createElement(
              'strong',
            );
          name.textContent =
            candidate.existing
              .displayName ??
            'Geometry #' +
              candidate.existing.id;

          const details =
            document.createElement(
              'small',
            );
          details.textContent =
            relationLabel(
              candidate.relation,
            ) +
            '; изменялась вручную=' +
            (
              candidate.existing
                .wasEdited
                ? 'да'
                : 'нет'
            ) +
            (
              localDraft
                ? '; есть локальный черновик'
                : ''
            ) +
            '; sourceTags=' +
            JSON.stringify(
              candidate.existing
                .sourceTags ??
              {},
            );

          copy.append(
            name,
            details,
          );
          label.append(
            checkbox,
            copy,
          );
          return label;
        },
      );

    conflictCandidates
      .replaceChildren(
        ...rows,
      );
  }

  function renderImportConflicts() {
    const session =
      state.importSession;

    importPanel.hidden =
      !session;

    citySelect.disabled =
      Boolean(session);
    const cannotCreate =
      Boolean(session) ||
      !state.city?.boundaryId;
    newPointButton.disabled =
      cannotCreate;
    newLineButton.disabled =
      cannotCreate;
    newPolygonButton.disabled =
      cannotCreate;
    recalculateButton.disabled =
      Boolean(session);

    if (!session) {
      importList
        .replaceChildren();
      importSummary.textContent =
        '';
      importApply.disabled =
        true;
      importDiscard.disabled =
        true;
      conflictDecision.hidden =
        true;
      refreshDraftControls();
      renderFormState();
      renderMergeState();
      return;
    }

    importDiscard.disabled =
      false;
    importTitle.textContent =
      'Конфликты KML — session #' +
      session.id;

    const resolved =
      session.conflicts.filter(
        (item) =>
          state.conflictDecisions
            .has(
              item.incomingId,
            ),
      ).length;

    importSummary.textContent =
      session.conflictGeometries +
      ' геометрий / ' +
      session.conflictPairs +
      ' пар. Решено: ' +
      resolved +
      '/' +
      session.conflictGeometries +
      '.';

    importApply.disabled =
      resolved !==
      session.conflictGeometries;

    const buttons =
      session.conflicts.map(
        (conflict) => {
          const button =
            document.createElement(
              'button',
            );
          button.type =
            'button';
          button.className =
            'geometry-import-conflict-item';
          button.classList.toggle(
            'is-active',
            conflict.incomingId ===
              state.activeConflictId,
          );
          button.classList.toggle(
            'is-resolved',
            state.conflictDecisions
              .has(
                conflict.incomingId,
              ),
          );

          const heading =
            document.createElement(
              'strong',
            );
          heading.textContent =
            conflict.displayName ??
            'Incoming #' +
              conflict.incomingId;

          const details =
            document.createElement(
              'small',
            );
          const decision =
            state.conflictDecisions.get(
              conflict.incomingId,
            );
          details.textContent =
            conflict.cityName +
            '; кандидатов: ' +
            conflict.candidates.length +
            (
              decision
                ? '; решение: ' +
                  decision.action
                : '; решение не выбрано'
            );

          button.append(
            heading,
            details,
          );
          button.addEventListener(
            'click',
            () =>
              showImportConflict(
                conflict.incomingId,
              ),
          );
          return button;
        },
      );

    importList.replaceChildren(
      ...buttons,
    );
    renderConflictDecision();
    refreshDraftControls();
    renderFormState();
    renderMergeState();
  }

  function showImportConflict(
    incomingId,
    {
      fit = true,
      capture = true,
    } = {},
  ) {
    if (capture) {
      captureCurrentDraft();
    }

    state.activeConflictId =
      incomingId;
    state.selectedId = null;
    state.current = null;
    state.draft = null;
    state.history = [];
    state.future = [];
    state.selectedVertexPath = null;
    applyForm(null);
    renderList();
    renderImportConflicts();
    updateMapSources();

    const collection =
      importConflictFeatures();

    if (fit) {
      fitFeatureCollection(
        collection,
      );
    }

    modeLabel.textContent =
      'Конфликт #' +
      incomingId +
      ': красная — incoming, фиолетовые — текущие';
  }

  function setConflictDecision(
    action,
  ) {
    const conflict =
      activeConflict();
    if (!conflict) return;

    if (
      action ===
        'add-new' &&
      conflict.autoExistingId
    ) {
      setMessage(
        'Новая запись не создаётся: incoming уже имеет точное совпадение с теми же source_tags.',
        'error',
      );
      return;
    }

    let replaceExistingIds =
      [];

    if (
      action ===
        'replace'
    ) {
      replaceExistingIds =
        Array.from(
          conflictCandidates
            .querySelectorAll(
              'input[type="checkbox"]:checked',
            ),
        )
          .map(
            (input) =>
              Number(
                input.value,
              ),
          )
          .filter(
            (id) =>
              Number.isSafeInteger(
                id,
              ) &&
              id > 0,
          );

      if (
        !replaceExistingIds
          .length
      ) {
        setMessage(
          'Для замены выберите хотя бы одну текущую геометрию без локального черновика.',
          'error',
        );
        return;
      }

      const localIds =
        replaceExistingIds.filter(
          (id) =>
            Boolean(
              draftFor(id),
            ),
        );
      if (
        localIds.length >
        0
      ) {
        setMessage(
          'Нельзя заменить геометрию с локальным черновиком. Сначала сбросьте этот черновик или выберите другое решение.',
          'error',
        );
        return;
      }
    }

    state.conflictDecisions.set(
      conflict.incomingId,
      {
        incomingId:
          conflict.incomingId,
        action,
        replaceExistingIds,
      },
    );

    setMessage(
      'Решение сохранено локально. База изменится только после общей кнопки применения.',
      'success',
    );
    renderImportConflicts();
  }

  async function loadPendingImport() {
    const payload =
      await api(
        '/api/admin/geometry-import/pending',
      );
    const next =
      payload.session ??
      null;
    const previousId =
      state.importSession
        ?.id ??
      null;

    if (
      !next ||
      next.id !==
        previousId
    ) {
      state.conflictDecisions
        .clear();
      state.activeConflictId =
        next?.conflicts?.[0]
          ?.incomingId ??
        null;
    }

    state.importSession =
      next;
    renderImportConflicts();
    updateMapSources();
    return next;
  }

  async function waitForGeometryImportTask(
    taskId,
  ) {
    for (;;) {
      const status =
        await api(
          '/api/admin/geometry-import/tasks/' +
          encodeURIComponent(
            taskId,
          ),
        );
      const task =
        status.task;

      if (
        !task ||
        [
          'failed',
          'cancelled',
          'succeeded',
        ].includes(
          task.status,
        )
      ) {
        if (
          task?.status ===
          'succeeded'
        ) {
          return task.result;
        }

        throw new Error(
          task?.error?.message ??
          'Задача завершилась без успешного результата',
        );
      }

      await new Promise(
        (resolve) => {
          window.setTimeout(
            resolve,
            500,
          );
        },
      );
    }
  }

  async function applyImportDecisions() {
    const session =
      state.importSession;
    if (
      !session ||
      importApply.disabled
    ) {
      return;
    }

    try {
      importApply.disabled =
        true;
      importDiscard.disabled =
        true;
      setMessage(
        'Применяем решения конфликтов…',
      );

      const accepted =
        await api(
          '/api/admin/geometry-import/' +
          session.id +
          '/apply',
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body:
              JSON.stringify({
                decisions:
                  session.conflicts
                    .map(
                      (conflict) =>
                        state.conflictDecisions.get(
                          conflict.incomingId,
                        ),
                    ),
              }),
          },
        );

      const result =
        await waitForGeometryImportTask(
          accepted.taskId,
        );

      state.importSession =
        null;
      state.activeConflictId =
        null;
      state.conflictDecisions
        .clear();
      renderImportConflicts();

      await refresh({
        keepSelection: false,
        fit: false,
      });

      setMessage(
        'Импорт применён. Добавлено: ' +
        (
          result
            ?.insertedGeometries ??
          0
        ) +
        '; заменено: ' +
        (
          result
            ?.replacedExistingGeometries ??
          0
        ) +
        '.',
        'success',
      );
    } catch (error) {
      setMessage(
        error.message,
        'error',
      );
      await loadPendingImport()
        .catch(
          () => {},
        );
    } finally {
      renderImportConflicts();
    }
  }

  async function discardPendingImport() {
    const session =
      state.importSession;
    if (!session) return;

    const confirmed =
      await adminConfirm({
        title:
          'Отбросить подготовленный импорт?',
        message:
          'Staged KML import session #' +
          session.id +
          ' будет удалена. Production-геометрии не изменятся.',
        confirmLabel:
          'Отбросить импорт',
        cancelLabel:
          'Отмена',
        destructive:
          true,
      });

    if (!confirmed) return;

    try {
      importDiscard.disabled =
        true;
      await api(
        '/api/admin/geometry-import/' +
        session.id,
        {
          method: 'DELETE',
        },
      );

      state.importSession =
        null;
      state.activeConflictId =
        null;
      state.conflictDecisions
        .clear();
      renderImportConflicts();

      await refresh({
        keepSelection: false,
        fit: false,
      });

      setMessage(
        'Staged импорт отброшен. Production-геометрии не изменялись.',
        'success',
      );
    } catch (error) {
      setMessage(
        error.message,
        'error',
      );
      renderImportConflicts();
    }
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

  function renderCityOptions(
    preferredValue =
      citySelect.value,
  ) {
    const onlyWithGeometries =
      Boolean(
        cityWithGeometries
          ?.checked,
      );
    const visibleCities =
      onlyWithGeometries
        ? state.cities.filter(
            (city) =>
              Number(
                city.geometryCount,
              ) > 0,
          )
        : state.cities;

    const options =
      visibleCities.map(
        (city) => {
          const option =
            document.createElement(
              'option',
            );
          option.value =
            String(city.id);
          option.textContent =
            city.name +
            ' (' +
            city.geometryCount +
            ')';
          return option;
        },
      );

    const unlinked =
      document.createElement(
        'option',
      );
    unlinked.value =
      '__unlinked__';
    unlinked.textContent =
      'Без привязки';
    options.push(unlinked);

    citySelect.replaceChildren(
      ...options,
    );

    const preferred =
      String(
        preferredValue ??
        '',
      );
    const values =
      new Set(
        options.map(
          (option) =>
            option.value,
        ),
      );
    const nextValue =
      values.has(preferred)
        ? preferred
        : visibleCities[0]
          ? String(
              visibleCities[0].id,
            )
          : '__unlinked__';

    citySelect.value =
      nextValue;
    return nextValue;
  }

  async function loadCities({
    preferredValue =
      citySelect.value,
  } = {}) {
    const payload =
      await api(
        '/api/admin/geometry-editor/cities',
      );
    state.cities =
      payload.cities ?? [];

    return renderCityOptions(
      preferredValue,
    );
  }

  async function loadUnlinked({
    keepSelection = false,
    fit = false,
  } = {}) {
    const previousId =
      keepSelection
        ? state.selectedId
        : null;
    const payload = await api(
      '/api/admin/geometry-editor/unlinked/geometries',
    );

    state.city = null;
    state.workspaceKey = 'unlinked';
    state.serverGeometries =
      payload.geometries ?? [];
    state.selectedSet.clear();
    rebuildDraftOverlay();
    citySelect.value = '__unlinked__';

    const previous =
      previousId &&
      state.geometries.find(
        (item) => item.id === previousId,
      );
    if (previous) {
      await selectGeometry(
        previous.id,
        { focus: false },
      );
    } else {
      clearSelection();
    }

    renderList();
    updateMapSources();

    if (
      fit &&
      state.geometries.length === 1
    ) {
      focusGeometry(
        state.geometries[0].geometry,
      );
    }
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
      `/api/admin/geometry-editor/cities/${encodeURIComponent(cityId)}/geometries`,
    );

    state.city = payload.city;
    state.workspaceKey =
      'city:' + String(payload.city.id);
    state.serverGeometries = payload.geometries ?? [];
    renderImportConflicts();
    const currentIds = new Set(
      state.serverGeometries.map((item) => item.id),
    );
    state.selectedSet = new Set(
      [...state.selectedSet].filter((id) => currentIds.has(id)),
    );
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


  function loadWorkspace(
    value,
    {
      keepSelection = false,
      fit = true,
    } = {},
  ) {
    return value ===
      '__unlinked__'
      ? loadUnlinked({
          keepSelection,
          fit,
        })
      : loadCity(
          Number(value),
          {
            keepSelection,
            fit,
          },
        );
  }


  async function loadEditLeases() {
    const payload = await api(
      '/api/admin/geometry-editor/edit-locks',
    );
    state.editLeases =
      new Map(
        (payload.leases ?? [])
          .map(
            (lease) => [
              Number(lease.geometryId),
              lease,
            ],
          ),
      );
    renderFormState();
    renderList();
    updateMapSources();
  }

  async function refresh({ keepSelection = true, fit = false } = {}) {
    try {
      await ensureMap();

      const selectedWorkspace =
        citySelect.value ||
        (
          state.workspaceKey === 'unlinked'
            ? '__unlinked__'
            : state.city?.id
              ? String(state.city.id)
              : ''
        );

      const [
        workspace,
      ] =
        await Promise.all([
          loadCities({
            preferredValue:
              selectedWorkspace,
          }),
          loadPendingImport(),
          loadEditLeases(),
        ]);

      await loadWorkspace(
        workspace,
        {
          keepSelection,
          fit,
        },
      );

      if (
        state.importSession &&
        state.activeConflictId
      ) {
        showImportConflict(
          state.activeConflictId,
          {
            fit,
            capture: false,
          },
        );
      }

      window.setTimeout(
        () => state.map?.resize(),
        0,
      );
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

  async function finishTopologyMutation(
    target,
    geometries,
    successMessage,
  ) {
    const editDraft =
      draftFor(
        target.id,
      );

    if (editDraft?.editToken) {
      await Promise.allSettled([
        releaseDraftLease({
          ...editDraft,
          id:
            target.id,
        }),
      ]);
    }

    drafts.remove(
      target.id,
    );
    state.editing = false;
    state.editLease = null;
    state.blockedLease = null;
    state.selectedSet.clear();

    for (
      const geometry of
      geometries
    ) {
      upsertGeometrySummary(
        geometry,
      );
    }

    const primary =
      geometries.find(
        (geometry) =>
          geometry.id ===
          target.id,
      ) ??
      geometries[0];

    if (primary) {
      adoptGeometryDetail(
        primary,
      );
    }

    refreshDraftControls();
    setMessage(
      successMessage,
      'success',
    );
  }

  async function topologyFailure(
    error,
  ) {
    if (
      error.status === 409
    ) {
      for (
        const conflict of
        error.payload
          ?.details
          ?.conflicts ??
        []
      ) {
        if (
          draftFor(
            conflict.id,
          )
        ) {
          drafts.markConflict(
            conflict.id,
            true,
          );
        }
      }

      await refresh({
        keepSelection: true,
        fit: false,
      });
    }

    setMessage(
      error.message,
      'error',
    );
  }

  async function cutTarget(
    target,
    body,
  ) {
    try {
      setMessage(
        'Вырезаем область…',
      );

      const payload =
        await api(
          `/api/admin/geometry-editor/geometries/${encodeURIComponent(target.id)}/cut`,
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
              'X-DTPStat-Base-Revision':
                target.updatedAt,
              'X-DTPStat-Edit-Token':
                draftFor(
                  target.id,
                )?.editToken ??
                '',
            },
            body:
              JSON.stringify(
                body,
              ),
          },
        );

      await finishTopologyMutation(
        target,
        [
          payload.geometry,
        ],
        'Область вырезана. Для обновления основной карты и статистики нажмите «Пересчитать».',
      );
    } catch (error) {
      await topologyFailure(
        error,
      );
    }
  }

  async function splitTarget(
    target,
    blade,
  ) {
    try {
      setMessage(
        'Разделяем геометрию…',
      );

      const payload =
        await api(
          `/api/admin/geometry-editor/geometries/${encodeURIComponent(target.id)}/split`,
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
              'X-DTPStat-Base-Revision':
                target.updatedAt,
              'X-DTPStat-Edit-Token':
                draftFor(
                  target.id,
                )?.editToken ??
                '',
            },
            body:
              JSON.stringify({
                blade,
              }),
          },
        );

      await finishTopologyMutation(
        target,
        payload.geometries,
        'Геометрия разделена на две части. Для обновления основной карты и статистики нажмите «Пересчитать».',
      );
    } catch (error) {
      await topologyFailure(
        error,
      );
    }
  }

  async function cutWithSelectedGeometry() {
    const target =
      state.current;
    const cutter =
      selectedCutterGeometry();

    if (
      !topologyTargetReady([
        'polygon',
      ]) ||
      !cutter
    ) {
      renderTopologyState();
      setMessage(
        'Для вырезания выберите текущий редактируемый polygon и отметьте ровно один сохранённый polygon-cutter.',
        'error',
      );
      return;
    }

    const confirmed =
      await adminConfirm({
        title:
          'Вырезать выбранным полигоном?',
        message:
          displayName(
            cutter,
          ) +
          ' будет использован только как cutter и останется без изменений.',
        confirmLabel:
          'Вырезать',
        cancelLabel:
          'Отмена',
        destructive:
          true,
      });

    if (!confirmed) {
      return;
    }

    await cutTarget(
      target,
      {
        cutterGeometryId:
          cutter.id,
        cutterUpdatedAt:
          cutter.updatedAt,
      },
    );
  }

  async function startDrawing(mode) {
    setMoveGeometryMode(false);
    closeCoordinateWindow();

    if (state.importSession) {
      setMessage(
        'Сначала разрешите конфликты подготовленного импорта.',
        'error',
      );
      return;
    }
    if (
      mode === 'cut' ||
      mode === 'split'
    ) {
      const families =
        mode === 'cut'
          ? ['polygon']
          : [
            'line',
            'polygon',
          ];

      if (
        !topologyTargetReady(
          families,
        )
      ) {
        setMessage(
          mode === 'cut'
            ? 'Для вырезания сначала начните редактирование сохранённого полигона и синхронизируйте локальные изменения.'
            : 'Для разделения сначала начните редактирование сохранённой линии или полигона и синхронизируйте локальные изменения.',
          'error',
        );
        return;
      }

      const local =
        captureCurrentDraft();

      if (
        Object.keys(
          local?.changes ?? {},
        ).length > 0
      ) {
        setMessage(
          'Перед topology-операцией синхронизируйте или отмените локальные изменения.',
          'error',
        );
        return;
      }

      state.drawing = {
        mode,
        coordinates: [],
        previewCoordinate: null,
      };
      state.history = [];
      state.future = [];
      state.selectedVertexPath = null;
      updateMapSources();
      updateDrawControls();
      renderFormState();
      setMessage(
        mode === 'cut'
          ? 'Нарисуйте область, которую нужно вырезать: минимум три точки.'
          : 'Нарисуйте режущую линию через геометрию: минимум две точки.',
      );
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

    state.drawing = {
      mode,
      coordinates: [],
      previewCoordinate: null,
    };
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
      'Новая геометрия будет храниться в localStorage до массовой синхронизации.',
    );
  }


  function updateDrawControls() {
    const drawing = state.drawing;
    const active = Boolean(drawing);
    finishDrawButton.hidden = !active || drawing?.mode === 'point';
    cancelDrawButton.hidden = !active;

    let canFinish = false;
    if (
      drawing?.mode === 'line' ||
      drawing?.mode === 'split'
    ) {
      canFinish = drawing.coordinates.length >= 2;
    }
    if (
      drawing?.mode === 'polygon' ||
      drawing?.mode === 'cut'
    ) {
      canFinish = drawing.coordinates.length >= 3;
    }
    finishDrawButton.disabled = !canFinish;

    modeLabel.classList.toggle(
      'is-drawing',
      active,
    );
    if (drawing?.mode === 'cut') {
      modeLabel.textContent =
        'Вырезание области · точек: ' +
        drawing.coordinates.length +
        ' · замкнётся автоматически';
    } else if (drawing?.mode === 'split') {
      modeLabel.textContent =
        'Разделение режущей линией · точек: ' +
        drawing.coordinates.length;
    } else if (drawing?.mode === 'point') {
      modeLabel.textContent =
        'Добавление точки · кликните по карте';
    } else if (drawing?.mode === 'line') {
      modeLabel.textContent =
        'Добавление линии · точек: ' +
        drawing.coordinates.length +
        ' · клик — следующая точка';
    } else if (drawing?.mode === 'polygon') {
      modeLabel.textContent =
        'Добавление полигона · точек: ' +
        drawing.coordinates.length +
        ' · замкнётся автоматически';
    } else {
      modeLabel.textContent =
        editingModeText(state.current);
    }
    refreshMapCursor();
    renderHistoryControls();
    renderMergeState();
  }


  function cancelDrawing() {
    const wasTopology =
      [
        'cut',
        'split',
      ].includes(
        state.drawing?.mode,
      );
    state.drawing = null;
    if (
      !wasTopology &&
      !state.selectedId
    ) {
      clearSelection();
    }
    updateMapSources();
    updateDrawControls();
    renderFormState();
    flushPendingExternalDraftSync();
  }


  async function finishDrawing() {
    const drawing = state.drawing;
    if (!drawing) return;

    if (
      [
        'cut',
        'split',
      ].includes(
        drawing.mode,
      ) &&
      state.pendingExternalDraftSync
    ) {
      state.drawing = null;
      updateMapSources();
      updateDrawControls();
      renderFormState();
      flushPendingExternalDraftSync();
      setMessage(
        'Topology-операция отменена: общий черновик этой геометрии изменился в другой вкладке.',
        'error',
      );
      return;
    }

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
    } else if (
      drawing.mode === 'line' ||
      drawing.mode === 'split'
    ) {
      if (drawing.coordinates.length < 2) return;
      const line = {
        type: 'LineString',
        coordinates:
          clone(
            drawing.coordinates,
          ),
      };

      if (
        drawing.mode === 'split'
      ) {
        const target =
          state.current;
        state.drawing = null;
        updateMapSources();
        updateDrawControls();
        renderFormState();

        if (
          !target?.id ||
          !target.updatedAt
        ) {
          setMessage(
            'Не удалось определить серверную ревизию геометрии. Обновите список.',
            'error',
          );
          return;
        }

        await splitTarget(
          target,
          line,
        );
        return;
      }

      state.draft = line;
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
      const polygon = {
        type: 'Polygon',
        coordinates: [ring],
      };

      if (drawing.mode === 'cut') {
        const target =
          state.current;
        state.drawing = null;
        updateMapSources();
        updateDrawControls();
        renderFormState();

        if (
          !target?.id ||
          !target.updatedAt
        ) {
          setMessage(
            'Не удалось определить серверную ревизию полигона. Обновите список.',
            'error',
          );
          return;
        }

        await cutTarget(
          target,
          {
            geometry:
              polygon,
          },
        );
        return;
      }

      state.draft = polygon;
      state.current = {
        ...draftItemFor('Polygon'),
        geometry: state.draft,
      };
    }

    const localId =
      'local:' +
      crypto.randomUUID();
    state.current = {
      ...state.current,
      id: localId,
      localId,
      _local: true,
    };
    state.selectedId = localId;
    state.editing = true;
    state.editLease = null;
    state.blockedLease = null;
    state.drawing = null;
    state.history = [];
    state.future = [];
    applyForm(state.current);
    captureCurrentDraft();
    updateDraftMap();
    updateDrawControls();
    flushPendingExternalDraftSync();
    setMessage(
      'Новая геометрия сохранена локально. Для записи в БД используйте «Синхронизировать».',
      'success',
    );
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
    if (
      state.importSession ||
      !state.draft ||
      !state.editing ||
      state.drawing ||
      !form.reportValidity()
    ) {
      return;
    }

    const local = captureCurrentDraft();
    if (!local) {
      setMessage('Нет локального состояния для сохранения.');
      return;
    }

    if (!isLocalGeometryId(state.current?.id)) {
      state.editing = false;
      state.history = [];
      state.future = [];
      state.selectedVertexPath = null;
      rebuildDraftOverlay();
      updateMapSources();
      renderHistoryControls();
      renderFormState();
    }

    setMessage(
      isLocalGeometryId(state.current?.id)
        ? 'Изменения сохранены в localStorage. Для записи в БД используйте «Синхронизировать».'
        : 'Изменения сохранены в localStorage. Активное редактирование завершено, блокировка остаётся за вами.',
      'success',
    );
  }

  async function releaseDraftLease(entry) {
    if (
      !entry?.editToken ||
      entry.kind === 'create' ||
      !Number.isSafeInteger(Number(entry.id))
    ) {
      return;
    }

    await api(
      '/api/admin/geometry-editor/geometries/' +
        encodeURIComponent(entry.id) +
        '/edit-lock/release',
      {
        method: 'POST',
        headers: {
          'X-DTPStat-Edit-Token':
            entry.editToken,
        },
      },
    );
  }

  async function saveDraftEntries(entries) {
    const items =
      entries.flatMap((entry) => {
        if (entry.kind === 'create') {
          return [{
            kind: 'create',
            localId:
              entry.localId ??
              entry.id,
            value:
              entry.value,
          }];
        }

        if (
          !entry.editToken ||
          Object.keys(entry.changes ?? {}).length === 0
        ) {
          return [];
        }

        return [{
          kind: 'update',
          id: Number(entry.id),
          baseUpdatedAt:
            entry.baseUpdatedAt,
          editToken:
            entry.editToken,
          changes:
            entry.changes,
        }];
      });

    const payload = await api(
      '/api/admin/geometry-editor/sync',
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
        },
        body:
          JSON.stringify({ items }),
      },
    );

    const updatedIds =
      new Set(
        (payload.updated ?? [])
          .map(
            (geometry) =>
              String(geometry.id),
          ),
      );
    const createdIds =
      new Set(
        (payload.created ?? [])
          .map(
            (item) =>
              String(item.localId),
          ),
      );

    const release =
      entries.filter(
        (entry) =>
          updatedIds.has(
            String(entry.id),
          ),
      );

    for (const entry of entries) {
      if (
        updatedIds.has(String(entry.id)) ||
        createdIds.has(String(entry.id))
      ) {
        drafts.remove(entry.id);
      }
    }

    await Promise.allSettled(
      release.map(
        releaseDraftLease,
      ),
    );

    for (const entry of entries) {
      if (
        updatedIds.has(String(entry.id)) ||
        createdIds.has(String(entry.id))
      ) {
        state.validatedEditTokens.delete(
          String(entry.id),
        );
      }
    }

    state.editing = false;
    state.editLease = null;
    state.blockedLease = null;
    await refresh({
      keepSelection: false,
      fit: false,
    });
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


  revertButton.addEventListener('click', async () => {
    const item = state.current;
    if (!item?.id) return;

    if (isLocalGeometryId(item.id)) {
      drafts.remove(item.id);
      rebuildDraftOverlay();
      refreshDraftControls();
      clearSelection();
      setMessage('Новая локальная геометрия удалена.');
      return;
    }

    const local = draftFor(item.id);
    if (local?.editToken) {
      await Promise.allSettled([
        releaseDraftLease({
          ...local,
          id: item.id,
        }),
      ]);
    }

    drafts.remove(item.id);
    state.validatedEditTokens.delete(
      String(item.id),
    );
    state.editing = false;
    state.editLease = null;
    state.blockedLease = null;
    rebuildDraftOverlay();
    refreshDraftControls();
    adoptGeometryDetail(item);
    setMessage(
      'Локальные изменения отменены. Показана версия из БД.',
    );
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
    if (!local?.editToken) {
      setMessage(
        'Для удаления сначала начните редактирование геометрии.',
        'error',
      );
      return;
    }

    try {
      await api('/api/admin/geometry-editor/geometries/' + item.id, {
        method: 'DELETE',
        headers: {
          'X-DTPStat-Base-Revision': local.baseUpdatedAt ?? item.updatedAt,
          'X-DTPStat-Edit-Token':
            local.editToken,
        },
      });
      drafts.remove(item.id);
      state.validatedEditTokens.delete(
        String(item.id),
      );
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


  mergeButton.addEventListener('click', async () => {
    captureCurrentDraft();

    const items =
      selectedMergeItems();
    const problem =
      mergeProblem(items);

    if (problem) {
      renderMergeState();
      setMessage(
        problem,
        'error',
      );
      return;
    }

    const target =
      items[0];

    const confirmed =
      await adminConfirm({
        title:
          'Объединить геометрии?',
        message:
          'Будет объединено геометрий: ' +
          items.length +
          '. Основной записью останется #' +
          target.id +
          '; остальные записи будут удалены.',
        confirmLabel:
          'Объединить',
        cancelLabel:
          'Отмена',
        destructive:
          true,
      });

    if (!confirmed) {
      return;
    }

    try {
      mergeButton.disabled =
        true;
      setMessage(
        'Объединяем геометрии…',
      );

      const payload =
        await api(
          '/api/admin/geometry-editor/merge',
          {
            method:
              'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body:
              JSON.stringify({
                items:
                  items.map(
                    (item) => ({
                      id:
                        item.id,
                      baseUpdatedAt:
                        item.updatedAt,
                    }),
                  ),
              }),
          },
        );

      for (const item of items) {
        drafts.remove(
          item.id,
        );
      }

      const mergedIds =
        new Set(
          payload
            .sourceGeometryIds ??
          items.map(
            (item) =>
              item.id,
          ),
        );

      state.serverGeometries =
        state.serverGeometries
          .filter(
            (item) =>
              !mergedIds.has(
                item.id,
              ),
          );

      state.selectedSet.clear();
      upsertGeometrySummary(
        payload.geometry,
      );
      adoptGeometryDetail(
        payload.geometry,
      );
      refreshDraftControls();

      setMessage(
        'Геометрии объединены. Для обновления основной карты и статистики нажмите «Пересчитать».',
        'success',
      );
    } catch (error) {
      if (error.status === 409) {
        for (
          const conflict of
          error
            .payload
            ?.details
            ?.conflicts ??
          []
        ) {
          const local =
            draftFor(
              conflict.id,
            );
          if (local) {
            drafts.markConflict(
              conflict.id,
              true,
            );
          }
        }

        await refresh({
          keepSelection: false,
          fit: false,
        });
      }

      setMessage(
        error.message,
        'error',
      );
    } finally {
      renderMergeState();
      refreshDraftControls();
    }
  });


  async function recalculateDerived() {
    if (state.importSession) {
      setMessage(
        'Сначала разрешите конфликты подготовленного импорта.',
        'error',
      );
      return;
    }

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
    if (state.importSession) {
      setMessage(
        'Сначала разрешите конфликты подготовленного импорта.',
        'error',
      );
      return;
    }

    captureCurrentDraft();
    const entries =
      syncableDraftEntries();
    if (!entries.length) return;

    saveAll.disabled = true;
    setMessage(
      'Синхронизируем локальные изменения: ' +
      entries.length +
      '…',
    );

    try {
      const payload =
        await saveDraftEntries(
          entries,
        );
      setMessage(
        'Синхронизировано геометрий: ' +
          payload.changedCount +
          '. Операция применена атомарно.',
        'success',
      );
    } catch (error) {
      if (error.status === 409) {
        for (
          const conflict of
          error.payload?.details?.conflicts ??
          []
        ) {
          if (conflict.id) {
            drafts.markConflict(
              conflict.id,
              true,
            );
          }
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

    const created =
      entries.filter(
        (entry) =>
          entry.kind === 'create',
      ).length;
    const modified =
      entries.filter(
        (entry) =>
          entry.kind !== 'create' &&
          Object.keys(entry.changes ?? {}).length > 0,
      ).length;

    const confirmed = await adminConfirm({
      title: 'Очистить локальные изменения?',
      message:
        'Будут удалены несинхронизированные данные: новых геометрий — ' +
        created +
        ', изменённых геометрий — ' +
        modified +
        '. Активные блокировки редактирования будут освобождены.',
      confirmLabel: 'Очистить localStorage',
      cancelLabel: 'Отмена',
      destructive: true,
    });
    if (!confirmed) return;

    await Promise.allSettled(
      entries.map(
        releaseDraftLease,
      ),
    );
    drafts.clear();
    state.validatedEditTokens.clear();
    state.editing = false;
    state.editLease = null;
    state.blockedLease = null;
    refreshDraftControls();
    await refresh({
      keepSelection: false,
      fit: false,
    });
    setMessage('Локальный workspace очищен.');
  });

  async function validateWorkspaceEditTokens({
    announce = false,
  } = {}) {
    const entries =
      drafts.list()
        .filter(
          (entry) =>
            entry.kind !== 'create' &&
            entry.editToken &&
            Number.isSafeInteger(
              Number(entry.id),
            ),
        );

    if (!entries.length) {
      return {
        results: [],
      };
    }

    const payload = await api(
      '/api/admin/geometry-editor/edit-locks/validate',
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
        },
        body:
          JSON.stringify({
            items:
              entries.map(
                (entry) => ({
                  id:
                    Number(entry.id),
                  token:
                    entry.editToken,
                }),
              ),
          }),
      },
    );

    const invalid = [];
    for (
      const result of
      payload.results ?? []
    ) {
      if (result.status === 'valid') {
        const token =
          result.lease?.token ??
          draftFor(result.id)?.editToken ??
          null;
        if (token) {
          state.validatedEditTokens.set(
            String(result.id),
            token,
          );
        }
        state.editLeases.set(
          Number(result.id),
          {
            ...result.lease,
            token: undefined,
          },
        );
        continue;
      }

      invalid.push(result);
      drafts.remove(result.id);
      state.validatedEditTokens.delete(
        String(result.id),
      );
      state.editLeases.delete(
        Number(result.id),
      );
    }

    if (
      invalid.some(
        (result) =>
          String(result.id) ===
          String(state.selectedId),
      )
    ) {
      state.editing = false;
      state.editLease = null;
      state.blockedLease = null;
      state.history = [];
      state.future = [];
      state.selectedVertexPath = null;
      await refresh({
        keepSelection: true,
        fit: false,
      });
    } else {
      rebuildDraftOverlay();
      refreshDraftControls();
      renderList();
      updateMapSources();
      renderFormState();
    }

    if (
      announce &&
      invalid.length > 0
    ) {
      setMessage(
        'Недействительных токенов: ' +
        invalid.length +
        '. Эти локальные изменения сброшены до состояния БД.',
        'error',
      );
    }

    return payload;
  }

  drafts.subscribe((change) => {
    if (
      change.source !==
      'external-storage'
    ) {
      return;
    }

    if (
      change.incompatible
    ) {
      blockForDraftStorage(
        drafts.compatibility(),
      );
      return;
    }

    handleExternalDraftChange(
      change,
    );
  });

  subscribeAdminRealtime((realtimeMessage) => {
    if (
      realtimeMessage?.type !==
      'data-change'
    ) {
      return;
    }

    const change =
      realtimeMessage.change;

    if (
      change?.resource ===
      'geometry-edit-leases'
    ) {
      if (
        change.action ===
          'force-takeover' &&
        change.revokedClientId ===
          realtimeClientId()
      ) {
        const revokedIds =
          new Set(
            (change.entityIds ?? [])
              .map(
                (id) =>
                  String(id),
              ),
          );
        const selectedRevoked =
          revokedIds.has(
            String(state.selectedId),
          );

        for (
          const id of
          revokedIds
        ) {
          drafts.remove(id);
          state.validatedEditTokens.delete(
            String(id),
          );
          state.editLeases.delete(
            Number(id),
          );
        }

        if (selectedRevoked) {
          state.editing = false;
          state.editLease = null;
          state.blockedLease = null;
          state.history = [];
          state.future = [];
          state.selectedVertexPath = null;
          void refresh({
            keepSelection: true,
            fit: false,
          }).then(() => {
            setMessage(
              'Суперадминистратор перехватил редактирование. Ваш локальный черновик этой геометрии отменён.',
              'error',
            );
          });
        } else {
          rebuildDraftOverlay();
          refreshDraftControls();
          renderList();
          updateMapSources();
          renderFormState();
          void loadEditLeases()
            .catch(
              (error) =>
                console.warn(
                  'Geometry edit lease refresh failed after takeover',
                  error,
                ),
            );
          setMessage(
            'Суперадминистратор перехватил одну из ваших геометрий. Её локальный черновик отменён.',
            'error',
          );
        }
        return;
      }

      void loadEditLeases()
        .catch(
          (error) =>
            setMessage(
              error.message,
              'error',
            ),
        );
      return;
    }

    if (
      change?.resource !==
        'city-geometries' ||
      change.originClientId ===
        realtimeClientId()
    ) {
      return;
    }

    scheduleGeometryServerSync(
      'realtime',
    );
  });

  beginEditButton.addEventListener(
    'click',
    () =>
      void beginEditing(),
  );
  takeoverEditButton.addEventListener(
    'click',
    () =>
      void takeoverEditing(),
  );

  conflictKeep.addEventListener(
    'click',
    () =>
      setConflictDecision(
        'keep-existing',
      ),
  );
  conflictAdd.addEventListener(
    'click',
    () =>
      setConflictDecision(
        'add-new',
      ),
  );
  conflictReplace.addEventListener(
    'click',
    () =>
      setConflictDecision(
        'replace',
      ),
  );
  importApply.addEventListener(
    'click',
    () =>
      void applyImportDecisions(),
  );
  importDiscard.addEventListener(
    'click',
    () =>
      void discardPendingImport(),
  );

  cutButton.addEventListener('click', () => {
    void startDrawing('cut');
  });
  cutSelectedButton.addEventListener(
    'click',
    () =>
      void cutWithSelectedGeometry(),
  );
  splitButton.addEventListener(
    'click',
    () =>
      void startDrawing('split'),
  );


  moveGeometryButton.addEventListener(
    'click',
    () =>
      setMoveGeometryMode(
        !state.moveGeometryMode,
      ),
  );
  coordinateOpenButton.addEventListener(
    'click',
    openCoordinateWindow,
  );
  coordinateCloseButton.addEventListener(
    'click',
    closeCoordinateWindow,
  );
  coordinateSequence.addEventListener(
    'change',
    renderCoordinateSequence,
  );
  coordinateAddRow.addEventListener(
    'click',
    () => {
      const rows = [
        ...coordinateTableBody
          .querySelectorAll('tr'),
      ];
      const last =
        rows.at(-1);
      const fallback = last
        ? [
            last.querySelector(
              '[data-coordinate="longitude"]',
            )?.value ?? '',
            last.querySelector(
              '[data-coordinate="latitude"]',
            )?.value ?? '',
          ]
        : ['', ''];

      coordinateTableBody.append(
        coordinateRow(
          fallback,
          rows.length,
        ),
      );
      renumberCoordinateRows();
    },
  );
  coordinateImport.addEventListener(
    'click',
    () => {
      try {
        const parsed =
          parseCoordinateText(
            coordinatePaste.value,
          );
        renderCoordinateRows(
          parsed,
        );
        setCoordinateMessage(
          'Точки загружены в таблицу. Нажмите «Применить к черновику».',
          'success',
        );
      } catch (error) {
        setCoordinateMessage(
          error.message,
          'error',
        );
      }
    },
  );
  coordinateApply.addEventListener(
    'click',
    applyCoordinateTable,
  );

  undoButton.addEventListener('click', undo);
  redoButton.addEventListener('click', redo);
  finishDrawButton.addEventListener('click', () => void finishDrawing());
  cancelDrawButton.addEventListener('click', cancelDrawing);
  newPointButton.addEventListener('click', () => void startDrawing('point'));
  newLineButton.addEventListener('click', () => void startDrawing('line'));
  newPolygonButton.addEventListener('click', () => void startDrawing('polygon'));

  citySelect.addEventListener('change', () => {
    state.selectedSet.clear();
    void loadWorkspace(
      citySelect.value,
      {
        keepSelection: false,
        fit: true,
      },
    ).catch(
      (error) =>
        setMessage(
          error.message,
          'error',
        ),
    );
  });

  cityWithGeometries
    ?.addEventListener(
      'change',
      () => {
        const previous =
          citySelect.value;
        const workspace =
          renderCityOptions(
            previous,
          );

        if (
          workspace ===
          previous
        ) {
          return;
        }

        state.selectedSet.clear();
        void loadWorkspace(
          workspace,
          {
            keepSelection: false,
            fit: true,
          },
        ).catch(
          (error) =>
            setMessage(
              error.message,
              'error',
            ),
        );
      },
    );

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
        refreshMapCursor();
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
    if (
      !editingText &&
      event.key === 'Escape' &&
      state.coordinateWindowOpen
    ) {
      closeCoordinateWindow();
      return;
    }
    if (
      !editingText &&
      event.key === 'Escape' &&
      state.moveGeometryMode
    ) {
      setMoveGeometryMode(false);
      return;
    }
    if (!editingText && event.key === 'Escape' && state.drawing) cancelDrawing();
  });

  window.addEventListener('keyup', (event) => {
    if (event.key !== 'Control' && event.key !== 'Meta') return;
    state.deleteModifier = false;
    if (!section.hidden && state.map) {
      refreshMapCursor();
    }
  });

  window.addEventListener('blur', () => {
    state.deleteModifier = false;
    if (
      !section.hidden &&
      state.map &&
      !state.dragPath &&
      !state.geometryDrag
    ) {
      refreshMapCursor();
    }
  });

  refreshDraftControls();
  void validateWorkspaceEditTokens({
    announce: true,
  })
    .catch(
      (error) =>
        setMessage(
          error.message,
          'error',
        ),
    )
    .finally(
      () =>
        void refresh({
          keepSelection: false,
          fit: true,
        }),
    );

  window.setInterval(
    () => {
      void validateWorkspaceEditTokens()
        .catch(
          (error) =>
            console.warn(
              'Geometry edit token heartbeat failed',
              error,
            ),
        );
      void loadEditLeases()
        .catch(
          (error) =>
            console.warn(
              'Geometry edit lease refresh failed',
              error,
            ),
        );
    },
    30_000,
  );
}
