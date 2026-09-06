const DEFAULT_REPORT_CONFIG = Object.freeze({
  tableColumns: Object.freeze([
    Object.freeze({ kind: 'rank', title: '№' }),
    Object.freeze({ kind: 'city', title: 'город' }),
    Object.freeze({ kind: 'metric', metricKey: 'lane_length_m', title: 'длина ВП (км)', scale: 0.001, decimals: 1 }),
    Object.freeze({ kind: 'metric', metricKey: 'population', title: 'жители (тыс.)', scale: 0.001, decimals: 0 }),
    Object.freeze({ kind: 'metric', metricKey: 'lane_m_per_1000', title: 'ВП (м/1000 чел.)', scale: 1, decimals: 1 }),
  ]),
  rank: Object.freeze({ metricKey: 'lane_m_per_1000', direction: 'desc' }),
});

/** @param {HTMLElement} element */
function clear(element) {
  element.replaceChildren();
}

/** @param {unknown} value */
function missing(value) {
  return value === null || value === undefined || Number.isNaN(value);
}

/** @param {unknown} value @param {{ scale?: number, decimals?: number | null }} column */
function formatMetric(value, column) {
  if (missing(value)) return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const decimals = column.decimals;
  const options = decimals === null || decimals === undefined
    ? { maximumFractionDigits: 6 }
    : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  return new Intl.NumberFormat('ru-RU', options).format(
    number * (column.scale ?? 1),
  );
}

/** @param {any} city @param {string} field */
function sortValue(city, field) {
  if (field === 'rank') return city.rank;
  if (field === 'name') return city.name;
  if (field.startsWith('metric:')) {
    return city.metrics?.[field.slice('metric:'.length)] ?? null;
  }
  return null;
}

/** @param {any} column */
function sortField(column) {
  if (column.kind === 'rank') return 'rank';
  if (column.kind === 'city') return 'name';
  if (column.kind === 'metric') return `metric:${column.metricKey}`;
  return null;
}

/** @param {any} column @param {any} reportConfig */
function cellClass(column, reportConfig) {
  const classes = [`column-${column.kind}`];
  if (
    column.kind === 'metric' &&
    column.metricKey === reportConfig.rank?.metricKey
  ) {
    classes.push('is-rank-metric');
  }
  return classes.join(' ');
}

/**
 * One data model and one table body serve both desktop and mobile layouts.
 * Responsive CSS changes presentation without cloning rows or listeners.
 *
 * @param {{ list: HTMLElement, status: HTMLElement, categoryButtons: NodeListOf<HTMLElement> }} elements
 */
export function createCityList(elements) {
  let cities = [];
  let category = 'large';
  let selectedCityId = null;
  let reportConfig = DEFAULT_REPORT_CONFIG;
  let sort = { field: 'rank', direction: 'asc' };
  let selectHandler = () => {};
  const table = elements.list.closest('table');
  const head = table?.querySelector('thead');

  function sortButtons() {
    return head ? [...head.querySelectorAll('[data-sort]')] : [];
  }

  function updateSortIndicators() {
    for (const button of sortButtons()) {
      const isActive = button.dataset.sort === sort.field;
      const direction = isActive ? sort.direction : 'none';
      const header = button.closest('th');
      const label = button.textContent.trim();

      button.classList.toggle('is-active', isActive);
      button.dataset.sortDirection = direction;
      if (isActive) {
        const nextDirection = direction === 'asc' ? 'убыванию' : 'возрастанию';
        const currentDirection =
          direction === 'asc' ? 'по возрастанию' : 'по убыванию';
        header?.setAttribute(
          'aria-sort',
          direction === 'asc' ? 'ascending' : 'descending',
        );
        button.title = `Отсортировано ${currentDirection}. Сортировать по ${nextDirection}`;
      } else {
        header?.removeAttribute('aria-sort');
        button.title = `Сортировать по столбцу «${label}»`;
      }
    }
  }

  function renderHeader() {
    if (!head) return;
    const row = document.createElement('tr');
    for (const column of reportConfig.tableColumns) {
      const header = document.createElement('th');
      header.scope = 'col';
      header.className = cellClass(column, reportConfig);
      const field = sortField(column);
      if (field) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.sort = field;
        button.textContent = column.title;
        header.append(button);
      } else {
        header.textContent = column.title;
      }
      row.append(header);
    }
    head.replaceChildren(row);
    updateSortIndicators();
  }

  function visibleCities() {
    const direction = sort.direction === 'asc' ? 1 : -1;
    return cities
      .filter((city) => city.category === category)
      .sort((left, right) => {
        const a = sortValue(left, sort.field);
        const b = sortValue(right, sort.field);
        if (missing(a) && missing(b)) return left.name.localeCompare(right.name, 'ru');
        if (missing(a)) return 1;
        if (missing(b)) return -1;
        if (typeof a === 'string' || typeof b === 'string') {
          return String(a).localeCompare(String(b), 'ru') * direction;
        }
        const difference = (Number(a) - Number(b)) * direction;
        return difference || left.name.localeCompare(right.name, 'ru');
      });
  }

  function cityCell(city, column) {
    const cell = document.createElement('td');
    cell.className = cellClass(column, reportConfig);
    cell.dataset.label = column.title;

    if (column.kind === 'rank') {
      cell.textContent = missing(city.rank) ? '—' : String(city.rank);
      return cell;
    }
    if (column.kind === 'city') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'city-link';
      button.dataset.cityId = String(city.id);
      button.textContent = city.name;
      button.setAttribute('aria-label', `Показать ${city.name} на карте`);
      cell.append(button);
      return cell;
    }
    if (column.kind === 'metric') {
      cell.textContent = formatMetric(city.metrics?.[column.metricKey], column);
      return cell;
    }
    cell.textContent = '—';
    return cell;
  }

  function render() {
    clear(elements.list);
    const fragment = document.createDocumentFragment();

    for (const city of visibleCities()) {
      const row = document.createElement('tr');
      row.dataset.cityId = String(city.id);
      row.classList.toggle('is-active', city.id === selectedCityId);
      row.setAttribute('aria-selected', String(city.id === selectedCityId));
      for (const column of reportConfig.tableColumns) {
        row.append(cityCell(city, column));
      }
      fragment.append(row);
    }

    elements.list.append(fragment);
  }

  elements.list.addEventListener('click', (event) => {
    const button = event.target.closest('.city-link');
    if (!button) return;
    const city = cities.find(
      (item) => String(item.id) === button.dataset.cityId,
    );
    if (city) selectHandler(city);
  });

  head?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-sort]');
    if (!button) return;
    const field = button.dataset.sort;
    sort = sort.field === field
      ? { field, direction: sort.direction === 'asc' ? 'desc' : 'asc' }
      : {
          field,
          direction: field === 'name' || field === 'rank' ? 'asc' : 'desc',
        };
    updateSortIndicators();
    render();
  });

  for (const button of elements.categoryButtons) {
    button.addEventListener('click', () => {
      category = button.dataset.category;
      for (const candidate of elements.categoryButtons) {
        const isActive = candidate === button;
        candidate.classList.toggle('is-active', isActive);
        candidate.setAttribute('aria-pressed', String(isActive));
      }
      render();
    });
  }

  renderHeader();

  return {
    /** @param {any} nextConfig */
    setReportConfig(nextConfig) {
      if (!nextConfig || !Array.isArray(nextConfig.tableColumns)) return;
      reportConfig = nextConfig;
      sort = { field: 'rank', direction: 'asc' };
      renderHeader();
      render();
    },
    /** @param {any[]} nextCities */
    setCities(nextCities) {
      cities = nextCities;
      render();
    },
    /** @param {(city: any) => void} handler */
    onSelect(handler) {
      selectHandler = handler;
    },
    /** @param {number | null} cityId @param {{ scrollIntoView?: boolean }} [options] */
    select(cityId, options = {}) {
      selectedCityId = cityId;
      const city = cities.find((item) => item.id === cityId);
      if (city && city.category !== category) {
        category = city.category;
        for (const button of elements.categoryButtons) {
          const isActive = button.dataset.category === category;
          button.classList.toggle('is-active', isActive);
          button.setAttribute('aria-pressed', String(isActive));
        }
      }
      render();
      if (options.scrollIntoView && cityId !== null) {
        const row = [...elements.list.children].find(
          (element) => element.dataset.cityId === String(cityId),
        );
        row?.scrollIntoView({ block: 'nearest' });
      }
    },
    setStatus(message, isError = false) {
      elements.status.textContent = message;
      elements.status.classList.toggle('is-error', isError);
    },
  };
}
