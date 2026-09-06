import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runServiceOperation,
  serviceErrorDetails,
  serviceLog,
} from '../src/service-log.js';

function captureOutput() {
  const entries = [];
  return {
    entries,
    output: {
      info(message, details) {
        entries.push({ level: 'info', message, details });
      },
      warn(message, details) {
        entries.push({ level: 'warning', message, details });
      },
      error(message, details) {
        entries.push({ level: 'error', message, details });
      },
    },
  };
}

test('serviceLog emits a stable grep-friendly prefix', () => {
  const { entries, output } = captureOutput();
  serviceLog('warning', 'database.retry', { attempt: 2 }, output);
  assert.deepEqual(entries, [
    {
      level: 'warning',
      message: '[service] database.retry',
      details: { attempt: 2 },
    },
  ]);
});

test('runServiceOperation logs start, result details and duration', async () => {
  const { entries, output } = captureOutput();
  const times = [1000, 1037];
  const result = await runServiceOperation(
    'public-downloads.refresh',
    async () => ({ featureCount: 12, cityCount: 3 }),
    {
      details: { reason: 'startup' },
      successDetails: (value) => value,
      now: () => times.shift(),
      output,
    },
  );

  assert.deepEqual(result, { featureCount: 12, cityCount: 3 });
  assert.deepEqual(entries, [
    {
      level: 'info',
      message: '[service] public-downloads.refresh:start',
      details: { reason: 'startup' },
    },
    {
      level: 'info',
      message: '[service] public-downloads.refresh:ok',
      details: { featureCount: 12, cityCount: 3, durationMs: 37 },
    },
  ]);
});

test('runServiceOperation logs failures and rethrows them', async () => {
  const { entries, output } = captureOutput();
  const times = [2000, 2011];
  const failure = new Error('connection lost');
  failure.code = '57P01';

  await assert.rejects(
    runServiceOperation(
      'database.health',
      async () => {
        throw failure;
      },
      { now: () => times.shift(), output },
    ),
    failure,
  );

  assert.deepEqual(entries, [
    {
      level: 'info',
      message: '[service] database.health:start',
      details: {},
    },
    {
      level: 'error',
      message: '[service] database.health:error',
      details: {
        name: 'Error',
        code: '57P01',
        message: 'connection lost',
        durationMs: 11,
      },
    },
  ]);
  assert.deepEqual(serviceErrorDetails('broken'), {
    name: 'Error',
    code: null,
    message: 'broken',
  });
});
