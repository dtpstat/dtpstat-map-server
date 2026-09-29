import {
  adminNotificationSnapshot,
  dismissAdminNotification,
  publishAdminNotification,
  subscribeAdminNotifications,
} from './notification-center.js';

const stylesheet =
  document.createElement(
    'link',
  );
stylesheet.rel =
  'stylesheet';
stylesheet.href =
  '/admin/action-feedback.css';
document.head.append(
  stylesheet,
);

const host =
  document.createElement(
    'div',
  );
host.className =
  'admin-feedback-host';
host.setAttribute(
  'aria-live',
  'polite',
);
host.setAttribute(
  'aria-atomic',
  'false',
);
document.body.append(host);

const MESSAGE_SELECTOR = [
  '.project-settings-message',
  '.report-config-message',
  '.line-types-message',
  '.security-message',
  '.profile-message',
  '.project-transfer-message',
  '.notice.notice-success',
  '.notice.notice-error',
].join(',');

const toastTimers =
  new Map();

function isFeedbackSource(
  element,
) {
  return (
    element instanceof
      Element &&
    element.matches(
      MESSAGE_SELECTOR,
    )
  );
}

function levelFromElement(
  element,
) {
  const classes =
    element.classList;
  if (
    classes.contains(
      'is-error',
    ) ||
    classes.contains(
      'notice-error',
    ) ||
    classes.contains(
      'result-error',
    )
  ) {
    return 'error';
  }

  if (
    classes.contains(
      'is-success',
    ) ||
    classes.contains(
      'notice-success',
    ) ||
    classes.contains(
      'result-success',
    )
  ) {
    return 'info';
  }

  return null;
}

function clearToastTimer(
  id,
) {
  const timer =
    toastTimers.get(id);
  if (timer !== undefined) {
    window.clearTimeout(
      timer,
    );
    toastTimers.delete(
      id,
    );
  }
}

function removeToast(
  id,
) {
  clearToastTimer(id);
  host.querySelector(
    '[data-notification-id="' +
      CSS.escape(String(id)) +
      '"]',
  )?.remove();
}

function renderNotification(
  notification,
) {
  removeToast(
    notification.id,
  );

  const toast =
    document.createElement(
      'div',
    );
  toast.className =
    'admin-feedback-toast is-' +
    notification.level;
  toast.dataset.notificationId =
    notification.id;
  toast.setAttribute(
    'role',
    notification.level ===
      'error' ||
    notification.level ===
      'warn'
      ? 'alert'
      : 'status',
  );

  const content =
    document.createElement(
      'span',
    );
  content.textContent =
    notification.message;
  toast.append(content);

  const close =
    document.createElement(
      'button',
    );
  close.type =
    'button';
  close.className =
    'admin-feedback-close';
  close.setAttribute(
    'aria-label',
    'Закрыть уведомление',
  );
  close.textContent = '×';
  close.addEventListener(
    'click',
    () =>
      dismissAdminNotification(
        notification.id,
      ),
  );
  toast.append(close);

  host.append(toast);

  if (
    !notification.persistent &&
    notification.timeoutMs > 0
  ) {
    toastTimers.set(
      notification.id,
      window.setTimeout(
        () =>
          dismissAdminNotification(
            notification.id,
          ),
        notification.timeoutMs,
      ),
    );
  }
}

subscribeAdminNotifications(
  (event) => {
    if (
      event.kind ===
        'snapshot'
    ) {
      host.replaceChildren();
      for (
        const notification of
        event.notifications
      ) {
        renderNotification(
          notification,
        );
      }
      return;
    }

    if (
      event.kind ===
        'added' &&
      event.notification
    ) {
      renderNotification(
        event.notification,
      );
      return;
    }

    if (
      event.kind ===
        'dismissed' &&
      event.notification
    ) {
      removeToast(
        event.notification.id,
      );
    }
  },
);

window.dtpstatNotifications = {
  publish:
    publishAdminNotification,
  subscribe:
    subscribeAdminNotifications,
  dismiss:
    dismissAdminNotification,
  snapshot:
    adminNotificationSnapshot,
};

window.dtpstatAdminFeedback =
  (
    text,
    tone = 'info',
    timeoutMs,
  ) =>
    publishAdminNotification({
      message: text,
      level: tone,
      timeoutMs,
    });

window.addEventListener(
  'dtpstat:admin-feedback',
  (event) => {
    publishAdminNotification({
      message:
        event.detail?.text,
      level:
        event.detail?.tone,
      timeoutMs:
        event.detail
          ?.timeoutMs,
    });
  },
);

const observed =
  new WeakMap();

function watch(element) {
  if (
    !isFeedbackSource(
      element,
    ) ||
    observed.has(
      element,
    )
  ) {
    return;
  }

  let previous = '';

  const sync = () => {
    const level =
      levelFromElement(
        element,
      );
    const text =
      element.textContent
        ?.trim() ??
      '';

    if (
      level &&
      text &&
      text !== previous
    ) {
      publishAdminNotification({
        message: text,
        level,
      });
    }
    previous = text;
  };

  const observer =
    new MutationObserver(
      sync,
    );
  observer.observe(
    element,
    {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'class',
      ],
    },
  );
  observed.set(
    element,
    observer,
  );
  sync();
}

function discover(
  root = document,
) {
  for (
    const element of
    root.querySelectorAll(
      MESSAGE_SELECTOR,
    )
  ) {
    watch(element);
  }
}

discover();

new MutationObserver(
  (records) => {
    for (
      const record of records
    ) {
      for (
        const node of
        record.addedNodes
      ) {
        if (
          !(node instanceof
            Element)
        ) {
          continue;
        }

        if (node === host || host.contains(node)) continue;
        if (isFeedbackSource(node)) watch(node);

        discover(node);
      }
    }
  },
).observe(
  document.body,
  {
    childList: true,
    subtree: true,
  },
);
