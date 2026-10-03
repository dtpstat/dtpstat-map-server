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

  const discussionSource =
    notification.source?.kind ===
      'discussion-thread'
      ? String(
        notification.source.id ??
        '',
      )
      : '';

  if (discussionSource) {
    toast.classList.add(
      'is-actionable',
    );
    if (
      notification.code ===
      'discussion-mention'
    ) {
      toast.classList.add(
        'is-mention',
      );
    }
    toast.tabIndex = 0;
    toast.setAttribute(
      'aria-label',
      notification.message +
        ' Открыть обсуждение.',
    );
  }

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

  if (discussionSource) {
    const openDiscussion =
      () => {
        const separator =
          discussionSource.indexOf(
            ':',
          );
        if (separator < 1) {
          return;
        }

        const subjectType =
          discussionSource.slice(
            0,
            separator,
          );
        const subjectId =
          Number(
            discussionSource.slice(
              separator + 1,
            ),
          );
        if (
          !Number.isSafeInteger(
            subjectId,
          ) ||
          subjectId <= 0
        ) {
          return;
        }

        const messagesTab =
          document.querySelector(
            '[data-admin-section-tab="messages"]',
          );
        if (
          !messagesTab ||
          messagesTab.hidden
        ) {
          return;
        }

        let completed =
          false;
        let observer =
          null;

        const completeOpen =
          () => {
            if (
              completed ||
              messagesTab.getAttribute(
                'aria-selected',
              ) !== 'true'
            ) {
              return false;
            }

            completed = true;
            observer?.disconnect();
            window.dispatchEvent(
              new CustomEvent(
                'dtpstat:discussion-inbox-open',
                {
                  detail: {
                    subjectType,
                    subjectId,
                  },
                },
              ),
            );
            dismissAdminNotification(
              notification.id,
            );
            return true;
          };

        messagesTab.click();

        if (completeOpen()) {
          return;
        }

        observer =
          new MutationObserver(
            completeOpen,
          );
        observer.observe(
          messagesTab,
          {
            attributes: true,
            attributeFilter: [
              'aria-selected',
            ],
          },
        );
        window.setTimeout(
          () =>
            observer?.disconnect(),
          30_000,
        );
      };

    toast.addEventListener(
      'click',
      (event) => {
        if (
          event.target.closest(
            '.admin-feedback-close',
          )
        ) {
          return;
        }
        openDiscussion();
      },
    );
    toast.addEventListener(
      'keydown',
      (event) => {
        if (
          event.key !== 'Enter' &&
          event.key !== ' '
        ) {
          return;
        }
        event.preventDefault();
        openDiscussion();
      },
    );
  }

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
