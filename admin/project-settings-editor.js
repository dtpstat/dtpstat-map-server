const form = document.querySelector('#project-settings-form');

if (form) {
  const projectName = form.elements.namedItem('projectName');
  const keywords = form.elements.namedItem('keywords');
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

  function insertSnippet(snippet, cursorOffset = null) {
    const start = footerHtml.selectionStart ?? footerHtml.value.length;
    const end = footerHtml.selectionEnd ?? start;
    const selected = footerHtml.value.slice(start, end);
    const content = snippet.replace('{{selection}}', selected || 'Текст');
    footerHtml.setRangeText(content, start, end, 'end');
    footerHtml.focus();
    if (cursorOffset !== null && !selected) {
      const position = start + cursorOffset;
      footerHtml.setSelectionRange(position, position);
    }
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

  async function load() {
    setMessage('Загружаем настройки…');
    try {
      const response = await fetch('/api/admin/project-settings', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      projectName.value = payload.settings.projectName;
      keywords.value = payload.settings.keywords.join('\n');
      footerHtml.value = payload.settings.footerHtml;
      updatedAt.textContent = formatUpdatedAt(payload.settings.updatedAt);
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
          footerHtml: footerHtml.value,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      projectName.value = payload.settings.projectName;
      keywords.value = payload.settings.keywords.join('\n');
      footerHtml.value = payload.settings.footerHtml;
      updatedAt.textContent = formatUpdatedAt(payload.settings.updatedAt);
      setMessage('Настройки проекта сохранены.', 'success');
    } catch (error) {
      setMessage(error.message, 'error');
    }
  });

  void load();
}
