import { adminAvatarObjectUrl } from './admin-avatar.js';
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
  normalizeCoordinateInput,
  parseCoordinateText,
  replaceCoordinateSequence,
  translateGeometry,
} from './geometry-coordinate-model.js';
import { publishDerivedDataChange } from './derived-data-events.js';
import {
  createMentionAutocomplete,
  renderMentionText,
} from './discussion-mentions.js';
import {
  pointTypeIconOffset,
  pointTypeImageId,
  syncPointTypeImages,
} from '../js/point-type-map-icons.js';
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
  const citySearch = document.querySelector('#geometry-editor-city-search');
  const cityOptionsHost = document.querySelector('#geometry-editor-city-options');
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
  const editingNotice = document.querySelector('#geometry-editing-notice');
  const discussionOpenButton = document.querySelector('#geometry-discussion-open');
  const discussionUnread = document.querySelector('#geometry-discussion-unread');
  const discussionPanel = document.querySelector('#geometry-discussion');
  const discussionResizeGrip = document.querySelector('#geometry-discussion-resize-grip');
  const discussionCloseButton = document.querySelector('#geometry-discussion-close');
  const discussionTitle = document.querySelector('#geometry-discussion-title');
  const discussionSubtitle = document.querySelector('#geometry-discussion-subtitle');
  const discussionMessages = document.querySelector('#geometry-discussion-messages');
  const discussionForm = document.querySelector('#geometry-discussion-form');
  const discussionInput = document.querySelector('#geometry-discussion-input');
  const saveAll = document.querySelector('#geometry-editor-save-all');
  const discardAll = document.querySelector('#geometry-editor-discard-all');
  const form = document.querySelector('#geometry-editor-form');
  const detailsPanel =
    form?.closest(
      '.geometry-editor-details',
    ) ??
    null;
  const title = document.querySelector('#geometry-editor-selected-title');
  const lineFields = document.querySelector('#geometry-line-fields');
  const pointFields = document.querySelector('#geometry-point-fields');
  const topologyActions = document.querySelector('#geometry-topology-actions');
  const message = document.querySelector('#geometry-editor-message');
  const conflictMessage = document.querySelector('#geometry-editor-conflict');
  const meta = document.querySelector('#geometry-editor-meta');
  const sourceTags = document.querySelector('#geometry-source-tags');
  const mergeButton = document.querySelector('#geometry-merge-selected');
  const mergeStartButton = document.querySelector('#geometry-merge-start');
  const mergeMode = document.querySelector('#geometry-merge-mode');
  const mergeStatus = document.querySelector('#geometry-merge-status');
  const mergeClearButton = document.querySelector('#geometry-merge-clear');
  const mergeCancelButton = document.querySelector('#geometry-merge-cancel');
  const deleteButton = document.querySelector('#geometry-delete');
  const revertButton = document.querySelector('#geometry-revert');
  const cutButton = document.querySelector('#geometry-cut-area');
  const cutDirectButton = document.querySelector('#geometry-cut-direct');
  const cutSelectedButton = document.querySelector('#geometry-cut-selected');
  const splitButton = document.querySelector('#geometry-split');
  const undoButton = document.querySelector('#geometry-undo');
  const redoButton = document.querySelector('#geometry-redo');
  const finishDrawButton = document.querySelector('#geometry-finish-draw');
  const cancelDrawButton = document.querySelector('#geometry-cancel-draw');
  const coordinateOpenButton = document.querySelector('#geometry-coordinate-open');
  const coordinateWindow = document.querySelector('#geometry-coordinate-window');
  const coordinateCloseButton = document.querySelector('#geometry-coordinate-close');
  const coordinateSequence = document.querySelector('#geometry-coordinate-sequence');
  const coordinateTableBody = document.querySelector('#geometry-coordinate-table-body');
  const coordinateAddRow = document.querySelector('#geometry-coordinate-add-row');
  const coordinateClear = document.querySelector('#geometry-coordinate-clear');
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
    pointTypes: [],
    pointTypesLoaded: false,
    pointTypesPromise: null,
    pointImageIds: new Set(),
    city: null,
    serverGeometries: [],
    geometries: [],
    selectedId: null,
    selectedSet: new Set(),
    bulkSelecting: false,
    current: null,
    draft: null,
    history: [],
    future: [],
    drawing: null,
    map: null,
    mapReady: null,
    dragPath: null,
    geometryDrag: null,
    coordinateWindowOpen: false,
    hoveredVertex: false,
    hoveredSegment: false,
    hoveredMidpoint: false,
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
    discussionGeometryId: null,
    discussionMessages: [],
    discussionLoading: false,
    discussionSending: false,
    discussionRequestSequence: 0,
    workspaceRequestSequence: 0,
    discussionUnreadRefreshTimer: null,
    pendingTargetNavigation: false,
    discussionUnreadByGeometry: new Map(),
    discussionMessageCountByGeometry:
      new Map(),
    discussionAttentionMessageId: null,
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
    const pointType = state.pointTypes.find(
      (candidate) =>
        candidate.id === result.pointTypeId,
    );
    if (pointType) {
      result.pointTypeName = pointType.name;
      result.pointTypeActive =
        pointType.isActive !== false;
      result.pointIconName =
        pointTypeImageId(
          pointType,
          'geometry-point-type',
        );
      result.pointIconOffset =
        pointTypeIconOffset(
          pointType,
        );
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
    const pointType = state.pointTypes.find(
      (candidate) =>
        candidate.id === result.pointTypeId,
    );
    if (pointType) {
      result.pointTypeName = pointType.name;
      result.pointTypeActive =
        pointType.isActive !== false;
      result.pointIconName =
        pointTypeImageId(
          pointType,
          'geometry-point-type',
        );
      result.pointIconOffset =
        pointTypeIconOffset(
          pointType,
        );
    }
    return result;
  }

  function rebuildDraftOverlay() {
    const server =
      state.serverGeometries
        .filter(
          (item) =>
            draftFor(
              item.id,
            )?.kind !==
              'delete',
        )
        .map(
          effectiveSummary,
        );
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
      if (entry.kind === 'delete') {
        return Boolean(
          entry.editToken,
        );
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
        draft.kind === 'update' &&
        Object.keys(draft.changes ?? {}).length > 0,
    ).length;
    const deleted = entries.filter(
      (draft) =>
        draft.kind === 'delete',
    ).length;

    if (draftCount) {
      draftCount.textContent =
        'Локально: ' + entries.length +
        (created ? ' · новых: ' + created : '') +
        (edited ? ' · изменено: ' + edited : '') +
        (deleted ? ' · удалено: ' + deleted : '') +
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

    const draftTokenIsValid =
      Boolean(
        currentDraft?.editToken &&
        state.validatedEditTokens.get(
          String(state.selectedId),
        ) === currentDraft.editToken,
      );
    state.editing =
      Boolean(
        state.editing &&
        draftTokenIsValid,
      );
    state.draft = clone(effective.geometry);
    state.history = [];
    state.future = [];
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
        state.geometryDrag ||
        state.coordinateWindowOpen ||
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

  async function loadMentionUsers(
    subjectType,
    query,
  ) {
    const params =
      new URLSearchParams({
        subjectType,
        q: query,
      });
    const payload =
      await api(
        '/api/admin/profile/discussions/mentions?' +
        params.toString(),
      );
    return payload.users ?? [];
  }

  function clone(value) {
    return value === null || value === undefined ? value : structuredClone(value);
  }

  function setMessage(text, tone = '') {
    message.textContent = text ?? '';
    message.className = `notice${tone ? ` notice-${tone}` : ''}`;
  }

  function identityName(identity) {
    return (
      identity?.displayName?.trim?.() ||
      identity?.username?.trim?.() ||
      'Пользователь'
    );
  }

  function identityInitials(identity) {
    const name =
      identityName(identity);
    const parts =
      name
        .split(/\s+/u)
        .filter(Boolean)
        .slice(0, 2);

    return (
      parts
        .map(
          (part) =>
            part[0]?.toLocaleUpperCase('ru-RU') ??
            '',
        )
        .join('') ||
      '?'
    );
  }

  function identityAvatar(
    identity,
    className,
  ) {
    const avatarUrl =
      identity?.avatarUrl ??
      null;

    if (avatarUrl) {
      const wrapper =
        document.createElement(
          'span',
        );
      wrapper.className =
        className;

      const fallback =
        document.createElement(
          'span',
        );
      fallback.className =
        className ===
          'geometry-edit-actor-avatar'
          ? 'geometry-edit-actor-fallback'
          : 'geometry-discussion-avatar-fallback';
      fallback.textContent =
        identityInitials(
          identity,
        );

      const image =
        document.createElement(
          'img',
        );
      image.className =
        className ===
          'geometry-edit-actor-avatar'
          ? 'geometry-edit-actor-image'
          : 'geometry-discussion-avatar-image';
      image.alt = '';
      image.hidden = true;

      wrapper.append(
        fallback,
        image,
      );

      void adminAvatarObjectUrl(
        avatarUrl,
      )
        .then(
          (objectUrl) => {
            image.src =
              objectUrl;
            image.hidden =
              false;
            fallback.hidden =
              true;
          },
        )
        .catch(
          () => {
            image.hidden =
              true;
            fallback.hidden =
              false;
          },
        );

      return wrapper;
    }

    const fallback =
      document.createElement('span');
    fallback.className =
      className +
      ' ' +
      (
        className ===
          'geometry-edit-actor-avatar'
          ? 'geometry-edit-actor-fallback'
          : 'geometry-discussion-avatar-fallback'
      );
    fallback.textContent =
      identityInitials(
        identity,
      );
    return fallback;
  }

  function renderEditLockIdentity(
    prefix,
    identity,
  ) {
    if (!editLockStatus) return;

    editLockStatus.replaceChildren();

    if (!identity) {
      editLockStatus.textContent =
        prefix ?? '';
      return;
    }

    const actor =
      document.createElement('span');
    actor.className =
      'geometry-edit-actor';

    const label =
      document.createElement('span');
    label.className =
      'geometry-edit-actor-name';
    label.textContent =
      (prefix ? prefix + ' ' : '') +
      identityName(identity);

    actor.append(
      identityAvatar(
        identity,
        'geometry-edit-actor-avatar',
      ),
      label,
    );
    editLockStatus.append(
      actor,
    );
  }

  function discussionUnreadCount(
    geometryId,
  ) {
    return Number(
      state.discussionUnreadByGeometry.get(
        Number(geometryId),
      ) ?? 0,
    );
  }

  function discussionMessageCount(
    geometryId,
  ) {
    return Number(
      state
        .discussionMessageCountByGeometry
        .get(
          Number(
            geometryId,
          ),
        ) ??
      0,
    );
  }

  function setDiscussionMessageCount(
    geometryId,
    count,
  ) {
    const id =
      Number(
        geometryId,
      );
    if (
      !Number.isSafeInteger(
        id,
      ) ||
      id <= 0
    ) {
      return;
    }

    const normalized =
      Math.max(
        0,
        Number(
          count ??
          0,
        ),
      );

    if (normalized > 0) {
      state
        .discussionMessageCountByGeometry
        .set(
          id,
          normalized,
        );
    } else {
      state
        .discussionMessageCountByGeometry
        .delete(
          id,
        );
    }

    renderDiscussionUnreadBadge();
  }

  function setDiscussionUnread(
    geometryId,
    count,
  ) {
    const id =
      Number(geometryId);
    if (
      !Number.isSafeInteger(id) ||
      id <= 0
    ) {
      return;
    }

    if (count > 0) {
      state.discussionUnreadByGeometry.set(
        id,
        count,
      );
    } else {
      state.discussionUnreadByGeometry.delete(
        id,
      );
    }

    renderDiscussionUnreadBadge();
  }

  function incrementDiscussionUnread(
    geometryId,
  ) {
    setDiscussionUnread(
      geometryId,
      discussionUnreadCount(
        geometryId,
      ) + 1,
    );
  }

  function renderDiscussionUnreadBadge() {
    if (
      !discussionOpenButton ||
      !discussionUnread
    ) {
      return;
    }

    const geometryId =
      Number(
        state.current?.id,
      );
    const validGeometry =
      Number.isSafeInteger(
        geometryId,
      ) &&
      geometryId > 0;
    const count =
      validGeometry
        ? discussionUnreadCount(
            geometryId,
          )
        : 0;
    const messageCount =
      validGeometry
        ? discussionMessageCount(
            geometryId,
          )
        : 0;

    discussionUnread.hidden =
      count <= 0;
    discussionUnread.textContent =
      count > 99
        ? '99+'
        : String(count);
    discussionOpenButton.classList.toggle(
      'has-thread',
      messageCount > 0,
    );
    discussionOpenButton.classList.toggle(
      'has-unread',
      count > 0,
    );
    discussionOpenButton.title =
      !validGeometry
        ? 'Выберите геометрию'
        : count > 0
          ? 'Обсуждение · непрочитанных: ' +
            count
          : messageCount > 0
            ? 'Открыть обсуждение · есть сообщения'
            : 'Открыть обсуждение · сообщений ещё нет';
  }

  function markDiscussionRead(
    geometryId,
  ) {
    setDiscussionUnread(
      geometryId,
      0,
    );
  }

  async function loadDiscussionState() {
    const payload =
      await api(
        '/api/admin/geometry-editor/discussions/state',
      );

    const items =
      (payload.items ?? [])
        .filter(
          (item) =>
            Number.isSafeInteger(
              Number(
                item.geometryId,
              ),
            ),
        );

    state.discussionUnreadByGeometry =
      new Map(
        items
          .filter(
            (item) =>
              Number(
                item.unreadCount,
              ) > 0,
          )
          .map(
            (item) => [
              Number(
                item.geometryId,
              ),
              Number(
                item.unreadCount,
              ),
            ],
          ),
      );
    state
      .discussionMessageCountByGeometry =
      new Map(
        items
          .filter(
            (item) =>
              Number(
                item.messageCount,
              ) > 0,
          )
          .map(
            (item) => [
              Number(
                item.geometryId,
              ),
              Number(
                item.messageCount,
              ),
            ],
          ),
      );

    renderDiscussionUnreadBadge();
  }

  async function persistDiscussionRead(
    geometryId,
    messageId = null,
  ) {
    const id =
      Number(geometryId);
    if (
      !Number.isSafeInteger(id) ||
      id <= 0
    ) {
      return null;
    }

    const payload =
      await api(
        '/api/admin/geometry-editor/geometries/' +
          encodeURIComponent(id) +
          '/discussion/read',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body:
            JSON.stringify(
              messageId
                ? {
                  messageId:
                    Number(
                      messageId,
                    ),
                }
                : {},
            ),
        },
      );

    markDiscussionRead(id);
    return payload.read ?? null;
  }

  function markOwnMessagesReadThrough(
    geometryId,
    messageId,
  ) {
    if (
      Number(
        state.discussionGeometryId,
      ) !==
        Number(geometryId)
    ) {
      return;
    }

    let changed = false;
    for (
      const message of
      state.discussionMessages
    ) {
      if (
        Number(
          message.author
            ?.userId,
        ) ===
          Number(
            currentUser?.id,
          ) &&
        Number(message.id) <=
          Number(messageId) &&
        Number(
          message.readByOthersCount ??
          0,
        ) < 1
      ) {
        message.readByOthersCount =
          1;
        changed = true;
      }
    }

    if (changed) {
      renderDiscussion();
    }
  }

  function discussionIsOpenFor(
    geometryId,
  ) {
    return Boolean(
      discussionPanel &&
      !discussionPanel.hidden &&
      Number(
        state.discussionGeometryId,
      ) === Number(
        geometryId,
      ),
    );
  }

  function discussionNearBottom() {
    if (!discussionMessages) {
      return true;
    }
    return (
      discussionMessages.scrollHeight -
      discussionMessages.scrollTop -
      discussionMessages.clientHeight
    ) <= 56;
  }

  function discussionGeometryLabel(
    geometryId,
  ) {
    const candidate =
      (
        String(
          state.current?.id,
        ) ===
        String(geometryId)
          ? state.current
          : null
      ) ??
      state.geometries.find(
        (item) =>
          String(item.id) ===
          String(geometryId),
      );

    return candidate
      ? displayName(candidate)
      : 'Геометрия #' +
        geometryId;
  }

  function discussionTime(
    value,
  ) {
    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.valueOf(),
      )
    ) {
      return '';
    }

    return date.toLocaleString(
      'ru-RU',
      {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      },
    );
  }

  function renderDiscussion() {
    if (
      !discussionPanel ||
      !discussionMessages
    ) {
      return;
    }

    const geometryId =
      state.discussionGeometryId;

    discussionTitle.textContent =
      geometryId
        ? discussionGeometryLabel(
            geometryId,
          )
        : 'Геометрия';

    discussionSubtitle.textContent =
      geometryId
        ? (
            state.discussionLoading
              ? 'Загрузка истории…'
              : 'Сообщения сохраняются для этой геометрии'
          )
        : '';

    if (
      state.discussionLoading
    ) {
      const loading =
        document.createElement('p');
      loading.className =
        'empty-state';
      loading.textContent =
        'Загрузка сообщений…';
      discussionMessages.replaceChildren(
        loading,
      );
      return;
    }

    if (
      state.discussionMessages.length ===
      0
    ) {
      const empty =
        document.createElement('p');
      empty.className =
        'empty-state';
      empty.textContent =
        'Сообщений пока нет.';
      discussionMessages.replaceChildren(
        empty,
      );
      return;
    }

    const elements =
      state.discussionMessages.map(
        (entry) => {
          const article =
            document.createElement('article');
          article.className =
            'geometry-discussion-message';
          article.dataset.messageId =
            String(entry.id);
          if (
            Number(entry.id) ===
            Number(
              state.discussionAttentionMessageId,
            )
          ) {
            article.classList.add(
              'is-incoming',
            );
          }
          if (
            Number(
              entry.author?.userId,
            ) ===
            Number(
              currentUser?.id,
            )
          ) {
            article.classList.add(
              'is-own',
            );
          }

          const body =
            document.createElement('div');
          body.className =
            'geometry-discussion-message-body';

          const meta =
            document.createElement('div');
          meta.className =
            'geometry-discussion-message-meta';

          const author =
            document.createElement('strong');
          author.textContent =
            identityName(
              entry.author,
            );

          const time =
            document.createElement('time');
          time.dateTime =
            entry.createdAt ??
            '';
          time.textContent =
            discussionTime(
              entry.createdAt,
            );

          const text =
            document.createElement('p');
          text.className =
            'geometry-discussion-message-text';
          renderMentionText(
            text,
            entry.message,
          );

          meta.append(
            author,
            time,
          );
          body.append(
            meta,
            text,
          );

          if (
            Number(
              entry.author
                ?.userId,
            ) ===
              Number(
                currentUser?.id,
              )
          ) {
            const receipt =
              document.createElement(
                'small',
              );
            receipt.className =
              'geometry-discussion-receipt';
            const read =
              Number(
                entry.readByOthersCount ??
                0,
              ) > 0;
            receipt.textContent =
              read
                ? '✓✓ Прочитано'
                : '✓ Доставлено';
            receipt.title =
              read
                ? 'Сообщение прочитано другим пользователем'
                : 'Сообщение сохранено сервером';
            body.append(
              receipt,
            );
          }
          article.append(
            identityAvatar(
              entry.author,
              'geometry-discussion-avatar',
            ),
            body,
          );
          return article;
        },
      );

    discussionMessages.replaceChildren(
      ...elements,
    );

  }

  function revealDiscussion({
    attention = false,
    focusInput = false,
    scrollToEnd = true,
  } = {}) {
    if (!discussionPanel) return;

    discussionPanel.hidden =
      false;

    if (attention) {
      discussionPanel.classList.remove(
        'is-attention',
      );
      void discussionPanel.offsetWidth;
      discussionPanel.classList.add(
        'is-attention',
      );
    }

    const previousScrollTop =
      discussionMessages
        ?.scrollTop ??
      0;
    renderDiscussion();

    if (discussionMessages) {
      discussionMessages.scrollTop =
        scrollToEnd
          ? discussionMessages.scrollHeight
          : previousScrollTop;
    }

    if (focusInput) {
      discussionInput?.focus();
    }
  }

  function appendDiscussionMessage(
    entry,
  ) {
    if (!entry?.id) return;

    if (
      state.discussionMessages.some(
        (current) =>
          current.id ===
          entry.id,
      )
    ) {
      return;
    }

    state.discussionMessages.push(
      entry,
    );
    state.discussionMessages.sort(
      (left, right) =>
        Number(left.id) -
        Number(right.id),
    );
  }

  async function loadDiscussion(
    geometryId,
    {
      attention = false,
      focusInput = false,
    } = {},
  ) {
    const id =
      Number(geometryId);

    if (
      !Number.isSafeInteger(id) ||
      id <= 0
    ) {
      return;
    }

    const requestSequence =
      ++state.discussionRequestSequence;
    state.discussionGeometryId =
      id;
    state.discussionMessages =
      [];
    state.discussionLoading =
      true;
    revealDiscussion({
      attention,
    });

    try {
      const payload =
        await api(
          '/api/admin/geometry-editor/geometries/' +
          encodeURIComponent(id) +
          '/discussion',
        );

      if (
        requestSequence !==
          state.discussionRequestSequence
      ) {
        return;
      }

      state.discussionMessages =
        payload.messages ??
        [];
      setDiscussionMessageCount(
        id,
        state.discussionMessages
          .length,
      );
      state.discussionLoading =
        false;
      markDiscussionRead(
        id,
      );
      const lastMessageId =
        state.discussionMessages
          .at(-1)
          ?.id ??
        null;
      if (lastMessageId) {
        void persistDiscussionRead(
          id,
          lastMessageId,
        ).catch(
          (error) =>
            console.warn(
              'Geometry discussion read state update failed',
              error,
            ),
        );
      }
      revealDiscussion({
        attention,
        focusInput,
        scrollToEnd: true,
      });
    } catch (error) {
      if (
        requestSequence !==
          state.discussionRequestSequence
      ) {
        return;
      }
      state.discussionLoading =
        false;
      renderDiscussion();
      setMessage(
        error.message,
        'error',
      );
    }
  }

  async function sendDiscussionMessage() {
    const geometryId =
      state.discussionGeometryId;
    const value =
      discussionInput?.value
        ?.trim();

    if (
      !geometryId ||
      !value ||
      state.discussionSending
    ) {
      return;
    }

    state.discussionSending =
      true;
    const submit =
      discussionForm
        ?.querySelector(
          'button[type="submit"]',
        );
    if (submit) {
      submit.disabled =
        true;
    }

    revealDiscussion();

    try {
      const payload =
        await api(
          '/api/admin/geometry-editor/geometries/' +
          encodeURIComponent(
            geometryId,
          ) +
          '/discussion',
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body:
              JSON.stringify({
                message:
                  value,
              }),
          },
        );

      if (
        Number(
          payload.message
            ?.geometryId,
        ) ===
        Number(
          state.discussionGeometryId,
        )
      ) {
        appendDiscussionMessage(
          payload.message,
        );
        setDiscussionMessageCount(
          geometryId,
          discussionMessageCount(
            geometryId,
          ) + 1,
        );
      }

      if (discussionInput) {
        discussionInput.value =
          '';
        resizeDiscussionInput();
      }

      markDiscussionRead(
        geometryId,
      );
      revealDiscussion({
        attention: true,
        focusInput: true,
        scrollToEnd: true,
      });
    } catch (error) {
      setMessage(
        error.message,
        'error',
      );
      revealDiscussion({
        attention: true,
        focusInput: true,
      });
    } finally {
      state.discussionSending =
        false;
      if (submit) {
        submit.disabled =
          false;
      }
    }
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
      ? `Редактирование: ${displayName(item)} · клик по средней точке — добавить узел · перетащите линию — переместить геометрию · Ctrl+клик по узлу — удалить · двойной клик — закончить`
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
    const pointIconName =
      item.pointIconName &&
      state.map?.hasImage(
        item.pointIconName,
      )
        ? item.pointIconName
        : null;

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
        isEdited:
          Boolean(
            item._local ||
            item._draft ||
            item.wasEdited,
          ),
        lineColor: item.lineTypeColor ?? '#35c6b4',
        lineWidth: item.lineTypeWidth ?? 4,
        pointTypeId:
          item.pointTypeId ?? null,
        pointIconName,
        pointIconOffset:
          item.pointIconOffset ?? [0, 0],
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
      state.drawing
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
          },
        });
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates:
              midpoint(
                coords[index],
                coords[nextIndex],
              ),
          },
          properties: {
            kind: 'midpoint',
            path: pathKey([
              ...sequence.prefix,
              index,
            ]),
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
        properties: {
          mode:
            drawing.mode,
        },
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
    if (state.bulkSelecting) {
      canvas.style.cursor = 'crosshair';
      return;
    }
    if (state.geometryDrag) {
      canvas.style.cursor = 'grabbing';
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
    if (state.hoveredMidpoint) {
      canvas.style.cursor = ADD_VERTEX_CURSOR;
      return;
    }
    if (state.hoveredSegment) {
      canvas.style.cursor = 'grab';
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
            ['get', 'isEdited'],
            '#a9823c',
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
            ['get', 'isEdited'],
            '#d4a342',
            '#91a5ab',
          ],
          'line-width': [
            'case',
            ['get', 'isEdited'],
            3,
            2,
          ],
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
            ['get', 'isEdited'],
            '#d4a342',
            ['coalesce', ['get', 'lineColor'], '#35c6b4'],
          ],
          'line-width': [
            'case',
            ['get', 'isEdited'],
            [
              '+',
              ['coalesce', ['get', 'lineWidth'], 4],
              1,
            ],
            ['coalesce', ['get', 'lineWidth'], 4],
          ],
          'line-opacity': ['case', ['get', 'isVisible'], 0.88, 0.28],
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-points',
        type: 'circle',
        source: MAP_SOURCE,
        filter: [
          'all',
          ['==', ['geometry-type'], 'Point'],
          [
            '==',
            [
              'coalesce',
              ['get', 'pointIconName'],
              '',
            ],
            '',
          ],
        ],
        paint: {
          'circle-radius': 6,
          'circle-color': [
            'case',
            ['get', 'isEditLocked'],
            '#737d82',
            ['get', 'isEdited'],
            '#d4a342',
            '#91a5ab',
          ],
          'circle-stroke-color': '#061311',
          'circle-stroke-width': 1,
          'circle-opacity': ['case', ['get', 'isVisible'], 0.95, 0.3],
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-point-icons',
        type: 'symbol',
        source: MAP_SOURCE,
        filter: [
          'all',
          ['==', ['geometry-type'], 'Point'],
          [
            '!=',
            [
              'coalesce',
              ['get', 'pointIconName'],
              '',
            ],
            '',
          ],
        ],
        layout: {
          'icon-image': ['get', 'pointIconName'],
          'icon-size': 1,
          'icon-offset': ['get', 'pointIconOffset'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-opacity': [
            'case',
            ['get', 'isVisible'],
            1,
            0.35,
          ],
        },
      });

      addLayerSafe(map, {
        id: 'geometry-editor-selected-fill',
        type: 'fill',
        source: SELECTED_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': '#66fff0',
          'fill-opacity': 0.28,
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-selected-polygon-outline',
        type: 'line',
        source: SELECTED_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#07191d',
          'line-width': 9,
          'line-opacity': 0.92,
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-selected-polygon-line',
        type: 'line',
        source: SELECTED_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#66fff0',
          'line-width': 5,
          'line-opacity': 1,
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-selected-line-halo',
        type: 'line',
        source: SELECTED_SOURCE,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#07191d',
          'line-width': [
            '+',
            ['coalesce', ['get', 'lineWidth'], 4],
            10,
          ],
          'line-opacity': 0.92,
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-selected-line-accent',
        type: 'line',
        source: SELECTED_SOURCE,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#66fff0',
          'line-width': [
            '+',
            ['coalesce', ['get', 'lineWidth'], 4],
            5,
          ],
          'line-opacity': 1,
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-selected-line',
        type: 'line',
        source: SELECTED_SOURCE,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'coalesce',
            ['get', 'lineColor'],
            '#35c6b4',
          ],
          'line-width': [
            'coalesce',
            ['get', 'lineWidth'],
            4,
          ],
          'line-opacity': [
            'case',
            ['get', 'isVisible'],
            1,
            0.55,
          ],
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-selected-point-outline',
        type: 'circle',
        source: SELECTED_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 13,
          'circle-color': '#07191d',
          'circle-opacity': 0.92,
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-selected-point',
        type: 'circle',
        source: SELECTED_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 10,
          'circle-color': '#66fff0',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-selected-point-icon',
        type: 'symbol',
        source: SELECTED_SOURCE,
        filter: [
          'all',
          ['==', ['geometry-type'], 'Point'],
          [
            '!=',
            [
              'coalesce',
              ['get', 'pointIconName'],
              '',
            ],
            '',
          ],
        ],
        layout: {
          'icon-image': ['get', 'pointIconName'],
          'icon-size': 1,
          'icon-offset': ['get', 'pointIconOffset'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });

      addLayerSafe(map, {
        id: 'geometry-editor-draw-line',
        type: 'line',
        source: DRAW_SOURCE,
        filter: [
          'all',
          [
            'in',
            ['geometry-type'],
            ['literal', ['LineString', 'Polygon']],
          ],
          [
            '!',
            [
              'in',
              ['get', 'mode'],
              ['literal', ['split', 'cut']],
            ],
          ],
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#f3b74e', 'line-width': 5 },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-split-blade',
        type: 'line',
        source: DRAW_SOURCE,
        filter: [
          'all',
          ['==', ['geometry-type'], 'LineString'],
          ['==', ['get', 'mode'], 'split'],
        ],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#ff5d67',
          'line-width': 3,
          'line-opacity': 0.95,
          'line-dasharray': [1.5, 1],
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-split-point',
        type: 'circle',
        source: DRAW_SOURCE,
        filter: [
          'all',
          ['==', ['geometry-type'], 'Point'],
          ['==', ['get', 'mode'], 'split'],
        ],
        paint: {
          'circle-radius': 5,
          'circle-color': '#ff5d67',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5,
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-cut-blade',
        type: 'line',
        source: DRAW_SOURCE,
        filter: [
          'all',
          [
            'in',
            ['geometry-type'],
            ['literal', ['LineString', 'Polygon']],
          ],
          ['==', ['get', 'mode'], 'cut'],
        ],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#ff5d67',
          'line-width': 3,
          'line-opacity': 0.95,
          'line-dasharray': [1.5, 1],
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-cut-point',
        type: 'circle',
        source: DRAW_SOURCE,
        filter: [
          'all',
          ['==', ['geometry-type'], 'Point'],
          ['==', ['get', 'mode'], 'cut'],
        ],
        paint: {
          'circle-radius': 5,
          'circle-color': '#ff5d67',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5,
        },
      });
      addLayerSafe(map, {
        id: 'geometry-editor-draw-fill',
        type: 'fill',
        source: DRAW_SOURCE,
        filter: [
          'all',
          ['==', ['geometry-type'], 'Polygon'],
          ['!=', ['get', 'mode'], 'cut'],
        ],
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

      const beginGeometryDrag =
        (event) => {
          if (
            !state.editing ||
            !state.draft ||
            state.drawing ||
            state.geometryDrag
          ) {
            return;
          }

          const handleHits =
            map.queryRenderedFeatures(
              event.point,
              {
                layers: [
                  'geometry-editor-vertices',
                  'geometry-editor-midpoints',
                ],
              },
            );
          if (handleHits.length > 0) {
            return;
          }

          if (state.coordinateWindowOpen) {
            closeCoordinateWindow();
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
            screenOrigin:
              event.point
                ? [
                    event.point.x,
                    event.point.y,
                  ]
                : null,
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

      map.on(
        'mousedown',
        'geometry-editor-segment-hit',
        beginGeometryDrag,
      );
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
        const candidate =
          event.features?.[0];
        if (
          !candidate ||
          !state.draft ||
          state.drawing ||
          state.suppressMapClick
        ) {
          return;
        }

        event.originalEvent
          ?.preventDefault?.();
        event.originalEvent
          ?.stopPropagation?.();
        state.suppressMapClick =
          true;

        insertVertexOnSegment(
          JSON.parse(
            candidate
              .properties
              .path,
          ),
          [
            ...candidate
              .geometry
              .coordinates,
          ],
        );

        window.setTimeout(
          () => {
            state.suppressMapClick =
              false;
          },
          0,
        );
      });

      map.on('click', 'geometry-editor-vertices', (event) => {
        const candidate = event.features?.[0];
        if (
          !candidate ||
          !state.draft ||
          state.drawing
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
          state.drawing
        ) return;
        event.preventDefault();
        const originalEvent = event.originalEvent;
        if (originalEvent?.ctrlKey || originalEvent?.metaKey) return;

        const path = JSON.parse(candidate.properties.path);
        state.dragPath = path;
        map.dragPan.disable();
        pushHistory();
      });
      map.on('mousemove', (event) => {
        if (
          state.geometryDrag &&
          state.draft
        ) {
          if (
            !state.geometryDrag
              .moved &&
            state.geometryDrag
              .screenOrigin &&
            event.point
          ) {
            const [
              startX,
              startY,
            ] =
              state.geometryDrag
                .screenOrigin;
            const pixelDistance =
              Math.hypot(
                event.point.x -
                  startX,
                event.point.y -
                  startY,
              );

            if (pixelDistance < 3) {
              return;
            }

            state.geometryDrag
              .moved =
              true;
          }

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
            if (
              !state.geometryDrag
                .moved
            ) {
              state.geometryDrag
                .moved =
                Math.abs(dx) >
                  Number.EPSILON ||
                Math.abs(dy) >
                  Number.EPSILON;
            }
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

        if (
          state.drawing
            ?.mode ===
            'split' &&
          state.drawing
            .coordinates
            .length ===
            2
        ) {
          void finishDrawing();
        }
      });

      map.on(
        'dblclick',
        (event) => {
          const drawing =
            state.drawing;
          const finishEditing =
            !drawing &&
            state.editing &&
            Boolean(
              state.draft,
            ) &&
            !state.dragPath &&
            !state.geometryDrag;

          if (
            !finishEditing &&
            (
              !drawing ||
              ![
                'line',
                'polygon',
                'cut',
              ].includes(
                drawing.mode,
              )
            )
          ) {
            return;
          }

          event.preventDefault();
          event.originalEvent
            ?.preventDefault?.();
          event.originalEvent
            ?.stopPropagation?.();

          if (finishEditing) {
            void saveCurrent();
            return;
          }

          const coordinates =
            drawing.coordinates;

          if (
            coordinates.length >=
            2
          ) {
            const previous =
              state.map.project(
                coordinates.at(
                  -2,
                ),
              );
            const last =
              state.map.project(
                coordinates.at(
                  -1,
                ),
              );
            const repeatedClickDistance =
              Math.hypot(
                last.x -
                  previous.x,
                last.y -
                  previous.y,
              );

            if (
              repeatedClickDistance <=
              8
            ) {
              coordinates.pop();
            }
          }

          const minimum =
            drawing.mode ===
              'line'
              ? 2
              : 3;

          if (
            coordinates.length <
            minimum
          ) {
            updateMapSources();
            updateDrawControls();
            return;
          }

          drawing.previewCoordinate =
            null;
          updateMapSources();
          updateDrawControls();
          void finishDrawing();
        },
      );

      const addVertexHint =
        new globalThis.mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 10,
        });

      for (const layerId of [
        'geometry-editor-lines',
        'geometry-editor-polygon-lines',
        'geometry-editor-polygons',
        'geometry-editor-points',
        'geometry-editor-point-icons',
      ]) {
        map.on('click', layerId, (event) => {
          if (
            state.drawing ||
            state.suppressMapClick
          ) return;
          if (
            state.bulkSelecting &&
            event.originalEvent
              ?.__dtpstatMergeHandled
          ) {
            return;
          }
          const vertexHits = map.queryRenderedFeatures(event.point, {
            layers: ['geometry-editor-vertices'],
          });
          if (vertexHits.length > 0) return;

          const rawId =
            event.features?.[0]
              ?.properties
              ?.id;
          const id =
            isLocalGeometryId(
              rawId,
            )
              ? rawId
              : Number(
                  rawId,
                );
          if (
            isLocalGeometryId(
              id,
            ) ||
            (
              Number.isSafeInteger(
                id,
              ) &&
              id > 0
            )
          ) {
            if (
              state.bulkSelecting
            ) {
              if (
                event.originalEvent
              ) {
                event.originalEvent
                  .__dtpstatMergeHandled =
                  true;
              }
              event.originalEvent
                ?.preventDefault?.();
              event.originalEvent
                ?.stopPropagation?.();
              toggleMergeSelection(
                id,
              );
              return;
            }
            void selectGeometry(
              id,
            );
          }
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
        state.hoveredMidpoint = true;
        refreshMapCursor();
        if (
          !state.drawing &&
          event.lngLat
        ) {
          addVertexHint
            .setLngLat(event.lngLat)
            .setText('Добавить узел')
            .addTo(map);
        }
      });
      map.on('mouseleave', 'geometry-editor-midpoints', () => {
        state.hoveredMidpoint = false;
        addVertexHint.remove();
        refreshMapCursor();
      });
      state.map = map;
      await syncPointTypeMapImages();
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
            ...(selectedSummary ?? state.current ?? {}),
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
    const highlightedGeometries =
      state.bulkSelecting
        ? selectedMergeItems()
        : (
            selectedGeometry
              ? [
                  selectedGeometry,
                ]
              : []
          );

    map.getSource(SELECTED_SOURCE)?.setData(
      highlightedGeometries.length
        ? featureCollection(
            highlightedGeometries,
          )
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
    updateDraftMap();
    captureCurrentDraft();
    modeLabel.textContent = editingModeText(state.current);
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


  function insertVertexOnSegment(prefixAndIndex, coordinate) {
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
    updateDraftMap();
    captureCurrentDraft();
    modeLabel.textContent =
      'Новый узел добавлен · перетащите узел или Ctrl+кликните по нему для удаления';
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

  function coordinateInputValidity(
    input,
  ) {
    const axis =
      input.dataset
        .coordinate;
    const canonical =
      normalizeCoordinateInput(
        input.value,
      );

    if (
      input.value !==
      canonical
    ) {
      const start =
        input.selectionStart;
      const end =
        input.selectionEnd;
      input.value =
        canonical;
      if (
        start !== null &&
        end !== null
      ) {
        input.setSelectionRange(
          start,
          end,
        );
      }
    }

    try {
      if (
        axis ===
        'longitude'
      ) {
        normalizeCoordinate(
          canonical,
          0,
        );
      } else {
        normalizeCoordinate(
          0,
          canonical,
        );
      }

      input.setCustomValidity(
        '',
      );
      input.removeAttribute(
        'aria-invalid',
      );
      input.title =
        '';
      return true;
    } catch (error) {
      input.setCustomValidity(
        error.message,
      );
      input.setAttribute(
        'aria-invalid',
        'true',
      );
      input.title =
        error.message;
      return false;
    }
  }

  function refreshCoordinateValidation() {
    const descriptor =
      currentCoordinateSequence();
    const rows = [
      ...coordinateTableBody
        .querySelectorAll(
          'tr',
        ),
    ];
    const inputs = [
      ...coordinateTableBody
        .querySelectorAll(
          '[data-coordinate]',
        ),
    ];
    const valid =
      inputs.every(
        coordinateInputValidity,
      );
    const countValid =
      Boolean(
        descriptor &&
        (
          state.draft?.type ===
          'Point'
            ? rows.length ===
              1
            : rows.length >=
              descriptor.minimum
        )
      );

    coordinateApply.disabled =
      !descriptor ||
      !state.editing ||
      !valid ||
      !countValid;

    return (
      valid &&
      countValid
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
    lon.addEventListener(
      'input',
      () =>
        refreshCoordinateValidation(),
    );
    lon.addEventListener(
      'blur',
      () =>
        refreshCoordinateValidation(),
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
    lat.addEventListener(
      'input',
      () =>
        refreshCoordinateValidation(),
    );
    lat.addEventListener(
      'blur',
      () =>
        refreshCoordinateValidation(),
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
        refreshCoordinateValidation();
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
      coordinateClear.disabled =
        true;
      return;
    }

    renderCoordinateRows(
      descriptor.coordinates,
    );
    coordinateAddRow.disabled =
      state.draft?.type ===
      'Point';
    coordinateClear.disabled =
      false;
    refreshCoordinateValidation();
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

    coordinateOpenButton.disabled =
      !enabled;

    if (
      !enabled &&
      state.coordinateWindowOpen
    ) {
      closeCoordinateWindow();
    }

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

  function renderCreateControls() {
    const cannotCreate =
      Boolean(
        state.importSession ||
        state.editing ||
        state.drawing
      ) ||
      !state.city
        ?.boundaryId;

    newPointButton.disabled =
      cannotCreate;
    newLineButton.disabled =
      cannotCreate;
    newPolygonButton.disabled =
      cannotCreate;
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
    renderCreateControls();

    for (const control of form.elements) {
      if (control.name === 'lineTypeId' || control.name === 'lanes') continue;
      if ([
        'displayName',
        'tooltip',
        'tags',
        'isVisible',
        'minZoom',
        'maxZoom',
        'validFrom',
        'validTo',
      ].includes(control.name)) {
        control.disabled = !enabled;
      }
    }

    form.querySelector('button[type="submit"]').disabled = !enabled;
    const localTopologyDraft =
      Boolean(
        localItem &&
        localDraft
          ?.topologyGroupId,
      );
    revertButton.hidden =
      localItem &&
      !localTopologyDraft;
    revertButton.disabled =
      !item?.id ||
      !localDraft ||
      Boolean(
        state.drawing ||
        state.importSession,
      );
    deleteButton.disabled =
      !item?.id ||
      Boolean(state.drawing) ||
      Boolean(state.importSession) ||
      state.beginEditPendingId !== null;

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

    discussionOpenButton.hidden =
      !item?.id ||
      localItem;
    discussionOpenButton.disabled =
      !item?.id ||
      localItem ||
      Boolean(
        state.importSession,
      );
    renderDiscussionUnreadBadge();

    beginEditButton.hidden =
      !item?.id ||
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

    if (editingNotice) {
      editingNotice.hidden =
        !state.editing;
      editingNotice.textContent =
        state.editing
          ? (
              'Вы редактируете «' +
              displayName(item) +
              '». Изменения пока локальные; на сервер они попадут только после «Синхронизировать».'
            )
          : '';
    }

    if (editLockStatus) {
      if (localItem) {
        renderEditLockIdentity(
          state.editing
            ? 'Новая геометрия · редактирование localStorage'
            : 'Новая геометрия · localStorage',
          null,
        );
      } else if (state.editing) {
        renderEditLockIdentity(
          'Редактирует:',
          state.editLease ??
          activeLease ?? {
            userId:
              currentUser?.id,
            username:
              currentUser?.username,
            displayName:
              currentUser?.displayName,
            avatarUrl:
              currentUser?.hasAvatar
                ? '/api/admin/profile/avatar'
                : null,
          },
        );
      } else if (blockedByOther) {
        renderEditLockIdentity(
          'Редактирует:',
          activeLease,
        );
      } else if (leasedByThisClient) {
        renderEditLockIdentity(
          'Локально сохранено · блокировка остаётся за вами ·',
          activeLease,
        );
      } else {
        renderEditLockIdentity(
          item?.id
            ? 'Режим просмотра'
            : '',
          null,
        );
      }
    }

    if (conflictMessage) {
      conflictMessage.hidden = !localDraft?.conflict;
      conflictMessage.textContent = localDraft?.conflict
        ? 'Серверная версия изменилась после создания локального черновика.'
        : '';
    }

    detailsPanel?.classList
      .toggle(
        'is-empty',
        !draft,
      );

    if (!draft) {
      title.textContent = 'Выберите геометрию';
      lineFields.hidden = true;
      pointFields.hidden = true;
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
    pointFields.hidden = family !== 'point';
    renderTopologyState();

    if (family === 'line') {
      form.elements.lineTypeId.disabled = !enabled;
      form.elements.lanes.disabled = !enabled;
    } else {
      form.elements.lineTypeId.disabled = true;
      form.elements.lanes.disabled = true;
    }

    form.elements.pointTypeId.disabled =
      family !== 'point' ||
      !enabled;

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
    form.elements.minZoom.value =
      item?.minZoom ?? '';
    form.elements.maxZoom.value =
      item?.maxZoom ?? '';
    form.elements.validFrom.value =
      item?.validFrom ?? '';
    form.elements.validTo.value =
      item?.validTo ?? '';
    form.elements.maxZoom.setCustomValidity('');
    form.elements.validTo.setCustomValidity('');
    if (item?.lineTypeId) form.elements.lineTypeId.value = String(item.lineTypeId);
    else if (state.lineTypes[0]) form.elements.lineTypeId.value = String(state.lineTypes[0].id);
    form.elements.lanes.value = String(item?.lanes ?? 1);

    if (
      item?.pointTypeId
    ) {
      form.elements.pointTypeId.value =
        String(item.pointTypeId);
    } else if (
      isLocalGeometryId(item?.id) ||
      !item?.id
    ) {
      const defaultPointType =
        state.pointTypes.find(
          (pointType) =>
            pointType.isActive !== false,
        );
      form.elements.pointTypeId.value =
        defaultPointType
          ? String(
              defaultPointType.id,
            )
          : '';
    } else {
      form.elements.pointTypeId.value =
        '';
    }

    renderFormState();
  }

  function geometryMatchesSearch(item, query) {
    if (!query) return true;
    const haystack = [
      item.id,
      displayName(item),
      item.geometryType,
      item.lineTypeName,
      item.pointTypeName,
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
      const rowLeaseIsMine =
        Boolean(
          rowLease &&
          (
            rowLease.clientId ===
              realtimeClientId() ||
            (
              rowLease.userId !==
                null &&
              rowLease.userId !==
                undefined &&
              currentUser?.id !==
                null &&
              currentUser?.id !==
                undefined &&
              String(
                rowLease.userId,
              ) ===
                String(
                  currentUser.id,
                )
            )
          ),
        );
      row.classList.toggle('is-selected', item.id === state.selectedId);
      row.classList.toggle(
        'is-leased',
        Boolean(rowLease),
      );
      row.classList.toggle(
        'is-leased-by-me',
        rowLeaseIsMine,
      );
      row.classList.toggle('is-hidden', item.isVisible === false);
      row.classList.toggle(
        'is-edited',
        Boolean(
          item._local ||
          item._draft ||
          item.wasEdited,
        ),
      );
      row.classList.toggle(
        'is-bulk-selecting',
        state.bulkSelecting,
      );
      row.classList.toggle(
        'is-bulk-selected',
        state.selectedSet.has(
          item.id,
        ),
      );
      const mergeCandidateIssue =
        state.bulkSelecting
          ? mergeCandidateProblem(
              item,
            )
          : null;
      row.classList.toggle(
        'is-merge-incompatible',
        Boolean(
          mergeCandidateIssue &&
          !state.selectedSet.has(
            item.id,
          ),
        ),
      );
      row.classList.toggle('has-draft', Boolean(item._draft));
      row.classList.toggle('has-conflict', Boolean(item._conflict));
      row.classList.toggle('is-unlinked', !item.boundaryId);

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'geometry-editor-row-select';
      check.checked = state.selectedSet.has(item.id);
      check.disabled = Boolean(
        state.importSession ||
        (
          mergeCandidateIssue &&
          !state.selectedSet.has(
            item.id,
          )
        )
      );
      check.title =
        check.disabled
          ? mergeCandidateIssue
          : 'Добавить или убрать геометрию из объединения';
      check.setAttribute(
        'aria-label',
        'Выбрать для операции: ' + displayName(item),
      );
      check.addEventListener(
        'change',
        () => {
          toggleMergeSelection(
            item.id,
            {
              desired:
                check.checked,
            },
          );
        },
      );

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
        item.pointTypeName,
        item._local
          ? 'новая'
          : item.wasEdited
            ? 'изменена'
            : null,
        item._draft ? 'черновик' : null,
        item._conflict ? 'конфликт' : null,
        rowLease
          ? (
              rowLeaseIsMine
                ? 'редактируете вы'
                : 'редактирует: ' +
                  identityName(
                    rowLease,
                  )
            )
          : null,
        !item.boundaryId ? 'без привязки' : null,
        item.isVisible === false ? 'скрыта' : null,
      ].filter(Boolean).join(' · ') || typeLabel(item);
      copy.append(name, details);

      const type = document.createElement('span');
      type.className = 'geometry-editor-row-type';
      type.textContent = typeLabel(item);

      const leaseMarker =
        rowLease
          ? document.createElement(
              'span',
            )
          : null;
      if (leaseMarker) {
        leaseMarker.className =
          'geometry-editor-row-lease-marker';
        leaseMarker.textContent =
          '✎';
        leaseMarker.title =
          rowLeaseIsMine
            ? 'Редактируете вы'
            : 'Редактирует: ' +
              identityName(
                rowLease,
              );
        leaseMarker.setAttribute(
          'aria-label',
          leaseMarker.title,
        );
      }

      open.append(
        copy,
        ...(leaseMarker
          ? [leaseMarker]
          : []),
        type,
      );
      open.addEventListener(
        'click',
        () => {
          if (
            state.bulkSelecting
          ) {
            toggleMergeSelection(
              item.id,
            );
            return;
          }
          void selectGeometry(
            item.id,
          );
        },
      );

      if (
        state.bulkSelecting
      ) {
        row.append(
          check,
          open,
        );
      } else {
        row.append(
          open,
        );
      }
      listHost.append(row);
    }

    renderMergeState();
  }

  function mergeSelectionFamily() {
    return selectedMergeItems()
      .at(0)
      ?.family ??
      null;
  }

  function mergeCandidateProblem(
    item,
  ) {
    if (!item) {
      return 'Геометрия не найдена.';
    }
    if (item._conflict) {
      return 'Сначала разрешите конфликт этой геометрии.';
    }
    if (item.family === 'point') {
      return 'Точечные геометрии объединять нельзя.';
    }
    if (
      ![
        'line',
        'polygon',
      ].includes(
        item.family,
      )
    ) {
      return 'Этот тип геометрии нельзя объединять.';
    }

    const family =
      mergeSelectionFamily();
    if (
      family &&
      family !==
        item.family
    ) {
      return family === 'line'
        ? 'Сейчас выбираются линии. Полигон добавить нельзя.'
        : 'Сейчас выбираются полигоны. Линию добавить нельзя.';
    }

    return null;
  }

  function toggleMergeSelection(
    id,
    {
      desired,
    } = {},
  ) {
    if (!state.bulkSelecting) {
      return false;
    }

    const item =
      state.geometries.find(
        (candidate) =>
          String(
            candidate.id,
          ) ===
          String(id),
      );
    if (!item) {
      return false;
    }

    const selected =
      state.selectedSet.has(
        item.id,
      );
    const shouldSelect =
      desired === undefined
        ? !selected
        : Boolean(desired);

    if (!shouldSelect) {
      state.selectedSet.delete(
        item.id,
      );
    } else {
      const problem =
        mergeCandidateProblem(
          item,
        );
      if (problem) {
        setMessage(
          problem,
          'error',
        );
        renderMergeState();
        return false;
      }
      state.selectedSet.add(
        item.id,
      );
    }

    renderList();
    updateMapSources();
    renderMergeState();
    return true;
  }

  function startMergeSelection() {
    if (
      state.importSession ||
      state.editing ||
      state.drawing
    ) {
      return;
    }

    state.selectedSet.clear();
    state.bulkSelecting =
      true;
    refreshMapCursor();
    topologyActions.open =
      false;
    modeLabel.textContent =
      'Объединение геометрий · выбирайте объекты на карте или в списке';
    renderList();
    updateMapSources();
    renderMergeState();
  }

  function cancelMergeSelection() {
    state.selectedSet.clear();
    state.bulkSelecting =
      false;
    refreshMapCursor();
    modeLabel.textContent =
      editingModeText(
        state.current,
      );
    renderList();
    updateMapSources();
    renderMergeState();
  }

  function selectedMergeItems() {
    return [...state.selectedSet]
      .map(
        (id) =>
          state.geometries.find(
            (item) =>
              String(
                item.id,
              ) ===
              String(id),
          ),
      )
      .filter(Boolean);
  }

  function mergeProblem(items) {
    if (state.importSession) {
      return 'Сначала разрешите конфликты подготовленного импорта.';
    }
    if (items.length < 2) return 'Выберите минимум две геометрии.';
    if (items.some((item) => item._conflict)) {
      return 'Сначала разрешите конфликты выбранных геометрий.';
    }

    const first = items[0];
    if (first.family === 'point') {
      return 'Точечные геометрии объединять нельзя.';
    }

    if (
      items.some(
        (item) =>
          item.family !==
            first.family,
      )
    ) {
      return 'Геометрии должны иметь один тип геометрии.';
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
      !cutter.geometry ||
      cutter._conflict
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
        ? draftFor(
          item.id,
        )
        : null;
    const family =
      familyOf(
        state.draft,
      );
    const localItem =
      isLocalGeometryId(
        item?.id,
      );

    return Boolean(
      item?.id &&
      state.editing &&
      !state.drawing &&
      !state.importSession &&
      families.includes(
        family,
      ) &&
      (
        localItem ||
        local?.editToken
      )
    );
  }

  function renderTopologyState() {
    const family =
      familyOf(
        state.draft,
      );
    const topologyFamily =
      [
        'line',
        'polygon',
      ].includes(
        family,
      );

    const mergeFamilyCounts =
      state.geometries.reduce(
        (counts, candidate) => {
          if (
            !candidate._conflict &&
            [
              'line',
              'polygon',
            ].includes(
              candidate.family,
            )
          ) {
            counts[candidate.family] += 1;
          }
          return counts;
        },
        {
          line: 0,
          polygon: 0,
        },
      );
    const mergeAvailable =
      mergeFamilyCounts.line >= 2 ||
      mergeFamilyCounts.polygon >= 2;

    topologyActions.hidden =
      !topologyFamily &&
      !mergeAvailable;

    if (
      topologyActions.hidden
    ) {
      topologyActions.open =
        false;
    }

    cutButton.hidden =
      family !==
      'polygon';
    cutDirectButton.hidden =
      family !==
      'polygon';
    cutSelectedButton.hidden =
      family !==
      'polygon';
    splitButton.hidden =
      !topologyFamily;
    mergeStartButton.hidden =
      !mergeAvailable;
    mergeStartButton.disabled =
      !mergeAvailable ||
      Boolean(
        state.importSession ||
        state.editing ||
        state.drawing,
      );
    mergeStartButton.title =
      mergeAvailable
        ? 'Выбрать несколько совместимых линий или полигонов и объединить их'
        : 'Для объединения нужны минимум две линии или два полигона';

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
    const busy =
      Boolean(
        state.drawing ||
        state.importSession ||
        state.beginEditPendingId !==
          null,
      );

    cutDirectButton.disabled =
      busy;
    cutDirectButton.title =
      state.editing
        ? 'Нарисовать область, которая станет локальным вырезом полигона'
        : 'Начать редактирование и вырезать область из полигона';

    cutButton.disabled =
      !polygonReady;
    cutButton.title =
      polygonReady
        ? 'Нарисовать polygon, который будет локально вычтен из текущего'
        : 'Сначала начните редактирование полигона';

    cutSelectedButton.disabled =
      !polygonReady ||
      !cutter;
    cutSelectedButton.title =
      cutter
        ? 'Использовать как cutter: ' +
          displayName(
            cutter,
          )
        : 'Отметьте ровно один polygon-cutter';

    splitButton.disabled =
      !splitReady;
    splitButton.title =
      splitReady
        ? 'Нарисовать линию и сохранить обе части только в локальных черновиках'
        : 'Сначала начните редактирование линии или полигона';
  }

  function renderMergeState() {
    const selected =
      selectedMergeItems();
    const problem =
      mergeProblem(
        selected,
      );

    mergeMode.hidden =
      !state.bulkSelecting;
    section.classList.toggle(
      'is-merge-selecting',
      state.bulkSelecting,
    );

    mergeButton.disabled =
      !state.bulkSelecting ||
      Boolean(problem) ||
      Boolean(state.drawing);
    mergeButton.textContent =
      selected.length >= 2
        ? `Объединить ${selected.length}`
        : 'Объединить';
    mergeButton.title =
      problem ?? '';

    mergeClearButton.disabled =
      selected.length === 0;

    if (mergeStatus) {
      const family =
        mergeSelectionFamily();
      const familyLabel =
        family === 'line'
          ? 'линии'
          : family === 'polygon'
            ? 'полигоны'
            : 'линии или полигоны';

      mergeStatus.textContent =
        selected.length === 0
          ? 'Выберите минимум две совместимые линии или полигона на карте или в списке.'
          : `Выбрано: ${selected.length} · сейчас можно добавлять только ${familyLabel}.` +
            (
              problem &&
              selected.length >= 2
                ? ' ' + problem
                : ''
            );
    }

    renderTopologyState();
  }

  function focusGeometry(geometry) {
    const bounds = geometryBounds(geometry);
    if (!bounds || !state.map) return;
    state.map.fitBounds(bounds, { padding: 70, maxZoom: 17, duration: 250 });
  }

  function adoptLocalGeometry(entry, { focus = false } = {}) {
    const item = localCreateSummary(entry);
    state.selectedId = item.id;
    state.current = item;
    state.draft = clone(item.geometry);
    state.editing = false;
    state.editLease = null;
    state.blockedLease = null;
    state.history = [];
    state.future = [];
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
    state.editing = false;
    state.editLease = null;
    state.blockedLease = null;
    state.history = [];
    state.future = [];
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
    closeCoordinateWindow();

    if (
      state.editing &&
      String(state.current?.id) ===
        String(id)
    ) {
      if (
        focus &&
        state.draft
      ) {
        focusGeometry(
          state.draft,
        );
      }
      return;
    }

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
      if (item.family === 'point') await ensurePointTypes();
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
      state.editing ||
      state.beginEditPendingId !== null
    ) {
      return;
    }

    if (
      isLocalGeometryId(
        item.id,
      )
    ) {
      try {
        if (
          item.family ===
          'line'
        ) {
          await ensureLineTypes();
        }
        if (
          item.family ===
          'point'
        ) {
          await ensurePointTypes();
        }

        const local =
          draftFor(
            item.id,
          );

        if (
          local?.kind !==
          'create'
        ) {
          setMessage(
            'Локальная геометрия больше не существует. Обновите список.',
            'error',
          );
          return;
        }

        const editable =
          localCreateSummary(
            local,
          );
        state.current =
          editable;
        state.draft =
          clone(
            editable.geometry,
          );
        state.editing =
          true;
        state.editLease =
          null;
        state.blockedLease =
          null;
        state.history = [];
        state.future = [];
        applyForm(
          editable,
        );
        updateMapSources();
        renderHistoryControls();
        modeLabel.textContent =
          editingModeText(
            editable,
          );
        setMessage(
          'Редактирование локальной геометрии начато.',
          'success',
        );
      } catch (error) {
        setMessage(
          error.message,
          'error',
        );
      }
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
          identityName(
            knownLease,
          ) +
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
      identityName(
        state.blockedLease ??
        state.editLeases.get(
          Number(item.id),
        ),
      );

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
    state.geometryDrag =
      null;
    closeCoordinateWindow();
    state.selectedId = null;
    state.current = null;
    state.draft = null;
    state.history = [];
    state.future = [];
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
    renderCreateControls();
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


  function renderPointTypes() {
    const previous =
      form.elements
        .pointTypeId
        .value;

    const empty =
      document.createElement(
        'option',
      );
    empty.value = '';
    empty.textContent =
      'Без типа';

    const options =
      state.pointTypes.map(
        (pointType) => {
          const option =
            document.createElement(
              'option',
            );
          option.value =
            String(
              pointType.id,
            );
          option.textContent =
            pointType.name +
            (
              pointType.isActive ===
                false
                ? ' · выключен'
                : ''
            );
          return option;
        },
      );

    form.elements.pointTypeId
      .replaceChildren(
        empty,
        ...options,
      );

    if (
      [
        empty,
        ...options,
      ].some(
        (option) =>
          option.value ===
          previous,
      )
    ) {
      form.elements.pointTypeId
        .value =
        previous;
    }
  }

  async function syncPointTypeMapImages() {
    if (!state.map) {
      return;
    }

    state.pointImageIds =
      await syncPointTypeImages(
        state.map,
        state.pointTypes,
        {
          prefix:
            'geometry-point-type',
          previousIds:
            state.pointImageIds,
        },
      );

    rebuildDraftOverlay();
    updateMapSources();
  }

  async function ensurePointTypes({
    force = false,
  } = {}) {
    if (
      state.pointTypesLoaded &&
      !force
    ) {
      return state.pointTypes;
    }
    if (
      state.pointTypesPromise
    ) {
      return state.pointTypesPromise;
    }

    state.pointTypesPromise =
      api('/api/point-types')
        .then(
          async (payload) => {
            state.pointTypes =
              payload.pointTypes ??
              [];
            state.pointTypesLoaded =
              true;
            renderPointTypes();
            rebuildDraftOverlay();
            renderList();
            await syncPointTypeMapImages();
            return state.pointTypes;
          },
        )
        .finally(
          () => {
            state.pointTypesPromise =
              null;
          },
        );

    return state.pointTypesPromise;
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

  function selectedCityLabel() {
    return citySelect
      .selectedOptions[0]
      ?.textContent ?? '';
  }

  function closeCityPicker({
    restore = true,
  } = {}) {
    if (!citySearch || !cityOptionsHost) return;
    cityOptionsHost.hidden = true;
    citySearch.setAttribute(
      'aria-expanded',
      'false',
    );
    if (restore) {
      citySearch.value =
        selectedCityLabel();
    }
  }

  function renderCityPicker(
    query = '',
  ) {
    if (!citySearch || !cityOptionsHost) return;
    const normalized =
      query
        .trim()
        .toLocaleLowerCase(
          'ru-RU',
        );
    const options =
      Array.from(
        citySelect.options,
      ).filter(
        (option) =>
          !normalized ||
          option.textContent
            ?.toLocaleLowerCase(
              'ru-RU',
            )
            .includes(
              normalized,
            ),
      );

    cityOptionsHost
      .replaceChildren();

    if (!options.length) {
      const empty =
        document.createElement(
          'p',
        );
      empty.className =
        'geometry-editor-city-empty';
      empty.textContent =
        'Города не найдены';
      cityOptionsHost.append(
        empty,
      );
    } else {
      for (const option of options) {
        const button =
          document.createElement(
            'button',
          );
        button.type =
          'button';
        button.className =
          'geometry-editor-city-option';
        button.setAttribute(
          'role',
          'option',
        );
        button.setAttribute(
          'aria-selected',
          String(
            option.value ===
              citySelect.value,
          ),
        );
        button.dataset.value =
          option.value;
        button.textContent =
          option.textContent;
        button.addEventListener(
          'mousedown',
          (event) => {
            event.preventDefault();
          },
        );
        button.addEventListener(
          'click',
          () => {
            const changed =
              citySelect.value !==
              option.value;
            citySelect.value =
              option.value;
            citySearch.value =
              option.textContent;
            closeCityPicker({
              restore: false,
            });
            if (changed) {
              citySelect.dispatchEvent(
                new Event(
                  'change',
                  {
                    bubbles: true,
                  },
                ),
              );
            }
          },
        );
        cityOptionsHost.append(
          button,
        );
      }
    }

    cityOptionsHost.hidden =
      false;
    citySearch.setAttribute(
      'aria-expanded',
      'true',
    );
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
    if (citySearch) {
      citySearch.value =
        selectedCityLabel();
      if (
        cityOptionsHost &&
        !cityOptionsHost.hidden
      ) {
        renderCityPicker();
      }
    }
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
    requestSequence =
      state.workspaceRequestSequence,
  } = {}) {
    const previousId =
      keepSelection
        ? state.selectedId
        : null;
    const payload = await api(
      '/api/admin/geometry-editor/unlinked/geometries',
    );

    if (
      requestSequence !==
      state.workspaceRequestSequence
    ) {
      return false;
    }

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

    if (
      requestSequence !==
      state.workspaceRequestSequence
    ) {
      return false;
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

    return true;
  }

  async function loadCity(
    cityId,
    {
      keepSelection = false,
      fit = true,
      requestSequence =
        state.workspaceRequestSequence,
    } = {},
  ) {
    if (!cityId) {
      if (
        requestSequence !==
        state.workspaceRequestSequence
      ) {
        return false;
      }
      state.city = null;
      state.serverGeometries = [];
      state.geometries = [];
      clearSelection();
      return true;
    }

    const previousIds =
      state.city?.id === cityId
        ? new Set(
            state.serverGeometries.map(
              (item) => item.id,
            ),
          )
        : new Set();
    const previousId =
      keepSelection
        ? state.selectedId
        : null;

    const payload = await api(
      `/api/admin/geometry-editor/cities/${encodeURIComponent(cityId)}/geometries`,
    );

    if (
      requestSequence !==
      state.workspaceRequestSequence
    ) {
      return false;
    }

    state.city = payload.city;
    state.workspaceKey =
      'city:' + String(payload.city.id);
    state.serverGeometries =
      payload.geometries ?? [];
    renderImportConflicts();
    const currentIds =
      new Set(
        state.serverGeometries.map(
          (item) => item.id,
        ),
      );
    state.selectedSet =
      new Set(
        [...state.selectedSet].filter(
          (id) =>
            currentIds.has(id),
        ),
      );
    reconcileCurrentCityDrafts(
      previousIds,
    );
    rebuildDraftOverlay();
    citySelect.value =
      String(state.city.id);

    const previous =
      previousId &&
      state.geometries.find(
        (item) =>
          item.id === previousId,
      );
    if (previous) {
      await selectGeometry(
        previous.id,
        { focus: false },
      );
    } else {
      clearSelection();
    }

    if (
      requestSequence !==
      state.workspaceRequestSequence
    ) {
      return false;
    }

    renderList();
    updateMapSources();

    if (
      fit &&
      Array.isArray(
        state.city.bounds,
      ) &&
      state.map
    ) {
      state.map.fitBounds(
        [
          [
            state.city.bounds[0],
            state.city.bounds[1],
          ],
          [
            state.city.bounds[2],
            state.city.bounds[3],
          ],
        ],
        {
          padding: 42,
          duration: 250,
        },
      );
    }

    return true;
  }

  function loadWorkspace(
    value,
    {
      keepSelection = false,
      fit = true,
    } = {},
  ) {
    const requestSequence =
      ++state
        .workspaceRequestSequence;

    return value ===
      '__unlinked__'
      ? loadUnlinked({
          keepSelection,
          fit,
          requestSequence,
        })
      : loadCity(
          Number(value),
          {
            keepSelection,
            fit,
            requestSequence,
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
      minZoom: null,
      maxZoom: null,
      validFrom: null,
      validTo: null,
      wasEdited: true,
      lineTypeId: type === 'LineString' ? state.lineTypes[0]?.id ?? null : null,
      lanes: type === 'LineString' ? 1 : null,
    };
  }

  function topologyGroupEntries(
    entry,
  ) {
    if (
      !entry?.topologyGroupId
    ) {
      return entry
        ? [entry]
        : [];
    }

    return drafts.list()
      .filter(
        (candidate) =>
          candidate
            .topologyGroupId ===
          entry.topologyGroupId,
      );
  }

  function topologyPartValue(
    target,
    geometry,
  ) {
    return {
      cityId:
        target?.cityId ??
        state.city?.id ??
        null,
      ...payloadFromForm(),
      geometry:
        clone(
          geometry,
        ),
    };
  }

  function topologyGroupDefinition(
    entry,
    targetId,
  ) {
    return {
      groupId:
        entry
          ?.topologyGroupId ??
        crypto.randomUUID(),
      rootId:
        entry
          ?.topologyRootId ??
        targetId,
    };
  }

  async function undoTopologyGroup(
    entry,
  ) {
    if (
      !entry?.topologyGroupId
    ) {
      return false;
    }

    const group =
      topologyGroupEntries(
        entry,
      );
    const rootId =
      entry.topologyRootId ??
      entry.id;
    const root =
      draftFor(
        rootId,
      );
    const originalEntries =
      clone(
        root
          ?.topologyOriginalEntries ??
        [],
      );

    await Promise.allSettled(
      group
        .filter(
          (candidate) =>
            Boolean(
              candidate
                ?.editToken,
            ),
        )
        .map(
          (candidate) =>
            releaseDraftLease({
              ...candidate,
              id:
                candidate.id,
            }),
        ),
    );

    for (
      const candidate of
      group
    ) {
      drafts.remove(
        candidate.id,
      );
      state.validatedEditTokens
        .delete(
          String(
            candidate.id,
          ),
        );
    }

    if (
      originalEntries.length >
        0
    ) {
      for (
        const snapshot of
        originalEntries
      ) {
        if (
          snapshot?.id ===
            undefined ||
          !snapshot?.draft
        ) {
          continue;
        }

        drafts.upsert(
          snapshot.id,
          snapshot.draft,
        );
      }
    } else if (
      isLocalGeometryId(
        rootId,
      ) &&
      root?.topologyOriginalValue
    ) {
      drafts.upsert(
        rootId,
        {
          kind:
            'create',
          localId:
            rootId,
          workspaceKey:
            root.workspaceKey ??
            state.workspaceKey ??
            'unlinked',
          value:
            clone(
              root
                .topologyOriginalValue,
            ),
          conflict:
            false,
        },
      );
    }

    state.editing =
      false;
    state.editLease =
      null;
    state.blockedLease =
      null;
    state.history = [];
    state.future = [];
    rebuildDraftOverlay();
    refreshDraftControls();
    renderList();
    updateMapSources();
    renderHistoryControls();

    if (
      draftFor(
        rootId,
      )?.kind ===
      'create'
    ) {
      adoptLocalGeometry(
        draftFor(
          rootId,
        ),
      );
    } else if (
      !isLocalGeometryId(
        rootId,
      )
    ) {
      await selectGeometry(
        Number(
          rootId,
        ),
        {
          focus:
            false,
        },
      );
    } else {
      clearSelection();
    }

    return true;
  }

  async function topologyFailure(
    error,
  ) {
    setMessage(
      error.message,
      'error',
    );
  }

  async function cutTarget(
    target,
    cutterGeometry,
  ) {
    try {
      setMessage(
        'Вычисляем локальный вырез…',
      );

      const payload =
        await api(
          '/api/admin/geometry-editor/topology/cut-preview',
          {
            method:
              'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body:
              JSON.stringify({
                sourceGeometry:
                  state.draft,
                cutterGeometry,
              }),
          },
        );

      const existing =
        draftFor(
          target.id,
        );
      const localTarget =
        isLocalGeometryId(
          target.id,
        );

      if (
        localTarget &&
        existing?.kind ===
          'create' &&
        !existing
          .topologyGroupId
      ) {
        const {
          groupId,
          rootId,
        } =
          topologyGroupDefinition(
            existing,
            target.id,
          );

        drafts.upsert(
          target.id,
          {
            ...existing,
            topologyKind:
              'cut',
            topologyGroupId:
              groupId,
            topologyRootId:
              rootId,
            topologyOriginalValue:
              clone(
                existing.value,
              ),
          },
        );
      }

      pushHistory();
      state.draft =
        clone(
          payload.geometry,
        );
      captureCurrentDraft();
      updateDraftMap();
      renderFormState();
      setMessage(
        localTarget
          ? 'Вырез сохранён локально. «Отменить правки» вернёт исходную локальную геометрию; запись в БД произойдёт только после «Синхронизировать».'
          : 'Вырез сохранён локально. «Отменить правки» вернёт серверную версию; запись в БД произойдёт только после «Синхронизировать».',
        'success',
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
        'Вычисляем локальное разделение…',
      );

      const sourceGeometry =
        clone(
          state.draft,
        );
      const payload =
        await api(
          '/api/admin/geometry-editor/topology/split-preview',
          {
            method:
              'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body:
              JSON.stringify({
                sourceGeometry,
                blade,
              }),
          },
        );
      const parts =
        payload.geometries ??
        [];

      if (
        parts.length <
        2
      ) {
        throw new Error(
          'Сервер не вернул части разделения.',
        );
      }

      const existing =
        draftFor(
          target.id,
        );
      const {
        groupId,
        rootId,
      } =
        topologyGroupDefinition(
          existing,
          target.id,
        );
      const localTarget =
        isLocalGeometryId(
          target.id,
        );
      const companionIds =
        parts
          .slice(1)
          .map(
            () =>
              'local:' +
              crypto.randomUUID(),
          );

      state.draft =
        clone(
          parts[0],
        );

      if (localTarget) {
        if (
          existing?.kind !==
          'create'
        ) {
          throw new Error(
            'Локальный черновик разделяемой геометрии не найден.',
          );
        }

        drafts.upsert(
          target.id,
          {
            ...existing,
            kind:
              'create',
            localId:
              target.id,
            value: {
              ...existing.value,
              geometry:
                clone(
                  parts[0],
                ),
            },
            topologyKind:
              'split',
            topologyGroupId:
              groupId,
            topologyRootId:
              rootId,
            topologyLocalIds: [
              ...new Set([
                ...(
                  existing
                    ?.topologyLocalIds ??
                  []
                ),
                ...companionIds,
              ]),
            ],
            topologyOriginalValue:
              existing
                .topologyOriginalValue ??
              clone(
                existing.value,
              ),
          },
        );
      } else {
        captureCurrentDraft();
        const sourceDraft =
          draftFor(
            target.id,
          );
        const topologyLocalIds =
          [
            ...new Set([
              ...(
                sourceDraft
                  ?.topologyLocalIds ??
                []
              ),
              ...companionIds,
            ]),
          ];

        drafts.upsert(
          target.id,
          {
            ...sourceDraft,
            topologyKind:
              'split',
            topologyGroupId:
              groupId,
            topologyRootId:
              rootId,
            topologyLocalIds,
          },
        );
      }

      for (
        const [
          index,
          localId,
        ] of companionIds
          .entries()
      ) {
        drafts.upsert(
          localId,
          {
            kind:
              'create',
            localId,
            workspaceKey:
              existing?.workspaceKey ??
              state.workspaceKey ??
              'unlinked',
            value:
              topologyPartValue(
                target,
                parts[
                  index + 1
                ],
              ),
            sourceGeometryId:
              localTarget
                ? (
                    existing
                      ?.sourceGeometryId ??
                    null
                  )
                : Number(
                  target.id,
                ),
            topologyKind:
              'split',
            topologyGroupId:
              groupId,
            topologyRootId:
              rootId,
            topologySourceId:
              localTarget
                ? (
                    existing
                      ?.topologySourceId ??
                    null
                  )
                : Number(
                  target.id,
                ),
            conflict:
              false,
          },
        );
      }

      if (
        localTarget
      ) {
        state.current =
          localCreateSummary(
            draftFor(
              target.id,
            ),
          );
        state.draft =
          clone(
            state.current
              .geometry,
          );
        applyForm(
          state.current,
        );
      }

      state.history = [];
      state.future = [];
      rebuildDraftOverlay();
      refreshDraftControls();
      renderList();
      updateMapSources();
      renderHistoryControls();
      renderFormState();
      setMessage(
        'Геометрия разделена только в локальных черновиках: частей — ' +
          parts.length +
          '. «Отменить правки» вернёт исходную геометрию; «Синхронизировать» атомарно запишет все части.',
        'success',
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
      !state.editing
    ) {
      await beginEditing();
    }

    if (
      !topologyTargetReady([
        'polygon',
      ]) ||
      !cutter
    ) {
      renderTopologyState();
      setMessage(
        'Для вырезания выберите текущий polygon и отметьте ровно один polygon-cutter.',
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
      cutter.geometry,
    );
  }

  async function startPolygonCut() {
    const item =
      state.current;

    if (
      !item?.id ||
      familyOf(
        state.draft,
      ) !==
        'polygon'
    ) {
      return;
    }

    if (!state.editing) {
      await beginEditing();
    }

    if (
      !topologyTargetReady([
        'polygon',
      ])
    ) {
      setMessage(
        'Не удалось начать локальное редактирование полигона.',
        'error',
      );
      return;
    }

    await startDrawing(
      'cut',
    );
  }


  async function startDrawing(mode) {
    closeCoordinateWindow();

    const createsGeometry =
      [
        'point',
        'line',
        'polygon',
      ].includes(
        mode,
      );

    if (
      createsGeometry &&
      (
        state.editing ||
        state.drawing
      )
    ) {
      setMessage(
        'Завершите текущее редактирование или рисование перед добавлением другой геометрии.',
        'error',
      );
      return;
    }

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
        !state.editing
      ) {
        await beginEditing();
      }

      if (
        !topologyTargetReady(
          families,
        )
      ) {
        setMessage(
          mode === 'cut'
            ? 'Не удалось начать локальное редактирование полигона.'
            : 'Не удалось начать локальное редактирование линии или полигона.',
          'error',
        );
        return;
      }

      captureCurrentDraft();

      state.drawing = {
        mode,
        coordinates: [],
        previewCoordinate: null,
      };
      state.history = [];
      state.future = [];
      updateMapSources();
      updateDrawControls();
      renderFormState();
      setMessage(
        mode === 'cut'
          ? 'Нарисуйте область, которую нужно вырезать: минимум три точки.'
          : 'Укажите две точки прямой разреза. После второй точки разделение выполнится автоматически.',
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

    if (mode === 'point') {
      try {
        await ensurePointTypes();
      } catch (error) {
        setMessage(
          'Не удалось загрузить типы точек: ' +
            error.message,
          'error',
        );
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
    finishDrawButton.hidden =
      !active ||
      [
        'point',
        'split',
      ].includes(
        drawing?.mode,
      );
    cancelDrawButton.hidden = !active;

    let canFinish = false;
    if (
      drawing?.mode ===
      'line'
    ) {
      canFinish =
        drawing.coordinates
          .length >=
        2;
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
        ' · двойной клик — вырезать';
    } else if (drawing?.mode === 'split') {
      modeLabel.textContent =
        drawing.coordinates.length ===
          0
          ? 'Разделение · укажите первую точку прямой'
          : 'Разделение · укажите вторую точку прямой';
    } else if (drawing?.mode === 'point') {
      modeLabel.textContent =
        'Добавление точки · кликните по карте';
    } else if (drawing?.mode === 'line') {
      modeLabel.textContent =
        'Добавление линии · точек: ' +
        drawing.coordinates.length +
        ' · клик — следующая точка · двойной клик — завершить';
    } else if (drawing?.mode === 'polygon') {
      modeLabel.textContent =
        'Добавление полигона · точек: ' +
        drawing.coordinates.length +
        ' · двойной клик — завершить';
    } else {
      modeLabel.textContent =
        editingModeText(state.current);
    }
    refreshMapCursor();
    renderHistoryControls();
    renderMergeState();
    renderCreateControls();
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
      if (
        drawing.mode ===
          'split' &&
        drawing.coordinates
          .length !==
          2
      ) {
        return;
      }
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

        if (!target?.id) {
          setMessage(
            'Не удалось определить редактируемую геометрию.',
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

        if (!target?.id) {
          setMessage(
            'Не удалось определить редактируемый полигон.',
            'error',
          );
          return;
        }

        await cutTarget(
          target,
          polygon,
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
      minZoom:
        form.elements.minZoom.value === ''
          ? null
          : Number(
              form.elements.minZoom.value,
            ),
      maxZoom:
        form.elements.maxZoom.value === ''
          ? null
          : Number(
              form.elements.maxZoom.value,
            ),
      validFrom:
        form.elements.validFrom.value ||
        null,
      validTo:
        form.elements.validTo.value ||
        null,
      ...(family === 'line'
        ? {
            lineTypeId: Number(form.elements.lineTypeId.value),
            lanes: Number(form.elements.lanes.value),
          }
        : {}),
      ...(family === 'point'
        ? {
            pointTypeId:
              form.elements.pointTypeId.value
                ? Number(
                    form.elements.pointTypeId.value,
                  )
                : null,
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

    const localItem =
      isLocalGeometryId(
        state.current?.id,
      );
    const selectedId =
      state.current?.id;

    state.editing = false;
    state.history = [];
    state.future = [];
    rebuildDraftOverlay();

    if (localItem) {
      const persisted =
        draftFor(
          selectedId,
        );
      if (
        persisted?.kind ===
        'create'
      ) {
        state.current =
          localCreateSummary(
            persisted,
          );
        state.draft =
          clone(
            state.current
              .geometry,
          );
        applyForm(
          state.current,
        );
      } else {
        renderFormState();
      }
    } else {
      renderFormState();
    }

    updateMapSources();
    renderHistoryControls();
    modeLabel.textContent =
      editingModeText(
        state.current,
      );

    setMessage(
      localItem
        ? 'Изменения сохранены в localStorage. Активное редактирование завершено. Для записи в БД используйте «Синхронизировать».'
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

  function expandDraftEntries(
    entries,
  ) {
    const expanded =
      new Map(
        entries.map(
          (entry) => [
            String(
              entry.id,
            ),
            entry,
          ],
        ),
      );
    const groupIds =
      new Set(
        entries
          .map(
            (entry) =>
              entry
                .topologyGroupId,
          )
          .filter(
            Boolean,
          ),
      );

    if (
      groupIds.size > 0
    ) {
      for (
        const candidate of
        drafts.list()
      ) {
        if (
          groupIds.has(
            candidate
              .topologyGroupId,
          )
        ) {
          expanded.set(
            String(
              candidate.id,
            ),
            candidate,
          );
        }
      }
    }

    return [
      ...expanded.values(),
    ];
  }

  async function saveDraftEntries(entries) {
    const expandedEntries =
      expandDraftEntries(
        entries,
      );
    const items =
      expandedEntries.flatMap((entry) => {
        if (entry.kind === 'delete') {
          if (
            !entry.editToken
          ) {
            return [];
          }

          return [{
            kind:
              'delete',
            id:
              Number(
                entry.id,
              ),
            baseUpdatedAt:
              entry.baseUpdatedAt,
            editToken:
              entry.editToken,
          }];
        }

        if (entry.kind === 'create') {
          return [{
            kind: 'create',
            localId:
              entry.localId ??
              entry.id,
            ...(
              entry.sourceGeometryId
                ? {
                  sourceGeometryId:
                    Number(
                      entry
                        .sourceGeometryId,
                    ),
                }
                : {}
            ),
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
    const deletedIds =
      new Set(
        (payload.deleted ?? [])
          .map(
            (item) =>
              String(item.id),
          ),
      );

    const release =
      expandedEntries.filter(
        (entry) =>
          updatedIds.has(
            String(entry.id),
          ) ||
          deletedIds.has(
            String(entry.id),
          ),
      );

    for (
      const entry of
      expandedEntries
    ) {
      if (
        updatedIds.has(String(entry.id)) ||
        createdIds.has(String(entry.id)) ||
        deletedIds.has(String(entry.id))
      ) {
        drafts.remove(entry.id);
      }
    }

    await Promise.allSettled(
      release.map(
        releaseDraftLease,
      ),
    );

    for (
      const entry of
      expandedEntries
    ) {
      if (
        updatedIds.has(String(entry.id)) ||
        createdIds.has(String(entry.id)) ||
        deletedIds.has(String(entry.id))
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

  function syncDisplayWindowValidity() {
    const minZoom =
      form.elements.minZoom.value === ''
        ? null
        : Number(
            form.elements.minZoom.value,
          );
    const maxZoom =
      form.elements.maxZoom.value === ''
        ? null
        : Number(
            form.elements.maxZoom.value,
          );
    const validFrom =
      form.elements.validFrom.value ||
      null;
    const validTo =
      form.elements.validTo.value ||
      null;

    form.elements.maxZoom.setCustomValidity(
      minZoom !== null &&
      maxZoom !== null &&
      minZoom > maxZoom
        ? 'Zoom «до» должен быть не меньше zoom «от».'
        : '',
    );
    form.elements.validTo.setCustomValidity(
      validFrom &&
      validTo &&
      validFrom > validTo
        ? 'Дата «по» должна быть не раньше даты «с».'
        : '',
    );
  }

  for (const control of [
    form.elements.displayName,
    form.elements.tooltip,
    form.elements.tags,
    form.elements.isVisible,
    form.elements.minZoom,
    form.elements.maxZoom,
    form.elements.validFrom,
    form.elements.validTo,
    form.elements.lineTypeId,
    form.elements.lanes,
    form.elements.pointTypeId,
  ]) {
    control?.addEventListener(
      'input',
      () => {
        syncDisplayWindowValidity();
        captureCurrentDraft();
      },
    );
    control?.addEventListener(
      'change',
      () => {
        syncDisplayWindowValidity();
        captureCurrentDraft();
      },
    );
  }


  revertButton.addEventListener('click', async () => {
    const item = state.current;
    if (!item?.id) return;

    const local =
      draftFor(
        item.id,
      );

    if (
      local?.topologyGroupId
    ) {
      const localItem =
        isLocalGeometryId(
          item.id,
        );
      await undoTopologyGroup(
        local,
      );
      setMessage(
        localItem
          ? 'Локальная topology-операция отменена. Исходная локальная геометрия восстановлена.'
          : 'Локальная topology-операция отменена. Показана версия из БД.',
        'success',
      );
      return;
    }

    if (
      isLocalGeometryId(
        item.id,
      )
    ) {
      return;
    }

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
    const item =
      state.current;
    if (!item?.id) return;

    if (
      isLocalGeometryId(
        item.id,
      )
    ) {
      const local =
        draftFor(
          item.id,
        );

      if (
        local
          ?.topologyGroupId &&
        String(
          local.topologyRootId,
        ) !==
        String(
          item.id,
        )
      ) {
        await undoTopologyGroup(
          local,
        );
        setMessage(
          'Разделение отменено. Исходная геометрия восстановлена.',
          'success',
        );
        return;
      }

      if (
        local
          ?.topologyGroupId
      ) {
        for (
          const candidate of
          topologyGroupEntries(
            local,
          )
        ) {
          drafts.remove(
            candidate.id,
          );
        }
      } else {
        drafts.remove(
          item.id,
        );
      }

      state.selectedSet.delete(
        item.id,
      );
      rebuildDraftOverlay();
      clearSelection();
      refreshDraftControls();
      setMessage(
        'Геометрия удалена.',
        'success',
      );
      return;
    }

    const confirmed =
      await adminConfirm({
        title:
          'Удалить геометрию?',
        message:
          'Вы уверены, что хотите удалить геометрию с сервера?',
        confirmLabel:
          'Удалить',
        cancelLabel:
          'Отмена',
        destructive:
          true,
      });
    if (!confirmed) return;

    if (
      String(
        state.current?.id,
      ) !==
      String(
        item.id,
      )
    ) {
      return;
    }

    if (!state.editing) {
      await beginEditing();
    }

    if (
      !state.editing ||
      String(
        state.current?.id,
      ) !==
      String(
        item.id,
      )
    ) {
      return;
    }

    const local =
      draftFor(
        item.id,
      );
    if (!local?.editToken) {
      setMessage(
        'Не удалось получить блокировку для удаления геометрии.',
        'error',
      );
      return;
    }

    try {
      await api(
        '/api/admin/geometry-editor/geometries/' +
          item.id,
        {
          method: 'DELETE',
          headers: {
            'X-DTPStat-Base-Revision':
              local.baseUpdatedAt ??
              item.updatedAt,
            'X-DTPStat-Edit-Token':
              local.editToken,
          },
        },
      );
      drafts.remove(
        item.id,
      );
      state.validatedEditTokens.delete(
        String(item.id),
      );
      state.selectedSet.delete(
        item.id,
      );
      state.serverGeometries =
        state.serverGeometries.filter(
          (candidate) =>
            candidate.id !==
            item.id,
        );
      rebuildDraftOverlay();
      clearSelection();
      refreshDraftControls();
      setMessage(
        'Геометрия удалена. Для обновления основной карты и статистики нажмите «Пересчитать».',
        'success',
      );
    } catch (error) {
      if (
        error.status === 409 &&
        local
      ) {
        drafts.markConflict(
          item.id,
          true,
        );
        rebuildDraftOverlay();
        renderList();
        renderFormState();
        refreshDraftControls();
      }
      setMessage(
        error.message,
        'error',
      );
    }
  });


  async function acquireOperationLeases(
    items,
  ) {
    await validateWorkspaceEditTokens({
      announce:
        false,
    });

    const tokens =
      new Map();
    const acquired =
      [];

    try {
      for (
        const item of
        items
      ) {
        if (
          isLocalGeometryId(
            item.id,
          )
        ) {
          continue;
        }

        const existing =
          draftFor(
            item.id,
          );
        const validatedToken =
          existing?.editToken &&
          state.validatedEditTokens.get(
            String(
              item.id,
            ),
          ) ===
            existing.editToken
            ? existing.editToken
            : null;

        if (validatedToken) {
          tokens.set(
            String(
              item.id,
            ),
            validatedToken,
          );
          continue;
        }

        const knownLease =
          state.editLeases.get(
            Number(
              item.id,
            ),
          );

        if (
          knownLease &&
          knownLease.clientId !==
            realtimeClientId()
        ) {
          throw new Error(
            'Геометрия «' +
              displayName(
                item,
              ) +
              '» редактируется другим пользователем.',
          );
        }

        const payload =
          await api(
            '/api/admin/geometry-editor/geometries/' +
              encodeURIComponent(
                item.id,
              ) +
              '/edit-lock',
            {
              method:
                'POST',
            },
          );
        const lease =
          payload.lease;

        tokens.set(
          String(
            item.id,
          ),
          lease.token,
        );
        acquired.push({
          id:
            item.id,
          kind:
            'update',
          editToken:
            lease.token,
        });
        state.validatedEditTokens.set(
          String(
            item.id,
          ),
          lease.token,
        );
        state.editLeases.set(
          Number(
            item.id,
          ),
          {
            ...lease,
            token:
              undefined,
          },
        );
      }

      return tokens;
    } catch (error) {
      await Promise.allSettled(
        acquired.map(
          releaseDraftLease,
        ),
      );

      for (
        const item of
        acquired
      ) {
        state.validatedEditTokens.delete(
          String(
            item.id,
          ),
        );
        state.editLeases.delete(
          Number(
            item.id,
          ),
        );
      }

      throw error;
    }
  }


  function topologyDraftSnapshots(
    items,
  ) {
    return items
      .map(
        (item) => ({
          id:
            item.id,
          draft:
            draftFor(
              item.id,
            ),
        }),
      )
      .filter(
        (snapshot) =>
          Boolean(
            snapshot.draft,
          ),
      )
      .map(
        (snapshot) => ({
          id:
            snapshot.id,
          draft:
            clone(
              snapshot.draft,
            ),
        }),
      );
  }


  mergeStartButton.addEventListener(
    'click',
    startMergeSelection,
  );

  mergeClearButton.addEventListener(
    'click',
    () => {
      state.selectedSet.clear();
      renderList();
      updateMapSources();
      renderMergeState();
    },
  );

  mergeCancelButton.addEventListener(
    'click',
    cancelMergeSelection,
  );


  mergeButton.addEventListener(
    'click',
    async () => {
      captureCurrentDraft();

      let items =
        selectedMergeItems();
      let problem =
        mergeProblem(
          items,
        );

      if (problem) {
        renderMergeState();
        setMessage(
          problem,
          'error',
        );
        return;
      }

      const target =
        items.find(
          (item) =>
            !isLocalGeometryId(
              item.id,
            ),
        ) ??
        items[0];

      const confirmed =
        await adminConfirm({
          title:
            'Объединить геометрии?',
          message:
            'Геометрия будет вычислена локально. Атрибуты основной геометрии сохранятся; запись в БД произойдёт только после «Синхронизировать».',
          confirmLabel:
            'Объединить локально',
          cancelLabel:
            'Отмена',
        });

      if (!confirmed) {
        return;
      }

      try {
        mergeButton.disabled =
          true;
        setMessage(
          'Вычисляем локальное объединение…',
        );

        await validateWorkspaceEditTokens({
          announce:
            false,
        });
        rebuildDraftOverlay();

        items =
          selectedMergeItems();
        problem =
          mergeProblem(
            items,
          );
        if (problem) {
          throw new Error(
            problem,
          );
        }

        const payload =
          await api(
            '/api/admin/geometry-editor/topology/union-preview',
            {
              method:
                'POST',
              headers: {
                'Content-Type':
                  'application/json',
              },
              body:
                JSON.stringify({
                  geometries:
                    items.map(
                      (item) =>
                        item.geometry,
                    ),
                }),
            },
          );
        const geometry =
          payload.geometry;

        if (!geometry) {
          throw new Error(
            'Сервер не вернул результат объединения.',
          );
        }

        const leaseTokens =
          await acquireOperationLeases(
            items,
          );
        const originalEntries =
          topologyDraftSnapshots(
            items,
          );
        const groupId =
          crypto.randomUUID();
        const rootId =
          target.id;
        const targetExisting =
          draftFor(
            target.id,
          );

        if (
          isLocalGeometryId(
            target.id,
          )
        ) {
          if (
            targetExisting
              ?.kind !==
            'create'
          ) {
            throw new Error(
              'Локальный черновик основной геометрии не найден.',
            );
          }

          drafts.upsert(
            target.id,
            {
              ...targetExisting,
              kind:
                'create',
              value: {
                ...targetExisting.value,
                geometry:
                  clone(
                    geometry,
                  ),
              },
              topologyKind:
                'union',
              topologyGroupId:
                groupId,
              topologyRootId:
                rootId,
              topologyOriginalEntries:
                originalEntries,
            },
          );
        } else {
          drafts.upsert(
            target.id,
            {
              ...(targetExisting ??
                {}),
              kind:
                'update',
              baseUpdatedAt:
                targetExisting
                  ?.baseUpdatedAt ??
                target.updatedAt,
              editToken:
                leaseTokens.get(
                  String(
                    target.id,
                  ),
                ) ??
                targetExisting
                  ?.editToken,
              changes: {
                ...(
                  targetExisting
                    ?.changes ??
                  {}
                ),
                geometry:
                  clone(
                    geometry,
                  ),
              },
              conflict:
                false,
              topologyKind:
                'union',
              topologyGroupId:
                groupId,
              topologyRootId:
                rootId,
              topologyOriginalEntries:
                originalEntries,
            },
          );
        }

        for (
          const item of
          items
        ) {
          if (
            String(
              item.id,
            ) ===
            String(
              target.id,
            )
          ) {
            continue;
          }

          if (
            isLocalGeometryId(
              item.id,
            )
          ) {
            drafts.remove(
              item.id,
            );
            continue;
          }

          const existing =
            draftFor(
              item.id,
            );

          drafts.upsert(
            item.id,
            {
              kind:
                'delete',
              baseUpdatedAt:
                existing
                  ?.baseUpdatedAt ??
                item.updatedAt,
              editToken:
                leaseTokens.get(
                  String(
                    item.id,
                  ),
                ) ??
                existing
                  ?.editToken,
              changes: {},
              conflict:
                false,
              topologyKind:
                'union',
              topologyGroupId:
                groupId,
              topologyRootId:
                rootId,
            },
          );
        }

        state.selectedSet.clear();
        state.bulkSelecting =
          false;
        section.classList.remove(
          'is-merge-selecting',
        );
        mergeMode.hidden =
          true;
        state.editing =
          false;
        state.editLease =
          null;
        state.blockedLease =
          null;
        rebuildDraftOverlay();
        refreshDraftControls();

        if (
          isLocalGeometryId(
            target.id,
          )
        ) {
          adoptLocalGeometry(
            draftFor(
              target.id,
            ),
            {
              focus:
                false,
            },
          );
        } else {
          const serverTarget =
            state.serverGeometries
              .find(
                (item) =>
                  String(
                    item.id,
                  ) ===
                  String(
                    target.id,
                  ),
              );

          if (serverTarget) {
            adoptGeometryDetail(
              serverTarget,
              {
                focus:
                  false,
              },
            );
          }
        }

        setMessage(
          'Геометрии объединены только локально. «Отменить правки» восстановит исходные геометрии; «Синхронизировать» атомарно запишет результат.',
          'success',
        );
      } catch (error) {
        setMessage(
          error.message,
          'error',
        );
      } finally {
        renderMergeState();
        refreshDraftControls();
      }
    },
  );


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
          entry.kind === 'update' &&
          Object.keys(entry.changes ?? {}).length > 0,
      ).length;
    const deleted =
      entries.filter(
        (entry) =>
          entry.kind === 'delete',
      ).length;

    const confirmed = await adminConfirm({
      title: 'Очистить локальные изменения?',
      message:
        'Будут удалены несинхронизированные данные: новых геометрий — ' +
        created +
        ', изменённых геометрий — ' +
        modified +
        ', удаляемых геометрий — ' +
        deleted +
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
      change?.resource ===
        'geometry-discussions'
    ) {
      if (
        change.originClientId ===
          realtimeClientId()
      ) {
        return;
      }

      const discussionSource =
        change.source ??
        {};
      const geometryId =
        Number(
          change.geometryId ??
          discussionSource
            .geometryId ??
          change.entityIds?.[0],
        );

      if (
        !Number.isSafeInteger(
          geometryId,
        ) ||
        geometryId <= 0
      ) {
        return;
      }

      if (
        change.action ===
          'read'
      ) {
        if (
          Number(
            change.readerUserId ??
            discussionSource
              .readerUserId,
          ) !==
            Number(
              currentUser?.id,
            ) &&
          (
            change.lastReadMessageId ??
            discussionSource
              .lastReadMessageId
          )
        ) {
          markOwnMessagesReadThrough(
            geometryId,
            change.lastReadMessageId ??
            discussionSource
              .lastReadMessageId,
          );
        }
        return;
      }

      const incoming =
        change.discussionMessage ??
        discussionSource
          .discussionMessage ??
        null;

      if (!incoming) {
        return;
      }

      setDiscussionMessageCount(
        geometryId,
        discussionMessageCount(
          geometryId,
        ) + 1,
      );

      if (
        discussionIsOpenFor(
          geometryId,
        )
      ) {
        const keepScroll =
          discussionNearBottom();
        appendDiscussionMessage(
          incoming,
        );
        state.discussionAttentionMessageId =
          incoming.id;
        markDiscussionRead(
          geometryId,
        );
        void persistDiscussionRead(
          geometryId,
          incoming.id,
        ).catch(
          (error) =>
            console.warn(
              'Geometry discussion realtime read update failed',
              error,
            ),
        );
        revealDiscussion({
          attention: true,
          scrollToEnd:
            keepScroll,
        });
        window.setTimeout(
          () => {
            if (
              Number(
                state.discussionAttentionMessageId,
              ) ===
              Number(
                incoming.id,
              )
            ) {
              state.discussionAttentionMessageId =
                null;
              discussionMessages
                ?.querySelector(
                  '[data-message-id="' +
                  CSS.escape(
                    String(
                      incoming.id,
                    ),
                  ) +
                  '"]',
                )
                ?.classList.remove(
                  'is-incoming',
                );
            }
          },
          1400,
        );
      } else {
        incrementDiscussionUnread(
          geometryId,
        );
      }
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

  discussionOpenButton?.addEventListener(
    'click',
    () => {
      const geometryId =
        Number(
          state.current?.id,
        );
      if (
        Number.isSafeInteger(
          geometryId,
        ) &&
        geometryId > 0
      ) {
        void loadDiscussion(
          geometryId,
          {
            focusInput: true,
          },
        );
      }
    },
  );

  discussionCloseButton?.addEventListener(
    'click',
    () => {
      discussionPanel.hidden =
        true;
      discussionPanel.classList.remove(
        'is-attention',
      );
    },
  );

  discussionForm?.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      void sendDiscussionMessage();
    },
  );

  function beginDiscussionResize(
    event,
  ) {
    if (
      !discussionPanel ||
      !discussionResizeGrip ||
      event.button !== 0
    ) {
      return;
    }

    event.preventDefault();

    const rect =
      discussionPanel
        .getBoundingClientRect();
    const startX =
      event.clientX;
    const startY =
      event.clientY;
    const startWidth =
      rect.width;
    const startHeight =
      rect.height;

    const minWidth = 320;
    const minHeight = 256;
    const maxWidth =
      Math.max(
        minWidth,
        globalThis.innerWidth - 16,
      );
    const maxHeight =
      Math.max(
        minHeight,
        globalThis.innerHeight - 16,
      );

    const move =
      (moveEvent) => {
        const width =
          Math.min(
            maxWidth,
            Math.max(
              minWidth,
              startWidth +
                startX -
                moveEvent.clientX,
            ),
          );
        const height =
          Math.min(
            maxHeight,
            Math.max(
              minHeight,
              startHeight +
                startY -
                moveEvent.clientY,
            ),
          );

        discussionPanel
          .style.width =
          width + 'px';
        discussionPanel
          .style.height =
          height + 'px';
      };

    const finish = () => {
      globalThis.removeEventListener(
        'pointermove',
        move,
      );
      globalThis.removeEventListener(
        'pointerup',
        finish,
      );
      globalThis.removeEventListener(
        'pointercancel',
        finish,
      );
    };

    globalThis.addEventListener(
      'pointermove',
      move,
    );
    globalThis.addEventListener(
      'pointerup',
      finish,
      {
        once: true,
      },
    );
    globalThis.addEventListener(
      'pointercancel',
      finish,
      {
        once: true,
      },
    );
  }

  discussionResizeGrip
    ?.addEventListener(
      'pointerdown',
      beginDiscussionResize,
    );

  function resizeDiscussionInput() {
    if (!discussionInput) {
      return;
    }
    discussionInput.style.height =
      'auto';
    const nextHeight =
      Math.min(
        discussionInput.scrollHeight,
        112,
      );
    discussionInput.style.height =
      nextHeight + 'px';
    discussionInput.style.overflowY =
      discussionInput.scrollHeight >
        112
        ? 'auto'
        : 'hidden';
  }

  discussionInput?.addEventListener(
    'input',
    resizeDiscussionInput,
  );

  if (discussionInput) {
    createMentionAutocomplete({
      input:
        discussionInput,
      subjectType:
        'geometry',
      loadUsers:
        loadMentionUsers,
    });
  }

  discussionInput?.addEventListener(
    'keydown',
    (event) => {
      if (
        event.defaultPrevented
      ) {
        return;
      }

      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        discussionForm
          ?.requestSubmit();
      }
    },
  );

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

  cutButton.addEventListener(
    'click',
    () => {
      topologyActions.open =
        false;
      void startPolygonCut();
    },
  );
  cutDirectButton.addEventListener(
    'click',
    () =>
      void startPolygonCut(),
  );
  cutSelectedButton.addEventListener(
    'click',
    () => {
      topologyActions.open =
        false;
      void cutWithSelectedGeometry();
    },
  );
  splitButton.addEventListener(
    'click',
    () => {
      topologyActions.open =
        false;
      void startDrawing(
        'split',
      );
    },
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
      refreshCoordinateValidation();
    },
  );
  coordinateClear.addEventListener(
    'click',
    () => {
      coordinateTableBody
        .replaceChildren();
      refreshCoordinateValidation();
      setCoordinateMessage(
        'Таблица очищена. Добавьте строки вручную или вставьте координаты массово.',
      );
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
        refreshCoordinateValidation();
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

  citySearch?.addEventListener(
    'focus',
    () => {
      citySearch.select();
      renderCityPicker();
    },
  );

  citySearch?.addEventListener(
    'click',
    () => {
      renderCityPicker();
    },
  );

  citySearch?.addEventListener(
    'input',
    () => {
      renderCityPicker(
        citySearch.value,
      );
    },
  );

  citySearch?.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCityPicker();
        citySearch.blur();
        return;
      }

      if (event.key !== 'Enter') {
        return;
      }

      const first =
        cityOptionsHost
          ?.querySelector(
            '.geometry-editor-city-option',
          );
      if (!first) return;
      event.preventDefault();
      first.click();
    },
  );

  citySearch?.addEventListener(
    'blur',
    () => {
      window.setTimeout(
        () =>
          closeCityPicker(),
        0,
      );
    },
  );

  citySelect.addEventListener('change', () => {
    if (citySearch) {
      citySearch.value =
        selectedCityLabel();
    }
    state.selectedSet.clear();
    state.bulkSelecting =
      false;
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
        state.bulkSelecting =
          false;
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
  window.addEventListener(
    'dtpstat:point-types-changed',
    () => {
      state.pointTypesLoaded =
        false;
      void ensurePointTypes({
        force: true,
      }).catch(
        (error) =>
          setMessage(
            error.message,
            'error',
          ),
      );
    },
  );

  window.addEventListener(
    'dtpstat:discussion-read-all',
    () => {
      void loadDiscussionState()
        .catch(
          (error) =>
            console.warn(
              'Geometry discussion state refresh failed',
              error,
            ),
        );
    },
  );

  window.addEventListener(
    'dtpstat:discussion-unread-refresh',
    (event) => {
      if (
        event.detail?.subjectType !==
        'geometry'
      ) {
        return;
      }

      const geometryId =
        Number(
          event.detail?.subjectId,
        );
      if (
        !Number.isSafeInteger(
          geometryId,
        ) ||
        geometryId <= 0
      ) {
        return;
      }

      if (
        state.discussionUnreadRefreshTimer !==
        null
      ) {
        window.clearTimeout(
          state.discussionUnreadRefreshTimer,
        );
      }

      const detail = {
        ...event.detail,
      };
      state.discussionUnreadRefreshTimer =
        window.setTimeout(
          () => {
            state.discussionUnreadRefreshTimer =
              null;

            if (
              detail.source ===
                'notification' &&
              discussionIsOpenFor(
                geometryId,
              )
            ) {
              void loadDiscussion(
                geometryId,
              ).catch(
                (error) =>
                  console.warn(
                    'Geometry discussion notification refresh failed',
                    error,
                  ),
              );
              return;
            }

            if (
              discussionIsOpenFor(
                geometryId,
              )
            ) {
              return;
            }

            void loadDiscussionState()
              .catch(
                (error) =>
                  console.warn(
                    'Geometry discussion unread refresh failed',
                    error,
                  ),
              );
          },
          60,
        );
    },
  );

  window.addEventListener(
    'dtpstat:geometry-editor-navigation-pending',
    () => {
      state.pendingTargetNavigation =
        true;
      state.workspaceRequestSequence +=
        1;
    },
  );

  window.addEventListener('dtpstat:geometry-editor-open', () => {
    const tasks = [
      ensurePointTypes(),
      loadDiscussionState(),
    ];

    if (
      !state.pendingTargetNavigation
    ) {
      tasks.push(
        refresh({
          keepSelection: true,
          fit: false,
        }),
      );
    }

    void Promise.all(tasks);
    window.setTimeout(() => state.map?.resize(), 0);
  });

  window.addEventListener(
    'dtpstat:geometry-editor-select',
    (event) => {
      const id =
        Number(
          event.detail?.id,
        );
      if (
        !Number.isSafeInteger(id) ||
        id <= 0
      ) {
        return;
      }

      const cityId =
        event.detail?.cityId;
      const workspace =
        cityId === null ||
        cityId === undefined
          ? '__unlinked__'
          : String(
              Number(cityId),
            );

      void (
        async () => {
          try {
            await ensureMap();

            if (
              citySelect.value !==
              workspace
            ) {
              await loadWorkspace(
                workspace,
                {
                  keepSelection:
                    false,
                  fit: false,
                },
              );
            }

            await selectGeometry(
              id,
              {
                focus: true,
              },
            );

            if (
              event.detail
                ?.openDiscussion
            ) {
              await loadDiscussion(
                id,
                {
                  focusInput:
                    true,
                },
              );
            }
          } catch (error) {
            setMessage(
              'Не удалось открыть геометрию из обсуждения: ' +
                error.message,
              'error',
            );
          } finally {
            state.pendingTargetNavigation =
              false;
          }
        }
      )();
    },
  );

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
      state.bulkSelecting
    ) {
      cancelMergeSelection();
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
        void Promise.all([
          ensurePointTypes(),
          loadDiscussionState(),
          refresh({
            keepSelection: false,
            fit: true,
          }),
        ]),
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
