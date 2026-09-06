const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = '/admin/report-config.css';
document.head.append(stylesheet);

const taskTabs = document.querySelector('.task-tabs');
const controlCard = document.querySelector('.control-card');

if (taskTabs && controlCard && !document.querySelector('[data-task-tab="report"]')) {
  const tab = document.createElement('button');
  tab.className = 'task-tab';
  tab.id = 'tab-report';
  tab.type = 'button';
  tab.role = 'tab';
  tab.setAttribute('aria-selected', 'false');
  tab.setAttribute('aria-controls', 'panel-report');
  tab.dataset.taskTab = 'report';
  tab.textContent = 'Расчёты';
  taskTabs.append(tab);

  const panel = document.createElement('article');
  panel.className = 'task-panel';
  panel.id = 'panel-report';
  panel.role = 'tabpanel';
  panel.setAttribute('aria-labelledby', 'tab-report');
  panel.dataset.taskPanel = 'report';
  panel.hidden = true;
  panel.innerHTML = `
    <h3>Расчёты и таблица</h3>
    <p class="panel-description">Безопасный конструктор расчётных показателей, колонок публичного рейтинга и статического CSV. SQL и произвольные имена полей не принимаются.</p>

    <nav class="operation-tabs operation-tabs-single" role="tablist" aria-label="Настройки расчётов">
      <button class="operation-tab" id="operation-tab-report-config" type="button" role="tab"
              aria-selected="true" aria-controls="operation-report-config"
              data-operation-tab="report-config" data-operation-group="report">
        Конструктор отчёта
      </button>
    </nav>

    <section class="operation-panel transfer-mode report-config-editor" id="operation-report-config" role="tabpanel"
             aria-labelledby="operation-tab-report-config"
             data-operation-panel="report-config" data-operation-group="report">
      <div class="mode-heading">
        <div>
          <h4>Материализованный отчёт по городам</h4>
          <p>После сохранения значения пересчитываются в CITY_REPORT_VALUES. Публичная таблица и CSV используют подготовленные значения.</p>
        </div>
      </div>

      <p class="report-config-meta">
        <span>Последнее изменение</span><time id="report-config-updated-at">—</time>
      </p>

      <form id="report-config-form" data-task-form="report">
        <div class="form-fields report-config-sections">
          <section class="report-builder-section">
            <div class="report-section-heading">
              <div>
                <h5>Расчётные метрики</h5>
                <p>Исходное поле/агрегат и последовательность арифметических операций. Все технические значения выбираются только из списков.</p>
              </div>
              <button class="secondary report-add-button" id="report-add-metric" type="button">Добавить метрику</button>
            </div>
            <div id="report-metrics"></div>
          </section>

          <section class="report-builder-section">
            <div class="report-section-heading">
              <div>
                <h5>Публичная таблица</h5>
                <p>Порядок, подписи и формат колонок рейтинга.</p>
              </div>
              <button class="secondary report-add-button" id="report-add-table-column" type="button">Добавить колонку</button>
            </div>
            <div class="report-column-list" id="report-table-columns"></div>
          </section>

          <section class="report-builder-section">
            <div class="report-section-heading">
              <div>
                <h5>CSV</h5>
                <p>Независимый набор колонок статического /bus-lanes.csv. Можно добавлять границы и категорию города.</p>
              </div>
              <button class="secondary report-add-button" id="report-add-csv-column" type="button">Добавить колонку</button>
            </div>
            <div class="report-column-list" id="report-csv-columns"></div>
          </section>

          <section class="report-builder-section">
            <h5>Рейтинг</h5>
            <div class="report-rank-grid">
              <label>Метрика рейтинга
                <select id="report-rank-metric"></select>
              </label>
              <label>Направление
                <select id="report-rank-direction">
                  <option value="desc">Больше — выше</option>
                  <option value="asc">Меньше — выше</option>
                </select>
              </label>
            </div>
          </section>
        </div>
        <button class="task-action" type="submit">Сохранить и пересчитать</button>
      </form>
      <p class="report-config-message" id="report-config-message" role="status"></p>
    </section>
    <p class="notice" data-task-notice="report" role="status"></p>
  `;
  controlCard.append(panel);
}

const form = document.querySelector('#report-config-form');

if (form) {
  const state = {
    config: null,
    catalog: null,
    lineTypes: [],
  };
  let keyCounter = 0;

  const metricsHost = document.querySelector('#report-metrics');
  const tableColumnsHost = document.querySelector('#report-table-columns');
  const csvColumnsHost = document.querySelector('#report-csv-columns');
  const rankMetric = document.querySelector('#report-rank-metric');
  const rankDirection = document.querySelector('#report-rank-direction');
  const updatedAt = document.querySelector('#report-config-updated-at');
  const message = document.querySelector('#report-config-message');

  function setMessage(text, tone = '') {
    message.textContent = text;
    message.className = `report-config-message${tone ? ` is-${tone}` : ''}`;
  }

  function formatUpdatedAt(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('ru-RU');
  }

  function clone(value) {
    return structuredClone(value);
  }

  function generatedMetricKey() {
    keyCounter += 1;
    if (globalThis.crypto?.randomUUID) {
      return `metric_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    }
    return `metric_${Date.now().toString(36)}_${keyCounter.toString(36)}`;
  }

  function option(value, label) {
    const element = document.createElement('option');
    element.value = String(value);
    element.textContent = label;
    return element;
  }

  function select(options, selected) {
    const element = document.createElement('select');
    for (const item of options) {
      element.append(option(item.value, item.label));
    }
    element.value = String(selected ?? options[0]?.value ?? '');
    return element;
  }

  function fieldDefinition(key) {
    return state.catalog.fields.find((field) => field.key === key);
  }

  function fieldsFor(kind) {
    return state.catalog.fields
      .filter((field) => field.sourceKinds.includes(kind))
      .map((field) => ({ value: field.key, label: field.label }));
  }

  function defaultOperand(kind = 'aggregate') {
    if (kind === 'constant') {
      return { kind, value: state.catalog.constants[0] };
    }
    const field = state.catalog.fields.find((item) => item.sourceKinds.includes(kind));
    if (kind === 'field') return { kind, field: field.key };
    return {
      kind: 'aggregate',
      field: field.key,
      aggregate: field.aggregates[0],
      groupBy: 'none',
    };
  }

  function normalizeReferences() {
    const keys = new Set(state.config.metrics.map((metric) => metric.key));
    const fallback = state.config.metrics[0]?.key;
    for (const columns of [state.config.tableColumns, state.config.csvColumns]) {
      for (const column of columns) {
        if (column.kind === 'metric' && !keys.has(column.metricKey)) {
          column.metricKey = fallback;
        }
      }
    }
    if (!keys.has(state.config.rank.metricKey)) state.config.rank.metricKey = fallback;
  }

  function metricOptions() {
    return state.config.metrics.map((metric) => ({
      value: metric.key,
      label: metric.name,
    }));
  }

  function renderOperand(host, getter, setter, { allowConstant = true } = {}) {
    host.replaceChildren();
    const operand = getter();
    const kinds = [
      { value: 'field', label: 'Поле города' },
      { value: 'aggregate', label: 'Агрегат геометрий' },
      ...(allowConstant ? [{ value: 'constant', label: 'Константа' }] : []),
    ];

    const kindLabel = document.createElement('label');
    kindLabel.textContent = 'Источник';
    const kindSelect = select(kinds, operand.kind);
    kindLabel.append(kindSelect);
    host.append(kindLabel);
    kindSelect.addEventListener('change', () => {
      setter(defaultOperand(kindSelect.value));
      renderAll();
    });

    if (operand.kind === 'constant') {
      const label = document.createElement('label');
      label.textContent = 'Значение';
      const control = select(
        state.catalog.constants.map((value) => ({ value, label: String(value) })),
        operand.value,
      );
      label.append(control);
      control.addEventListener('change', () => {
        operand.value = Number(control.value);
      });
      host.append(label);
      return;
    }

    const fieldLabel = document.createElement('label');
    fieldLabel.textContent = operand.kind === 'aggregate' ? 'Поле геометрии' : 'Поле';
    const fieldSelect = select(fieldsFor(operand.kind), operand.field);
    fieldLabel.append(fieldSelect);
    host.append(fieldLabel);
    fieldSelect.addEventListener('change', () => {
      operand.field = fieldSelect.value;
      if (operand.kind === 'aggregate') {
        const definition = fieldDefinition(operand.field);
        operand.aggregate = definition.aggregates[0];
      }
      renderAll();
    });

    if (operand.kind !== 'aggregate') return;

    const definition = fieldDefinition(operand.field);
    const aggregateLabel = document.createElement('label');
    aggregateLabel.textContent = 'Агрегат';
    const aggregateSelect = select(
      state.catalog.aggregates
        .filter((aggregate) => definition.aggregates.includes(aggregate.key))
        .map((aggregate) => ({ value: aggregate.key, label: aggregate.label })),
      operand.aggregate,
    );
    aggregateLabel.append(aggregateSelect);
    host.append(aggregateLabel);
    aggregateSelect.addEventListener('change', () => {
      operand.aggregate = aggregateSelect.value;
    });

    const groupingOptions = state.catalog.groupings
      .filter((grouping) => grouping.key === 'none' || state.lineTypes.length > 0)
      .map((grouping) => ({ value: grouping.key, label: grouping.label }));
    const groupLabel = document.createElement('label');
    groupLabel.textContent = 'Группировка / выбор группы';
    const groupSelect = select(groupingOptions, operand.groupBy ?? 'none');
    groupLabel.append(groupSelect);
    host.append(groupLabel);
    groupSelect.addEventListener('change', () => {
      operand.groupBy = groupSelect.value;
      if (operand.groupBy === 'line_type.name') {
        operand.groupValue = state.lineTypes[0]?.name;
      } else {
        delete operand.groupValue;
      }
      renderAll();
    });

    if (operand.groupBy === 'line_type.name') {
      const valueLabel = document.createElement('label');
      valueLabel.textContent = 'Группа';
      const valueSelect = select(
        state.lineTypes.map((lineType) => ({
          value: lineType.name,
          label: lineType.title && lineType.title !== lineType.name
            ? `${lineType.title} — ${lineType.name}`
            : lineType.name,
        })),
        operand.groupValue,
      );
      valueLabel.append(valueSelect);
      host.append(valueLabel);
      valueSelect.addEventListener('change', () => {
        operand.groupValue = valueSelect.value;
      });
    }
  }

  function renderMetrics() {
    metricsHost.replaceChildren();
    state.config.metrics.forEach((metric, metricIndex) => {
      const card = document.createElement('article');
      card.className = 'report-metric-card';

      const header = document.createElement('div');
      header.className = 'report-card-heading';
      const title = document.createElement('div');
      const nameLabel = document.createElement('label');
      nameLabel.textContent = 'Название метрики';
      const name = document.createElement('input');
      name.type = 'text';
      name.maxLength = 100;
      name.required = true;
      name.value = metric.name;
      nameLabel.append(name);
      const key = document.createElement('code');
      key.textContent = metric.key;
      title.append(nameLabel, key);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger report-small-button';
      remove.textContent = 'Удалить';
      remove.disabled = state.config.metrics.length <= 1;
      header.append(title, remove);
      card.append(header);

      name.addEventListener('change', () => {
        metric.name = name.value.trim() || metric.name;
        renderAll();
      });
      remove.addEventListener('click', () => {
        state.config.metrics.splice(metricIndex, 1);
        normalizeReferences();
        renderAll();
      });

      const source = document.createElement('section');
      source.className = 'report-operand-grid';
      renderOperand(
        source,
        () => metric.source,
        (value) => { metric.source = value; },
        { allowConstant: false },
      );
      card.append(source);

      const operationsHeading = document.createElement('div');
      operationsHeading.className = 'report-subheading';
      const operationsTitle = document.createElement('strong');
      operationsTitle.textContent = 'Арифметика';
      const addOperation = document.createElement('button');
      addOperation.type = 'button';
      addOperation.className = 'secondary report-small-button';
      addOperation.textContent = 'Добавить операцию';
      operationsHeading.append(operationsTitle, addOperation);
      card.append(operationsHeading);
      addOperation.addEventListener('click', () => {
        metric.operations.push({
          operator: state.catalog.operators[0].key,
          operand: defaultOperand('constant'),
        });
        renderAll();
      });

      const operations = document.createElement('div');
      operations.className = 'report-operation-list';
      metric.operations.forEach((operation, operationIndex) => {
        const row = document.createElement('div');
        row.className = 'report-operation-row';
        const operatorLabel = document.createElement('label');
        operatorLabel.textContent = 'Операция';
        const operatorSelect = select(
          state.catalog.operators.map((item) => ({ value: item.key, label: item.label })),
          operation.operator,
        );
        operatorLabel.append(operatorSelect);
        operatorSelect.addEventListener('change', () => {
          operation.operator = operatorSelect.value;
        });

        const operandHost = document.createElement('div');
        operandHost.className = 'report-operation-operand report-operand-grid';
        renderOperand(
          operandHost,
          () => operation.operand,
          (value) => { operation.operand = value; },
        );
        const removeOperation = document.createElement('button');
        removeOperation.type = 'button';
        removeOperation.className = 'danger report-small-button report-remove-operation';
        removeOperation.textContent = '×';
        removeOperation.title = 'Удалить операцию';
        removeOperation.addEventListener('click', () => {
          metric.operations.splice(operationIndex, 1);
          renderAll();
        });
        row.append(operatorLabel, operandHost, removeOperation);
        operations.append(row);
      });
      if (!metric.operations.length) {
        const empty = document.createElement('p');
        empty.className = 'report-empty';
        empty.textContent = 'Без дополнительных арифметических операций.';
        operations.append(empty);
      }
      card.append(operations);
      metricsHost.append(card);
    });
  }

  function defaultColumn(kind, csv = false) {
    if (kind === 'metric') {
      return {
        kind,
        metricKey: state.config.metrics[0].key,
        title: state.config.metrics[0].name,
        scale: 1,
        decimals: 1,
      };
    }
    const kindCatalog = csv ? state.catalog.csvColumnKinds : state.catalog.tableColumnKinds;
    const definition = kindCatalog.find((item) => item.key === kind);
    return { kind, title: definition?.label ?? kind };
  }

  function renderColumns(host, columns, catalog, { csv = false } = {}) {
    host.replaceChildren();
    columns.forEach((column, index) => {
      const row = document.createElement('div');
      row.className = 'report-column-row';

      const kindLabel = document.createElement('label');
      kindLabel.textContent = 'Данные';
      const kindSelect = select(
        catalog.map((item) => ({ value: item.key, label: item.label })),
        column.kind,
      );
      kindLabel.append(kindSelect);
      kindSelect.addEventListener('change', () => {
        columns[index] = defaultColumn(kindSelect.value, csv);
        renderAll();
      });

      const titleLabel = document.createElement('label');
      titleLabel.textContent = csv ? 'Заголовок CSV' : 'Заголовок';
      const title = document.createElement('input');
      title.type = 'text';
      title.maxLength = 100;
      title.required = true;
      title.value = column.title;
      titleLabel.append(title);
      title.addEventListener('change', () => {
        column.title = title.value.trim() || column.title;
      });

      const details = document.createElement('div');
      details.className = 'report-column-details';
      if (column.kind === 'metric') {
        const metricLabel = document.createElement('label');
        metricLabel.textContent = 'Метрика';
        const metricSelect = select(metricOptions(), column.metricKey);
        metricLabel.append(metricSelect);
        metricSelect.addEventListener('change', () => {
          column.metricKey = metricSelect.value;
        });

        const scaleLabel = document.createElement('label');
        scaleLabel.textContent = 'Масштаб';
        const scaleSelect = select(
          state.catalog.scales.map((item) => ({ value: item.value, label: item.label })),
          column.scale ?? 1,
        );
        scaleLabel.append(scaleSelect);
        scaleSelect.addEventListener('change', () => {
          column.scale = Number(scaleSelect.value);
        });

        const decimalsLabel = document.createElement('label');
        decimalsLabel.textContent = 'Знаков после запятой';
        const decimalOptions = state.catalog.decimals.map((value) => ({
          value: value === null ? 'raw' : value,
          label: value === null ? 'как рассчитано' : String(value),
        }));
        const decimalsSelect = select(
          decimalOptions,
          column.decimals === null ? 'raw' : column.decimals,
        );
        decimalsLabel.append(decimalsSelect);
        decimalsSelect.addEventListener('change', () => {
          column.decimals = decimalsSelect.value === 'raw'
            ? null
            : Number(decimalsSelect.value);
        });
        details.append(metricLabel, scaleLabel, decimalsLabel);
      }

      const actions = document.createElement('div');
      actions.className = 'report-row-actions';
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'secondary report-small-button';
      up.textContent = '↑';
      up.title = 'Выше';
      up.disabled = index === 0;
      up.addEventListener('click', () => {
        [columns[index - 1], columns[index]] = [columns[index], columns[index - 1]];
        renderAll();
      });
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'secondary report-small-button';
      down.textContent = '↓';
      down.title = 'Ниже';
      down.disabled = index === columns.length - 1;
      down.addEventListener('click', () => {
        [columns[index + 1], columns[index]] = [columns[index], columns[index + 1]];
        renderAll();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger report-small-button';
      remove.textContent = '×';
      remove.title = 'Удалить колонку';
      remove.disabled = columns.length <= 1 || (!csv && column.kind === 'city' && columns.filter((item) => item.kind === 'city').length === 1);
      remove.addEventListener('click', () => {
        columns.splice(index, 1);
        renderAll();
      });
      actions.append(up, down, remove);
      row.append(kindLabel, titleLabel, details, actions);
      host.append(row);
    });
  }

  function renderRank() {
    rankMetric.replaceChildren(...metricOptions().map((item) => option(item.value, item.label)));
    rankMetric.value = state.config.rank.metricKey;
    rankDirection.value = state.config.rank.direction;
  }

  function renderAll() {
    if (!state.config || !state.catalog) return;
    normalizeReferences();
    updatedAt.textContent = formatUpdatedAt(state.config.updatedAt);
    renderMetrics();
    renderColumns(
      tableColumnsHost,
      state.config.tableColumns,
      state.catalog.tableColumnKinds,
    );
    renderColumns(
      csvColumnsHost,
      state.config.csvColumns,
      state.catalog.csvColumnKinds,
      { csv: true },
    );
    renderRank();
  }

  rankMetric.addEventListener('change', () => {
    state.config.rank.metricKey = rankMetric.value;
  });
  rankDirection.addEventListener('change', () => {
    state.config.rank.direction = rankDirection.value;
  });

  document.querySelector('#report-add-metric').addEventListener('click', () => {
    const source = defaultOperand('aggregate');
    const key = generatedMetricKey();
    state.config.metrics.push({
      key,
      name: `Метрика ${state.config.metrics.length + 1}`,
      source,
      operations: [],
    });
    renderAll();
  });

  document.querySelector('#report-add-table-column').addEventListener('click', () => {
    state.config.tableColumns.push(defaultColumn('metric'));
    renderAll();
  });

  document.querySelector('#report-add-csv-column').addEventListener('click', () => {
    state.config.csvColumns.push(defaultColumn('metric', true));
    renderAll();
  });

  async function load() {
    setMessage('Загружаем конфигурацию…');
    try {
      const response = await fetch('/api/admin/report-config', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      state.config = clone(payload.config);
      state.catalog = payload.catalog;
      state.lineTypes = payload.lineTypes ?? [];
      renderAll();
      setMessage('Конфигурация загружена.');
    } catch (error) {
      setMessage(error.message, 'error');
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity() || !state.config) return;
    setMessage('Сохраняем конфигурацию и пересчитываем города…');
    try {
      const response = await fetch('/api/admin/report-config', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          metrics: state.config.metrics,
          tableColumns: state.config.tableColumns,
          csvColumns: state.config.csvColumns,
          rank: state.config.rank,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      state.config = clone(payload.config);
      renderAll();
      const cities = payload.materialized?.cities ?? 0;
      const metrics = payload.materialized?.metrics ?? state.config.metrics.length;
      setMessage(`Сохранено. Пересчитано городов: ${cities}; метрик: ${metrics}. CSV обновлён.`, 'success');
    } catch (error) {
      setMessage(error.message, 'error');
    }
  });

  void load();
}
