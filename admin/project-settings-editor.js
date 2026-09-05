if (typeof document !== 'undefined') {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/admin/project-settings.css';
  document.head.append(stylesheet);

  const taskTabs = document.querySelector('.task-tabs');
  const controlCard = document.querySelector('.control-card');

  if (taskTabs && controlCard && !document.querySelector('[data-task-tab="project"]')) {
    const tab = document.createElement('button');
    tab.className = 'task-tab';
    tab.id = 'tab-project';
    tab.type = 'button';
    tab.role = 'tab';
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', 'panel-project');
    tab.dataset.taskTab = 'project';
    tab.textContent = 'Проект';
    taskTabs.append(tab);

    const panel = document.createElement('article');
    panel.className = 'task-panel';
    panel.id = 'panel-project';
    panel.role = 'tabpanel';
    panel.setAttribute('aria-labelledby', 'tab-project');
    panel.dataset.taskPanel = 'project';
    panel.hidden = true;
    panel.innerHTML = `
      <h3>Проект</h3>
      <p class="panel-description">Название, служебные метатеги, счётчики аналитики, ключевые слова и информационный блок публичной карты.</p>

      <nav class="operation-tabs operation-tabs-single" role="tablist" aria-label="Настройки проекта">
        <button class="operation-tab" id="operation-tab-project-settings" type="button" role="tab"
                aria-selected="true" aria-controls="operation-project-settings"
                data-operation-tab="project-settings" data-operation-group="project">
          Оформление и метаданные
        </button>
      </nav>

      <section class="operation-panel transfer-mode" id="operation-project-settings" role="tabpanel"
               aria-labelledby="operation-tab-project-settings"
               data-operation-panel="project-settings" data-operation-group="project">
        <div class="mode-heading">
          <div>
            <h4>Оформление и метаданные</h4>
            <p>Название используется в H1, title, PWA manifest, OpenGraph/Twitter и остальных служебных тегах страницы.</p>
          </div>
        </div>

        <p class="project-settings-meta">
          <span>Последнее изменение</span><time id="project-settings-updated-at">—</time>
        </p>

        <form id="project-settings-form" data-task-form="project">
          <div class="form-fields project-settings-grid">
            <label>Название проекта
              <input name="projectName" type="text" maxlength="160" required
                     placeholder="Например: Выделенные полосы в России">
              <small>Одно значение транзитом попадает в видимый заголовок и служебные title/meta/PWA-теги.</small>
            </label>

            <label>Ключевые слова
              <textarea name="keywords" rows="5"
                        placeholder="выделенные полосы\nобщественный транспорт\nрейтинг городов"></textarea>
              <small>По одному на строку или через запятую. Используются в meta keywords; дубликаты удаляются.</small>
            </label>

            <section class="project-settings-section" aria-labelledby="project-metrics-title">
              <div>
                <h5 id="project-metrics-title">Сбор метрик</h5>
                <p>Код интеграции фиксирован. Пустой ID отключает соответствующий счётчик и внешний скрипт не загружается.</p>
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
                  <small>Measurement ID GA4 вида G-…. Регистр нормализуется автоматически.</small>
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
      <p class="notice" data-task-notice="project" role="status"></p>
    `;
    controlCard.append(panel);
  }

  const form = document.querySelector('#project-settings-form');

  if (form) {
    const projectName = form.elements.namedItem('projectName');
    const keywords = form.elements.namedItem('keywords');
    const yandexMetrikaId = form.elements.namedItem('yandexMetrikaId');
    const googleAnalyticsId = form.elements.namedItem('googleAnalyticsId');
    const footerHtml = form.elements.namedItem('footerHtml');
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
      keywords.value = settings.keywords.join('\n');
      yandexMetrikaId.value = settings.yandexMetrikaId ?? '';
      googleAnalyticsId.value = settings.googleAnalyticsId ?? '';
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
      setMessage('Проверяем и сохраняем…');
      try {
        const response = await fetch('/api/admin/project-settings', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            projectName: projectName.value.trim(),
            keywords: splitKeywords(keywords.value),
            yandexMetrikaId: yandexMetrikaId.value.trim() || null,
            googleAnalyticsId: googleAnalyticsId.value.trim() || null,
            footerHtml: footerHtml.value,
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        applySettings(payload.settings);
        setMessage('Настройки проекта сохранены.', 'success');
      } catch (error) {
        setMessage(error.message, 'error');
      }
    });

    void load();
  }
}