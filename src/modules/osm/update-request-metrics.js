function checkpointMetrics(checkpoint) {
  return {
    downloadedBytes: Number(checkpoint?.downloadedBytes ?? 0),
    requestAttemptCount: Number(checkpoint?.requestAttemptCount ?? 0),
    retryCount: Number(checkpoint?.retryCount ?? 0),
    retryWaitMs: Number(checkpoint?.retryWaitMs ?? 0),
    throttleWaitMs: Number(checkpoint?.throttleWaitMs ?? 0),
  };
}

export function createOsmRequestMetricsState(initialCheckpoint = null) {
  let values = checkpointMetrics(initialCheckpoint);
  let persisted = { ...values };

  const metrics = {};
  for (const key of Object.keys(values)) {
    Object.defineProperty(metrics, key, {
      enumerable: true,
      get() {
        return values[key];
      },
      set(value) {
        values[key] = Number(value);
      },
    });
  }

  return {
    metrics,

    snapshot() {
      return { ...values };
    },

    delta() {
      return Object.fromEntries(
        Object.keys(values).map((key) => [
          key,
          values[key] - persisted[key],
        ]),
      );
    },

    rememberPersisted() {
      persisted = { ...values };
    },

    loadPersistedCheckpoint(checkpoint) {
      values = checkpointMetrics(checkpoint);
      persisted = { ...values };
    },
  };
}
