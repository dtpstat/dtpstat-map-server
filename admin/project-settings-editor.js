if (typeof document !== 'undefined') {
  const session = await globalThis.dtpstatAdminSession?.catch(() => null);
  const user = session?.user;
  const canManageInterface = Boolean(user?.isSuperuser || user?.canManageInterface);

  if (canManageInterface) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/admin/project-settings.css';
    document.head.append(stylesheet);

    const interfaceTabs = document.querySelector('#interface-tabs');
    const interfacePanels = document.querySelector('#interface-panels');

    if (
      interfaceTabs &&
      interfacePanels &&
      !document.querySelector('[data-interface-tab="project"]')
    ) {
      const tab = document.createElement('button');
      tab.className = 'task-tab';
      tab.id = 'interface-tab-project';
      tab.type = 'button';
      tab.role = 'tab';
      tab.setAttribute('aria-selected', 'true');
      tab.setAttribute('aria-controls', 'interface-panel-project');
      tab.dataset.interfaceTab = 'project';
      tab.textContent = 'Проект';
      interfaceTabs.prepend(tab);

      const panel = document.createElement('article');
      panel.className = 'task-panel interface-task-panel';
      panel.id = 'interface-panel-project';
      panel.role = 'tabpanel';
      panel.setAttribute('aria-labelledby', 'interface-tab-project');
      panel.dataset.interfacePanel = 'project';
      panel.innerHTML = `
        <h3>Проект</h3>
        <p class="panel-description">Название, метаданные, аналитика и общие параметры публичной карты.</p>

        <section class="operation-panel transfer-mode" id="operation-project-settings">
          <div class="mode-heading">
            <div>
              <h4>Оформление и метаданные</h4>
              <p>Название используется в H1, title, PWA manifest, OpenGraph/Twitter и остальных служебных тегах страницы.</p>
            </div>
          </div>

          <p class="project-settings-meta">
            <span>Последнее изменение</span><time id="project-settings-updated-at">—</time>
          </p>

          <form id="project-settings-form">
            <div class="form-fields project-settings-grid">
              <label>Название проекта
                <input name="projectName" type="text" maxlength="160" required
                       placeholder="Например: Выделенные полосы в России">
                <small>Одно значение используется в видимом заголовке и служебных title/meta/PWA-тегах.</small>
              </label>

              <label class="check project-setting-check">
                <input name="showLineLabels" type="checkbox">
                Отображать подписи линий на карте
                <small>Для линий с KML Placemark/name рядом с геометрией постоянно показывается подпись. Hover-popup работает независимо от этой настройки.</small>
              </label>

              <label>Ключевые слова
                <textarea name="keywords" rows="5"
                          placeholder="выделенные полосы\nобщественный транспорт\nрейтинг городов"></textarea>
                <small>По одному на строку или через запятую. Используются в meta keywords; дубликаты удаляются.</small>
              </label>

              <section class="project-settings-section" aria-labelledby="project-identifiers-title">
                <div>
                  <h5 id="project-identifiers-title">Идентификаторы и API</h5>
                  <p>Идентификаторы аналитики можно оставить пустыми. Mapbox token хранится в БД и никогда не читается обратно в админку открытым текстом.</p>
                </div>
                <div class="project-metrics-grid">
                  <label>Yandex Metrica ID
                    <input name="yandexMetrikaId" type="text" inputmode="numeric"
                           maxlength="15" pattern="[1-9][0-9]{0,14}"
                           placeholder="Например: 12345678">
                    <small>Числовой ID счётчика Яндекс Метрики.</small>
                  </label>
                  <label>Google Analytics 4 Measurement ID
                    <input name="googleAnalyticsId" type="text" maxlength="34"
                           pattern="[Gg]-[A-Za-z0-9]{4,32}"
                           placeholder="Например: G-XXXXXXXXXX">
                    <small>Measurement ID GA4 вида G-….</small>
                  </label>
                  <label>Mapbox public access token
                    <input name="mapboxAccessToken" type="password" maxlength="2048"
                           autocomplete="new-password" spellcheck="false"
                           placeholder="pk.…">
                    <small>Если ключ уже задан, показывается *****. Оставь поле без изменений, чтобы сохранить текущий ключ; введённый новый pk.* заменит его.</small>
                  </label>
                </div>
              </section>

              <label>Информационный блок / подвал — HTML
                <div class="project-settings-toolbar" id="project-html-toolbar" aria-label="Готовые HTML-стили">
                  <button type="button" data-project-snippet="h2">H2</button>
                  <button type="button" data-project-snippet="paragraph">Абзац</button>
                  <button type="button" data-project-snippet="link">Ссылка</button>
                  <button type="button" data-project-snippet="strong">Жирный</button>
                  <button type="button" data-project-snippet="list">Список</button>
                  <button type="button" data-project-snippet="lead">Лид</button>
                  <button type="button" data-project-snippet="muted">Приглушённый</button>
                  <button type="button" data-project-snippet="callout">Акцент-блок</button>
                  <button type="button" data-project-snippet="columns">2 колонки</button>
                  <button type="button" data-project-snippet="button">Кнопка-ссылка</button>
                </div>
                <textarea name="footerHtml" rows="18" required spellcheck="false"
                          placeholder="<h2>О проекте</h2>\n<p>Описание проекта…</p>"></textarea>
              </label>

              <div class="project-settings-help">
                <div><strong>Разрешённые теги:</strong> <code id="project-allowed-tags">загрузка…</code></div>
                <div><strong>Стили проекта:</strong> <code id="project-allowed-classes">загрузка…</code></div>
                <div>Inline style, script, iframe, обработчики событий и неизвестные классы сервер не принимает.</div>
              </div>
            </div>
            <button class="task-action" type="submit">Сохранить настройки проекта</button>
          </form>
          <p class="project-settings-message" id="project-settings-message" role="status"></p>
        </section>
      `;
      interfacePanels.prepend(panel);
    }

    const form = document.querySelector('#project-settings-form');

    if (form) {
      const projectName = form.elements.namedItem('projectName');
      const showLineLabels = form.elements.namedItem('showLineLabels');
      const keywords = form.elements.namedItem('keywords');
      const yandexMetrikaId = form.elements.namedItem('yandexMetrikaId');
      const googleAnalyticsId = form.elements.namedItem('googleAnalyticsId');
      const mapboxAccessToken = form.elements.namedItem('mapboxAccessToken');
      const footerHtml = form.elements.namedItem('footerHtml');
      const saveButton = form.querySelector('button[type="submit"]');
      const message = document.querySelector('#project-settings-message');
      const updatedAt = document.querySelector('#project-settings-updated-at');
      const toolbar = document.querySelector('#project-html-toolbar');
      const allowedTags = document.querySelector('#project-allowed-tags');
      const allowedClasses = document.querySelector('#project-allowed-classes');

      function setMessage(text, tone = '') {
        message.textContent = text;
        message.className = `project-settings-message${tone ? ` is-${tone}` : ''}`;
      }

      function formatUpdatedAt(value) {
        if (!value) return '—';
        const date = new Date(value);
        return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('ru-RU');
      }

      function splitKeywords(value) {
        return value
          .split(/[\n,]+/)
          .map((item) => item.trim())
          .filter(Boolean);
      }

      function setMapboxState(configured) {
        mapboxAccessToken.dataset.configured = configured ? 'true' : 'false';
        mapboxAccessToken.dataset.changed = 'false';
        mapboxAccessToken.dataset.masked = configured ? 'true' : 'false';
        mapboxAccessToken.value = configured ? '*****' : '';
      }

      mapboxAccessToken.addEventListener('focus', () => {
        if (mapboxAccessToken.dataset.masked !== 'true') return;
        mapboxAccessToken.value = '';
        mapboxAccessToken.dataset.masked = 'false';
        mapboxAccessToken.dataset.changed = 'false';
      });
      mapboxAccessToken.addEventListener('input', () => {
        mapboxAccessToken.dataset.masked = 'false';
        mapboxAccessToken.dataset.changed = 'true';
      });
      mapboxAccessToken.addEventListener('blur', () => {
        if (
          mapboxAccessToken.dataset.configured === 'true' &&
          mapboxAccessToken.dataset.changed !== 'true' &&
          mapboxAccessToken.value === ''
        ) {
          mapboxAccessToken.value = '*****';
          mapboxAccessToken.dataset.masked = 'true';
        }
      });

      function insertSnippet(snippet) {
        const start = footerHtml.selectionStart ?? footerHtml.value.length;
        const end = footerHtml.selectionEnd ?? start;
        const selected = footerHtml.value.slice(start, end);
        const content = snippet.replace('{{selection}}', selected || 'Текст');
        footerHtml.setRangeText(content, start, end, 'end');
        footerHtml.focus();
      }

      const snippets = Object.freeze({
        h2: '<h2>{{selection}}</h2>',
        paragraph: '<p>{{selection}}</p>',
        link: '<a href="https://example.com/">{{selection}}</a>',
        strong: '<strong>{{selection}}</strong>',
        list: '<ul>\n  <li>{{selection}}</li>\n  <li>Текст</li>\n</ul>',
        lead: '<p class="project-lead">{{selection}}</p>',
        muted: '<p class="project-muted">{{selection}}</p>',
        callout: '<div class="project-callout">\n  <p>{{selection}}</p>\n</div>',
        columns: '<div class="project-columns">\n  <div>{{selection}}</div>\n  <div>Текст</div>\n</div>',
        button: '<a class="project-link-button" href="https://example.com/">{{selection}}</a>',
      });

      toolbar?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-project-snippet]');
        if (!button) return;
        const snippet = snippets[button.dataset.projectSnippet];
        if (snippet) insertSnippet(snippet);
      });

      function applySettings(settings) {
        projectName.value = settings.projectName;
        showLineLabels.checked = Boolean(settings.showLineLabels);
        keywords.value = settings.keywords.join('\n');
        yandexMetrikaId.value = settings.yandexMetrikaId ?? '';
        googleAnalyticsId.value = settings.googleAnalyticsId ?? '';
        setMapboxState(Boolean(settings.mapboxAccessTokenConfigured));
        footerHtml.value = settings.footerHtml;
        updatedAt.textContent = formatUpdatedAt(settings.updatedAt);
      }

      async function load() {
        setMessage('Загружаем настройки…');
        try {
          const response = await fetch('/api/admin/project-settings', {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
          applySettings(payload.settings);
          allowedTags.textContent = payload.editor.tags.map((tag) => `<${tag}>`).join(' · ');
          allowedClasses.textContent = payload.editor.classes.map((name) => `.${name}`).join(' · ');
          setMessage('Настройки загружены.');
        } catch (error) {
          setMessage(error.message, 'error');
        }
      }

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        saveButton.disabled = true;
        setMessage('Проверяем и сохраняем…');
        try {
          const mapboxChanged = mapboxAccessToken.dataset.changed === 'true';
          const response = await fetch('/api/admin/project-settings', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              projectName: projectName.value.trim(),
              showLineLabels: showLineLabels.checked,
              keywords: splitKeywords(keywords.value),
              yandexMetrikaId: yandexMetrikaId.value.trim() || null,
              googleAnalyticsId: googleAnalyticsId.value.trim() || null,
              mapboxAccessToken: mapboxChanged
                ? mapboxAccessToken.value.trim() || null
                : null,
              footerHtml: footerHtml.value,
            }),
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
          applySettings(payload.settings);
          setMessage('Настройки проекта сохранены.', 'success');
          window.dispatchEvent(new CustomEvent('dtpstat:project-settings-changed'));
        } catch (error) {
          setMessage(error.message, 'error');
        } finally {
          saveButton.disabled = false;
        }
      });

      void load();
    }
  }
}
