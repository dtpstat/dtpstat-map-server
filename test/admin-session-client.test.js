import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAdminSessionFetchGuard,
  isProtectedAdminRequest,
} from '../admin/admin-session.js';

function fakeLocation() {
  return {
    href: 'https://example.test/admin/',
    pathname: '/admin/',
    replacements: [],
    replace(value) {
      this.replacements.push(value);
    },
  };
}

test('admin session fetch guard redirects only on 401 from protected admin API', async () => {
  const location = fakeLocation();
  const responses = new Map([
    ['/api/admin/status', new Response('{}', { status: 401 })],
    ['/api/admin/security/users', new Response('{}', { status: 403 })],
    ['/api/config', new Response('{}', { status: 401 })],
  ]);
  const guard = createAdminSessionFetchGuard({
    fetchImpl: async (input) => responses.get(String(input)),
    location,
  });

  await guard.fetch('/api/admin/security/users');
  assert.deepEqual(location.replacements, []);

  await guard.fetch('/api/config');
  assert.deepEqual(location.replacements, []);

  await guard.fetch('/api/admin/status');
  assert.deepEqual(location.replacements, ['/admin/login.html?expired=1']);
});

test('admin session fetch guard schedules redirect at effective server expiry', async () => {
  const location = fakeLocation();
  let now = Date.parse('2026-09-20T10:00:00.000Z');
  let scheduled = null;
  const guard = createAdminSessionFetchGuard({
    fetchImpl: async () => new Response('{}', {
      status: 200,
      headers: {
        'X-DTPStat-Admin-Session-Expires-At':
          '2026-09-20T10:05:00.000Z',
      },
    }),
    location,
    now: () => now,
    setTimeoutImpl(callback, delay) {
      scheduled = { callback, delay };
      return 1;
    },
    clearTimeoutImpl() {},
  });

  await guard.fetch('/api/admin/me');
  assert.equal(scheduled.delay, 300000);
  assert.deepEqual(location.replacements, []);

  now = Date.parse('2026-09-20T10:05:00.000Z');
  scheduled.callback();
  assert.deepEqual(location.replacements, ['/admin/login.html?expired=1']);
});

test('admin session fetch guard refreshes the idle deadline after authenticated activity', async () => {
  const location = fakeLocation();
  let now = Date.parse('2026-09-20T10:00:00.000Z');
  const delays = [];
  let expiry = '2026-09-20T10:05:00.000Z';
  const guard = createAdminSessionFetchGuard({
    fetchImpl: async () => new Response('{}', {
      status: 200,
      headers: { 'X-DTPStat-Admin-Session-Expires-At': expiry },
    }),
    location,
    now: () => now,
    setTimeoutImpl(_callback, delay) {
      delays.push(delay);
      return delays.length;
    },
    clearTimeoutImpl() {},
  });

  await guard.fetch('/api/admin/me');
  assert.equal(delays.at(-1), 300000);

  now = Date.parse('2026-09-20T10:04:00.000Z');
  expiry = '2026-09-20T10:09:00.000Z';
  await guard.fetch('/api/admin/status');
  assert.equal(delays.at(-1), 300000);
  assert.deepEqual(location.replacements, []);
});

test('protected admin request detection is same-origin and excludes login', () => {
  const base = 'https://example.test/admin/';
  assert.equal(isProtectedAdminRequest('/api/admin/me', base), true);
  assert.equal(isProtectedAdminRequest('/api/admin/login', base), false);
  assert.equal(isProtectedAdminRequest('/api/config', base), false);
  assert.equal(
    isProtectedAdminRequest('https://other.test/api/admin/me', base),
    false,
  );
});


test('admin session activity hold keeps idle session alive and resumes expiry timer', async () => {
  const location = fakeLocation();
  let now = Date.parse('2026-09-20T10:00:00.000Z');
  let timeout = null;
  let interval = null;
  let fetchCalls = 0;

  const guard = createAdminSessionFetchGuard({
    fetchImpl: async (_input) => {
      fetchCalls += 1;
      return new Response('{}', {
        status: 200,
        headers: {
          'X-DTPStat-Admin-Session-Expires-At':
            new Date(now + 60_000).toISOString(),
        },
      });
    },
    location,
    now: () => now,
    setTimeoutImpl(callback, delay) {
      timeout = { callback, delay };
      return 1;
    },
    clearTimeoutImpl() {
      timeout = null;
    },
    setIntervalImpl(callback, delay) {
      interval = { callback, delay };
      return 2;
    },
    clearIntervalImpl() {
      interval = null;
    },
    keepAliveIntervalMs: 30_000,
  });

  guard.scheduleExpiry(new Date(now + 60_000).toISOString());
  assert.equal(timeout.delay, 60_000);

  guard.setActivityHold(true);
  assert.equal(guard.isActivityHeld(), true);
  assert.equal(timeout, null);
  assert.equal(interval.delay, 30_000);

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fetchCalls, 1);

  now += 30_000;
  interval.callback();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fetchCalls, 2);
  assert.deepEqual(location.replacements, []);

  guard.setActivityHold(false);
  assert.equal(guard.isActivityHeld(), false);
  assert.equal(interval, null);
  assert.equal(timeout.delay, 60_000);
});
