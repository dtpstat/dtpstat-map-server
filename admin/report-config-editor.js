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
    <p class="panel-description">Безопасный конструктор расчётных показателей, колонок публичного рейтинга и статического CSV. SQL и произвольные технические имена не принимаются.</p>

    <section class="transfer-mode report-config-editor">
      <div class="mode-heading">
        <div>
          <h4>Материализованный отчёт по городам</h4>
          <p>После сохранения значения пересчитываются в CITY_REPORT_VALUES. Публичная таблица и CSV используют подготовленные значения.</p>
        </div>
      </div>

      <p class="report-config-meta">
        <span>Последнее изменение</span><time id="report-config-updated-at">—</time>
      </p>

      <nav class="report-view-tabs" role="tablist" aria-label="Разделы конструктора расчётов">
        <button class="report-view-tab is-active" type="button" role="tab" aria-selected="true"
                aria-controls="report-view-metrics" data-report-view-tab="metrics">Метрики</button>
        <button class="report-view-tab" type="button" role="tab" aria-selected="false"
                aria-controls="report-view-table" data-report-view-tab="table">Публичная таблица</button>
        <button class="report-view-tab" type="button" role="tab" aria-selected="false"
                aria-controls="report-view-csv" data-report-view-tab="csv">CSV</button>
        <button class="report-view-tab" type="button" role="tab" aria-selected="false"
                aria-controls="report-view-rank" data-report-view-tab="rank">Рейтинг</button>
      </nav>

      <form id="report-config-form" data-task-form="report">
        <div class="form-fields report-config-sections">
          <section class="report-builder-section report-view-panel" id="report-view-metrics"
                   role="tabpanel" data-report-view-panel="metrics">
            <div class="report-section-heading">
              <div>
                <h5>Расчётные метрики</h5>
                <p>Метрика может использовать поля города, агрегаты геометрий и уже определённые метрики. Зависимости пересчитываются автоматически; циклы запрещены. Карточки и операции можно переставлять ↑/↓.</p>
              </div>
              <button class="secondary report-add-button" id="report-add-metric" type="button">Добавить метрику</button>
            </div>
            <div id="report-metrics"></div>
          </section>

          <section class="report-builder-section report-view-panel" id="report-view-table"
                   role="tabpanel" data-report-view-panel="table" hidden>
            <div class="report-section-heading">
              <div>
                <h5>Публичная таблица</h5>
                <p>Порядок, подписи, формат чисел и условное оформление диапазонов. Диапазоны задаются в отображаемых единицах после масштаба.</p>
              </div>
              <button class="secondary report-add-button" id="report-add-table-column" type="button">Добавить колонку</button>
            </div>
            <div class="report-column-list" id="report-table-columns"></div>
          </section>

          <section class="report-builder-section report-view-panel" id="report-view-csv"
                   role="tabpanel" data-report-view-panel="csv" hidden>
            <div class="report-section-heading">
              <div>
                <h5>CSV</h5>
                <p>Независимый набор колонок статического /bus-lanes.csv. Экранное условное форматирование в CSV не переносится.</p>
              </div>
              <button class="secondary report-add-button" id="report-add-csv-column" type="button">Добавить колонку</button>
            </div>
            <div class="report-column-list" id="report-csv-columns"></div>
          </section>

          <section class="report-builder-section report-view-panel" id="report-view-rank"
                   role="tabpanel" data-report-view-panel="rank" hidden>
            <div class="report-section-heading">
              <div>
                <h5>Рейтинг</h5>
                <p>Критерии применяются последовательно сверху вниз внутри каждой категории городов: сначала первый, при равенстве — второй и так далее. Последний резервный критерий всегда — название города.</p>
              </div>
              <button class="secondary report-add-button" id="report-add-rank-sort" type="button">Добавить критерий</button>
            </div>
            <div class="report-column-list" id="report-rank-sort"></div>
          </section>
        </div>
        <button class="task-action report-save-button" type="submit">Сохранить и пересчитать</button>
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
    view: 'metrics',
  };
  let keyCounter = 0;

  const metricsHost = document.querySelector('#report-metrics');
  const tableColumnsHost = document.querySelector('#report-table-columns');
  const csvColumnsHost = document.querySelector('#report-csv-columns');
  const rankSortHost = document.querySelector('#report-rank-sort');
  const addRankSort = document.querySelector('#report-add-rank-sort');
  const updatedAt = document.querySelector('#report-config-updated-at');
  const message = document.querySelector('#report-config-message');
  const viewTabs = [...document.querySelectorAll('[data-report-view-tab]')];
  const viewPanels = [...document.querySelectorAll('[data-report-view-panel]')];

  function setMessage(text, tone = '') {
    message.textContent = text;
    message.className = `report-config-message${tone ? ` is-${tone}` : ''}`;
  }

  function setView(view) {
    state.view = view;
    for (const tab of viewTabs) {
      const active = tab.dataset.reportViewTab === view;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    }
    for (const panel of viewPanels) {
      panel.hidden = panel.dataset.reportViewPanel !== view;
    }
  }

  for (const tab of viewTabs) {
    tab.addEventListener('click', () => setView(tab.dataset.reportViewTab));
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
    for (const item of options) element.append(option(item.value, item.label));
    element.value = String(selected ?? options[0]?.value ?? '');
    return element;
  }

  function fieldDefinition(key) {
    return state.catalog.fields.find((field) => field.key === key);
  }

  function aggregateDefinition(key) {
    return state.catalog.aggregates.find((aggregate) => aggregate.key === key);
  }

  function operatorDefinition(key) {
    return state.catalog.operators.find((operator) => operator.key === key);
  }

  function fieldsFor(kind) {
    return state.catalog.fields
      .filter((field) => field.sourceKinds.includes(kind))
      .map((field) => ({ value: field.key, label: field.label }));
  }

  function metricByKey(key) {
    return state.config.metrics.find((metric) => metric.key === key);
  }

  function metricDependencyKeys(metric) {
    const dependencies = new Set();
    const collect = (operand) => {
      if (operand?.kind === 'metric' && operand.metricKey) dependencies.add(operand.metricKey);
    };
    collect(metric.source);
    for (const operation of metric.operations ?? []) collect(operation.operand);
    return [...dependencies];
  }

  function metricDependsOn(metricKey, targetKey, visited = new Set()) {
    if (metricKey === targetKey) return true;
    if (visited.has(metricKey)) return false;
    visited.add(metricKey);
    const metric = metricByKey(metricKey);
    if (!metric) return false;
    return metricDependencyKeys(metric).some((dependencyKey) =>
      metricDependsOn(dependencyKey, targetKey, visited));
  }

  function metricOptions({ excludeKey = null, dependencyFor = null } = {}) {
    return state.config.metrics
      .filter((metric) => metric.key !== excludeKey)
      .filter((metric) => !dependencyFor || !metricDependsOn(metric.key, dependencyFor))
      .map((metric) => ({ value: metric.key, label: metric.name }));
  }

  function defaultOperand(kind = 'aggregate', currentMetricKey = null) {
    if (kind === 'constant') return { kind, value: state.catalog.constants[0] };
    if (kind === 'metric') {
      const candidate = metricOptions({
        excludeKey: currentMetricKey,
        dependencyFor: currentMetricKey,
      })[0];
      if (candidate) return { kind, metricKey: candidate.value };
      return defaultOperand('field', currentMetricKey);
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

  function normalizeRankShape() {
    const fallback = state.config.metrics[0]?.key;
    const rank = state.config.rank && typeof state.config.rank === 'object'
      ? state.config.rank
      : {};
    if (!Array.isArray(rank.sort) || rank.sort.length === 0) {
      rank.sort = [{
        metricKey: rank.metricKey ?? fallback,
        direction: rank.direction === 'asc' ? 'asc' : 'desc',
      }];
    }
    state.config.rank = rank;
  }

  function normalizeReferences() {
    const keys = new Set(state.config.metrics.map((metric) => metric.key));
    const fallback = state.config.metrics[0]?.key;
    for (const columns of [state.config.tableColumns, state.config.csvColumns]) {
      for (const column of columns) {
        if (column.kind === 'metric' && !keys.has(column.metricKey)) column.metricKey = fallback;
      }
    }

    normalizeRankShape();
    const usedRankKeys = new Set();
    state.config.rank.sort = state.config.rank.sort.filter((criterion) => {
      if (!criterion || !keys.has(criterion.metricKey) || usedRankKeys.has(criterion.metricKey)) {
        return false;
      }
      usedRankKeys.add(criterion.metricKey);
      criterion.direction = criterion.direction === 'asc' ? 'asc' : 'desc';
      return true;
    });
    if (state.config.rank.sort.length === 0 && fallback) {
      state.config.rank.sort.push({ metricKey: fallback, direction: 'desc' });
    }
    const primary = state.config.rank.sort[0];
    state.config.rank.metricKey = primary?.metricKey ?? fallback;
    state.config.rank.direction = primary?.direction ?? 'desc';
  }

  function metricIsReferencedByMetric(key) {
    return state.config.metrics.some((metric) =>
      metric.key !== key && metricDependencyKeys(metric).includes(key));
  }

  function operandLabel(operand) {
    if (operand.kind === 'constant') return String(operand.value);
    if (operand.kind === 'metric') {
      const metric = metricByKey(operand.metricKey);
      return `Метрика «${metric?.name ?? operand.metricKey}»`;
    }
    const field = fieldDefinition(operand.field);
    const fieldLabel = field?.label ?? operand.field;
    if (operand.kind === 'field') return fieldLabel;
    const aggregate = aggregateDefinition(operand.aggregate);
    const aggregateLabel = aggregate?.label ?? operand.aggregate;
    const group = operand.groupBy === 'line_type.name'
      ? ` [тип: ${operand.groupValue ?? '—'}]`
      : '';
    return `${aggregateLabel}(${fieldLabel})${group}`;
  }

  function metricRpnTokens(metric) {
    const output = [{ kind: 'operand', operand: metric.source }];
    const operators = [];
    for (const operation of metric.operations ?? []) {
      const current = {
        kind: 'operator',
        operator: operation.operator,
        priority: Number.isInteger(operation.priority) ? operation.priority : 1,
      };
      while (operators.length > 0 && operators[operators.length - 1].priority >= current.priority) {
        output.push(operators.pop());
      }
      operators.push(current);
      output.push({ kind: 'operand', operand: operation.operand });
    }
    while (operators.length > 0) output.push(operators.pop());
    return output;
  }

  function expressionPreview(metric) {
    const rpn = metricRpnTokens(metric);
    const stack = [];
    const rpnLabels = [];
    for (const token of rpn) {
      if (token.kind === 'operand') {
        const label = operandLabel(token.operand);
        stack.push(label);
        rpnLabels.push(label);
        continue;
      }
      const symbol = operatorDefinition(token.operator)?.label ?? token.operator;
      const right = stack.pop() ?? '?';
      const left = stack.pop() ?? '?';
      stack.push(`(${left} ${symbol} ${right})`);
      rpnLabels.push(symbol);
    }
    return {
      infix: stack.length === 1 ? stack[0] : 'Некорректное выражение',
      rpn: rpnLabels.join('  '),
    };
  }

  function renderOperand(host, getter, setter, { allowConstant = true, currentMetricKey = null } = {}) {
    host.replaceChildren();
    const operand = getter();
    const dependencyOptions = metricOptions({
      excludeKey: currentMetricKey,
      dependencyFor: currentMetricKey,
    });
    const kindCatalog = state.catalog.operandKinds ?? [
      { key: 'field', label: 'Поле города' },
      { key: 'aggregate', label: 'Агрегат геометрий' },
      { key: 'metric', label: 'Другая метрика' },
      { key: 'constant', label: 'Константа' },
    ];
    const kinds = kindCatalog
      .filter((kind) => allowConstant || kind.key !== 'constant')
      .filter((kind) => kind.key !== 'metric' || dependencyOptions.length > 0)
      .map((kind) => ({ value: kind.key, label: kind.label }));

    const kindLabel = document.createElement('label');
    kindLabel.textContent = 'Источник';
    const kindSelect = select(kinds, operand.kind);
    kindLabel.append(kindSelect);
    host.append(kindLabel);
    kindSelect.addEventListener('change', () => {
      setter(defaultOperand(kindSelect.value, currentMetricKey));
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
        renderAll();
      });
      host.append(label);
      return;
    }

    if (operand.kind === 'metric') {
      const label = document.createElement('label');
      label.textContent = 'Метрика';
      const control = select(dependencyOptions, operand.metricKey);
      label.append(control);
      control.addEventListener('change', () => {
        operand.metricKey = control.value;
        renderAll();
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
      renderAll();
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
      if (operand.groupBy === 'line_type.name') operand.groupValue = state.lineTypes[0]?.name;
      else delete operand.groupValue;
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
        renderAll();
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

      const metricActions = document.createElement('span');
      metricActions.className = 'report-row-actions';
      const upMetric = document.createElement('button');
      upMetric.type = 'button';
      upMetric.className = 'secondary report-small-button';
      upMetric.textContent = '↑';
      upMetric.title = 'Поднять метрику';
      upMetric.disabled = metricIndex === 0;
      upMetric.addEventListener('click', () => {
        [state.config.metrics[metricIndex - 1], state.config.metrics[metricIndex]] = [
          state.config.metrics[metricIndex],
          state.config.metrics[metricIndex - 1],
        ];
        renderAll();
      });
      const downMetric = document.createElement('button');
      downMetric.type = 'button';
      downMetric.className = 'secondary report-small-button';
      downMetric.textContent = '↓';
      downMetric.title = 'Опустить метрику';
      downMetric.disabled = metricIndex === state.config.metrics.length - 1;
      downMetric.addEventListener('click', () => {
        [state.config.metrics[metricIndex + 1], state.config.metrics[metricIndex]] = [
          state.config.metrics[metricIndex],
          state.config.metrics[metricIndex + 1],
        ];
        renderAll();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger report-small-button';
      remove.textContent = 'Удалить';
      remove.title = 'Удалить метрику';
      const dependencyTarget = metricIsReferencedByMetric(metric.key);
      remove.disabled = state.config.metrics.length <= 1 || dependencyTarget;
      if (dependencyTarget) remove.title = 'Сначала уберите ссылки на эту метрику из других метрик';
      metricActions.append(upMetric, downMetric, remove);
      header.append(title, metricActions);
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
        { allowConstant: false, currentMetricKey: metric.key },
      );
      card.append(source);

      const operationsHeading = document.createElement('div');
      operationsHeading.className = 'report-subheading';
      const operationsTitle = document.createElement('strong');
      operationsTitle.textContent = 'Арифметика и приоритет';
      const addOperation = document.createElement('button');
      addOperation.type = 'button';
      addOperation.className = 'secondary report-small-button';
      addOperation.textContent = 'Добавить операцию';
      operationsHeading.append(operationsTitle, addOperation);
      card.append(operationsHeading);

      const priorityHelp = document.createElement('p');
      priorityHelp.className = 'report-priority-help';
      priorityHelp.textContent = 'Больший уровень выполняется раньше. Одинаковый — слева направо. Порядок строк является частью формулы. Ссылки, создающие очевидный цикл, скрываются.';
      card.append(priorityHelp);

      addOperation.addEventListener('click', () => {
        metric.operations.push({
          operator: state.catalog.operators[0].key,
          priority: 1,
          operand: defaultOperand('constant', metric.key),
        });
        renderAll();
      });

      const operations = document.createElement('div');
      operations.className = 'report-operation-list';
      metric.operations.forEach((operation, operationIndex) => {
        if (!Number.isInteger(operation.priority)) operation.priority = 1;
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
          renderAll();
        });

        const priorityLabel = document.createElement('label');
        priorityLabel.textContent = 'Приоритет';
        const prioritySelect = select(
          state.catalog.precedenceLevels.map((item) => ({ value: item.value, label: item.label })),
          operation.priority,
        );
        priorityLabel.append(prioritySelect);
        prioritySelect.addEventListener('change', () => {
          operation.priority = Number(prioritySelect.value);
          renderAll();
        });

        const operandHost = document.createElement('div');
        operandHost.className = 'report-operation-operand report-operand-grid';
        renderOperand(
          operandHost,
          () => operation.operand,
          (value) => { operation.operand = value; },
          { currentMetricKey: metric.key },
        );

        const operationActions = document.createElement('span');
        operationActions.className = 'report-row-actions';
        const upOperation = document.createElement('button');
        upOperation.type = 'button';
        upOperation.className = 'secondary report-small-button';
        upOperation.textContent = '↑';
        upOperation.title = 'Поднять операцию';
        upOperation.disabled = operationIndex === 0;
        upOperation.addEventListener('click', () => {
          [metric.operations[operationIndex - 1], metric.operations[operationIndex]] = [
            metric.operations[operationIndex],
            metric.operations[operationIndex - 1],
          ];
          renderAll();
        });
        const downOperation = document.createElement('button');
        downOperation.type = 'button';
        downOperation.className = 'secondary report-small-button';
        downOperation.textContent = '↓';
        downOperation.title = 'Опустить операцию';
        downOperation.disabled = operationIndex === metric.operations.length - 1;
        downOperation.addEventListener('click', () => {
          [metric.operations[operationIndex + 1], metric.operations[operationIndex]] = [
            metric.operations[operationIndex],
            metric.operations[operationIndex + 1],
          ];
          renderAll();
        });
        const removeOperation = document.createElement('button');
        removeOperation.type = 'button';
        removeOperation.className = 'danger report-small-button report-remove-operation';
        removeOperation.textContent = '×';
        removeOperation.title = 'Удалить операцию';
        removeOperation.addEventListener('click', () => {
          metric.operations.splice(operationIndex, 1);
          renderAll();
        });
        operationActions.append(upOperation, downOperation, removeOperation);
        row.append(operatorLabel, priorityLabel, operandHost, operationActions);
        operations.append(row);
      });
      if (!metric.operations.length) {
        const empty = document.createElement('p');
        empty.className = 'report-empty';
        empty.textContent = 'Без дополнительных арифметических операций.';
        operations.append(empty);
      }
      card.append(operations);

      const preview = expressionPreview(metric);
      const previewBox = document.createElement('section');
      previewBox.className = 'report-expression-preview';
      const previewTitle = document.createElement('strong');
      previewTitle.textContent = 'Фактический порядок вычисления';
      const infix = document.createElement('code');
      infix.textContent = preview.infix;
      const rpnLabel = document.createElement('span');
      rpnLabel.textContent = 'ОПЗ';
      const rpn = document.createElement('code');
      rpn.textContent = preview.rpn;
      previewBox.append(previewTitle, infix, rpnLabel, rpn);
      card.append(previewBox);
      metricsHost.append(card);
    });
  }

  function defaultFormatRule() {
    return {
      min: null,
      max: null,
      bold: true,
      italic: false,
      underline: false,
      strike: false,
      color: null,
      fontSizeStep: 0,
    };
  }

  function renderFormatRules(host, column) {
    if (!Array.isArray(column.formatRules)) column.formatRules = [];
    const box = document.createElement('section');
    box.className = 'report-formatting-box';
    const heading = document.createElement('div');
    heading.className = 'report-subheading';
    const title = document.createElement('strong');
    title.textContent = 'Условное форматирование';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'secondary report-small-button';
    add.textContent = 'Добавить диапазон';
    add.disabled = column.formatRules.length >= (state.catalog.maxFormatRules ?? 8);
    add.addEventListener('click', () => {
      column.formatRules.push(defaultFormatRule());
      renderAll();
    });
    heading.append(title, add);
    box.append(heading);

    const help = document.createElement('p');
    help.className = 'report-format-help';
    help.textContent = 'Границы включаются в диапазон; пустая нижняя/верхняя граница означает −∞/+∞. Для метрик используются отображаемые значения после масштаба. При пересечении диапазонов применяется первый сверху.';
    box.append(help);

    const list = document.createElement('div');
    list.className = 'report-format-rule-list';
    column.formatRules.forEach((rule, ruleIndex) => {
      const row = document.createElement('div');
      row.className = 'report-format-rule-row';

      const minLabel = document.createElement('label');
      minLabel.textContent = 'От';
      const min = document.createElement('input');
      min.type = 'number';
      min.step = 'any';
      min.placeholder = '−∞';
      min.value = rule.min ?? '';
      minLabel.append(min);
      min.addEventListener('change', () => {
        rule.min = min.value === '' ? null : Number(min.value);
      });

      const maxLabel = document.createElement('label');
      maxLabel.textContent = 'До';
      const max = document.createElement('input');
      max.type = 'number';
      max.step = 'any';
      max.placeholder = '+∞';
      max.value = rule.max ?? '';
      maxLabel.append(max);
      max.addEventListener('change', () => {
        rule.max = max.value === '' ? null : Number(max.value);
      });

      const styleBox = document.createElement('div');
      styleBox.className = 'report-format-style-controls';
      const styleOptions = [
        ['bold', 'Жирный'],
        ['italic', 'Курсив'],
        ['underline', 'Подчёркнутый'],
        ['strike', 'Зачёркнутый'],
      ];
      for (const [key, labelText] of styleOptions) {
        const label = document.createElement('label');
        label.className = 'report-check-control';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = rule[key] === true;
        checkbox.addEventListener('change', () => { rule[key] = checkbox.checked; });
        label.append(checkbox, document.createTextNode(labelText));
        styleBox.append(label);
      }

      const colorLabel = document.createElement('label');
      colorLabel.className = 'report-color-control';
      const colorEnabled = document.createElement('input');
      colorEnabled.type = 'checkbox';
      colorEnabled.checked = Boolean(rule.color);
      const color = document.createElement('input');
      color.type = 'color';
      color.value = rule.color ?? '#17373b';
      color.disabled = !colorEnabled.checked;
      const colorText = document.createElement('span');
      colorText.textContent = 'Цвет';
      colorEnabled.addEventListener('change', () => {
        color.disabled = !colorEnabled.checked;
        rule.color = colorEnabled.checked ? color.value : null;
      });
      color.addEventListener('input', () => { if (colorEnabled.checked) rule.color = color.value; });
      colorLabel.append(colorEnabled, colorText, color);

      const sizeLabel = document.createElement('label');
      sizeLabel.textContent = 'Размер';
      const size = select(
        (state.catalog.formatFontSizes ?? []).map((item) => ({ value: item.value, label: item.label })),
        rule.fontSizeStep ?? 0,
      );
      sizeLabel.append(size);
      size.addEventListener('change', () => { rule.fontSizeStep = Number(size.value); });

      const actions = document.createElement('div');
      actions.className = 'report-row-actions';
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'secondary report-small-button';
      up.textContent = '↑';
      up.title = 'Поднять правило';
      up.disabled = ruleIndex === 0;
      up.addEventListener('click', () => {
        [column.formatRules[ruleIndex - 1], column.formatRules[ruleIndex]] = [
          column.formatRules[ruleIndex], column.formatRules[ruleIndex - 1],
        ];
        renderAll();
      });
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'secondary report-small-button';
      down.textContent = '↓';
      down.title = 'Опустить правило';
      down.disabled = ruleIndex === column.formatRules.length - 1;
      down.addEventListener('click', () => {
        [column.formatRules[ruleIndex + 1], column.formatRules[ruleIndex]] = [
          column.formatRules[ruleIndex], column.formatRules[ruleIndex + 1],
        ];
        renderAll();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger report-small-button';
      remove.textContent = '×';
      remove.title = 'Удалить правило';
      remove.addEventListener('click', () => {
        column.formatRules.splice(ruleIndex, 1);
        renderAll();
      });
      actions.append(up, down, remove);
      row.append(minLabel, maxLabel, styleBox, colorLabel, sizeLabel, actions);
      list.append(row);
    });
    if (!column.formatRules.length) {
      const empty = document.createElement('p');
      empty.className = 'report-empty';
      empty.textContent = 'Условное форматирование не задано.';
      list.append(empty);
    }
    box.append(list);
    host.append(box);
  }

  function defaultColumn(kind, csv = false) {
    if (kind === 'metric') {
      return {
        kind,
        metricKey: state.config.metrics[0].key,
        title: state.config.metrics[0].name,
        scale: 1,
        decimals: 1,
        ...(csv ? {} : { formatRules: [] }),
      };
    }
    const kindCatalog = csv ? state.catalog.csvColumnKinds : state.catalog.tableColumnKinds;
    const definition = kindCatalog.find((item) => item.key === kind);
    return {
      kind,
      title: definition?.label ?? kind,
      ...(!csv && kind === 'rank' ? { formatRules: [] } : {}),
    };
  }

  function renderColumns(host, columns, catalog, { csv = false } = {}) {
    host.replaceChildren();
    columns.forEach((column, index) => {
      const card = document.createElement('article');
      card.className = 'report-column-card';
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
      title.addEventListener('change', () => { column.title = title.value.trim() || column.title; });

      const details = document.createElement('div');
      details.className = 'report-column-details';
      if (column.kind === 'metric') {
        const metricLabel = document.createElement('label');
        metricLabel.textContent = 'Метрика';
        const metricSelect = select(metricOptions(), column.metricKey);
        metricLabel.append(metricSelect);
        metricSelect.addEventListener('change', () => { column.metricKey = metricSelect.value; });

        const scaleLabel = document.createElement('label');
        scaleLabel.textContent = 'Масштаб';
        const scaleSelect = select(
          state.catalog.scales.map((item) => ({ value: item.value, label: item.label })),
          column.scale ?? 1,
        );
        scaleLabel.append(scaleSelect);
        scaleSelect.addEventListener('change', () => { column.scale = Number(scaleSelect.value); });

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
          column.decimals = decimalsSelect.value === 'raw' ? null : Number(decimalsSelect.value);
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
      card.append(row);

      if (!csv && (column.kind === 'rank' || column.kind === 'metric')) {
        renderFormatRules(card, column);
      }
      host.append(card);
    });
  }

  function renderRank() {
    normalizeRankShape();
    rankSortHost.replaceChildren();
    const sort = state.config.rank.sort;
    const used = new Set(sort.map((criterion) => criterion.metricKey));

    sort.forEach((criterion, index) => {
      const card = document.createElement('article');
      card.className = 'report-column-card';
      const row = document.createElement('div');
      row.className = 'report-column-row';

      const priorityLabel = document.createElement('label');
      priorityLabel.textContent = 'Порядок';
      const priority = document.createElement('input');
      priority.type = 'text';
      priority.readOnly = true;
      priority.value = index === 0 ? '1 — сначала' : String(index + 1);
      priorityLabel.append(priority);

      const metricLabel = document.createElement('label');
      metricLabel.textContent = 'Метрика';
      const availableMetrics = metricOptions().filter((item) =>
        item.value === criterion.metricKey || !used.has(item.value));
      const metricSelect = select(availableMetrics, criterion.metricKey);
      metricLabel.append(metricSelect);
      metricSelect.addEventListener('change', () => {
        criterion.metricKey = metricSelect.value;
        normalizeReferences();
        renderAll();
      });

      const directionLabel = document.createElement('label');
      directionLabel.textContent = 'Направление';
      const directionSelect = select([
        { value: 'desc', label: 'Больше — выше' },
        { value: 'asc', label: 'Меньше — выше' },
      ], criterion.direction);
      directionLabel.append(directionSelect);
      directionSelect.addEventListener('change', () => {
        criterion.direction = directionSelect.value;
        normalizeReferences();
      });

      const actions = document.createElement('div');
      actions.className = 'report-row-actions';
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'secondary report-small-button';
      up.textContent = '↑';
      up.title = 'Повысить приоритет';
      up.disabled = index === 0;
      up.addEventListener('click', () => {
        [sort[index - 1], sort[index]] = [sort[index], sort[index - 1]];
        renderAll();
      });
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'secondary report-small-button';
      down.textContent = '↓';
      down.title = 'Понизить приоритет';
      down.disabled = index === sort.length - 1;
      down.addEventListener('click', () => {
        [sort[index + 1], sort[index]] = [sort[index], sort[index + 1]];
        renderAll();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger report-small-button';
      remove.textContent = '×';
      remove.title = 'Удалить критерий';
      remove.disabled = sort.length <= 1;
      remove.addEventListener('click', () => {
        sort.splice(index, 1);
        renderAll();
      });
      actions.append(up, down, remove);
      row.append(priorityLabel, metricLabel, directionLabel, actions);
      card.append(row);
      rankSortHost.append(card);
    });

    const maxRankSorts = state.catalog.maxRankSorts ?? 8;
    addRankSort.disabled = sort.length >= maxRankSorts || used.size >= state.config.metrics.length;
  }

  function renderAll() {
    if (!state.config || !state.catalog) return;
    normalizeReferences();
    updatedAt.textContent = formatUpdatedAt(state.config.updatedAt);
    renderMetrics();
    renderColumns(tableColumnsHost, state.config.tableColumns, state.catalog.tableColumnKinds);
    renderColumns(csvColumnsHost, state.config.csvColumns, state.catalog.csvColumnKinds, { csv: true });
    renderRank();
    setView(state.view);
  }

  addRankSort.addEventListener('click', () => {
    normalizeReferences();
    const used = new Set(state.config.rank.sort.map((criterion) => criterion.metricKey));
    const candidate = metricOptions().find((item) => !used.has(item.value));
    if (!candidate) return;
    state.config.rank.sort.push({ metricKey: candidate.value, direction: 'desc' });
    renderAll();
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
    normalizeReferences();
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

  setView('metrics');
  void load();
}
