import {
  createOsmCheckpointRecordRepository,
} from '../db/osm-checkpoint-record-repository.js';
import {
  createOsmCheckpointStageRepository,
} from '../db/osm-checkpoint-stage-repository.js';

/**
 * Compose durable OSM checkpoint persistence.
 *
 * Cross-table lifecycle operations live at the application boundary so
 * record/status changes and staged geometry commit or roll back together.
 *
 * @param {{
 *   query: Function,
 *   connect: () => Promise<any>
 * }} pool
 * @param {{
 *   records?: ReturnType<typeof createOsmCheckpointRecordRepository>,
 *   stage?: ReturnType<typeof createOsmCheckpointStageRepository>
 * }} [dependencies]
 */
export function createOsmCheckpointRuntime(
  pool,
  dependencies = {},
) {
  const records =
    dependencies.records ??
    createOsmCheckpointRecordRepository(pool);
  const stage =
    dependencies.stage ??
    createOsmCheckpointStageRepository(pool);

  return {
    cleanup: () => records.cleanup(),
    getResumable: () => records.getResumable(),
    getById: (checkpointId) =>
      records.getById(checkpointId),
    getIndexObjects: (checkpointId) =>
      records.getIndexObjects(checkpointId),
    create: (value) => records.create(value),

    async replaceResumable(checkpointId, value) {
      const client = await pool.connect();
      let newId;

      try {
        await client.query('BEGIN');

        const locked = await records.lockResumable(
          client,
          checkpointId,
        );
        if (!locked) {
          throw new Error(
            `OSM checkpoint ${checkpointId} is no longer resumable`,
          );
        }

        await records.discardRecord(
          client,
          checkpointId,
        );
        newId = await records.insert(client, value);

        // Old staged rows are removed only after the replacement row exists.
        // A failure anywhere in this transaction restores the old resumable
        // checkpoint and all of its geometry through ROLLBACK.
        await stage.deleteByCheckpoint(
          client,
          checkpointId,
        );

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }

      return records.getById(newId);
    },

    getStagedKeys: (checkpointId) =>
      stage.getStagedKeys(checkpointId),

    async stageBatch(
      checkpointId,
      places,
      metrics = {},
    ) {
      const client = await pool.connect();
      let batchResult;

      try {
        await client.query('BEGIN');

        batchResult = await stage.stageBatch(
          client,
          checkpointId,
          places,
        );
        await records.addBatchMetrics(
          client,
          checkpointId,
          metrics,
        );

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }

      const checkpoint =
        await records.getById(checkpointId);

      return {
        ...checkpoint,
        ...batchResult,
      };
    },

    addMetrics: (checkpointId, metrics = {}) =>
      records.addMetrics(checkpointId, metrics),

    mark: (
      checkpointId,
      status,
      lastError = null,
    ) => records.mark(
      checkpointId,
      status,
      lastError,
    ),

    async complete(client, checkpointId) {
      await stage.deleteByCheckpoint(
        client,
        checkpointId,
      );
      await records.completeRecord(
        client,
        checkpointId,
      );
    },

    async discard(checkpointId) {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        await stage.deleteByCheckpoint(
          client,
          checkpointId,
        );
        await records.discardRecord(
          client,
          checkpointId,
        );

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    stats: (checkpointId) =>
      stage.stats(checkpointId),

    checksums: (checkpointId) =>
      stage.checksums(checkpointId),
  };
}
