import { adminConfirm } from './admin-dialog.js';

const states = new Map();
let tabGuardInstalled = false;
const bypassTabs = new WeakSet();

function snapshot(form) {
  const result = [];
  for (const element of form.elements) {
    if (!(element instanceof HTMLElement) || !element.name) continue;
    if (element.matches('button,[type="submit"],[type="button"],[type="reset"]')) continue;
    if (element instanceof HTMLInputElement && element.type === 'file') {
      const files = [...(element.files ?? [])].map((file) => [file.name, file.size, file.lastModified]);
      result.push([element.name, files]);
      continue;
    }
    if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) {
      result.push([element.name, element.value, element.checked]);
      continue;
    }
    result.push([element.name, element.value]);
  }
  return JSON.stringify(result);
}

function ensureIndicator(form) {
  let node = form.querySelector(':scope > .admin-dirty-indicator');
  if (node) return node;
  node = document.createElement('p');
  node.className = 'admin-dirty-indicator';
  node.hidden = true;
  node.setAttribute('role', 'status');
  node.textContent = 'Есть несохранённые изменения';
  form.append(node);
  return node;
}

function refresh(state) {
  state.dirty = snapshot(state.form) !== state.cleanSnapshot;
  state.indicator.hidden = !state.dirty;
  if (!state.dirty) state.acknowledged = false;
  state.form.classList.toggle('is-dirty', state.dirty);
}

export function trackDirtyForm(form, { label = 'Настройки' } = {}) {
  if (!form) return null;
  const existing = states.get(form);
  if (existing) return existing.controller;

  const state = {
    form,
    label,
    indicator: ensureIndicator(form),
    cleanSnapshot: snapshot(form),
    dirty: false,
    acknowledged: false,
    controller: null,
  };

  const markClean = () => {
    state.cleanSnapshot = snapshot(form);
    state.dirty = false;
    state.acknowledged = false;
    state.indicator.hidden = true;
    form.classList.remove('is-dirty');
  };
  const markDirty = () => {
    state.dirty = true;
    state.acknowledged = false;
    state.indicator.hidden = false;
    form.classList.add('is-dirty');
  };
  const onChange = () => refresh(state);
  form.addEventListener('input', onChange);
  form.addEventListener('change', onChange);

  state.controller = {
    markClean,
    markDirty,
    isDirty: () => state.dirty,
  };
  states.set(form, state);
  return state.controller;
}

function dirtyLeavingForTab(tab) {
  const targetId = tab.getAttribute('aria-controls');
  const target = targetId ? document.getElementById(targetId) : null;
  return [...states.values()].filter((state) => {
    if (!state.dirty || state.acknowledged) return false;
    if (!target) return true;
    return !target.contains(state.form) && !state.form.contains(target);
  });
}

export async function confirmDirtyNavigation({
  title = 'Есть несохранённые изменения',
  message = null,
} = {}) {
  const dirty = [...states.values()].filter((state) => state.dirty && !state.acknowledged);
  if (dirty.length === 0) return true;
  const names = dirty.map((state) => state.label).join(', ');
  const accepted = await adminConfirm({
    title,
    message: message ?? `Не сохранено: ${names}. Перейти дальше? Изменения останутся в формах, пока страница открыта.`,
    confirmLabel: 'Перейти',
    cancelLabel: 'Остаться',
  });
  if (accepted) {
    for (const state of dirty) state.acknowledged = true;
  }
  return accepted;
}

export function installDirtyTabGuard() {
  if (tabGuardInstalled) return;
  tabGuardInstalled = true;
  document.addEventListener('click', async (event) => {
    const tab = event.target.closest?.('[role="tab"]');
    if (!tab || tab.getAttribute('aria-selected') === 'true') return;
    if (bypassTabs.has(tab)) {
      bypassTabs.delete(tab);
      return;
    }
    const dirty = dirtyLeavingForTab(tab);
    if (dirty.length === 0) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const names = dirty.map((state) => state.label).join(', ');
    const accepted = await adminConfirm({
      title: 'Есть несохранённые изменения',
      message: `Не сохранено: ${names}. Перейти на другую вкладку? Изменения останутся в формах, пока страница открыта.`,
      confirmLabel: 'Перейти',
      cancelLabel: 'Остаться',
    });
    if (!accepted) return;
    for (const state of dirty) state.acknowledged = true;
    bypassTabs.add(tab);
    tab.click();
  }, true);
}
