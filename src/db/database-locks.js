import { databaseLockKey } from './database-environment.js';

/**
 * Serialize destructive/import operations inside one configured application
 * schema. The key is parameterized, so the schema never becomes SQL text here.
 *
 * @param {{ query: (text: string, values?: unknown[]) => Promise<unknown> }} client
 * @param {{ databaseSchema?: string }} pool
 */
export async function acquireDataImportLock(client, pool) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    [databaseLockKey(pool?.databaseSchema, 'data-import')],
  );
}
