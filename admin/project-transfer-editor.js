import { adminConfirm } from './admin-dialog.js';

const session = await globalThis.dtpstatAdminSession?.catch(() => null);

if (session?.user?.isSuperuser) {
  const host =
    document.querySelector(
      '#project-transfer-editor-host',
    );

  if (
    host &&
    !host.querySelector(
      '#project-settings-transfer-form',
    )
  ) {
    host.innerHTML = `
      <div class="mode-heading">
        <div>
          <h4>Экспорт</h4>
          <p>Versioned JSON для переноса конфигурации между экземплярами.</p>
        </div>
        <a class="secondary-link" href="/api/admin/settings/export" download="project-settings.json">Выгрузить настройки</a>
      </div>

      <div class="project-transfer-divider"></div>

      <div class="mode-heading">
        <div>
          <h4>Импорт</h4>
          <p>Файл полностью валидируется до commit. REPORT_CONFIG пересчитывается на данных принимающего экземпляра.</p>
        </div>
      </div>
      <form id="project-settings-transfer-form">
        <div class="form-fields">
          <label>Файл настроек проекта
            <input name="file" type="file" accept=".json,application/json" required>
          </label>
        </div>
        <button type="submit">Импортировать настройки</button>
      </form>
      <p class="notice" id="project-settings-transfer-message" role="status"></p>
    `;

    const form =
      host.querySelector(
        '#project-settings-transfer-form',
      );
    const message =
      host.querySelector(
        '#project-settings-transfer-message',
      );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const file = form.elements.file.files?.[0];
      if (!file) return;
      const confirmed = await adminConfirm({
        title: 'Импортировать настройки проекта?',
        message: 'Текущие настройки проекта и расчётов будут заменены значениями из файла. Пользователи, пароли и данные не переносятся.',
        confirmLabel: 'Импортировать',
        cancelLabel: 'Отмена',
        destructive: true,
      });
      if (!confirmed) return;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      message.textContent = 'Импортируем и пересчитываем проект…';
      message.className = 'notice';
      try {
        const text = await file.text();
        JSON.parse(text);
        const response = await fetch('/api/admin/settings/import', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: text,
        });
        let payload = null;
        try { payload = await response.json(); } catch { /* no body */ }
        if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
        const warnings = payload?.warnings?.length
          ? ` Предупреждения: ${payload.warnings.join('; ')}`
          : '';
        message.textContent = `Настройки импортированы.${warnings}`;
        message.className = 'notice notice-success';
        setTimeout(() => window.location.reload(), 1200);
      } catch (error) {
        message.textContent = error.message;
        message.className = 'notice notice-error';
      } finally {
        button.disabled = false;
      }
    });
  }
}
