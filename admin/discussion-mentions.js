const MENTION_PATTERN =
  /(^|[^\p{L}\p{N}_.-])@([\p{L}\p{N}][\p{L}\p{N}_.-]{0,63})/gu;

export function renderMentionText(
  host,
  value,
) {
  const text =
    String(
      value ??
      '',
    );
  const nodes = [];
  let cursor = 0;

  for (
    const match of
    text.matchAll(
      MENTION_PATTERN,
    )
  ) {
    const index =
      match.index ??
      0;
    const prefix =
      match[1] ??
      '';
    const login =
      match[2] ??
      '';
    const mentionStart =
      index +
      prefix.length;

    if (
      mentionStart >
      cursor
    ) {
      nodes.push(
        document.createTextNode(
          text.slice(
            cursor,
            mentionStart,
          ),
        ),
      );
    }

    const mention =
      document.createElement(
        'span',
      );
    mention.className =
      'discussion-mention';
    mention.textContent =
      '@' + login;
    nodes.push(
      mention,
    );

    cursor =
      mentionStart +
      login.length +
      1;
  }

  if (
    cursor <
    text.length
  ) {
    nodes.push(
      document.createTextNode(
        text.slice(
          cursor,
        ),
      ),
    );
  }

  host.replaceChildren(
    ...(
      nodes.length
        ? nodes
        : [
            document
              .createTextNode(
                text,
              ),
          ]
    ),
  );
}

function tokenAtCursor(
  input,
) {
  const value =
    String(
      input.value ??
      '',
    );
  const cursor =
    Number.isInteger(
      input.selectionStart,
    )
      ? input.selectionStart
      : value.length;
  const before =
    value.slice(
      0,
      cursor,
    );
  const match =
    before.match(
      /(^|[^\p{L}\p{N}_.-])@([\p{L}\p{N}_.-]{0,64})$/u,
    );

  if (!match) {
    return null;
  }

  const prefixLength =
    match[1]?.length ??
    0;
  const query =
    match[2] ??
    '';

  return {
    start:
      cursor -
      query.length -
      1,
    end:
      cursor,
    query,
    prefixLength,
  };
}

export function createMentionAutocomplete({
  input,
  subjectType,
  loadUsers,
}) {
  if (
    !input ||
    typeof loadUsers !==
      'function'
  ) {
    return {
      destroy() {},
    };
  }

  const popup =
    document.createElement(
      'div',
    );
  popup.className =
    'discussion-mention-suggestions';
  popup.hidden = true;
  popup.setAttribute(
    'role',
    'listbox',
  );
  document.body.append(
    popup,
  );

  let currentToken =
    null;
  let users = [];
  let activeIndex =
    -1;
  let requestSequence =
    0;
  let debounceTimer =
    null;
  let destroyed =
    false;

  function hide() {
    popup.hidden =
      true;
    popup.replaceChildren();
    users = [];
    activeIndex =
      -1;
    currentToken =
      null;
  }

  function position() {
    if (
      popup.hidden ||
      destroyed
    ) {
      return;
    }

    const rect =
      input
        .getBoundingClientRect();
    const width =
      Math.max(
        220,
        Math.min(
          360,
          rect.width,
        ),
      );

    popup.style.left =
      Math.max(
        8,
        Math.min(
          globalThis.innerWidth -
            width -
            8,
          rect.left,
        ),
      ) + 'px';
    popup.style.width =
      width + 'px';

    const below =
      globalThis.innerHeight -
      rect.bottom;
    const openAbove =
      below < 180 &&
      rect.top > below;

    if (openAbove) {
      popup.style.top =
        'auto';
      popup.style.bottom =
        Math.max(
          8,
          globalThis.innerHeight -
            rect.top +
            4,
        ) + 'px';
    } else {
      popup.style.bottom =
        'auto';
      popup.style.top =
        Math.min(
          globalThis.innerHeight -
            8,
          rect.bottom + 4,
        ) + 'px';
    }
  }

  function setActive(
    index,
  ) {
    if (
      users.length ===
      0
    ) {
      activeIndex =
        -1;
      return;
    }

    activeIndex =
      (
        index +
        users.length
      ) %
      users.length;

    const options =
      popup.querySelectorAll(
        '[role="option"]',
      );

    for (
      let optionIndex = 0;
      optionIndex <
        options.length;
      optionIndex += 1
    ) {
      const active =
        optionIndex ===
        activeIndex;
      options[
        optionIndex
      ].classList.toggle(
        'is-active',
        active,
      );
      options[
        optionIndex
      ].setAttribute(
        'aria-selected',
        String(
          active,
        ),
      );
      if (active) {
        options[
          optionIndex
        ].scrollIntoView({
          block:
            'nearest',
        });
      }
    }
  }

  function applyUser(
    user,
  ) {
    const token =
      currentToken ??
      tokenAtCursor(
        input,
      );
    if (
      !token ||
      !user?.username
    ) {
      hide();
      return;
    }

    const value =
      String(
        input.value ??
        '',
      );
    const replacement =
      '@' +
      user.username +
      ' ';
    input.value =
      value.slice(
        0,
        token.start,
      ) +
      replacement +
      value.slice(
        token.end,
      );

    const cursor =
      token.start +
      replacement.length;
    input.setSelectionRange(
      cursor,
      cursor,
    );
    hide();
    input.dispatchEvent(
      new Event(
        'input',
        {
          bubbles: true,
        },
      ),
    );
    input.focus();
  }

  function render() {
    popup.replaceChildren();

    for (
      const [
        index,
        user,
      ] of
      users.entries()
    ) {
      const option =
        document.createElement(
          'button',
        );
      option.type =
        'button';
      option.className =
        'discussion-mention-suggestion';
      option.setAttribute(
        'role',
        'option',
      );
      option.setAttribute(
        'aria-selected',
        'false',
      );

      const login =
        document.createElement(
          'strong',
        );
      login.textContent =
        '@' +
        user.username;

      const name =
        document.createElement(
          'span',
        );
      name.textContent =
        user.displayName ??
        user.username;

      option.append(
        login,
        name,
      );

      option.addEventListener(
        'pointerdown',
        (event) => {
          event.preventDefault();
        },
      );
      option.addEventListener(
        'click',
        () =>
          applyUser(
            user,
          ),
      );
      option.addEventListener(
        'mouseenter',
        () =>
          setActive(
            index,
          ),
      );

      popup.append(
        option,
      );
    }

    popup.hidden =
      users.length ===
      0;

    if (
      !popup.hidden
    ) {
      setActive(
        0,
      );
      position();
    }
  }

  async function refresh() {
    if (destroyed) {
      return;
    }

    const token =
      tokenAtCursor(
        input,
      );
    currentToken =
      token;

    if (!token) {
      hide();
      return;
    }

    const sequence =
      ++requestSequence;

    try {
      const result =
        await loadUsers(
          subjectType,
          token.query,
        );

      if (
        destroyed ||
        sequence !==
          requestSequence
      ) {
        return;
      }

      const nextToken =
        tokenAtCursor(
          input,
        );
      if (
        !nextToken ||
        nextToken.start !==
          token.start ||
        nextToken.query !==
          token.query
      ) {
        return;
      }

      currentToken =
        nextToken;
      users =
        Array.isArray(
          result,
        )
          ? result
              .filter(
                (user) =>
                  user?.username,
              )
              .slice(
                0,
                8,
              )
          : [];
      render();
    } catch {
      if (
        sequence ===
        requestSequence
      ) {
        hide();
      }
    }
  }

  function schedule() {
    if (
      debounceTimer !==
      null
    ) {
      globalThis.clearTimeout(
        debounceTimer,
      );
    }
    debounceTimer =
      globalThis.setTimeout(
        () => {
          debounceTimer =
            null;
          void refresh();
        },
        100,
      );
  }

  function keydown(
    event,
  ) {
    if (
      popup.hidden ||
      users.length ===
        0
    ) {
      if (
        event.key ===
        'Escape'
      ) {
        hide();
      }
      return;
    }

    if (
      event.key ===
      'ArrowDown'
    ) {
      event.preventDefault();
      setActive(
        activeIndex + 1,
      );
      return;
    }

    if (
      event.key ===
      'ArrowUp'
    ) {
      event.preventDefault();
      setActive(
        activeIndex - 1,
      );
      return;
    }

    if (
      (
        event.key ===
          'Enter' ||
        event.key ===
          'Tab'
      ) &&
      activeIndex >= 0
    ) {
      event.preventDefault();
      applyUser(
        users[
          activeIndex
        ],
      );
      return;
    }

    if (
      event.key ===
      'Escape'
    ) {
      event.preventDefault();
      hide();
    }
  }

  input.addEventListener(
    'input',
    schedule,
  );
  input.addEventListener(
    'click',
    schedule,
  );
  input.addEventListener(
    'keyup',
    (event) => {
      if (
        [
          'ArrowDown',
          'ArrowUp',
          'Enter',
          'Tab',
          'Escape',
        ].includes(
          event.key,
        )
      ) {
        return;
      }
      schedule();
    },
  );
  input.addEventListener(
    'keydown',
    keydown,
  );
  input.addEventListener(
    'blur',
    () => {
      globalThis.setTimeout(
        () => {
          if (
            document.activeElement
              ?.closest?.(
                '.discussion-mention-suggestions',
              ) !== popup
          ) {
            hide();
          }
        },
        0,
      );
    },
  );

  globalThis.addEventListener(
    'resize',
    position,
  );
  document.addEventListener(
    'scroll',
    position,
    true,
  );

  return {
    close:
      hide,
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed =
        true;
      requestSequence +=
        1;
      if (
        debounceTimer !==
        null
      ) {
        globalThis
          .clearTimeout(
            debounceTimer,
          );
      }
      input.removeEventListener(
        'keydown',
        keydown,
      );
      globalThis.removeEventListener(
        'resize',
        position,
      );
      document.removeEventListener(
        'scroll',
        position,
        true,
      );
      popup.remove();
    },
  };
}
