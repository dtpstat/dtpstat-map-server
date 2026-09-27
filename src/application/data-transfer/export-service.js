async function* jsonArray(items) {
  let first = true;
  for await (const item of items) {
    if (!first) yield ',';
    first = false;
    yield item;
  }
}

function dateOnly(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function populationCity(row) {
  return {
    name: row.cityName,
    osmType: row.cityOsmType,
    osmId: row.cityOsmId,
    population: row.population ?? null,
    asOf: dateOnly(row.asOf),
    source: row.source ?? null,
    attributes: row.attributes ?? {},
  };
}

function buildPopulationRegions(rows) {
  const regions = [];
  let current = null;

  for (const row of rows) {
    if (!current || current.id !== row.regionId) {
      current = {
        id: row.regionId,
        value: {
          name: row.regionName,
          osmType: row.regionOsmType,
          osmId: row.regionOsmId,
          attributes: row.regionAttributes ?? {},
          cities: [],
        },
      };
      regions.push(current);
    }
    current.value.cities.push(populationCity(row));
  }

  return regions.map((region) => region.value);
}

async function* streamPopulationRegions(rows) {
  let currentRegionId = null;
  let firstRegion = true;
  let firstCity = true;

  for await (const row of rows) {
    if (row.regionId !== currentRegionId) {
      if (currentRegionId !== null) yield ']}';
      if (!firstRegion) yield ',';
      firstRegion = false;
      currentRegionId = row.regionId;
      firstCity = true;

      const region = JSON.stringify({
        name: row.regionName,
        osmType: row.regionOsmType,
        osmId: row.regionOsmId,
        attributes: row.regionAttributes ?? {},
      });
      yield region.slice(0, -1);
      yield ',"cities":[';
    }

    if (!firstCity) yield ',';
    firstCity = false;
    yield JSON.stringify(populationCity(row));
  }

  if (currentRegionId !== null) yield ']}';
}

/**
 * Portable backup/transfer export use case.
 *
 * @param {{
 *   query: (text: string, values?: unknown[]) => Promise<any>,
 *   connect?: () => Promise<any>
 * }} database
 * @param {{
 *   storage: {
 *     exportCityBoundaries(queryable: any): Promise<any>,
 *     exportLines(queryable: any): Promise<any>,
 *     exportedAt(queryable: any): Promise<any>,
 *     lineTypeItems(queryable: any): Promise<string[]>,
 *     populationRows(queryable: any): Promise<{ rows: any[] }>,
 *     streamCityBoundaryItems(client: any, fetchSize?: number): AsyncIterable<string>,
 *     streamLineItems(client: any, fetchSize?: number): AsyncIterable<string>,
 *     streamPopulationRows(client: any, fetchSize?: number): AsyncIterable<any>
 *   }
 * }} dependencies
 */
export function createDataExportService(database, dependencies) {
  const storage = dependencies?.storage;
  if (!storage) {
    throw new TypeError(
      'Data export storage dependency is required',
    );
  }

  return {
    async *streamCityBoundaries() {
      if (typeof database.connect !== 'function') {
        yield JSON.stringify(
          await storage.exportCityBoundaries(database),
        );
        yield '\n';
        return;
      }

      const client = await database.connect();
      try {
        await client.query('BEGIN READ ONLY');
        const exportedAt = await storage.exportedAt(client);
        yield '{"type":"FeatureCollection","name":"dtpstat-buslines-cities","schemaVersion":2,"exportedAt":';
        yield JSON.stringify(exportedAt);
        yield ',"features":[';
        yield* jsonArray(
          storage.streamCityBoundaryItems(client),
        );
        yield ']}\n';
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    },

    async *streamLines() {
      if (typeof database.connect !== 'function') {
        yield JSON.stringify(await storage.exportLines(database));
        yield '\n';
        return;
      }

      const client = await database.connect();
      try {
        await client.query('BEGIN READ ONLY');
        const exportedAt = await storage.exportedAt(client);
        yield '{"type":"FeatureCollection","name":"dtpstat-buslines-lines","schemaVersion":3,"exportedAt":';
        yield JSON.stringify(exportedAt);
        yield ',"lineTypes":[';

        let firstType = true;
        for (const item of await storage.lineTypeItems(client)) {
          if (!firstType) yield ',';
          firstType = false;
          yield item;
        }

        yield '],"features":[';
        yield* jsonArray(
          storage.streamLineItems(client),
        );
        yield ']}\n';
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    },

    async *streamPopulations() {
      if (typeof database.connect !== 'function') {
        yield JSON.stringify(await this.exportPopulations());
        yield '\n';
        return;
      }

      const client = await database.connect();
      try {
        await client.query('BEGIN READ ONLY');
        const exportedAt = await storage.exportedAt(client);
        yield '{"schemaVersion":3,"exportedAt":';
        yield JSON.stringify(exportedAt);
        yield ',"regions":[';
        yield* streamPopulationRegions(
          storage.streamPopulationRows(client),
        );
        yield ']}\n';
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    },

    exportCityBoundaries() {
      return storage.exportCityBoundaries(database);
    },

    exportLines() {
      return storage.exportLines(database);
    },

    async exportPopulations() {
      const [exportedAt, rows] = await Promise.all([
        storage.exportedAt(database),
        storage.populationRows(database),
      ]);
      return {
        schemaVersion: 3,
        exportedAt,
        regions: buildPopulationRegions(rows.rows),
      };
    },
  };
}
