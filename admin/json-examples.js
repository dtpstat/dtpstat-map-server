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
  schemaVersion: 2,
  exportedAt: '2026-01-01T00:00:00.000Z',
  asOf: '2026-01-01',
  source: 'Росстат',
  regions: [
    {
      name: 'Республика Татарстан',
      attributes: {
        federalDistrict: 'Приволжский федеральный округ',
      },
      cities: [
        {
          name: 'Казань',
          population: 1320000,
          attributes: {},
        },
        {
          name: 'Набережные Челны',
          population: 544000,
          asOf: '2025-01-01',
          source: 'Татарстанстат',
          attributes: {},
        },
      ],
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
      hint.textContent = 'Каждый слой: name + multiple (1 или 2) + необязательный type. type — NAME бизнес-типа из источника, а не CODE. NAME сопоставляется без учёта регистра и крайних пробелов; отсутствующий NAME создаётся автоматически, CODE назначает БД, TITLE сначала равен NAME.';
    }
  }

  const lineGeoJson = document.querySelector('#line-geojson-form input[name="file"]');
  const lineGeoJsonHint = lineGeoJson?.closest('label')?.querySelector('small');
  if (lineGeoJsonHint) {
    lineGeoJsonHint.textContent = 'Канонический schemaVersion 3 переносит lineTypes[{code,name,title,color,style,width}], а каждая линия ссылается на numeric _dtpstat.businessTypeCode. При импорте другой сервер сопоставляет типы по NAME и генерирует собственные CODE для отсутствующих NAME. Legacy GeoJSON v2 и старые файлы без типов поддерживаются.';
  }

  const population = document.querySelector('#population-form textarea[name="payload"]');
  if (population) population.placeholder = jsonExample(POPULATION_JSON_EXAMPLE);
}
