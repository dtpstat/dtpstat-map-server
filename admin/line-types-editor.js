if (typeof document !== 'undefined') {
  const host = document.querySelector('#line-types-editor-host');
  if (host) {
    host.innerHTML = `
      <div class="mode-heading">
        <div>
          <h4>Типы линий</h4>
          <p>CODE генерируется базой автоматически. NAME приходит из импорта и используется для сопоставления. TITLE — редактируемая подпись легенды.</p>
        </div>
      </div>
      <form id="line-types-form">
        <div class="line-types-table" id="line-types-table"></div>
        <div class="line-types-actions">
          <button type="submit">Сохранить подписи и стили</button>
        </div>
      </form>
      <p class="line-types-message" id="line-types-message" role="status"></p>
    `;

    const table = host.querySelector('#line-types-table');
    const form = host.querySelector('#line-types-form');
    const message = host.querySelector('#line-types-message');

    function setMessage(text, tone = '') {
      message.textContent = text;
      message.className = `line-types-message${tone ? ` is-${tone}` : ''}`;
    }

    function readOnlyField(labelText, name, value) {
      const label = document.createElement('label');
      label.textContent = labelText;
      const input = document.createElement('input');
      input.name = name;
      input.value = value;
      input.readOnly = true;
      label.append(input);
      return label;
    }

    function addRow(lineType) {
      const row = document.createElement('div');
      row.className = 'line-type-row';
      row.dataset.geometryCount = String(lineType.geometryCount ?? 0);

      const codeLabel = readOnlyField('CODE', 'code', String(lineType.code));
      const nameLabel = readOnlyField('NAME из импорта', 'name', lineType.name);

      const titleLabel = document.createElement('label');
      titleLabel.textContent = 'TITLE в легенде';
      const titleInput = document.createElement('input');
      titleInput.name = 'title';
      titleInput.required = true;
      titleInput.maxLength = 120;
      titleInput.value = lineType.title ?? lineType.name;
      titleLabel.append(titleInput);

      const colorLabel = document.createElement('label');
      colorLabel.textContent = 'Цвет';
      const colorInput = document.createElement('input');
      colorInput.name = 'color';
      colorInput.type = 'color';
      colorInput.value = lineType.color ?? '#045b69';
      colorLabel.append(colorInput);

      const styleLabel = document.createElement('label');
      styleLabel.textContent = 'Стиль';
      const styleSelect = document.createElement('select');
      styleSelect.name = 'style';
      for (const [value, label] of [
        ['solid', 'Сплошная'],
        ['dashed', 'Штриховая'],
        ['dotted', 'Точечная'],
      ]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = (lineType.style ?? 'solid') === value;
        styleSelect.append(option);
      }
      styleLabel.append(styleSelect);

      const widthLabel = document.createElement('label');
      widthLabel.textContent = 'Толщина';
      const widthInput = document.createElement('input');
      widthInput.name = 'width';
      widthInput.type = 'number';
      widthInput.min = '0.5';
      widthInput.max = '32';
      widthInput.step = '0.5';
      widthInput.required = true;
      widthInput.value = String(lineType.width ?? 4);
      widthLabel.append(widthInput);

      row.append(codeLabel, nameLabel, titleLabel, colorLabel, styleLabel, widthLabel);
      table.append(row);
    }

    function readRows() {
      return [...table.querySelectorAll('.line-type-row')].map((row) => ({
        code: Number(row.querySelector('[name="code"]').value),
        title: row.querySelector('[name="title"]').value.trim(),
        color: row.querySelector('[name="color"]').value,
        style: row.querySelector('[name="style"]').value,
        width: Number(row.querySelector('[name="width"]').value),
      }));
    }

    async function load({ changed = false } = {}) {
      setMessage(changed ? 'Обновляем типы…' : 'Загружаем типы…');
      try {
        const response = await fetch('/api/line-types', {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        table.replaceChildren();
        for (const lineType of payload.lineTypes) addRow(lineType);
        setMessage(
          changed
            ? `Справочник обновлён. Типов: ${payload.lineTypes.length}`
            : `Типов: ${payload.lineTypes.length}`,
          changed ? 'success' : '',
        );
      } catch (error) {
        setMessage(error.message, 'error');
      }
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      setMessage('Сохраняем…');
      try {
        const response = await fetch('/api/admin/line-types', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ lineTypes: readRows() }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        table.replaceChildren();
        for (const lineType of payload.lineTypes) addRow(lineType);
        setMessage('Подписи и стили сохранены.', 'success');
        window.dispatchEvent(new CustomEvent('dtpstat:line-types-changed'));
      } catch (error) {
        setMessage(error.message, 'error');
      }
    });

    window.addEventListener('dtpstat:line-types-changed', () => {
      void load({ changed: true });
    });

    void load();
  }
}
