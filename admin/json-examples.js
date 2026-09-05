export const KML_SOURCES_EXAMPLE = [
  {
    URL: 'https://www.google.com/maps/d/viewer?mid=YOUR_MAP_ID',
    layers: [
      { name: 'Двусторонние', multiple: 2, type: 'Двусторонние' },
      { name: 'Односторонние', multiple: 1, type: 'Односторонние' },
    ],
  },
];

export const POPULATION_JSON_EXAMPLE = {
  asOf: '2026-01-01',
  source: 'Росстат',
  populations: [
    {
      name: 'Москва',
      population: 13274285,
      attributes: {},
    },
    {
      name: 'Санкт-Петербург',
      population: 5655257,
      asOf: '2025-01-01',
      source: 'Петростат',
      attributes: {
        comment: 'asOf/source можно переопределить для отдельного города',
      },
    },
  ],
};

export function jsonExample(value) {
  return JSON.stringify(value, null, 2);
}

if (typeof document !== 'undefined') {
  const kmlSources = document.querySelector('#kml-form textarea[name="sources"]');
  if (kmlSources) {
    kmlSources.placeholder = jsonExample(KML_SOURCES_EXAMPLE);
    const hint = kmlSources.closest('label')?.querySelector('small');
    if (hint) {
      hint.textContent = 'Каждый слой: name + multiple (1 или 2) + необязательный type. type — стабильный code справочника; без type используется default. Отсутствующий code создаётся автоматически с начальным name=code и стандартным стилем.';
    }
  }

  const population = document.querySelector('#population-form textarea[name="payload"]');
  if (population) population.placeholder = jsonExample(POPULATION_JSON_EXAMPLE);
}
