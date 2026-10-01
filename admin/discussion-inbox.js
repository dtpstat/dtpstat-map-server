import {
  adminAvatarObjectUrl,
} from './admin-avatar.js';
import {
  realtimeMutationHeaders,
  subscribeAdminRealtime,
} from './realtime-client.js';

const profileHost =
  document.querySelector(
    '#profile-editor-host',
  );

const session =
  await globalThis
    .dtpstatAdminSession
    ?.catch(() => null);

const currentUser =
  session?.user ??
  null;

function apiPath(
  item,
  suffix = '',
) {
  if (
    item.subjectType ===
    'geometry'
  ) {
    return (
      '/api/admin/geometry-editor/geometries/' +
      encodeURIComponent(
        item.subjectId,
      ) +
      '/discussion' +
      suffix
    );
  }

  if (
    item.subjectType ===
    'osm-boundary'
  ) {
    return (
      '/api/admin/osm-boundaries/' +
      encodeURIComponent(
        item.subjectId,
      ) +
      '/discussion' +
      suffix
    );
  }

  throw new Error(
    'Unsupported discussion subject',
  );
}

async function api(
  path,
  options = {},
) {
  const response =
    await fetch(
      path,
      {
        credentials:
          'same-origin',
        ...options,
        headers: {
          Accept:
            'application/json',
          ...(
            options.headers ??
            {}
          ),
        },
      },
    );

  let payload = null;
  try {
    payload =
      await response.json();
  } catch {
    // Some failure paths may not expose JSON.
  }

  if (!response.ok) {
    throw new Error(
      payload?.error ??
      'HTTP ' +
      response.status,
    );
  }

  return payload;
}

function formatDate(
  value,
) {
  if (!value) return '—';

  return new Date(
    value,
  ).toLocaleString(
    'ru-RU',
    {
      dateStyle: 'short',
      timeStyle: 'short',
    },
  );
}

function initials(
  identity,
) {
  const source =
    String(
      identity?.displayName ??
      identity?.username ??
      '?',
    )
      .trim();

  const parts =
    source
      .split(
        /\s+/u,
      )
      .filter(Boolean);

  return (
    parts
      .slice(0, 2)
      .map(
        (part) =>
          part
            .slice(0, 1)
            .toLocaleUpperCase(
              'ru-RU',
            ),
      )
      .join('') ||
    '?'
  );
}

function avatarNode(
  identity,
  className,
) {
  const fallback =
    document.createElement(
      'span',
    );
  fallback.className =
    className +
    ' is-fallback';
  fallback.textContent =
    initials(
      identity,
    );

  if (!identity?.avatarUrl) {
    return fallback;
  }

  const wrapper =
    document.createElement(
      'span',
    );
  wrapper.className =
    className;

  const image =
    document.createElement(
      'img',
    );
  image.alt = '';
  image.hidden = true;

  wrapper.append(
    fallback,
    image,
  );

  void adminAvatarObjectUrl(
    identity.avatarUrl,
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

function createPanel() {
  if (!profileHost) {
    return null;
  }

  const grid =
    profileHost.querySelector(
      '.profile-grid',
    );

  if (!grid) return null;

  const panel =
    document.createElement(
      'section',
    );
  panel.className =
    'profile-panel profile-discussions-panel';
  panel.innerHTML = `
    <div class="profile-section-heading profile-discussions-heading">
      <div>
        <h3>Сообщения</h3>
        <p class="profile-muted">
          Обсуждения геометрий и объектов OSM, доступных вашей роли.
        </p>
      </div>
      <strong id="profile-discussions-total">0 непрочитанных</strong>
    </div>
    <div class="profile-discussions-layout">
      <aside class="profile-discussions-list-wrap">
        <div id="profile-discussions-list"
             class="profile-discussions-list"
             role="listbox"
             aria-label="Обсуждения"></div>
      </aside>
      <section class="profile-discussion-thread"
               id="profile-discussion-thread">
        <p class="empty-state">
          Выберите обсуждение слева.
        </p>
      </section>
    </div>
    <p id="profile-discussions-message"
       class="profile-message"
       role="status"></p>
  `;

  const firstPanel =
    grid.querySelector(
      '.profile-panel',
    );

  if (firstPanel?.nextSibling) {
    grid.insertBefore(
      panel,
      firstPanel.nextSibling,
    );
  } else {
    grid.append(
      panel,
    );
  }

  return panel;
}

if (profileHost && currentUser) {
  const stylesheet =
    document.createElement(
      'link',
    );
  stylesheet.rel =
    'stylesheet';
  stylesheet.href =
    '/admin/discussion-inbox.css';
  document.head.append(
    stylesheet,
  );

  const panel =
    createPanel();

  if (panel) {
    const listHost =
      panel.querySelector(
        '#profile-discussions-list',
      );
    const threadHost =
      panel.querySelector(
        '#profile-discussion-thread',
      );
    const totalHost =
      panel.querySelector(
        '#profile-discussions-total',
      );
    const statusHost =
      panel.querySelector(
        '#profile-discussions-message',
      );
    const profileTab =
      document.querySelector(
        '[data-admin-section-tab="profile"]',
      );

    let profileBadge =
      profileTab?.querySelector(
        '.admin-profile-unread',
      ) ??
      null;

    if (
      profileTab &&
      !profileBadge
    ) {
      profileBadge =
        document.createElement(
          'span',
        );
      profileBadge.className =
        'admin-profile-unread';
      profileBadge.hidden =
        true;
      profileTab.append(
        profileBadge,
      );
    }

    const state = {
      items: [],
      selectedKey: null,
      messages: [],
      loadingInbox: false,
      loadingThread: false,
      refreshTimer: null,
    };

    function keyFor(
      item,
    ) {
      return (
        item.subjectType +
        ':' +
        item.subjectId
      );
    }

    function selectedItem() {
      return state.items.find(
        (item) =>
          keyFor(item) ===
          state.selectedKey,
      ) ?? null;
    }

    function setStatus(
      text = '',
      tone = '',
    ) {
      statusHost.textContent =
        text;
      statusHost.className =
        'profile-message' +
        (
          tone
            ? ' is-' + tone
            : ''
        );
    }

    function renderTotal(
      count,
    ) {
      const total =
        Number(
          count ??
          0,
        );

      totalHost.textContent =
        total === 1
          ? '1 непрочитанное'
          : total +
            ' непрочитанных';

      if (profileBadge) {
        profileBadge.textContent =
          total > 99
            ? '99+'
            : String(total);
        profileBadge.hidden =
          total <= 0;
      }
    }

    function renderInbox() {
      if (
        state.items.length ===
        0
      ) {
        const empty =
          document.createElement(
            'p',
          );
        empty.className =
          'empty-state';
        empty.textContent =
          'Обсуждений пока нет.';
        listHost.replaceChildren(
          empty,
        );
        return;
      }

      const rows =
        state.items.map(
          (item) => {
            const button =
              document.createElement(
                'button',
              );
            button.type =
              'button';
            button.className =
              'profile-discussion-row';
            button.dataset
              .discussionKey =
              keyFor(item);
            button.setAttribute(
              'role',
              'option',
            );
            button.setAttribute(
              'aria-selected',
              String(
                keyFor(item) ===
                state.selectedKey,
              ),
            );

            const author =
              item.latestAuthor ??
              {};

            const body =
              document.createElement(
                'span',
              );
            body.className =
              'profile-discussion-row-body';

            const title =
              document.createElement(
                'strong',
              );
            title.textContent =
              item.subjectTitle ??
              item.subjectSubtitle ??
              'Обсуждение';

            const meta =
              document.createElement(
                'span',
              );
            meta.className =
              'profile-discussion-row-meta';
            meta.textContent =
              (
                item.subjectType ===
                'geometry'
                  ? 'Геометрия'
                  : 'OSM'
              ) +
              ' · ' +
              formatDate(
                item.latestCreatedAt,
              );

            const preview =
              document.createElement(
                'span',
              );
            preview.className =
              'profile-discussion-row-preview';
            preview.textContent =
              (
                author.displayName ??
                author.username ??
                'Пользователь'
              ) +
              ': ' +
              (
                item.latestMessage ??
                ''
              );

            body.append(
              title,
              meta,
              preview,
            );

            button.append(
              avatarNode(
                author,
                'profile-discussion-avatar',
              ),
              body,
            );

            if (
              item.unreadCount >
              0
            ) {
              const badge =
                document.createElement(
                  'span',
                );
              badge.className =
                'profile-discussion-row-unread';
              badge.textContent =
                item.unreadCount >
                99
                  ? '99+'
                  : String(
                    item.unreadCount,
                  );
              button.append(
                badge,
              );
            }

            button.addEventListener(
              'click',
              () => {
                state.selectedKey =
                  keyFor(item);
                renderInbox();
                void loadThread(
                  item,
                );
              },
            );

            return button;
          },
        );

      listHost.replaceChildren(
        ...rows,
      );
    }

    function messageNode(
      entry,
    ) {
      const article =
        document.createElement(
          'article',
        );
      const own =
        Number(
          entry.author?.userId,
        ) ===
        Number(
          currentUser.id,
        );
      article.className =
        'profile-discussion-message ' +
        (
          own
            ? 'is-own'
            : 'is-incoming'
        );

      const body =
        document.createElement(
          'div',
        );
      body.className =
        'profile-discussion-message-body';

      const head =
        document.createElement(
          'div',
        );
      head.className =
        'profile-discussion-message-head';

      const author =
        document.createElement(
          'strong',
        );
      author.textContent =
        entry.author
          ?.displayName ??
        entry.author
          ?.username ??
        'Удалённый пользователь';

      const time =
        document.createElement(
          'time',
        );
      time.dateTime =
        entry.createdAt ??
        '';
      time.textContent =
        formatDate(
          entry.createdAt,
        );

      const text =
        document.createElement(
          'p',
        );
      text.textContent =
        entry.message ??
        '';

      head.append(
        author,
        time,
      );
      body.append(
        head,
        text,
      );

      if (own) {
        const receipt =
          document.createElement(
            'small',
          );
        receipt.className =
          'profile-discussion-receipt';
        receipt.textContent =
          Number(
            entry
              .readByOthersCount ??
            0,
          ) > 0
            ? 'Прочитано'
            : 'Доставлено';
        body.append(
          receipt,
        );
      }

      article.append(
        avatarNode(
          entry.author,
          'profile-discussion-avatar',
        ),
        body,
      );

      return article;
    }

    function navigateToSource(
      item,
    ) {
      if (!item.subjectExists) {
        setStatus(
          'Исходный объект больше не существует.',
          'error',
        );
        return;
      }

      const tabKey =
        item.subjectType ===
        'geometry'
          ? 'geometries'
          : 'osm-objects';

      const tab =
        document.querySelector(
          `[data-admin-section-tab="${tabKey}"]`,
        );

      if (!tab || tab.hidden) {
        setStatus(
          'У текущей роли нет доступа к исходному объекту.',
          'error',
        );
        return;
      }

      tab.click();

      queueMicrotask(
        () => {
          window.dispatchEvent(
            new CustomEvent(
              item.subjectType ===
              'geometry'
                ? 'dtpstat:geometry-editor-select'
                : 'dtpstat:osm-boundary-editor-select',
              {
                detail: {
                  id:
                    item.subjectId,
                  cityId:
                    item.subjectCityId ??
                    null,
                },
              },
            ),
          );
        },
      );
    }

    function renderThread(
      item,
    ) {
      const header =
        document.createElement(
          'header',
        );
      header.className =
        'profile-discussion-thread-head';

      const heading =
        document.createElement(
          'div',
        );
      const title =
        document.createElement(
          'h4',
        );
      title.textContent =
        item.subjectTitle ??
        'Обсуждение';

      const subtitle =
        document.createElement(
          'p',
        );
      subtitle.className =
        'profile-muted';
      subtitle.textContent =
        item.subjectSubtitle ??
        '';

      heading.append(
        title,
        subtitle,
      );

      const sourceButton =
        document.createElement(
          'button',
        );
      sourceButton.type =
        'button';
      sourceButton.className =
        'secondary';
      sourceButton.textContent =
        item.subjectExists
          ? 'Открыть объект'
          : 'Объект удалён';
      sourceButton.disabled =
        !item.subjectExists;
      sourceButton.addEventListener(
        'click',
        () =>
          navigateToSource(
            item,
          ),
      );

      header.append(
        heading,
        sourceButton,
      );

      const messages =
        document.createElement(
          'div',
        );
      messages.className =
        'profile-discussion-messages';
      messages.append(
        ...state.messages.map(
          messageNode,
        ),
      );

      const form =
        document.createElement(
          'form',
        );
      form.className =
        'profile-discussion-compose';

      const input =
        document.createElement(
          'textarea',
        );
      input.rows = 2;
      input.maxLength = 4000;
      input.required = true;
      input.placeholder =
        'Сообщение…';

      const send =
        document.createElement(
          'button',
        );
      send.type = 'submit';
      send.textContent =
        'Отправить';

      form.append(
        input,
        send,
      );

      if (!item.subjectExists) {
        form.hidden = true;
      }

      form.addEventListener(
        'submit',
        async (event) => {
          event.preventDefault();

          const message =
            input.value.trim();
          if (!message) return;

          input.disabled =
            true;
          send.disabled =
            true;

          try {
            await api(
              apiPath(item),
              {
                method: 'POST',
                headers:
                  realtimeMutationHeaders({
                    'Content-Type':
                      'application/json',
                  }),
                body:
                  JSON.stringify({
                    message,
                  }),
              },
            );
            input.value = '';
            await Promise.all([
              loadThread(
                item,
                {
                  markRead:
                    false,
                },
              ),
              loadInbox({
                keepSelection:
                  true,
              }),
            ]);
          } catch (error) {
            setStatus(
              error.message,
              'error',
            );
          } finally {
            input.disabled =
              false;
            send.disabled =
              false;
            input.focus();
          }
        },
      );

      input.addEventListener(
        'keydown',
        (event) => {
          if (
            event.key ===
              'Enter' &&
            !event.shiftKey
          ) {
            event.preventDefault();
            form.requestSubmit();
          }
        },
      );

      threadHost.replaceChildren(
        header,
        messages,
        form,
      );

      messages.scrollTop =
        messages.scrollHeight;
    }

    async function markRead(
      item,
      messageId,
    ) {
      if (!messageId) return;

      await api(
        apiPath(
          item,
          '/read',
        ),
        {
          method: 'POST',
          headers:
            realtimeMutationHeaders({
              'Content-Type':
                'application/json',
            }),
          body:
            JSON.stringify({
              messageId,
            }),
        },
      );
    }

    async function loadThread(
      item,
      {
        markRead:
          shouldMarkRead =
            true,
      } = {},
    ) {
      if (
        state.loadingThread ||
        !item
      ) {
        return;
      }

      state.loadingThread =
        true;

      try {
        if (!item.subjectExists) {
          state.messages = [];
          renderThread(
            item,
          );
          return;
        }

        const payload =
          await api(
            apiPath(
              item,
            ),
          );

        state.messages =
          Array.isArray(
            payload?.messages,
          )
            ? payload.messages
            : [];

        renderThread(
          item,
        );

        const last =
          state.messages.at(-1);

        if (
          shouldMarkRead &&
          last?.id
        ) {
          await markRead(
            item,
            last.id,
          );
          await loadInbox({
            keepSelection:
              true,
          });
        }
      } catch (error) {
        setStatus(
          error.message,
          'error',
        );
      } finally {
        state.loadingThread =
          false;
      }
    }

    async function loadInbox({
      keepSelection =
        true,
    } = {}) {
      if (
        state.loadingInbox
      ) {
        return;
      }

      state.loadingInbox =
        true;

      try {
        const payload =
          await api(
            '/api/admin/profile/discussions',
          );

        state.items =
          Array.isArray(
            payload?.items,
          )
            ? payload.items
            : [];

        renderTotal(
          payload
            ?.totalUnread ??
          0,
        );

        if (
          !keepSelection ||
          !state.items.some(
            (item) =>
              keyFor(item) ===
              state.selectedKey,
          )
        ) {
          state.selectedKey =
            null;
        }

        renderInbox();

        const selected =
          selectedItem();

        if (
          selected &&
          !state.loadingThread
        ) {
          renderThread(
            selected,
          );
        }
      } catch (error) {
        setStatus(
          error.message,
          'error',
        );
      } finally {
        state.loadingInbox =
          false;
      }
    }

    function scheduleRefresh(
      event,
    ) {
      const relevant =
        event?.resource ===
          'geometry-discussions' ||
        event?.resource ===
          'osm-boundary-discussions';

      if (!relevant) return;

      clearTimeout(
        state.refreshTimer,
      );

      state.refreshTimer =
        setTimeout(
          () => {
            state.refreshTimer =
              null;

            const selected =
              selectedItem();

            void loadInbox({
              keepSelection:
                true,
            });

            if (selected) {
              void loadThread(
                selected,
              );
            }
          },
          50,
        );
    }

    subscribeAdminRealtime(
      scheduleRefresh,
      {
        replaySnapshot:
          false,
      },
    );

    window.addEventListener(
      'dtpstat:profile-open',
      () => {
        void loadInbox({
          keepSelection:
            true,
        });
      },
    );

    await loadInbox({
      keepSelection:
        false,
    });
  }
}
