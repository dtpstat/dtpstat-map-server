import { createTaskNotices } from './task-notices.js';

const taskTypeTabs = Object.freeze({
  'osm-city-update': 'osm',
  'kml-update': 'kml',
  'geojson-import': 'geojson',
  'population-update': 'population',
});
const tabTaskTypes = Object.freeze(
  Object.fromEntries(
    Object.entries(taskTypeTabs).map(([taskType, tab]) => [tab, taskType]),
  ),
);
const taskNames = Object.freeze({
  osm: 'Города OSM',
  kml: 'Линии KML',
  geojson: 'GeoJSON',
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
const state = {
  task: null,
  lastSuccessfulUpdates: {},
  selected: 'osm',
  socket: null,
  reconnectTimer: null,
};
const elements = {
  connection: document.querySelector('#connection-state'),
  status: document.querySelector('#task-status'),
  meta: document.querySelector('#task-meta'),
  log: document.querySelector('#task-log'),
  logCount: document.querySelector('#log-count'),
  result: document.querySelector('#task-result'),
  resultPanel: document.querySelector('#result-panel'),
  notices: [...document.querySelectorAll('[data-task-notice]')],
  refresh: document.querySelector('#refresh-task'),
  tabs: [...document.querySelectorAll('[data-task-tab]')],
  panels: [...document.querySelectorAll('[data-task-panel]')],
  forms: [...document.querySelectorAll('[data-task-form]')],
  actions: [...document.querySelectorAll('[data-task-action]')],
  successfulUpdates: [...document.querySelectorAll('[data-last-success]')],
};
const taskNotices = createTaskNotices(elements.notices, taskNames);

function active(task) {
  return task && ['queued', 'running', 'cancelling'].includes(task.status);
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function setNotice(message, tone = 'warning', taskKey = state.selected) {
  taskNotices.set(taskKey, message, tone);
}

function setTaskNotice(taskKey, message, tone = 'warning') {
  taskNotices.setForTask(taskKey, message, tone);
}

function selectTab(taskKey) {
  if (!elements.tabs.some((tab) => tab.dataset.taskTab === taskKey)) return;
  state.selected = taskKey;
  for (const tab of elements.tabs) {
    const selected = tab.dataset.taskTab === taskKey;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of elements.panels) {
    panel.hidden = panel.dataset.taskPanel !== taskKey;
  }
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
  if (!task) {
    elements.result.textContent = '—';
    return;
  }
  if (task.error !== undefined) {
    elements.resultPanel.classList.add('result-error');
    elements.resultPanel.open = true;
    elements.result.textContent = pretty({ error: task.error });
  } else if (task.result !== undefined) {
    elements.resultPanel.classList.add('result-success');
    elements.resultPanel.open = true;
    elements.result.textContent = pretty(task.result);
  } else {
    elements.result.textContent = '—';
  }
}

function renderControls(task) {
  const locked = Boolean(active(task));
  const activeTab = locked ? taskTypeTabs[task.type] : null;
  if (activeTab) selectTab(activeTab);
  else selectTab(state.selected);

  for (const tab of elements.tabs) {
    tab.disabled = locked;
    tab.setAttribute('aria-disabled', String(locked));
  }
  for (const form of elements.forms) {
    for (const control of form.elements) {
      if (!control.matches('[data-task-action]')) control.disabled = locked;
    }
  }
  for (const action of elements.actions) {
    const ownsActiveTask = locked && action.dataset.taskAction === state.selected;
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

function renderSuccessfulUpdates() {
  for (const element of elements.successfulUpdates) {
    const taskType = tabTaskTypes[element.dataset.lastSuccess];
    const update = state.lastSuccessfulUpdates[taskType];
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
    elements.status.className = `status status-${task.status}`;
    elements.status.textContent = statusLabels[task.status] ?? task.status;
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
      setTaskNotice(taskKey, 'операция завершена успешно.', 'success');
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

async function refresh({ quiet = false } = {}) {
  try {
    const payload = await api('/api/admin/status');
    state.lastSuccessfulUpdates = payload.lastSuccessfulUpdates ?? {};
    applyTask(payload.task);
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

for (const tab of elements.tabs) {
  tab.addEventListener('click', () => {
    if (active(state.task)) return;
    selectTab(tab.dataset.taskTab);
  });
}

document.querySelector('#osm-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (await cancelActiveTask()) return;
  const data = new FormData(form);
  const query = new URLSearchParams({
    dryRun: String(data.get('dryRun') === 'on'),
    batchSize: String(data.get('batchSize')),
  });
  const URL = String(data.get('URL')).trim();
  const options = URL
    ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ URL }) }
    : {};
  await start(`/api/admin/update/cities?${query}`, options, 'osm');
});

document.querySelector('#kml-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (await cancelActiveTask()) return;
  const data = new FormData(form);
  const query = new URLSearchParams({
    dryRun: String(data.get('dryRun') === 'on'),
    cityBufferMeters: String(data.get('cityBufferMeters')),
  });
  const sources = String(data.get('sources')).trim();
  let body;
  if (sources) {
    try { body = JSON.stringify(JSON.parse(sources)); }
    catch { setTaskNotice('kml', 'некорректный JSON источников.', 'error'); return; }
  }
  await start(`/api/admin/update?${query}`, body
    ? { headers: { 'Content-Type': 'application/json' }, body }
    : {}, 'kml');
});

document.querySelector('#geojson-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (await cancelActiveTask()) return;
  const file = new FormData(form).get('file');
  if (!(file instanceof File) || file.size === 0) return;
  await start('/api/admin/import', {
    headers: { 'Content-Type': 'application/geo+json' },
    body: await file.text(),
  }, 'geojson');
});

document.querySelector('#population-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (await cancelActiveTask()) return;
  const raw = String(new FormData(form).get('payload')).trim();
  try { JSON.parse(raw); }
  catch { setTaskNotice('population', 'некорректный JSON.', 'error'); return; }
  await start('/api/admin/populations', {
    headers: { 'Content-Type': 'application/json' },
    body: raw,
  }, 'population');
});

elements.refresh.addEventListener('click', () => refresh());

function setConnection(status, text) {
  elements.connection.className = `connection connection-${status}`;
  elements.connection.textContent = text;
}

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/api/admin/ws`);
  state.socket = socket;
  socket.addEventListener('open', () => {
    setConnection('online', 'WebSocket: подключён');
    void refresh({ quiet: true });
  });
  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'snapshot' || message.type === 'task') {
        if (message.lastSuccessfulUpdates) {
          state.lastSuccessfulUpdates = message.lastSuccessfulUpdates;
        }
        applyTask(message.task, true);
      } else if (message.type === 'success') {
        state.lastSuccessfulUpdates = {
          ...state.lastSuccessfulUpdates,
          [message.update.taskType]: message.update,
        };
        renderSuccessfulUpdates();
      } else if (message.type === 'log' && state.task?.id === message.taskId) {
        const log = state.task.log ?? [];
        if (!log.some((entry) => entry.sequence === message.entry.sequence)) {
          applyTask({...state.task, log: [...log, message.entry]});
        }
      }
    } catch {
      setNotice('Получено некорректное WebSocket-событие.', 'error');
    }
  });
  socket.addEventListener('close', () => {
    if (state.socket !== socket) return;
    state.socket = null;
    setConnection('pending', 'WebSocket: переподключение…');
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(connectWebSocket, 2000);
  });
  socket.addEventListener('error', () => socket.close());
}

selectTab(state.selected);
await refresh({ quiet: true });
connectWebSocket();
