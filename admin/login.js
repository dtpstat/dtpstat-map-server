import {
  adminApiHeaders,
} from './api-contract-client.js';
import {
  hidePageStandby,
  showPageStandby,
} from '../js/page-standby.js';

const form = document.querySelector('#admin-login-form');
const mfaForm = document.querySelector('#admin-mfa-form');
const mfaBack = document.querySelector('#admin-mfa-back');
const message = document.querySelector('#admin-login-message');
let mfaChallengeToken = null;
const loginReason = new URLSearchParams(window.location.search);

if (message && loginReason.get('expired') === '1') {
  message.textContent = 'Сессия истекла. Войдите снова.';
  message.className = 'notice';
}

function showCredentialStep(
  text = '',
  tone = '',
) {
  mfaChallengeToken =
    null;
  if (mfaForm) {
    mfaForm.hidden =
      true;
    mfaForm.reset();
  }
  if (form) {
    form.hidden =
      false;
  }
  if (
    message &&
    text
  ) {
    message.textContent =
      text;
    message.className =
      `notice${tone ? ` notice-${tone}` : ''}`;
  }
}

function showMfaStep(
  challengeToken,
  expiresAt,
) {
  mfaChallengeToken =
    challengeToken;
  form.hidden =
    true;
  mfaForm.hidden =
    false;
  const expiry =
    expiresAt
      ? new Date(
          expiresAt,
        ).toLocaleTimeString(
          'ru-RU',
          {
            hour:
              '2-digit',
            minute:
              '2-digit',
          },
        )
      : null;
  message.textContent =
    expiry
      ? `Пароль принят. Введите второй фактор до ${expiry}.`
      : 'Пароль принят. Введите второй фактор.';
  message.className =
    'notice';
  mfaForm.elements.code
    .focus();
}

async function alreadyAuthenticated() {
  try {
    const response = await fetch('/api/admin/me', {
      credentials: 'same-origin',
      headers:
        adminApiHeaders({
          Accept:
            'application/json',
        }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

if (await alreadyAuthenticated()) {
  showPageStandby(
    'Открываем админку…',
  );
  window.location.replace('/admin/');
} else {
  hidePageStandby();
}

if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    message.textContent = 'Проверяем учётные данные…';
    message.className = 'notice';
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers:
          adminApiHeaders({
            Accept:
              'application/json',
            'Content-Type':
              'application/json',
          }),
        body: JSON.stringify({
          username: form.elements.username.value,
          password: form.elements.password.value,
        }),
      });
      let payload = null;
      try { payload = await response.json(); } catch { /* no body */ }
      if (
        response.status === 426
      ) {
        throw new Error(
          'Сервер обновлён. Перезагрузите страницу входа.',
        );
      }

      if (
        response.status ===
          202 &&
        payload
          ?.mfaRequired ===
          true &&
        typeof payload
          .challengeToken ===
          'string'
      ) {
        form.elements.password.value =
          '';
        showMfaStep(
          payload.challengeToken,
          payload.expiresAt,
        );
        return;
      }

      if (!response.ok) {
        const retry = payload?.retryAfterSeconds
          ? ` Повторите через ${payload.retryAfterSeconds} сек.`
          : '';
        throw new Error(`${payload?.error ?? `HTTP ${response.status}`}${retry}`);
      }
      showPageStandby(
        'Открываем админку…',
      );
      window.location.replace('/admin/');
    } catch (error) {
      message.textContent = error.message;
      message.className = 'notice notice-error';
      form.elements.password.value = '';
      form.elements.password.focus();
    } finally {
      button.disabled = false;
    }
  });
}


if (
  mfaForm &&
  mfaBack
) {
  mfaBack.addEventListener(
    'click',
    () => {
      showCredentialStep(
        'Введите логин и пароль заново.',
      );
      form.elements.username
        .focus();
    },
  );

  mfaForm.addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();
      if (
        !mfaChallengeToken ||
        !mfaForm.reportValidity()
      ) {
        return;
      }

      const button =
        mfaForm.querySelector(
          'button[type="submit"]',
        );
      button.disabled =
        true;
      message.textContent =
        'Проверяем второй фактор…';
      message.className =
        'notice';

      try {
        const response =
          await fetch(
            '/api/admin/login/mfa',
            {
              method:
                'POST',
              credentials:
                'same-origin',
              headers:
                adminApiHeaders({
                  Accept:
                    'application/json',
                  'Content-Type':
                    'application/json',
                }),
              body:
                JSON.stringify({
                  challengeToken:
                    mfaChallengeToken,
                  code:
                    mfaForm
                      .elements
                      .code
                      .value,
                }),
            },
          );

        let payload =
          null;
        try {
          payload =
            await response.json();
        } catch {
          // no body
        }

        if (
          response.status ===
          426
        ) {
          throw new Error(
            'Сервер обновлён. Перезагрузите страницу входа.',
          );
        }

        if (!response.ok) {
          const retry =
            payload
              ?.retryAfterSeconds
              ? ` Повторите через ${payload.retryAfterSeconds} сек.`
              : '';
          throw new Error(
            `${payload?.error ?? `HTTP ${response.status}`}${retry}`,
          );
        }

        mfaChallengeToken =
          null;
        showPageStandby(
          'Открываем админку…',
        );
        window.location
          .replace(
            '/admin/',
          );
      } catch (error) {
        showCredentialStep(
          `${error.message} Введите пароль снова.`,
          'error',
        );
        form.elements.password
          .focus();
      } finally {
        button.disabled =
          false;
      }
    },
  );
}
