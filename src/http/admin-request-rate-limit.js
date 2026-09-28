const WINDOW_MS =
  60_000;

const DEFAULT_USER_LIMIT =
  600;
const DEFAULT_GLOBAL_LIMIT =
  5000;

function positiveLimit(
  value,
  fallback,
) {
  return (
    Number.isInteger(value) &&
    value > 0
  )
    ? value
    : fallback;
}

export function createAdminRequestRateLimiter({
  now = Date.now,
} = {}) {
  let windowId = null;
  let globalCount = 0;
  const perUser =
    new Map();

  function resetIfNeeded(
    timestamp,
  ) {
    const nextWindow =
      Math.floor(
        timestamp /
        WINDOW_MS,
      );

    if (
      nextWindow ===
      windowId
    ) {
      return;
    }

    windowId =
      nextWindow;
    globalCount = 0;
    perUser.clear();
  }

  function retryAfterSeconds(
    timestamp,
  ) {
    return Math.max(
      1,
      Math.ceil(
        (
          (
            windowId + 1
          ) *
          WINDOW_MS -
          timestamp
        ) /
        1000,
      ),
    );
  }

  function consumeGlobal({
    settings = {},
  } = {}) {
    const timestamp =
      Number(now());
    resetIfNeeded(
      timestamp,
    );

    const globalLimit =
      positiveLimit(
        settings
          .requestRateLimitGlobalPerMinute,
        DEFAULT_GLOBAL_LIMIT,
      );

    if (
      globalCount >=
      globalLimit
    ) {
      return {
        allowed: false,
        scope: 'global',
        limit: globalLimit,
        retryAfterSeconds:
          retryAfterSeconds(
            timestamp,
          ),
      };
    }

    globalCount += 1;

    return {
      allowed: true,
      globalRemaining:
        Math.max(
          0,
          globalLimit -
          globalCount,
        ),
    };
  }

  function consumeUser({
    userId,
    settings = {},
  }) {
    const timestamp =
      Number(now());
    resetIfNeeded(
      timestamp,
    );

    const userLimit =
      positiveLimit(
        settings
          .requestRateLimitUserPerMinute,
        DEFAULT_USER_LIMIT,
      );
    const key =
      String(userId);
    const userCount =
      perUser.get(key) ??
      0;

    if (
      userCount >=
      userLimit
    ) {
      return {
        allowed: false,
        scope: 'user',
        limit: userLimit,
        retryAfterSeconds:
          retryAfterSeconds(
            timestamp,
          ),
      };
    }

    perUser.set(
      key,
      userCount + 1,
    );

    return {
      allowed: true,
      userRemaining:
        Math.max(
          0,
          userLimit -
          userCount -
          1,
        ),
    };
  }

  return {
    consumeGlobal,
    consumeUser,

    consume({
      userId,
      settings = {},
    }) {
      const global =
        consumeGlobal({
          settings,
        });

      if (!global.allowed) {
        return global;
      }

      const user =
        consumeUser({
          userId,
          settings,
        });

      return user.allowed
        ? {
            ...user,
            globalRemaining:
              global.globalRemaining,
          }
        : user;
    },
  };
}
