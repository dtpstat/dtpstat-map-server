import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reportOsmUpdateProgress,
} from '../src/modules/osm/update-progress-reporter.js';

function captureConsole(fn) {
  const info = [];
  const warn = [];
  const originalInfo = console.info;
  const originalWarn = console.warn;
  console.info = (...args) => info.push(args.join(' '));
  console.warn = (...args) => warn.push(args.join(' '));
  try {
    fn();
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
  }
  return { info, warn };
}

test('OSM progress reporter formats resume index retry split and hierarchy phases', () => {
  const output = captureConsole(() => {
    reportOsmUpdateProgress({
      phase: 'resume',
      checkpointId: 7,
      stagedPlaces: 2,
      indexedPlaces: 5,
      remainingPlaces: 3,
    });
    reportOsmUpdateProgress({
      phase: 'index',
      indexPart: 2,
      indexPartCount: 4,
      indexedPlaces: 9,
    });
    reportOsmUpdateProgress({
      phase: 'retry',
      statusCode: 429,
      attempt: 1,
      maxRetries: 6,
      waitMs: 30000,
    });
    reportOsmUpdateProgress({
      phase: 'split',
      reason: 'http-504',
      retryCount: 3,
      batch: 2,
      objectCount: 8,
      splitSizes: [4, 4],
    });
    reportOsmUpdateProgress({
      phase: 'hierarchy',
      processed: 250,
      total: 500,
      batch: 1,
      batchCount: 2,
    });
  });

  assert.equal(output.info.length, 3);
  assert.equal(output.warn.length, 2);
  assert.match(output.info[0], /checkpoint 7/u);
  assert.match(output.info[1], /index 2\/4/u);
  assert.match(output.warn[0], /HTTP 429/u);
  assert.match(output.warn[1], /split 8 objects into 4\+4/u);
  assert.match(output.info[2], /250\/500/u);
});

test('OSM progress reporter keeps generic geometry batch logging', () => {
  const output = captureConsole(() => {
    reportOsmUpdateProgress({
      phase: 'geometry',
      batch: 2,
      batchCount: 3,
      stagedPlaces: 50,
      indexedPlaces: 75,
    });
  });

  assert.deepEqual(output.warn, []);
  assert.equal(output.info.length, 1);
  assert.match(output.info[0], /batch 2\/3/u);
  assert.match(output.info[0], /50\/75/u);
});
