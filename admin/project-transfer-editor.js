const session = await globalThis.dtpstatAdminSession?.catch(() => null);

if (session?.user?.isSuperuser) {
  const tabs = document.querySelector('#interface-tabs');
  const panels = document.querySelector('#interface-panels');
  if (tabs && panels && !document.querySelector('[data-interface-tab="project-transfer"]')) {
    const tab = document.createElement('button');
    tab.className = 'task-tab';
    tab.type = 'button';
    tab.role = 'tab';
    tab.dataset.interfaceTab = 'project-transfer';
    tab.id = 'interface-tab-project-transfer';
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', 'interface-panel-project-transfer');
    tab.textContent = 'Импорт / экспорт проекта';
    tabs.append(tab);

    const panel = document.createElement('article');
    panel.className = 'task-panel interface-task-panel';
    panel.id = 'interface-panel-project-transfer';
    panel.role = 'tabpanel';
    panel.dataset.interfacePanel = 'project-transfer';
    panel.setAttribute('aria-labelledby', tab.id);
    panel.hidden = true;
    panel.innerHTML = `
      <h3>Импорт / экспорт настроек проекта</h3>
      <p class="panel-description">Суперадминский перенос настроек интерфейса, аналитики, типов линий и политики безопасности. Пользователи, пароли, сессии, аудит, данные городов и секреты ENV не переносятся.</p>
      <section class="operation-panel transfer-mode">
        <div class="mode-heading">
          <div>
            <h4>Экспорт</h4>
            <p>Versioned JSON для переноса конфигурации между экземплярами.</p>
          </div>
          <a class="secondary-link" href="/api/admin/settings/export" download="project-settings.json">Выгрузить настройки</a>
        </div>
      </section>
      <section class="operation-panel transfer-mode">
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
      </section>
    `;
    panels.append(panel);

    const form = panel.querySelector('#project-settings-transfer-form');
    const message = panel.querySelector('#project-settings-transfer-message');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const file = form.elements.file.files?.[0];
      if (!file) return;
      if (!window.confirm('Импорт заменить настройки проекта и расчётов на значения из файла. Продолжить?')) return;
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
