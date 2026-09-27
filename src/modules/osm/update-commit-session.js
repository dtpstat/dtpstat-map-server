/**
 * Atomically replace the production OSM boundary snapshot from the already
 * validated staging table. All database-specific operations are injected so
 * this module owns transaction order without depending on src/db.
 */
export async function commitOsmBoundaryUpdate({
  client,
  pool,
  boundaryUpdateRepository,
  checkpointRepository,
  checkpoint,
  osmTimestamp,
  geometryPlaces,
  dryRun,
  runValues,
  acquireLock,
  rebuildHierarchy,
  syncDerivedData,
  assertNotCancelled = () => {},
  emitProgress = () => {},
  onCommit,
}) {
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;

    await acquireLock(client, pool);
    await boundaryUpdateRepository.preserveLinks(client);
    assertNotCancelled();

    await boundaryUpdateRepository.deleteBoundaries(client);
    const boundaryResult = await boundaryUpdateRepository.insertBoundaries(
      client,
      osmTimestamp,
    );
    if (boundaryResult.rowCount !== geometryPlaces) {
      throw new Error('Not every buildable OSM boundary was inserted');
    }

    await boundaryUpdateRepository.activateNewPlaces(client);
    await rebuildHierarchy(client, {
      onProgress: emitProgress,
    });

    const restoredLinksResult =
      await boundaryUpdateRepository.restoreGeometryLinks(client);

    await syncDerivedData(client);
    assertNotCancelled();

    if (dryRun) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return {
        committed: false,
        restoredGeometryLinks: restoredLinksResult.rowCount,
        run: null,
      };
    }

    const runResult = await boundaryUpdateRepository.insertRun(
      client,
      runValues,
    );

    if (checkpointRepository && checkpoint) {
      await checkpointRepository.complete(client, checkpoint.id);
    }

    assertNotCancelled();
    onCommit?.();
    await client.query('COMMIT');
    inTransaction = false;

    return {
      committed: true,
      restoredGeometryLinks: restoredLinksResult.rowCount,
      run: runResult.rows[0],
    };
  } catch (error) {
    if (inTransaction) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw error;
  }
}
