function standbyElement() {
  return document.querySelector(
    '#page-standby',
  );
}


export function showPageStandby(
  message = 'Загрузка…',
) {
  const standby =
    standbyElement();

  if (!standby) {
    return;
  }

  const label =
    standby.querySelector(
      '[data-page-standby-label]',
    );

  if (label) {
    label.textContent =
      message;
  }

  standby.classList
    .remove(
      'is-hidden',
    );
  standby.removeAttribute(
    'aria-hidden',
  );
}


export function hidePageStandby() {
  const standby =
    standbyElement();

  if (!standby) {
    return;
  }

  standby.classList
    .add(
      'is-hidden',
    );
  standby.setAttribute(
    'aria-hidden',
    'true',
  );
}


if (
  typeof window !==
  'undefined'
) {
  window.addEventListener(
    'beforeunload',
    () => {
      showPageStandby(
        'Загрузка страницы…',
      );
    },
  );
}
