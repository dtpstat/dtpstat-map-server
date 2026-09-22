let dialogRoot = null;
let dialogQueue = Promise.resolve();

function ensureDialog() {
  if (dialogRoot) return dialogRoot;
  const root = document.createElement('div');
  root.className = 'admin-dialog-overlay';
  root.hidden = true;
  root.innerHTML = `
    <section class="admin-dialog" role="dialog" aria-modal="true"
             aria-labelledby="admin-dialog-title" aria-describedby="admin-dialog-message">
      <h3 id="admin-dialog-title">Подтверждение</h3>
      <p id="admin-dialog-message"></p>
      <div class="admin-dialog-actions">
        <button type="button" class="secondary" data-admin-dialog-cancel>Отмена</button>
        <button type="button" data-admin-dialog-accept>Продолжить</button>
      </div>
    </section>
  `;
  document.body.append(root);
  dialogRoot = root;
  return root;
}

function showDialog({
  title = 'Подтверждение',
  message = '',
  confirmLabel = 'Продолжить',
  cancelLabel = 'Отмена',
  destructive = false,
  alertOnly = false,
} = {}) {
  const root = ensureDialog();
  const titleNode = root.querySelector('#admin-dialog-title');
  const messageNode = root.querySelector('#admin-dialog-message');
  const accept = root.querySelector('[data-admin-dialog-accept]');
  const cancel = root.querySelector('[data-admin-dialog-cancel]');
  const previousFocus = document.activeElement;

  titleNode.textContent = title;
  messageNode.textContent = message;
  accept.textContent = confirmLabel;
  cancel.textContent = cancelLabel;
  cancel.hidden = alertOnly;
  accept.classList.toggle('danger', destructive);
  root.hidden = false;
  document.body.classList.add('admin-dialog-open');

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      root.hidden = true;
      document.body.classList.remove('admin-dialog-open');
      accept.classList.remove('danger');
      cancel.hidden = false;
      accept.removeEventListener('click', acceptHandler);
      cancel.removeEventListener('click', cancelHandler);
      root.removeEventListener('click', backdropHandler);
      document.removeEventListener('keydown', keyHandler);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
      resolve(value);
    };
    const acceptHandler = () => finish(true);
    const cancelHandler = () => finish(false);
    const backdropHandler = (event) => {
      if (event.target === root && !alertOnly) finish(false);
    };
    const keyHandler = (event) => {
      if (event.key === 'Escape' && !alertOnly) finish(false);
    };

    accept.addEventListener('click', acceptHandler);
    cancel.addEventListener('click', cancelHandler);
    root.addEventListener('click', backdropHandler);
    document.addEventListener('keydown', keyHandler);
    accept.focus();
  });
}

function enqueue(options) {
  const run = dialogQueue.then(() => showDialog(options));
  dialogQueue = run.catch(() => {});
  return run;
}

export function adminConfirm(options) {
  return enqueue(options);
}

export function adminAlert(options) {
  return enqueue({
    ...options,
    alertOnly: true,
    confirmLabel: options?.confirmLabel ?? 'OK',
  });
}
