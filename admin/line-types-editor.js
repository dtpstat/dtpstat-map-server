if (typeof document !== 'undefined') {
  const host = document.querySelector('#line-types-editor-host');
  if (host) {
    host.innerHTML = `
      <div class="mode-heading">
        <div>
          <h4>Типы линий</h4>
          <p>type — стабильный код справочника. Имя используется только в легенде; KML автоматически создаёт отсутствующие коды с именем, равным коду.</p>
        </div>
      </div>
      <form id="line-types-form">
        <div class="line-types-table" id="line-types-table"></div>
        <div class="line-types-actions">
          <button class="secondary" type="button" id="add-line-type">Добавить тип</button>
          <button type="submit">Сохранить типы и стили</button>
        </div>
      </form>
      <p class="line-types-message" id="line-types-message" role="status"></p>
    `;

    const table = host.querySelector('#line-types-table');
    const form = host.querySelector('#line-types-form');
    const message = host.querySelector('#line-types-message');
    const addButton = host.querySelector('#add-line-type');

    function setMessage(text, tone = '') {
      message.textContent = text;
      message.className = `line-types-message${tone ? ` is-${tone}` : ''}`;
    }

    function addRow(lineType = {}, focus = false) {
      const row = document.createElement('div');
      row.className = 'line-type-row';
      row.dataset.existing = lineType.id ? 'true' : 'false';
      row.dataset.geometryCount = String(lineType.geometryCount ?? 0);

      const typeLabel = document.createElement('label');
      typeLabel.textContent = 'code';
      const typeInput = document.createElement('input');
      typeInput.name = 'type';
      typeInput.required = true;
      typeInput.maxLength = 64;
      typeInput.value = lineType.type ?? '';
      if (lineType.id) typeInput.readOnly = true;
      typeLabel.append(typeInput);

      const nameLabel = document.createElement('label');
      nameLabel.textContent = 'Имя в легенде';
      const nameInput = document.createElement('input');
      nameInput.name = 'name';
      nameInput.required = true;
      nameInput.maxLength = 120;
      nameInput.value = lineType.name ?? '';
      nameLabel.append(nameInput);

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

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary remove-line-type';
      remove.textContent = '×';
      remove.title = lineType.geometryCount > 0
        ? `Тип используется ${lineType.geometryCount} геометриями`
        : 'Удалить тип';
      remove.disabled = lineType.type === 'default' || (lineType.geometryCount ?? 0) > 0;
      remove.addEventListener('click', () => row.remove());

      row.append(typeLabel, nameLabel, colorLabel, styleLabel, widthLabel, remove);
      table.append(row);
      if (focus) typeInput.focus();
    }

    function readRows() {
      return [...table.querySelectorAll('.line-type-row')].map((row) => ({
        type: row.querySelector('[name="type"]').value.trim(),
        name: row.querySelector('[name="name"]').value.trim(),
        color: row.querySelector('[name="color"]').value,
        style: row.querySelector('[name="style"]').value,
        width: Number(row.querySelector('[name="width"]').value),
      }));
    }

    async function load({ changed = false } = {}) {
      setMessage(changed ? 'Обновляем типы после импорта…' : 'Загружаем типы…');
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
            ? `Справочник обновлён после импорта. Типов: ${payload.lineTypes.length}`
            : `Типов: ${payload.lineTypes.length}`,
          changed ? 'success' : '',
        );
      } catch (error) {
        setMessage(error.message, 'error');
      }
    }

    addButton.addEventListener('click', () => addRow({}, true));
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
        setMessage('Типы и стили сохранены.', 'success');
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
