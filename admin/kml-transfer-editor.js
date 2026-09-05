if (typeof document !== 'undefined') {
  const panel = document.querySelector('#operation-kml-external');
  const externalForm = document.querySelector('#kml-form');
  if (panel && externalForm) {
    const externalHint = externalForm
      .querySelector('textarea[name="sources"]')
      ?.closest('label')
      ?.querySelector('small');
    if (externalHint) {
      externalHint.textContent = 'Каждый слой: name + multiple (1 или 2) + необязательный type. type — NAME бизнес-типа из источника, а не CODE и не геометрический LineString/MultiLineString. Отсутствующий NAME создаётся автоматически; CODE назначает БД, TITLE сначала равен NAME.';
    }

    const transfer = document.createElement('div');
    transfer.className = 'transfer-mode portable-kml-transfer';
    transfer.innerHTML = `
      <div class="mode-heading">
        <div>
          <h4>Импорт / экспорт KML-снимка</h4>
          <p>Переносимый KML хранит геометрию отдельно от бизнес-типа. Справочник code/name/title/color/style/width записывается один раз в metadata документа и проверяется до линий.</p>
        </div>
        <a class="secondary-link" href="/api/admin/export/lines.kml" download>Выгрузить KML</a>
      </div>
      <form id="line-kml-transfer-form" data-task-form="kml">
        <div class="form-fields">
          <label>KML-снимок линий
            <input name="file" type="file"
                   accept=".kml,application/vnd.google-earth.kml+xml,application/xml,text/xml"
                   required>
            <small>Сначала обрабатывается Document metadata: numeric code, импортный NAME, TITLE и стили. Затем Placemark с numeric businessTypeCode и геометрией LineString/MultiGeometry. На другом сервере типы сопоставляются по NAME, а локальный CODE для новых типов генерирует его БД.</small>
          </label>
        </div>
        <button type="submit">Импортировать KML-снимок</button>
      </form>
    `;
    panel.insertBefore(transfer, externalForm);

    const form = transfer.querySelector('#line-kml-transfer-form');
    const notice = document.querySelector('[data-task-notice="kml"]');

    function setNotice(message, tone = 'warning') {
      if (!notice) return;
      notice.textContent = `Линии данных: ${message}`;
      notice.className = `notice notice-${tone}`;
    }

    async function encodedBody(text) {
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/vnd.google-earth.kml+xml',
      };
      if (text.length < 1024 || typeof CompressionStream !== 'function') {
        return { headers, body: text };
      }
      try {
        const source = new Blob([text], { type: headers['Content-Type'] });
        const compressed = source.stream().pipeThrough(new CompressionStream('gzip'));
        const body = await new Response(compressed).blob();
        headers['Content-Encoding'] = 'gzip';
        return { headers, body };
      } catch {
        return { headers, body: text };
      }
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const file = new FormData(form).get('file');
      if (!(file instanceof File) || file.size === 0) return;

      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      setNotice('проверяем и отправляем KML-снимок…');
      try {
        const request = await encodedBody(await file.text());
        const response = await fetch('/api/admin/import/lines.kml', {
          method: 'POST',
          credentials: 'same-origin',
          ...request,
        });
        let payload = null;
        try { payload = await response.json(); } catch { /* empty response */ }
        if (!response.ok) {
          throw new Error(payload?.error ?? `HTTP ${response.status}`);
        }
        setNotice(`KML-задача ${payload.taskId} принята.`, 'success');
        document.querySelector('#refresh-task')?.click();
      } catch (error) {
        setNotice(error.message, 'error');
      } finally {
        submit.disabled = false;
      }
    });
  }
}
