import { normalizeMapboxAccessToken } from '../../data/mapbox-access-token.js';
import { normalizePublicDownloadName } from '../../data/public-download-name.js';
import {
  normalizeProjectSettingsUpdate,
} from './settings-update-policy.js';

/**
 * @param {{
 *   query: (text: string, values?: unknown[]) => Promise<any>,
 *   connect?: () => Promise<any>,
 *   databaseSchema?: string
 * }} database
 * @param {{ styleUrl?: string, initialCenter?: number[], initialZoom?: number }} publicMapDefaults
 * @param {{
 *   storage: {
 *     get(queryable: any): Promise<any>,
 *     getMapboxAccessToken(queryable: any): Promise<string | null>,
 *     getCityMarkerIcon(queryable: any): Promise<any>,
 *     getMapboxBootstrapState(queryable: any): Promise<any>,
 *     bootstrapMapboxAccessToken(queryable: any, token: string): Promise<any>,
 *     updateSettings(queryable: any, settings: any): Promise<any>,
 *     updatePublicDownloadName(queryable: any, value: string): Promise<any>,
 *     updateCityMarkerIcon(queryable: any, icon: any): Promise<any>,
 *     clearCityMarkerIcon(queryable: any): Promise<any>
 *   },
 *   acquireLock: (client: any, pool: any) => Promise<void>,
 *   recalculateStatistics: (queryable: any) => Promise<any>
 * }} dependencies
 */
export function createProjectSettingsService(
  database,
  publicMapDefaults = {},
  dependencies,
) {
  const storage = dependencies?.storage;
  const acquireLock = dependencies?.acquireLock;
  const recalculateStatistics =
    dependencies?.recalculateStatistics;

  if (!storage) {
    throw new TypeError(
      'Project settings storage dependency is required',
    );
  }
  if (typeof acquireLock !== 'function') {
    throw new TypeError(
      'Project settings acquireLock dependency is required',
    );
  }
  if (typeof recalculateStatistics !== 'function') {
    throw new TypeError(
      'Project settings recalculateStatistics dependency is required',
    );
  }

  async function get() {
    return storage.get(database);
  }

  async function getMapboxAccessToken() {
    return storage.getMapboxAccessToken(database);
  }

  async function getCityMarkerIcon() {
    return storage.getCityMarkerIcon(database);
  }

  async function getPublicMapConfig() {
    return {
      accessToken: await getMapboxAccessToken(),
      styleUrl: publicMapDefaults.styleUrl,
      initialCenter: publicMapDefaults.initialCenter,
      initialZoom: publicMapDefaults.initialZoom,
    };
  }

  async function bootstrapMapboxAccessToken(value) {
    const state =
      await storage.getMapboxBootstrapState(database);
    if (state.initialized) {
      return {
        initialized: false,
        configured: Boolean(state.configured),
      };
    }

    const token = normalizeMapboxAccessToken(
      value,
      { optional: true },
    );
    if (!token) {
      return {
        initialized: false,
        configured: false,
      };
    }

    const result =
      await storage.bootstrapMapboxAccessToken(
        database,
        token,
      );
    return {
      initialized: result.rows.length > 0,
      configured: Boolean(
        result.rows[0]?.mapboxAccessTokenConfigured,
      ),
    };
  }

  async function save(payload) {
    const settings = normalizeProjectSettingsUpdate(payload);

    // Keep the query-only fallback for isolated repository tests and simple
    // queryable implementations. Production Pools use one atomic transaction.
    if (typeof database.connect !== 'function') {
      const saved =
        await storage.updateSettings(database, settings);
      await recalculateStatistics(database);
      return saved;
    }

    const client = await database.connect();
    try {
      await client.query('BEGIN');
      await acquireLock(client, database);
      const saved =
        await storage.updateSettings(client, settings);
      await recalculateStatistics(client);
      await client.query('COMMIT');
      return saved;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function savePublicDownloadName(value) {
    return storage.updatePublicDownloadName(
      database,
      normalizePublicDownloadName(value),
    );
  }

  async function saveCityMarkerIcon(icon) {
    return storage.updateCityMarkerIcon(database, icon);
  }

  async function clearCityMarkerIcon() {
    return storage.clearCityMarkerIcon(database);
  }

  return {
    get,
    save,
    savePublicDownloadName,
    getMapboxAccessToken,
    getCityMarkerIcon,
    getPublicMapConfig,
    bootstrapMapboxAccessToken,
    saveCityMarkerIcon,
    clearCityMarkerIcon,
  };
}
