import {
  throwIfAdminTaskCancelled,
} from '../../shared/tasks/admin-task-manager.js';
import {
  normalizeGeometryImportDecisions,
  normalizeGeometryImportSessionId,
} from './import-policy.js';

async function rollbackQuietly(
  client,
) {
  await client
    .query(
      'ROLLBACK',
    )
    .catch(
      () => {},
    );
}

export function createGeometryImportService(
  pool,
  dependencies,
) {
  const storage =
    dependencies
      ?.storage;
  const acquireLock =
    dependencies
      ?.acquireLock;

  if (!storage) {
    throw new TypeError(
      'Geometry import storage dependency is required',
    );
  }

  if (
    typeof acquireLock !==
    'function'
  ) {
    throw new TypeError(
      'Geometry import acquireLock dependency is required',
    );
  }

  return {
    assertNoPending(
      client,
    ) {
      return storage
        .assertNoPending(
          client,
        );
    },

    stageKml(
      client,
      rows,
      metadata,
    ) {
      return storage
        .stageKml(
          client,
          rows,
          metadata,
        );
    },

    applyInTransaction(
      client,
      sessionId,
      decisions = [],
    ) {
      const id =
        normalizeGeometryImportSessionId(
          sessionId,
        );

      normalizeGeometryImportDecisions(
        decisions,
      );

      return storage
        .applyInTransaction(
          client,
          id,
          decisions,
        );
    },

    pending() {
      return storage
        .pending();
    },

    async discard(
      sessionId,
    ) {
      const id =
        normalizeGeometryImportSessionId(
          sessionId,
        );
      const client =
        await pool.connect();

      try {
        await client.query(
          'BEGIN',
        );
        await acquireLock(
          client,
          pool,
        );
        const discarded =
          await storage
            .discardInTransaction(
              client,
              id,
            );
        await client.query(
          'COMMIT',
        );
        return discarded;
      } catch (error) {
        await rollbackQuietly(
          client,
        );
        throw error;
      } finally {
        client.release();
      }
    },

    async apply(
      sessionId,
      decisions = [],
      operation = {},
    ) {
      const id =
        normalizeGeometryImportSessionId(
          sessionId,
        );

      normalizeGeometryImportDecisions(
        decisions,
      );

      throwIfAdminTaskCancelled(
        operation.signal,
      );

      const client =
        await pool.connect();

      try {
        await client.query(
          'BEGIN',
        );
        await acquireLock(
          client,
          pool,
        );
        throwIfAdminTaskCancelled(
          operation.signal,
        );

        operation
          .onProgress?.({
            phase:
              'import-conflicts-apply',
            sessionId:
              id,
          });

        const result =
          await storage
            .applyInTransaction(
              client,
              id,
              decisions,
            );

        throwIfAdminTaskCancelled(
          operation.signal,
        );
        operation
          .onCommit?.();
        await client.query(
          'COMMIT',
        );
        return result;
      } catch (error) {
        await rollbackQuietly(
          client,
        );
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
