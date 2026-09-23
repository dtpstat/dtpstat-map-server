export function reportOsmUpdateProgress(progress) {
  if (progress.phase === 'resume') {
    console.info(
      `OSM city update resumed checkpoint ${progress.checkpointId}: ` +
      `${progress.stagedPlaces}/${progress.indexedPlaces} already staged, ` +
      `${progress.remainingPlaces} remaining`,
    );
    return;
  }
  if (progress.phase === 'index') {
    console.info(
      `OSM city update index ${progress.indexPart}/${progress.indexPartCount}: ` +
      `${progress.indexedPlaces} place IDs loaded`,
    );
    return;
  }
  if (progress.phase === 'retry') {
    const reason = progress.retryKind === 'network'
      ? `network ${progress.networkCode ?? progress.networkMessage ?? 'failure'}`
      : `HTTP ${progress.statusCode}`;
    console.warn(
      `OSM city update ${reason}: retry ` +
      `${progress.attempt}/${progress.maxRetries} in ${progress.waitMs} ms`,
    );
    return;
  }
  if (progress.phase === 'split') {
    const reason = progress.reason === 'http-504'
      ? `HTTP 504 after ${progress.retryCount} retries`
      : `response exceeded ${progress.limitBytes} bytes`;
    console.warn(
      `OSM geometry batch ${progress.batch}: ${reason}; split ` +
      `${progress.objectCount} objects into ${progress.splitSizes.join('+')}`,
    );
    return;
  }
  if (progress.phase === 'hierarchy') {
    console.info(
      `OSM boundary hierarchy ${progress.processed}/${progress.total}: ` +
      `batch ${progress.batch}/${progress.batchCount}`,
    );
    return;
  }
  console.info(
    `OSM city update batch ${progress.batch}/${progress.batchCount}: ` +
    `${progress.stagedPlaces}/${progress.indexedPlaces} places staged`,
  );
}
