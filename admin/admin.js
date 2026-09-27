import { copyTextToClipboard } from './admin-clipboard.js';
import { createTaskNotices } from './task-notices.js';
import { adminConfirm } from './admin-dialog.js';
import { trackDirtyForm } from './admin-dirty-state.js';
import { bindHumanUnits } from './admin-human-units.js';
import { readTabState, writeTabState } from './admin-tab-state.js';
import { subscribeAdminRealtime } from './realtime-client.js';

const taskTypeTabs = Object.freeze({
  'osm-city-update': 'osm',
  'city-geojson-import': 'osm',
  'kml-update': 'kml',
  'geojson-import': 'kml',
  'population-update': 'population',
});
const taskTypeOperations = Object.freeze({
  'osm-city-update': 'osm-update',
  'city-geojson-import': 'osm-geojson',
  'kml-update': 'kml-external',
  'geojson-import': 'kml-geojson',
  'population-update': 'population-json',
});
const tabTaskTypes = Object.freeze({
  osm: ['osm-city-update', 'city-geojson-import'],
  kml: ['kml-update', 'geojson-import'],
  population: ['population-update'],
});
const taskNames = Object.freeze({
  osm: 'Города',
  kml: 'Линии данных',
  population: 'Население',
});
const statusLabels = Object.freeze({
  queued: 'в очереди',
  running: 'выполняется',
  cancelling: 'отменяется',
  cancelled: 'отменена',
  succeeded: 'успешно',
  failed: 'ошибка',
});
const statusOrder = Object.freeze({
  queued: 0,
  running: 1,
  cancelling: 2,
  cancelled: 3,
  succeeded: 3,
  failed: 3,
});
const fileImportTaskTypes = new Set([
  'city-geojson-import',
  'geojson-import',
  'population-update',
]);
const state = {
  task: null,
  adminConfig: null,
  osmSettings: null,
  osmCheckpoint: null,
  lastSuccessfulUpdates: {},
  selected: readTabState('data-task', ['osm', 'kml', 'population'], 'osm'),
  selectedOperations: {
    osm: readTabState('data-operation-osm', ['osm-update', 'osm-geojson'], 'osm-update'),
    kml: readTabState('data-operation-kml', ['kml-external', 'kml-geojson'], 'kml-external'),
    population: readTabState('data-operation-population', ['population-json'], 'population-json'),
  },
  transfer: null,
};
const elements = {
  connection: document.querySelector('#connection-state'),
  status: document.querySelector('#task-status'),
  meta: document.querySelector('#task-meta'),
  log: document.querySelector('#task-log'),
  logCount: document.querySelector('#log-count'),
  result: document.querySelector('#task-result'),
  resultPanel: document.querySelector('#result-panel'),
  resultCopy: document.querySelector('#result-copy'),
  notices: [...document.querySelectorAll('[data-task-notice]')],
  refresh: document.querySelector('#refresh-task'),
  tabs: [...document.querySelectorAll('[data-task-tab]')],
  panels: [...document.querySelectorAll('[data-task-panel]')],
  operationTabs: [...document.querySelectorAll('[data-operation-tab]')],
  operationPanels: [...document.querySelectorAll('[data-operation-panel]')],
  forms: [...document.querySelectorAll('[data-task-form]')],
  actions: [...document.querySelectorAll('[data-task-action]')],
  successfulUpdates: [...document.querySelectorAll('[data-last-success]')],
  osmForm: document.querySelector('#osm-form'),
  osmURL: document.querySelector('#osm-url'),
  osmDefaults: document.querySelector('#osm-defaults'),
  osmSettingsSave: document.querySelector('#osm-settings-save'),
  osmCheckpoint: document.querySelector('#osm-checkpoint'),
  osmCheckpointSummary: document.querySelector('#osm-checkpoint-summary'),
  osmResume: document.querySelector('#osm-resume'),
  osmCheckpointDiscard: document.querySelector('#osm-checkpoint-discard'),
  cityGeoJsonForm: document.querySelector('#city-geojson-form'),
  kmlForm: document.querySelector('#kml-form'),
  lineGeoJsonForm: document.querySelector('#line-geojson-form'),
  populationForm: document.querySelector('#population-form'),
};
const taskNotices = createTaskNotices(elements.notices, taskNames);
if (elements.resultCopy) {
  elements.resultCopy.addEventListener('click', () => {
    void copyTaskResult();
  });
}
const transferOverlay = createTransferOverlay();
const osmSettingsDirty = trackDirtyForm(elements.osmForm, {
  label: 'Настройки OSM-загрузки',
});
bindHumanUnits(document);

function formatTransferBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unit]}`;
}

function formatTransferDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded} сек`;
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder === 0
    ? `${minutes} мин`
    : `${minutes} мин ${remainder} сек`;
}

function createTransferOverlay() {
  const root = document.createElement('div');
  root.className = 'admin-transfer-overlay';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'admin-transfer-title');
  root.innerHTML = `
    <section class="admin-transfer-dialog">
      <p class="eyebrow">ИМПОРТ ДАННЫХ</p>
      <h2 id="admin-transfer-title">Выполняется импорт</h2>
      <p class="admin-transfer-file"></p>
      <p class="admin-transfer-phase">Подготовка…</p>
      <div class="admin-transfer-progress-row">
        <progress class="admin-transfer-progress" max="100"></progress>
        <strong class="admin-transfer-percent"></strong>
      </div>
      <p class="admin-transfer-amount"></p>
      <div class="admin-transfer-processing-status" hidden>
        <p class="admin-transfer-json-status"></p>
        <p class="admin-transfer-db-status"></p>
      </div>
      <p class="admin-transfer-detail"></p>
      <button class="danger admin-transfer-cancel" type="button">Отменить</button>
    </section>
  `;
  document.body.append(root);

  const overlay = {
    root,
    file: root.querySelector('.admin-transfer-file'),
    phase: root.querySelector('.admin-transfer-phase'),
    progress: root.querySelector('.admin-transfer-progress'),
    percent: root.querySelector('.admin-transfer-percent'),
    amount: root.querySelector('.admin-transfer-amount'),
    processingStatus: root.querySelector('.admin-transfer-processing-status'),
    jsonStatus: root.querySelector('.admin-transfer-json-status'),
    dbStatus: root.querySelector('.admin-transfer-db-status'),
    detail: root.querySelector('.admin-transfer-detail'),
    cancel: root.querySelector('.admin-transfer-cancel'),
  };

  overlay.cancel.addEventListener('click', () => {
    const transfer = state.transfer;
    if (!transfer || transfer.cancelRequested) return;
    transfer.cancelRequested = true;
    renderTransferOverlay();

    if (transfer.mode === 'upload' && transfer.xhr) {
      transfer.xhr.abort();
      return;
    }
    if (transfer.mode === 'processing' && transfer.taskId) {
      void cancelActiveTask();
    }
  });

  return overlay;
}

function reverseFind(values, predicate) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) return values[index];
  }
  return null;
}

function processingProgress(task) {
  const logs = task?.log ?? [];
  const prepared = logs.find((entry) =>
    entry.message === 'Входной поток подготовлен');
  const commitStarted = logs.some((entry) =>
    entry.message === 'Начата атомарная фиксация изменений');
  const progressEntry = reverseFind(
    logs,
    (entry) => typeof entry.details?.phase === 'string',
  );
  const details = progressEntry?.details ?? {};
  const phase = commitStarted ? 'commit' : details.phase ?? 'accepted';

  let expectedJsonBytes = Number(prepared?.details?.expectedJsonBytes);
  if (!Number.isFinite(expectedJsonBytes) || expectedJsonBytes <= 0) {
    const transport = task?.parameters?.transport;
    if (transport !== 'application/zip') {
      expectedJsonBytes = Number(task?.parameters?.uploadBytes);
    }
  }

  let label = 'Сервер обрабатывает файл…';
  let ratio = null;
  let amount = '';
  let detail = progressEntry?.message ?? '';

  if (phase === 'parse') {
    label = 'Разбор JSON';
    const decodedBytes = Number(details.decodedBytes);
    if (
      Number.isFinite(decodedBytes) &&
      decodedBytes >= 0 &&
      Number.isFinite(expectedJsonBytes) &&
      expectedJsonBytes > 0
    ) {
      ratio = Math.min(1, decodedBytes / expectedJsonBytes);
      amount =
        `${formatTransferBytes(decodedBytes)} / ` +
        formatTransferBytes(expectedJsonBytes);
    }
    if (Number.isFinite(Number(details.items))) {
      detail = `Разобрано записей: ${Number(details.items).toLocaleString('ru-RU')}`;
    }
  } else if (phase === 'parsed') {
    label = 'JSON разобран';
    ratio = 1;
    const decodedBytes = Number(details.decodedBytes);
    if (Number.isFinite(decodedBytes)) {
      amount = formatTransferBytes(decodedBytes);
    }
    if (Number.isFinite(Number(details.items))) {
      detail = `Записей: ${Number(details.items).toLocaleString('ru-RU')}`;
    }
  } else if (phase === 'raw-stage') {
    label = 'Подготовка входных данных';
    if (Number.isFinite(Number(details.features))) {
      detail = `Подготовлен пакет: ${Number(details.features).toLocaleString('ru-RU')} записей`;
    }
  } else if (phase === 'normalize-stage') {
    label = 'Нормализация данных';
    const regionProgress =
      Number.isFinite(Number(details.processedRegions)) &&
      Number.isFinite(Number(details.parsedRegions)) &&
      Number(details.parsedRegions) > 0;
    const processed = regionProgress
      ? Number(details.processedRegions)
      : Number(details.processedFeatures ?? details.staged);
    const total = regionProgress
      ? Number(details.parsedRegions)
      : Number(details.parsedFeatures ?? details.parsedRecords);
    if (
      Number.isFinite(processed) &&
      Number.isFinite(total) &&
      total > 0
    ) {
      ratio = Math.min(1, processed / total);
      amount =
        `${processed.toLocaleString('ru-RU')} / ` +
        total.toLocaleString('ru-RU') +
        (regionProgress ? ' регионов' : '');
    }
    if (regionProgress && Number.isFinite(Number(details.staged))) {
      detail =
        `Городов подготовлено: ` +
        Number(details.staged).toLocaleString('ru-RU');
    } else if (Number.isFinite(Number(details.stagedGeometries))) {
      detail =
        `Геометрий подготовлено: ` +
        Number(details.stagedGeometries).toLocaleString('ru-RU');
    }
  } else if (phase === 'stage-write') {
    label = 'Запись пакета в PostgreSQL/PostGIS';
    const batch = Number(details.batch);
    const batchPlaces = Number(details.batchPlaces);
    const stagedPlaces = Number(details.stagedPlaces);
    if (Number.isFinite(batch)) {
      amount = `Пакет ${batch.toLocaleString('ru-RU')}`;
    }
    const parts = [];
    if (Number.isFinite(batchPlaces)) {
      parts.push(
        `объектов в пакете: ${batchPlaces.toLocaleString('ru-RU')}`,
      );
    }
    if (Number.isFinite(stagedPlaces)) {
      parts.push(
        `уже записано: ${stagedPlaces.toLocaleString('ru-RU')}`,
      );
    }
    detail = parts.length > 0
      ? `Ожидаем PostgreSQL/PostGIS · ${parts.join(' · ')}`
      : 'Ожидаем завершения PostgreSQL/PostGIS.';
  } else if (phase === 'stage') {
    label = 'Подготовка данных в БД';
    const batch = Number(details.batch);
    const batchCount = Number(details.batchCount);
    if (
      Number.isFinite(batch) &&
      Number.isFinite(batchCount) &&
      batchCount > 0
    ) {
      ratio = Math.min(1, batch / batchCount);
      amount = `Пакет ${batch.toLocaleString('ru-RU')} / ${batchCount.toLocaleString('ru-RU')}`;
    } else {
      const staged = Number(details.stagedPlaces);
      const places = Number(details.places);
      if (Number.isFinite(staged) && Number.isFinite(places) && places > 0) {
        ratio = Math.min(1, staged / places);
        amount =
          `${staged.toLocaleString('ru-RU')} / ` +
          places.toLocaleString('ru-RU');
      }
    }
  } else if (phase === 'warnings') {
    label = 'Есть предупреждения';
    const warningCount = Number(details.warningCount);
    const skippedCount = Number(details.skippedCount);
    if (Number.isFinite(warningCount)) {
      amount = `${warningCount.toLocaleString('ru-RU')} предупреждений`;
    }
    if (Number.isFinite(skippedCount)) {
      detail =
        `Пропущено записей: ` +
        skippedCount.toLocaleString('ru-RU') +
        '. Остальные данные будут сохранены.';
    } else {
      detail = 'Остальные корректные данные будут сохранены.';
    }
  } else if (phase === 'validated' || phase === 'validate-stage') {
    label = 'Проверка данных завершена';
    detail = 'Подготавливаются изменения базы данных.';
  } else if (phase === 'cities') {
    label = 'Подготовка городов';
  } else if (phase === 'preserve-links') {
    label = 'Сохранение существующих связей';
  } else if (phase === 'delete-boundaries') {
    label = 'Удаление старых территорий';
    detail = 'Сохраняемые связи уже зафиксированы; удаляется прежний snapshot.';
  } else if (phase === 'insert-boundaries') {
    label = 'Вставка новых территорий';
    const places = Number(details.places);
    detail = Number.isFinite(places)
      ? `Записывается ${places.toLocaleString('ru-RU')} объектов.`
      : 'Записывается новый snapshot территорий.';
  } else if (phase === 'replace-boundaries') {
    label = 'Замена геометрий';
  } else if (phase === 'hierarchy') {
    label = 'Построение иерархии территорий';
    const processed = Number(details.processed);
    const total = Number(details.total);
    const batch = Number(details.batch);
    const batchCount = Number(details.batchCount);
    if (Number.isFinite(processed) && Number.isFinite(total) && total > 0) {
      ratio = Math.min(1, processed / total);
      amount =
        `${processed.toLocaleString('ru-RU')} / ` +
        total.toLocaleString('ru-RU') +
        ' объектов';
    }
    if (
      Number.isFinite(batch) &&
      Number.isFinite(batchCount) &&
      batchCount > 0
    ) {
      detail =
        `Пакет ${batch.toLocaleString('ru-RU')} / ` +
        batchCount.toLocaleString('ru-RU');
    } else {
      detail = 'Поиск непосредственного родителя по геометрическому покрытию.';
    }
  } else if (phase === 'restore-links') {
    label = 'Восстановление связей';
  } else if (phase === 'database') {
    label = 'Изменения базы данных подготовлены';
    detail = 'Ожидается атомарная фиксация транзакции.';
  } else if (phase === 'commit') {
    label = 'Фиксация транзакции';
    detail = 'Отмена на этом этапе уже недоступна.';
  }

  return { label, ratio, amount, detail };
}

function stableProcessingView(task) {
  const logs = task?.log ?? [];
  const prepared = logs.find((entry) =>
    entry.message === 'Входной поток подготовлен');
  const parseEntries = logs.filter((entry) =>
    ['parse', 'parsed'].includes(entry.details?.phase) &&
    Number.isFinite(Number(entry.details?.decodedBytes)));
  const latestParse = parseEntries.at(-1) ?? null;
  const parsed = reverseFind(
    logs,
    (entry) => entry.details?.phase === 'parsed',
  );
  const databaseEntry = reverseFind(
    logs,
    (entry) => ['stage-write', 'stage'].includes(entry.details?.phase),
  );
  const current = processingProgress(task);

  if (!latestParse) {
    return {
      ...current,
      jsonStatus: '',
      databaseStatus: '',
      stableInputProgress: false,
    };
  }

  let expectedJsonBytes = Number(prepared?.details?.expectedJsonBytes);
  if (!Number.isFinite(expectedJsonBytes) || expectedJsonBytes <= 0) {
    const transport = task?.parameters?.transport;
    if (transport !== 'application/zip') {
      expectedJsonBytes = Number(task?.parameters?.uploadBytes);
    }
  }

  let decodedBytes = 0;
  let itemCount = 0;
  for (const entry of parseEntries) {
    decodedBytes = Math.max(
      decodedBytes,
      Number(entry.details?.decodedBytes) || 0,
    );
    const items = Number(entry.details?.items);
    if (Number.isFinite(items)) itemCount = Math.max(itemCount, items);
  }
  const ratio =
    Number.isFinite(expectedJsonBytes) && expectedJsonBytes > 0
      ? Math.min(1, decodedBytes / expectedJsonBytes)
      : (parsed ? 1 : null);
  const amount =
    Number.isFinite(expectedJsonBytes) && expectedJsonBytes > 0
      ? `${formatTransferBytes(decodedBytes)} / ${formatTransferBytes(expectedJsonBytes)}`
      : formatTransferBytes(decodedBytes);

  const jsonStatus = [
    `JSON: ${formatTransferBytes(decodedBytes)}` +
      (Number.isFinite(expectedJsonBytes) && expectedJsonBytes > 0
        ? ` / ${formatTransferBytes(expectedJsonBytes)}`
        : ''),
    itemCount > 0
      ? `${itemCount.toLocaleString('ru-RU')} записей`
      : null,
  ].filter(Boolean).join(' · ');

  let databaseStatus = '';
  if (databaseEntry) {
    const details = databaseEntry.details ?? {};
    const batch = Number(details.batch);
    const staged = Number(details.stagedPlaces);
    const batchPlaces = Number(details.batchPlaces);
    const writing = details.phase === 'stage-write';
    const parts = [
      Number.isFinite(batch)
        ? `пакет ${batch.toLocaleString('ru-RU')}`
        : null,
      writing
        ? 'запись…'
        : 'записан',
      Number.isFinite(staged)
        ? `всего ${staged.toLocaleString('ru-RU')} объектов`
        : null,
      writing && Number.isFinite(batchPlaces)
        ? `в пакете ${batchPlaces.toLocaleString('ru-RU')}`
        : null,
    ].filter(Boolean);
    databaseStatus = `PostgreSQL/PostGIS: ${parts.join(' · ')}`;
  }

  const currentEntry = reverseFind(
    logs,
    (entry) => typeof entry.details?.phase === 'string',
  );
  const currentPhase = currentEntry?.details?.phase;
  if (currentPhase === 'hierarchy') {
    const hierarchy = currentEntry.details ?? {};
    const processed = Number(hierarchy.processed);
    const total = Number(hierarchy.total);
    const batch = Number(hierarchy.batch);
    const batchCount = Number(hierarchy.batchCount);
    const parts = [];
    if (Number.isFinite(processed) && Number.isFinite(total)) {
      parts.push(
        `иерархия ${processed.toLocaleString('ru-RU')} / ` +
        total.toLocaleString('ru-RU'),
      );
    }
    if (Number.isFinite(batch) && Number.isFinite(batchCount)) {
      parts.push(
        `пакет ${batch.toLocaleString('ru-RU')} / ` +
        batchCount.toLocaleString('ru-RU'),
      );
    }
    databaseStatus = `PostgreSQL/PostGIS: ${parts.join(' · ')}`;
  }
  const interleaved = ['parse', 'stage-write', 'stage'].includes(currentPhase);
  const label = parsed
    ? (interleaved ? 'Входной JSON прочитан' : current.label)
    : 'Чтение и подготовка входного JSON';
  const detail = interleaved
    ? 'JSON и staging обрабатываются потоково; индикатор выше показывает только реальный прогресс чтения входного JSON.'
    : current.detail;

  return {
    ...current,
    label,
    ratio,
    amount,
    detail,
    jsonStatus,
    databaseStatus,
    stableInputProgress: true,
  };
}

function showTransferOverlay({ file, taskKey, taskType }) {
  state.transfer = {
    mode: 'upload',
    taskId: null,
    taskKey,
    taskType,
    fileName: file.name,
    loaded: 0,
    total: file.size,
    startedAt: performance.now(),
    speed: 0,
    xhr: null,
    cancelRequested: false,
  };
  syncSessionActivityHold();
  renderTransferOverlay();
}

function hideTransferOverlay() {
  state.transfer = null;
  syncSessionActivityHold();
  transferOverlay.root.hidden = true;
  document.body.classList.remove('admin-transfer-locked');
}

function renderTransferOverlay() {
  const transfer = state.transfer;
  if (!transfer) {
    transferOverlay.root.hidden = true;
    document.body.classList.remove('admin-transfer-locked');
    return;
  }

  transferOverlay.root.hidden = false;
  document.body.classList.add('admin-transfer-locked');
  transferOverlay.file.textContent = transfer.fileName
    ? `Файл: ${transfer.fileName}`
    : 'Файловый импорт';
  transferOverlay.cancel.textContent = transfer.cancelRequested
    ? 'Отмена запрошена…'
    : 'Отменить';

  if (transfer.mode === 'upload') {
    transferOverlay.processingStatus.hidden = true;
    const total = Math.max(0, Number(transfer.total) || 0);
    const loaded = Math.min(total || Number.MAX_SAFE_INTEGER, Number(transfer.loaded) || 0);
    const ratio = total > 0 ? Math.min(1, loaded / total) : null;
    transferOverlay.phase.textContent = 'Загрузка файла на сервер';
    if (ratio === null) {
      transferOverlay.progress.removeAttribute('value');
      transferOverlay.percent.textContent = '';
    } else {
      transferOverlay.progress.value = ratio * 100;
      transferOverlay.percent.textContent = `${Math.floor(ratio * 100)} %`;
    }
    transferOverlay.amount.textContent = total > 0
      ? `${formatTransferBytes(loaded)} / ${formatTransferBytes(total)}`
      : formatTransferBytes(loaded);

    const details = [];
    if (transfer.speed > 0) {
      details.push(`${formatTransferBytes(transfer.speed)}/с`);
      if (total > loaded) {
        const eta = formatTransferDuration((total - loaded) / transfer.speed);
        if (eta) details.push(`осталось ~${eta}`);
      }
    }
    transferOverlay.detail.textContent = details.join(' · ') ||
      'Передача файла…';
    transferOverlay.cancel.disabled = transfer.cancelRequested;
    return;
  }

  if (transfer.mode === 'waiting') {
    transferOverlay.processingStatus.hidden = true;
    transferOverlay.phase.textContent = 'Файл передан';
    transferOverlay.progress.removeAttribute('value');
    transferOverlay.percent.textContent = '';
    transferOverlay.amount.textContent = transfer.total > 0
      ? formatTransferBytes(transfer.total)
      : '';
    transferOverlay.detail.textContent =
      'Сервер завершает приём файла и создаёт задачу импорта…';
    transferOverlay.cancel.disabled = true;
    return;
  }

  const task = state.task?.id === transfer.taskId ? state.task : null;
  const progress = stableProcessingView(task);
  transferOverlay.processingStatus.hidden = !progress.stableInputProgress;
  transferOverlay.jsonStatus.textContent = progress.jsonStatus ?? '';
  transferOverlay.dbStatus.textContent = progress.databaseStatus ?? '';
  transferOverlay.phase.textContent = progress.label;
  if (progress.ratio === null) {
    transferOverlay.progress.removeAttribute('value');
    transferOverlay.percent.textContent = '';
  } else {
    const percent = Math.max(0, Math.min(100, progress.ratio * 100));
    transferOverlay.progress.value = percent;
    transferOverlay.percent.textContent = `${Math.floor(percent)} %`;
  }
  transferOverlay.amount.textContent = progress.amount;
  transferOverlay.detail.textContent = progress.detail ||
    'Импорт выполняется одной транзакцией.';
  transferOverlay.cancel.disabled =
    transfer.cancelRequested ||
    !task ||
    !task.cancellable ||
    task.status === 'cancelling';
}

function syncTransferOverlay(task) {
  if (
    !state.transfer &&
    task &&
    active(task) &&
    fileImportTaskTypes.has(task.type)
  ) {
    state.transfer = {
      mode: 'processing',
      taskId: task.id,
      taskKey: taskTypeTabs[task.type] ?? state.selected,
      taskType: task.type,
      fileName: null,
      loaded: Number(task.parameters?.uploadBytes) || 0,
      total: Number(task.parameters?.uploadBytes) || 0,
      startedAt: performance.now(),
      speed: 0,
      xhr: null,
      cancelRequested: false,
    };
  }

  const transfer = state.transfer;
  if (!transfer || !transfer.taskId || !task || task.id !== transfer.taskId) {
    renderTransferOverlay();
    return;
  }

  if (['failed', 'cancelled', 'succeeded'].includes(task.status)) {
    hideTransferOverlay();
    return;
  }

  transfer.mode = 'processing';
  renderTransferOverlay();
}

function syncSessionActivityHold() {
  window.dtpstatAdminSessionGuard?.setActivityHold?.(
    Boolean(state.transfer) || Boolean(active(state.task)),
  );
}

function active(task) {
  return task && ['queued', 'running', 'cancelling'].includes(task.status);
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function taskResultPayload(task) {
  if (!task) return undefined;
  if (task.error !== undefined) return { error: task.error };
  if (task.result !== undefined) return task.result;
  return undefined;
}

let resultCopyFeedbackTimer = null;

async function copyTaskResult() {
  const payload = taskResultPayload(state.task);
  if (payload === undefined || !elements.resultCopy) return;

  const copied = await copyTextToClipboard(pretty(payload));
  elements.resultCopy.textContent = copied ? 'Скопировано' : 'Не удалось';
  elements.resultCopy.classList.toggle('result-copy-failed', !copied);

  if (resultCopyFeedbackTimer) clearTimeout(resultCopyFeedbackTimer);
  resultCopyFeedbackTimer = setTimeout(() => {
    elements.resultCopy.textContent = 'Копировать';
    elements.resultCopy.classList.remove('result-copy-failed');
    resultCopyFeedbackTimer = null;
  }, 1800);
}

function setNotice(message, tone = 'warning', taskKey = state.selected) {
  taskNotices.set(taskKey, message, tone);
}

function setTaskNotice(taskKey, message, tone = 'warning') {
  if (!taskKey) return;
  taskNotices.setForTask(taskKey, message, tone);
}

function clearTaskStatusForStart(taskKey = state.selected) {
  if (active(state.task)) return false;
  taskNotices.clear(taskKey);
  state.task = null;
  render();
  return true;
}

function selectOperation(operationKey) {
  const selectedTab = elements.operationTabs.find(
    (tab) => tab.dataset.operationTab === operationKey,
  );
  if (!selectedTab) return;
  const group = selectedTab.dataset.operationGroup;
  state.selectedOperations[group] = operationKey;
  writeTabState(`data-operation-${group}`, operationKey);

  for (const tab of elements.operationTabs) {
    if (tab.dataset.operationGroup !== group) continue;
    const selected = tab.dataset.operationTab === operationKey;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of elements.operationPanels) {
    if (panel.dataset.operationGroup !== group) continue;
    panel.hidden = panel.dataset.operationPanel !== operationKey;
  }
}

function selectTab(taskKey) {
  if (!elements.tabs.some((tab) => tab.dataset.taskTab === taskKey)) return;
  state.selected = taskKey;
  writeTabState('data-task', taskKey);
  for (const tab of elements.tabs) {
    const selected = tab.dataset.taskTab === taskKey;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of elements.panels) {
    panel.hidden = panel.dataset.taskPanel !== taskKey;
  }
  const operation = state.selectedOperations[taskKey];
  if (operation) selectOperation(operation);
}

function metaItem(label, value, wide = false) {
  const wrapper = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  if (wide) wrapper.classList.add('meta-wide');
  term.textContent = label;
  description.textContent = value ?? '—';
  wrapper.append(term, description);
  return wrapper;
}

function renderLog(log) {
  elements.log.replaceChildren();
  elements.logCount.textContent = `${log.length} записей`;
  if (log.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = state.task
      ? 'Журнал пока пуст.'
      : 'Задача ещё не запускалась.';
    elements.log.append(empty);
    return;
  }

  for (const entry of log) {
    const item = document.createElement('article');
    const header = document.createElement('div');
    const timestamp = document.createElement('span');
    const level = document.createElement('span');
    const message = document.createElement('p');
    const normalizedLevel = ['info', 'warning', 'error'].includes(entry.level)
      ? entry.level
      : 'info';
    item.className = `log-entry log-entry-${normalizedLevel}`;
    header.className = 'log-entry-header';
    timestamp.textContent = entry.timestamp;
    level.textContent = normalizedLevel.toUpperCase();
    message.textContent = entry.message;
    header.append(timestamp, level);
    item.append(header, message);
    if (entry.details !== undefined) {
      const details = document.createElement('pre');
      details.className = 'log-details';
      details.textContent = pretty(entry.details);
      item.append(details);
    }
    elements.log.append(item);
  }
  elements.log.scrollTop = elements.log.scrollHeight;
}

function renderResult(task) {
  elements.resultPanel.className = 'result-panel';
  elements.resultPanel.open = false;

  const payload = taskResultPayload(task);
  if (elements.resultCopy) {
    elements.resultCopy.hidden = payload === undefined;
    elements.resultCopy.textContent = 'Копировать';
    elements.resultCopy.classList.remove('result-copy-failed');
    elements.resultCopy.setAttribute(
      'aria-label',
      task?.error !== undefined
        ? 'Копировать JSON ошибки'
        : 'Копировать JSON результата',
    );
  }

  if (payload === undefined) {
    elements.result.textContent = '—';
    return;
  }

  if (task.error !== undefined) {
    elements.resultPanel.classList.add('result-error');
  } else {
    elements.resultPanel.classList.add(
      task.result?.partial ? 'result-warning' : 'result-success',
    );
  }
  elements.resultPanel.open = true;
  elements.result.textContent = pretty(payload);
}

function setFormTaskLock(form, locked) {
  for (const control of form.elements) {
    if (control.matches('[data-task-action]')) continue;
    if (locked) {
      if (control.dataset.taskLockWasDisabled === undefined) {
        control.dataset.taskLockWasDisabled = String(control.disabled);
      }
      control.disabled = true;
      continue;
    }
    if (control.dataset.taskLockWasDisabled !== undefined) {
      control.disabled = control.dataset.taskLockWasDisabled === 'true';
      delete control.dataset.taskLockWasDisabled;
    }
  }
}

function renderControls(task) {
  const locked = Boolean(active(task));
  const activeTab = locked ? taskTypeTabs[task.type] : null;
  const activeOperation = locked ? taskTypeOperations[task.type] : null;
  if (activeTab) {
    selectTab(activeTab);
    if (activeOperation) selectOperation(activeOperation);
  } else {
    selectTab(state.selected);
  }

  for (const tab of [...elements.tabs, ...elements.operationTabs]) {
    tab.disabled = locked;
    tab.setAttribute('aria-disabled', String(locked));
  }
  for (const form of elements.forms) setFormTaskLock(form, locked);
  for (const action of elements.actions) {
    const ownsActiveTask = locked && action.dataset.taskType === task?.type;
    action.textContent = action.dataset.startLabel;
    action.classList.toggle('danger', ownsActiveTask);
    if (ownsActiveTask) {
      action.textContent = task.status === 'cancelling'
        ? 'Отмена запрошена…'
        : 'Отменить операцию';
      action.disabled = !task.cancellable || task.status === 'cancelling';
    } else {
      action.disabled = locked;
    }
  }
}

function latestSuccessfulUpdate(key) {
  const direct = state.lastSuccessfulUpdates[key];
  if (direct) return direct;
  const updates = (tabTaskTypes[key] ?? [])
    .map((taskType) => state.lastSuccessfulUpdates[taskType])
    .filter(Boolean);
  updates.sort((left, right) =>
    Date.parse(right.completedAt) - Date.parse(left.completedAt));
  return updates[0] ?? null;
}

function renderOsmCheckpoint() {
  const checkpoint = state.osmCheckpoint;
  if (!elements.osmCheckpoint) return;

  elements.osmCheckpoint.hidden = !checkpoint;
  const startButton = elements.osmForm.querySelector(
    '[data-task-type="osm-city-update"]',
  );
  if (startButton) {
    startButton.dataset.startLabel = checkpoint
      ? 'Запустить OSM заново'
      : 'Запустить OSM';
    if (!active(state.task)) {
      startButton.textContent = startButton.dataset.startLabel;
    }
  }

  if (!checkpoint) return;

  const percent = checkpoint.totalObjects > 0
    ? Math.floor(checkpoint.stagedObjects * 100 / checkpoint.totalObjects)
    : 0;
  const checkpointStatusLabels = {
    downloading: 'загрузка прервана/может быть продолжена',
    failed: 'последняя попытка завершилась ошибкой',
    cancelled: 'последняя попытка отменена',
    ready: 'все геометрии загружены, можно применить',
  };
  const updatedAt = checkpoint.updatedAt
    ? new Date(checkpoint.updatedAt).toLocaleString('ru-RU')
    : '—';
  elements.osmCheckpointSummary.textContent =
    checkpoint.stagedObjects + ' из ' + checkpoint.totalObjects +
    ' объектов (' + percent + '%), осталось ' +
    checkpoint.remainingObjects + '. Статус: ' +
    (checkpointStatusLabels[checkpoint.status] ?? checkpoint.status) +
    '. Обновлён: ' + updatedAt + '.';

  const locked = Boolean(active(state.task));
  elements.osmResume.disabled = locked;
  elements.osmCheckpointDiscard.disabled = locked;
}

async function loadOsmCheckpoint() {
  const payload = await api('/api/admin/osm-checkpoint');
  state.osmCheckpoint = payload.checkpoint ?? null;
  renderOsmCheckpoint();
  return state.osmCheckpoint;
}

function renderSuccessfulUpdates() {
  for (const element of elements.successfulUpdates) {
    const update = latestSuccessfulUpdate(element.dataset.lastSuccess);
    const time = element.querySelector('time');
    element.classList.toggle('has-success', Boolean(update));
    if (!update) {
      time.removeAttribute('datetime');
      time.textContent = 'ещё не выполнялось';
      continue;
    }
    const completedAt = new Date(update.completedAt);
    time.dateTime = update.completedAt;
    time.textContent = completedAt.toLocaleString('ru-RU');
  }
}

function render() {
  const task = state.task;
  elements.meta.replaceChildren();
  if (!task) {
    elements.status.className = 'status status-idle';
    elements.status.textContent = 'нет задачи';
  } else {
    const partial =
      task.status === 'succeeded' &&
      Boolean(task.result?.partial);
    elements.status.className = partial
      ? 'status status-partial'
      : `status status-${task.status}`;
    elements.status.textContent = partial
      ? 'с предупреждениями'
      : (statusLabels[task.status] ?? task.status);
    elements.meta.append(
      metaItem('ID', task.id, true),
      metaItem('Тип', task.type),
      metaItem('Создана', task.createdAt),
      metaItem('Запущена', task.startedAt),
      metaItem('Завершена', task.completedAt),
      metaItem('Параметры', pretty(task.parameters), true),
    );
  }
  renderLog(task?.log ?? []);
  renderResult(task);
  renderControls(task);
  renderSuccessfulUpdates();
  renderOsmCheckpoint();
  syncTransferOverlay(task);
  syncSessionActivityHold();
}

function applyTask(task, announce = false) {
  const current = state.task;
  if (!task && active(current)) return;
  if (task && current?.id === task.id) {
    const currentOrder = statusOrder[current.status] ?? -1;
    const nextOrder = statusOrder[task.status] ?? -1;
    const currentLogSize = current.log?.length ?? 0;
    const nextLogSize = task.log?.length ?? 0;
    if (
      nextOrder < currentOrder ||
      (nextOrder === currentOrder && nextLogSize < currentLogSize)
    ) return;
  }
  const previousStatus = state.task?.status;
  state.task = task;
  if (announce && task && task.status !== previousStatus) {
    const taskKey = taskTypeTabs[task.type];
    if (task.status === 'succeeded') {
      if (task.result?.partial) {
        const skipped = Number(task.result.skippedCount ?? 0);
        const suffix = Number.isFinite(skipped) && skipped > 0
          ? ` Пропущено записей: ${skipped.toLocaleString('ru-RU')}.`
          : '';
        setTaskNotice(
          taskKey,
          `операция завершена с предупреждениями.${suffix}`,
          'warning',
        );
      } else {
        setTaskNotice(taskKey, 'операция завершена успешно.', 'success');
      }
    } else if (task.status === 'failed') {
      setTaskNotice(taskKey, 'операция завершилась с ошибкой.', 'error');
    } else if (task.status === 'cancelled') {
      setTaskNotice(taskKey, 'операция отменена.', 'warning');
    }
  }
  render();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { Accept: 'application/json', ...(options.headers ?? {}) },
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* empty response */ }
  if (!response.ok) {
    const error = new Error(payload?.error ?? `HTTP ${response.status}`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

function portableFileContentType(file, jsonContentType) {
  const zip =
    file.type === 'application/zip' ||
    file.name.toLocaleLowerCase('en-US').endsWith('.zip');
  return zip ? 'application/zip' : jsonContentType;
}

function parseXhrPayload(xhr) {
  if (!xhr.responseText) return null;
  try {
    return JSON.parse(xhr.responseText);
  } catch {
    return null;
  }
}

async function uploadPortableFile(
  path,
  file,
  jsonContentType,
  taskKey,
  taskType,
) {
  clearTaskStatusForStart(taskKey);
  showTransferOverlay({ file, taskKey, taskType });

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    state.transfer.xhr = xhr;
    xhr.open('POST', path);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader(
      'Content-Type',
      portableFileContentType(file, jsonContentType),
    );

    xhr.upload.addEventListener('progress', (event) => {
      const transfer = state.transfer;
      if (!transfer || transfer.xhr !== xhr) return;
      transfer.loaded = event.loaded;
      transfer.total = event.lengthComputable && event.total > 0
        ? event.total
        : file.size;
      const elapsedSeconds = Math.max(
        0.001,
        (performance.now() - transfer.startedAt) / 1000,
      );
      transfer.speed = event.loaded / elapsedSeconds;
      renderTransferOverlay();
    });

    xhr.upload.addEventListener('load', () => {
      const transfer = state.transfer;
      if (!transfer || transfer.xhr !== xhr) return;
      transfer.loaded = transfer.total || file.size;
      transfer.mode = 'waiting';
      renderTransferOverlay();
    });

    xhr.addEventListener('load', () => {
      void (async () => {
        const payload = parseXhrPayload(xhr);
        if (xhr.status >= 200 && xhr.status < 300 && payload?.task) {
          const transfer = state.transfer;
          if (!transfer || transfer.xhr !== xhr) {
            resolve(payload);
            return;
          }
          transfer.xhr = null;
          transfer.taskId = payload.task.id;
          transfer.mode = 'processing';
          applyTask(payload.task);
          syncTransferOverlay(
            state.task?.id === payload.task.id ? state.task : payload.task,
          );
          const acceptedTaskKey = taskTypeTabs[payload.task.type] ?? taskKey;
          setTaskNotice(
            acceptedTaskKey,
            `задача ${payload.taskId} принята.`,
            'success',
          );
          resolve(payload);
          return;
        }

        hideTransferOverlay();
        const errorMessage = payload?.error ?? `HTTP ${xhr.status || 0}`;
        if (payload?.taskId) {
          await refresh({ quiet: true });
          const activeTaskKey = taskTypeTabs[state.task?.type] ?? taskKey;
          setTaskNotice(
            activeTaskKey,
            `уже выполняется задача ${payload.taskId}.`,
            'error',
          );
        } else {
          setTaskNotice(taskKey, errorMessage, 'error');
        }
        resolve(null);
      })();
    });

    xhr.addEventListener('error', () => {
      hideTransferOverlay();
      setTaskNotice(taskKey, 'ошибка сети при загрузке файла.', 'error');
      resolve(null);
    });

    xhr.addEventListener('abort', () => {
      hideTransferOverlay();
      setTaskNotice(taskKey, 'загрузка файла отменена.', 'warning');
      resolve(null);
    });

    xhr.send(file);
  });
}

async function encodedJsonBody(text, contentType) {
  const headers = { 'Content-Type': contentType };
  if (text.length < 1024 || typeof CompressionStream !== 'function') {
    return { headers, body: text };
  }
  try {
    const source = new Blob([text], { type: contentType });
    const compressedStream = source.stream().pipeThrough(new CompressionStream('gzip'));
    const body = await new Response(compressedStream).blob();
    headers['Content-Encoding'] = 'gzip';
    return { headers, body };
  } catch {
    return { headers, body: text };
  }
}

function applyNumericDefault(form, name, value, limits) {
  const input = form.elements.namedItem(name);
  if (!(input instanceof HTMLInputElement)) return;
  input.value = String(value);
  input.placeholder = `из ENV: ${value}`;
  input.min = String(limits.min);
  input.max = String(limits.max);
}

function populateOsmURLs(config) {
  const current = config.settings.sourceURL;
  const options = config.allowedURLs.map((URL) => {
    const option = document.createElement('option');
    option.value = URL;
    option.textContent = URL;
    option.selected = URL === current;
    return option;
  });
  if (!options.some((option) => option.value === current)) {
    const option = document.createElement('option');
    option.value = current;
    option.textContent = current;
    option.selected = true;
    options.unshift(option);
  }
  elements.osmURL.replaceChildren(...options);
}

function applyOsmSettings(config) {
  if (!config?.settings) return;
  state.osmSettings = config;
  populateOsmURLs(config);
  const settings = config.settings;
  const form = elements.osmForm;

  for (const name of ['includeCity', 'includeTown', 'includeAdministrative']) {
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLInputElement) input.checked = Boolean(settings[name]);
  }
  for (const name of [
    'adminLevelMin',
    'adminLevelMax',
    'batchSize',
    'minDelayMs',
    'timeoutMs',
    'queryTimeoutSeconds',
    'maxResponseBytes',
    'maxTotalBytes',
    'maxRetries',
    'retryBaseDelayMs',
    'retryMaxDelayMs',
  ]) {
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLInputElement) input.value = String(settings[name]);
  }

  const limits = config.limits ?? {};
  const maxByName = {
    batchSize: limits.maxBatchSize,
    timeoutMs: limits.timeoutMs,
    queryTimeoutSeconds: limits.queryTimeoutSeconds,
    maxResponseBytes: limits.maxResponseBytes,
    maxTotalBytes: limits.maxTotalBytes,
    maxRetries: limits.maxRetries,
  };
  for (const [name, maximum] of Object.entries(maxByName)) {
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLInputElement && Number.isFinite(maximum)) {
      input.max = String(maximum);
    }
  }
  bindHumanUnits(form);
  osmSettingsDirty?.markClean();
}

function osmSettingsPayload(form = elements.osmForm) {
  const data = new FormData(form);
  const number = (name) => Number(data.get(name));
  return {
    sourceURL: String(data.get('URL')).trim(),
    includeCity: data.get('includeCity') === 'on',
    includeTown: data.get('includeTown') === 'on',
    includeAdministrative: data.get('includeAdministrative') === 'on',
    adminLevelMin: number('adminLevelMin'),
    adminLevelMax: number('adminLevelMax'),
    batchSize: number('batchSize'),
    minDelayMs: number('minDelayMs'),
    timeoutMs: number('timeoutMs'),
    queryTimeoutSeconds: number('queryTimeoutSeconds'),
    maxResponseBytes: number('maxResponseBytes'),
    maxTotalBytes: number('maxTotalBytes'),
    maxRetries: number('maxRetries'),
    retryBaseDelayMs: number('retryBaseDelayMs'),
    retryMaxDelayMs: number('retryMaxDelayMs'),
  };
}

function validateOsmForm(form) {
  if (!form.reportValidity()) return false;
  const settings = osmSettingsPayload(form);
  if (!settings.includeCity && !settings.includeTown && !settings.includeAdministrative) {
    setTaskNotice('osm', 'выберите хотя бы один класс OSM-объектов.', 'error');
    return false;
  }
  if (settings.adminLevelMin > settings.adminLevelMax) {
    setTaskNotice('osm', 'минимальный admin_level не может превышать максимальный.', 'error');
    return false;
  }
  if (settings.retryBaseDelayMs > settings.retryMaxDelayMs) {
    setTaskNotice(
      'osm',
      'начальная пауза повтора не может превышать предел backoff.',
      'error',
    );
    return false;
  }
  if (settings.maxResponseBytes > settings.maxTotalBytes) {
    setTaskNotice(
      'osm',
      'лимит одного ответа не может превышать общий лимит загрузки.',
      'error',
    );
    return false;
  }
  return true;
}

async function saveOsmSettings({ announce = true } = {}) {
  if (!validateOsmForm(elements.osmForm)) return false;
  const payload = await api('/api/admin/osm-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(osmSettingsPayload()),
  });
  state.osmSettings = { ...state.osmSettings, settings: payload.settings };
  applyOsmSettings(state.osmSettings);
  if (announce) {
    setTaskNotice('osm', 'настройки OSM-загрузки сохранены.', 'success');
  }
  return true;
}

async function loadAdminConfig({ announce = false } = {}) {
  try {
    const [adminConfig, osmSettings] = await Promise.all([
      api('/api/admin/config'),
      api('/api/admin/osm-settings'),
    ]);
    state.adminConfig = adminConfig;
    applyOsmSettings(osmSettings);
    const kml = state.adminConfig.kmlUpdate;
    applyNumericDefault(
      elements.kmlForm,
      'cityBufferMeters',
      kml.defaults.cityBufferMeters,
      kml.limits.cityBufferMeters,
    );
    if (announce) setTaskNotice('osm', 'сохранённые настройки загружены.', 'success');
  } catch (error) {
    setTaskNotice('osm', `не удалось загрузить настройки: ${error.message}`, 'error');
  }
}

async function refresh({ quiet = false } = {}) {
  try {
    const [payload, checkpointPayload] = await Promise.all([
      api('/api/admin/status'),
      api('/api/admin/osm-checkpoint'),
    ]);
    state.lastSuccessfulUpdates = payload.lastSuccessfulUpdates ?? {};
    state.osmCheckpoint = checkpointPayload.checkpoint ?? null;
    applyTask(payload.task);
    renderOsmCheckpoint();
    if (!quiet) setNotice('Статус обновлён.', 'success');
  } catch (error) {
    if (error.message === 'Admin task not found') {
      applyTask(null);
      if (!quiet) setNotice('Активных и завершённых задач нет.', 'warning');
    } else {
      setNotice(error.message, 'error');
    }
  }
}

async function start(path, options, taskKey = state.selected) {
  clearTaskStatusForStart(taskKey);
  try {
    const payload = await api(path, { method: 'POST', ...options });
    applyTask(payload.task);
    const acceptedTaskKey = taskTypeTabs[payload.task.type] ?? taskKey;
    setTaskNotice(acceptedTaskKey, `задача ${payload.taskId} принята.`, 'success');
  } catch (error) {
    if (error.payload?.taskId) {
      await refresh({ quiet: true });
      const activeTaskKey = taskTypeTabs[state.task?.type] ?? taskKey;
      setTaskNotice(
        activeTaskKey,
        `уже выполняется задача ${error.payload.taskId}.`,
        'error',
      );
      return;
    }
    setTaskNotice(taskKey, error.message, 'error');
  }
}

async function cancelActiveTask() {
  if (!active(state.task)) return false;
  const taskKey = taskTypeTabs[state.task.type] ?? state.selected;
  try {
    await api(`/api/admin/cancel/${encodeURIComponent(state.task.id)}`, {
      method: 'POST',
    });
    setTaskNotice(taskKey, 'запрос на отмену принят.', 'warning');
    await refresh({ quiet: true });
    if (state.task?.status === 'cancelled') {
      setTaskNotice(taskKey, 'операция отменена.', 'warning');
    }
  } catch (error) {
    setTaskNotice(taskKey, error.message, 'error');
  }
  return true;
}

async function importGeoJsonFile(form, endpoint, taskKey, query = '') {
  if (await cancelActiveTask()) return;
  if (!form.reportValidity()) return;
  const file = new FormData(form).get('file');
  if (!(file instanceof File) || file.size === 0) return;
  await uploadPortableFile(
    `${endpoint}${query}`,
    file,
    'application/geo+json',
    taskKey,
    form.dataset.taskType,
  );
}

for (const tab of elements.tabs) {
  tab.addEventListener('click', () => {
    if (active(state.task)) return;
    selectTab(tab.dataset.taskTab);
  });
}

for (const tab of elements.operationTabs) {
  tab.addEventListener('click', () => {
    if (active(state.task)) return;
    selectOperation(tab.dataset.operationTab);
  });
}

elements.osmForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (await cancelActiveTask()) return;
  if (!validateOsmForm(form)) return;

  const dryRun = new FormData(form).get('dryRun') === 'on';
  const restart = Boolean(state.osmCheckpoint);
  if (restart) {
    const checkpoint = state.osmCheckpoint;
    const confirmed = await adminConfirm({
      title: 'Начать OSM-загрузку заново?',
      message:
        'Есть сохранённый прогресс OSM: ' +
        checkpoint.stagedObjects + '/' + checkpoint.totalObjects +
        ' объектов. Старый checkpoint будет удалён только после успешного ' +
        'получения нового OSM-индекса.',
      confirmLabel: 'Начать заново',
      cancelLabel: 'Оставить checkpoint',
      destructive: true,
    });
    if (!confirmed) return;
  }

  try {
    if (!await saveOsmSettings({ announce: false })) return;
    const query = new URLSearchParams({
      dryRun: String(dryRun),
      restart: String(restart),
    });
    await start(
      `/api/admin/update/cities?${query}`,
      {},
      'osm',
    );
  } catch (error) {
    setTaskNotice('osm', error.message, 'error');
  }
});

elements.osmDefaults.addEventListener('click', () => {
  void loadAdminConfig({ announce: true });
});

elements.osmSettingsSave?.addEventListener('click', () => {
  void saveOsmSettings().catch((error) => {
    setTaskNotice('osm', error.message, 'error');
  });
});

elements.osmResume?.addEventListener('click', async () => {
  if (active(state.task) || !state.osmCheckpoint) return;
  if (!validateOsmForm(elements.osmForm)) return;
  const dryRun = new FormData(elements.osmForm).get('dryRun') === 'on';
  try {
    if (!await saveOsmSettings({ announce: false })) return;
    const query = new URLSearchParams({
      dryRun: String(dryRun),
      resume: 'true',
    });
    await start(
      `/api/admin/update/cities?${query}`,
      {},
      'osm',
    );
  } catch (error) {
    setTaskNotice('osm', error.message, 'error');
  }
});

elements.osmCheckpointDiscard?.addEventListener('click', async () => {
  const checkpoint = state.osmCheckpoint;
  if (active(state.task) || !checkpoint) return;
  const confirmed = await adminConfirm({
    title: 'Удалить сохранённый прогресс?',
    message:
      'OSM checkpoint: ' + checkpoint.stagedObjects + '/' +
      checkpoint.totalObjects +
      ' объектов. Возобновить эту загрузку после удаления будет невозможно.',
    confirmLabel: 'Удалить checkpoint',
    cancelLabel: 'Отмена',
    destructive: true,
  });
  if (!confirmed) return;
  try {
    await api('/api/admin/osm-checkpoint', { method: 'DELETE' });
    state.osmCheckpoint = null;
    renderOsmCheckpoint();
    setTaskNotice('osm', 'сохранённый прогресс удалён.', 'warning');
  } catch (error) {
    setTaskNotice('osm', error.message, 'error');
  }
});

elements.cityGeoJsonForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const query = new URLSearchParams({
    dryRun: String(data.get('dryRun') === 'on'),
  });
  await importGeoJsonFile(form, '/api/admin/import/cities', 'osm', `?${query}`);
});

elements.kmlForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (await cancelActiveTask()) return;
  const data = new FormData(form);
  if (!form.reportValidity()) return;
  const query = new URLSearchParams({
    dryRun: String(data.get('dryRun') === 'on'),
  });
  const cityBufferMeters = String(data.get('cityBufferMeters')).trim();
  if (cityBufferMeters) query.set('cityBufferMeters', cityBufferMeters);
  const sources = String(data.get('sources')).trim();
  let options = {};
  if (sources) {
    let normalized;
    try { normalized = JSON.stringify(JSON.parse(sources)); }
    catch { setTaskNotice('kml', 'некорректный JSON источников.', 'error'); return; }
    options = await encodedJsonBody(normalized, 'application/json');
  }
  await start(`/api/admin/update?${query}`, options, 'kml');
});

elements.lineGeoJsonForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await importGeoJsonFile(event.currentTarget, '/api/admin/import/lines', 'kml');
});

elements.populationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (await cancelActiveTask()) return;
  const data = new FormData(form);
  const file = data.get('file');

  if (file instanceof File && file.size > 0) {
    await uploadPortableFile(
      '/api/admin/populations',
      file,
      'application/json',
      'population',
      'population-update',
    );
    return;
  }

  const raw = String(data.get('payload') ?? '').trim();
  if (!raw) {
    setTaskNotice('population', 'выберите JSON/ZIP-файл или вставьте JSON.', 'error');
    return;
  }
  try { JSON.parse(raw); }
  catch { setTaskNotice('population', 'некорректный JSON.', 'error'); return; }
  await start(
    '/api/admin/populations',
    {
      headers: { 'Content-Type': 'application/json' },
      body: raw,
    },
    'population',
  );
});

elements.refresh.addEventListener('click', () => refresh());

function handleRealtimeMessage(message) {
  if (
    message.type === 'snapshot' ||
    message.type === 'task'
  ) {
    if (
      message.lastSuccessfulUpdates
    ) {
      state.lastSuccessfulUpdates =
        message.lastSuccessfulUpdates;
    }
    applyTask(
      message.task,
      true,
    );
    if (
      message.task &&
      [
        'failed',
        'cancelled',
        'succeeded',
      ].includes(
        message.task.status,
      )
    ) {
      void loadOsmCheckpoint()
        .catch((error) => {
          setTaskNotice(
            'osm',
            error.message,
            'error',
          );
        });
    }
    return;
  }

  if (
    message.type === 'success'
  ) {
    state.lastSuccessfulUpdates = {
      ...state
        .lastSuccessfulUpdates,
      [message.update.taskType]:
        message.update,
    };
    renderSuccessfulUpdates();
    return;
  }

  if (
    message.type === 'log' &&
    state.task?.id ===
      message.taskId
  ) {
    const log =
      state.task.log ?? [];
    if (
      !log.some(
        (entry) =>
          entry.sequence ===
          message.entry.sequence,
      )
    ) {
      applyTask({
        ...state.task,
        log: [
          ...log,
          message.entry,
        ],
      });
    }
  }
}
selectTab(state.selected);
await loadAdminConfig();
await refresh({ quiet: true });
subscribeAdminRealtime(
  handleRealtimeMessage,
);