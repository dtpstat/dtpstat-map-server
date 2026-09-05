export const KML_SOURCES_EXAMPLE = [
  {
    URL: 'https://www.google.com/maps/d/viewer?mid=YOUR_MAP_ID',
    layers: [
      { name: 'Двусторонние', multiple: 2, type: 'default' },
      { name: 'Односторонние', multiple: 1, type: 'tram' },
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
