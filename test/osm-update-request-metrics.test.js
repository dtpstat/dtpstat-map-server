import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOsmRequestMetricsState,
} from '../src/modules/osm/update-request-metrics.js';

test('OSM request metrics state starts from persisted checkpoint counters', () => {
  const state = createOsmRequestMetricsState({
    downloadedBytes: 100,
    requestAttemptCount: 2,
    retryCount: 1,
    retryWaitMs: 30,
    throttleWaitMs: 40,
  });

  assert.deepEqual(state.snapshot(), {
    downloadedBytes: 100,
    requestAttemptCount: 2,
    retryCount: 1,
    retryWaitMs: 30,
    throttleWaitMs: 40,
  });
  assert.deepEqual(state.delta(), {
    downloadedBytes: 0,
    requestAttemptCount: 0,
    retryCount: 0,
    retryWaitMs: 0,
    throttleWaitMs: 0,
  });
});

test('OSM request metrics state exposes mutable counters and persistence delta', () => {
  const state = createOsmRequestMetricsState();
  state.metrics.downloadedBytes += 50;
  state.metrics.requestAttemptCount += 2;
  state.metrics.retryCount += 1;
  state.metrics.retryWaitMs += 300;
  state.metrics.throttleWaitMs += 100;

  assert.deepEqual(state.delta(), {
    downloadedBytes: 50,
    requestAttemptCount: 2,
    retryCount: 1,
    retryWaitMs: 300,
    throttleWaitMs: 100,
  });

  state.rememberPersisted();
  assert.deepEqual(state.delta(), {
    downloadedBytes: 0,
    requestAttemptCount: 0,
    retryCount: 0,
    retryWaitMs: 0,
    throttleWaitMs: 0,
  });
});

test('OSM request metrics state can reload authoritative persisted counters', () => {
  const state = createOsmRequestMetricsState();
  state.metrics.downloadedBytes = 999;
  state.loadPersistedCheckpoint({
    downloadedBytes: 120,
    requestAttemptCount: 4,
    retryCount: 2,
    retryWaitMs: 600,
    throttleWaitMs: 300,
  });

  assert.equal(state.metrics.downloadedBytes, 120);
  assert.equal(state.metrics.requestAttemptCount, 4);
  assert.deepEqual(state.delta(), {
    downloadedBytes: 0,
    requestAttemptCount: 0,
    retryCount: 0,
    retryWaitMs: 0,
    throttleWaitMs: 0,
  });
});
