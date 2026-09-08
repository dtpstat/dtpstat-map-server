if (typeof document !== 'undefined') {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/admin/public-download-name.css';
  document.head.append(stylesheet);

  function mountEditor() {
    const projectForm = document.querySelector('#project-settings-form');
    const operation = document.querySelector('#operation-project-settings');
    const projectMessage = document.querySelector('#project-settings-message');

    if (!projectForm || !operation || !projectMessage) return false;
    if (document.querySelector('#public-download-name-form')) return true;

    const section = document.createElement('section');
    section.className = 'project-settings-section';
    section.id = 'project-public-download-name';
    section.innerHTML = `
      <div>
        <h5>Имя файлов открытых данных</h5>
        <p>Задаётся только базовое имя. Сервер сам добавляет <code>.geojson</code> и <code>.csv</code>; это же имя используется в публичных URL и для файлов на диске.</p>
      </div>
      <form id="public-download-name-form" class="project-download-name-form">
        <label>Базовое имя файла
          <input name="publicDownloadName" type="text" maxlength="120" required
                 autocomplete="off" spellcheck="false" placeholder="bus-lanes">
          <small>Без расширения и без символов пути <code>/</code> или <code>\\</code>.</small>
        </label>
        <div class="project-download-name-preview" aria-live="polite">
          <span>GeoJSON:</span><code data-download-preview="geojson">/bus-lanes.geojson</code>
          <span>CSV:</span><code data-download-preview="csv">/bus-lanes.csv</code>
        </div>
        <button class="secondary" type="submit">Сохранить имя файлов</button>
      </form>
      <p class="project-settings-message" id="public-download-name-message" role="status"></p>
    `;
    operation.insertBefore(section, projectMessage);

    const form = section.querySelector('#public-download-name-form');
    const input = form.elements.namedItem('publicDownloadName');
    const saveButton = form.querySelector('button[type="submit"]');
    const message = section.querySelector('#public-download-name-message');
    const geoJsonPreview = section.querySelector('[data-download-preview="geojson"]');
    const csvPreview = section.querySelector('[data-download-preview="csv"]');

    function setMessage(text, tone = '') {
      message.textContent = text;
      message.className = `project-settings-message${tone ? ` is-${tone}` : ''}`;
    }

    function baseName() {
      return input.value.trim() || 'bus-lanes';
    }

    function renderPreview() {
      const name = baseName();
      geoJsonPreview.textContent = `/${name}.geojson`;
      csvPreview.textContent = `/${name}.csv`;
    }

    input.addEventListener('input', renderPreview);

    async function load() {
      try {
        const response = await fetch('/api/admin/project-settings', {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        input.maxLength = Number(payload.editor?.publicDownloadName?.maxLength) || 120;
        input.value = payload.settings?.publicDownloadName || 'bus-lanes';
        renderPreview();
      } catch (error) {
        setMessage(`Не удалось загрузить имя файлов: ${error.message}`, 'error');
      }
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      saveButton.disabled = true;
      setMessage('Сохраняем имя и пересобираем публичные файлы…');
      try {
        const response = await fetch('/api/admin/project-settings/public-download-name', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ publicDownloadName: input.value.trim() }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        input.value = payload.settings.publicDownloadName;
        renderPreview();
        setMessage('Имя файлов и публичные URL обновлены.', 'success');
        window.dispatchEvent(new CustomEvent('dtpstat:project-settings-changed'));
      } catch (error) {
        setMessage(error.message, 'error');
      } finally {
        saveButton.disabled = false;
      }
    });

    renderPreview();
    void load();
    return true;
  }

  const session = await globalThis.dtpstatAdminSession?.catch(() => null);
  const canManageInterface = Boolean(
    session?.user?.isSuperuser || session?.user?.canManageInterface,
  );

  if (canManageInterface && !mountEditor()) {
    const observer = new MutationObserver(() => {
      if (mountEditor()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
}
