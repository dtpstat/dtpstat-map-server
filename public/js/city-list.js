const integerFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 0,
});
const decimalFormatter = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** @param {HTMLElement} element */
function clear(element) {
  element.replaceChildren();
}

/** @param {string} value */
function tableCell(value) {
  const cell = document.createElement('td');
  cell.textContent = value;
  return cell;
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
  let sort = { field: 'rank', direction: 'asc' };
  let selectHandler = () => {};

  function visibleCities() {
    const direction = sort.direction === 'asc' ? 1 : -1;
    return cities
      .filter((city) => city.category === category)
      .sort((left, right) => {
        const a = left[sort.field];
        const b = right[sort.field];
        if (typeof a === 'string') return a.localeCompare(b, 'ru') * direction;
        return (a - b) * direction;
      });
  }

  function render() {
    clear(elements.list);
    const fragment = document.createDocumentFragment();

    for (const city of visibleCities()) {
      const row = document.createElement('tr');
      row.dataset.cityId = String(city.id);
      row.classList.toggle('is-active', city.id === selectedCityId);
      row.setAttribute('aria-selected', String(city.id === selectedCityId));

      row.append(tableCell(String(city.rank)));

      const nameCell = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'city-link';
      button.dataset.cityId = String(city.id);
      button.textContent = city.name;
      button.setAttribute('aria-label', `Показать ${city.name} на карте`);
      nameCell.append(button);
      row.append(nameCell);

      row.append(tableCell(decimalFormatter.format(city.laneLengthMeters / 1000)));
      row.append(tableCell(integerFormatter.format(city.population / 1000)));
      row.append(tableCell(decimalFormatter.format(city.laneMetersPer1000)));
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

  for (const button of document.querySelectorAll('[data-sort]')) {
    button.addEventListener('click', () => {
      const field = button.dataset.sort;
      sort =
        sort.field === field
          ? { field, direction: sort.direction === 'asc' ? 'desc' : 'asc' }
          : {
              field,
              direction: field === 'name' || field === 'rank' ? 'asc' : 'desc',
            };
      render();
    });
  }

  return {
    /** @param {any[]} nextCities */
    setCities(nextCities) {
      cities = nextCities;
      render();
    },
    /** @param {(city: any) => void} handler */
    onSelect(handler) {
      selectHandler = handler;
    },
    /** @param {number} cityId */
    select(cityId) {
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
    },
    setStatus(message, isError = false) {
      elements.status.textContent = message;
      elements.status.classList.toggle('is-error', isError);
    },
  };
}
