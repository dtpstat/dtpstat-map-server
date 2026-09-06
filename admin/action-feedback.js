const host = document.createElement('div');
host.className = 'admin-feedback-host';
host.setAttribute('aria-live', 'polite');
host.setAttribute('aria-atomic', 'false');
document.body.append(host);

const MAX_TOASTS = 4;
const DEFAULT_TIMEOUT_MS = 5000;

function toneFromElement(element) {
  const classes = element.classList;
  if (
    classes.contains('is-error') ||
    classes.contains('notice-error') ||
    classes.contains('result-error')
  ) return 'error';
  if (
    classes.contains('is-success') ||
    classes.contains('notice-success') ||
    classes.contains('result-success')
  ) return 'success';
  return null;
}

function show(text, tone = 'success', timeoutMs = DEFAULT_TIMEOUT_MS) {
  const message = String(text ?? '').trim();
  if (!message) return;

  const toast = document.createElement('div');
  toast.className = `admin-feedback-toast is-${tone}`;
  toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');

  const content = document.createElement('span');
  content.textContent = message;
  toast.append(content);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'admin-feedback-close';
  close.setAttribute('aria-label', 'Закрыть уведомление');
  close.textContent = '×';
  close.addEventListener('click', () => toast.remove());
  toast.append(close);

  host.append(toast);
  while (host.children.length > MAX_TOASTS) host.firstElementChild?.remove();

  if (timeoutMs > 0) {
    window.setTimeout(() => toast.remove(), timeoutMs);
  }
}

window.dtpstatAdminFeedback = show;
window.addEventListener('dtpstat:admin-feedback', (event) => {
  show(event.detail?.text, event.detail?.tone, event.detail?.timeoutMs);
});

const observed = new WeakMap();

function watch(element) {
  if (observed.has(element)) return;
  let previous = '';
  const sync = () => {
    const tone = toneFromElement(element);
    const text = element.textContent?.trim() ?? '';
    if (tone && text && text !== previous) show(text, tone);
    previous = text;
  };
  const observer = new MutationObserver(sync);
  observer.observe(element, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  observed.set(element, observer);
  sync();
}

function discover(root = document) {
  for (const element of root.querySelectorAll([
    '.project-settings-message',
    '.report-config-message',
    '.line-types-message',
    '.security-message',
    '.profile-message',
    '.project-transfer-message',
    '.notice.notice-success',
    '.notice.notice-error',
  ].join(','))) {
    watch(element);
  }
}

discover();
new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (toneFromElement(node)) watch(node);
      discover(node);
    }
  }
}).observe(document.body, { childList: true, subtree: true });
