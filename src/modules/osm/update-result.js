export function buildOsmUpdateRunValues({
  options,
  checksum,
  requestMetrics,
  index,
  geometryPlaces,
  ignoredElements,
  cityPlaces,
  townPlaces,
  duplicateNames,
  administrativePlaces,
  batchCount,
}) {
  return [
    options.url,
    checksum,
    requestMetrics.downloadedBytes,
    index.sourceElements,
    geometryPlaces,
    ignoredElements,
    index.osmTimestamp,
    cityPlaces,
    townPlaces,
    duplicateNames,
    administrativePlaces,
    index.duplicateIndexObjects,
    options.batchSize,
    batchCount,
  ];
}

export function buildOsmUpdateResult({
  options,
  indexQueries,
  indexFinalURLs,
  requestMetrics,
  index,
  geometryPlaces,
  unbuildableGeometryPlaces,
  cityPlaces,
  townPlaces,
  administrativePlaces,
  duplicateNames,
  ignoredElements,
  batchCount,
  restoredGeometryLinks,
  checksum,
  checkpoint,
  mode,
  reusedObjects,
}) {
  return {
    dryRun: options.dryRun,
    sourceURL: options.url,
    indexFinalURLs: [...indexFinalURLs],
    indexRequestCount: indexQueries.length,
    downloadedBytes: requestMetrics.downloadedBytes,
    sourceElements: index.sourceElements,
    indexedPlaces: index.objects.length,
    importedPlaces: geometryPlaces,
    unbuildableGeometryPlaces,
    cityPlaces,
    townPlaces,
    administrativePlaces,
    duplicateIndexObjects: index.duplicateIndexObjects,
    duplicateNames,
    ignoredElements,
    batchSize: options.batchSize,
    batchCount,
    maxResponseBytes: options.maxResponseBytes,
    maxTotalBytes: options.maxTotalBytes,
    minDelayMs: options.minDelayMs,
    maxRetries: options.maxRetries,
    requestAttemptCount: requestMetrics.requestAttemptCount,
    retryCount: requestMetrics.retryCount,
    retryWaitMs: requestMetrics.retryWaitMs,
    throttleWaitMs: requestMetrics.throttleWaitMs,
    restoredGeometryLinks,
    osmTimestamp: index.osmTimestamp,
    checksum,
    checkpointId: checkpoint?.id ?? null,
    resumed: mode.resume,
    reusedObjects,
    completedAt: new Date().toISOString(),
  };
}

export function finalizeOsmUpdateResult({
  result,
  commitResult,
  checkpointEnabled,
}) {
  if (!commitResult.committed) {
    return {
      ...result,
      checkpointStatus: checkpointEnabled ? 'ready' : null,
      resumable: checkpointEnabled,
    };
  }

  return {
    ...result,
    checkpointStatus: checkpointEnabled ? 'completed' : null,
    resumable: false,
    updateRunId: commitResult.run.id,
    completedAt: commitResult.run.createdAt,
  };
}
