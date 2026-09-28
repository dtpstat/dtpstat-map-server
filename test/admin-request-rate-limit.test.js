import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAdminRequestRateLimiter,
} from '../src/http/admin-request-rate-limit.js';

test('admin request limiter enforces per-user request budget', () => {
  let now = 1_000;
  const limiter =
    createAdminRequestRateLimiter({
      now: () => now,
    });
  const settings = {
    requestRateLimitUserPerMinute: 2,
    requestRateLimitGlobalPerMinute: 10,
  };

  assert.equal(
    limiter.consume({
      userId: 7,
      settings,
    }).allowed,
    true,
  );
  assert.equal(
    limiter.consume({
      userId: 7,
      settings,
    }).allowed,
    true,
  );

  const blocked =
    limiter.consume({
      userId: 7,
      settings,
    });

  assert.equal(
    blocked.allowed,
    false,
  );
  assert.equal(
    blocked.scope,
    'user',
  );
  assert.equal(
    blocked.limit,
    2,
  );

  now = 61_000;

  assert.equal(
    limiter.consume({
      userId: 7,
      settings,
    }).allowed,
    true,
  );
});

test('admin request limiter shares one global budget between users', () => {
  const limiter =
    createAdminRequestRateLimiter({
      now: () => 1_000,
    });
  const settings = {
    requestRateLimitUserPerMinute: 10,
    requestRateLimitGlobalPerMinute: 2,
  };

  assert.equal(
    limiter.consume({
      userId: 1,
      settings,
    }).allowed,
    true,
  );
  assert.equal(
    limiter.consume({
      userId: 2,
      settings,
    }).allowed,
    true,
  );

  const blocked =
    limiter.consume({
      userId: 3,
      settings,
    });

  assert.equal(
    blocked.allowed,
    false,
  );
  assert.equal(
    blocked.scope,
    'global',
  );
  assert.equal(
    blocked.limit,
    2,
  );
});


test('global admin request budget can be consumed before user authentication', () => {
  const limiter =
    createAdminRequestRateLimiter({
      now: () => 1_000,
    });
  const settings = {
    requestRateLimitUserPerMinute: 10,
    requestRateLimitGlobalPerMinute: 2,
  };

  assert.equal(
    limiter.consumeGlobal({
      settings,
    }).allowed,
    true,
  );
  assert.equal(
    limiter.consumeGlobal({
      settings,
    }).allowed,
    true,
  );

  const blocked =
    limiter.consumeGlobal({
      settings,
    });

  assert.equal(
    blocked.allowed,
    false,
  );
  assert.equal(
    blocked.scope,
    'global',
  );
});

test('per-user request budget is independent from pre-auth global consumption', () => {
  const limiter =
    createAdminRequestRateLimiter({
      now: () => 1_000,
    });
  const settings = {
    requestRateLimitUserPerMinute: 2,
    requestRateLimitGlobalPerMinute: 100,
  };

  limiter.consumeGlobal({
    settings,
  });
  limiter.consumeGlobal({
    settings,
  });

  assert.equal(
    limiter.consumeUser({
      userId: 5,
      settings,
    }).allowed,
    true,
  );
  assert.equal(
    limiter.consumeUser({
      userId: 5,
      settings,
    }).allowed,
    true,
  );
  assert.equal(
    limiter.consumeUser({
      userId: 5,
      settings,
    }).scope,
    'user',
  );
});
