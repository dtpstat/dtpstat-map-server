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

  return {
    consume({
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
      const globalLimit =
        positiveLimit(
          settings
            .requestRateLimitGlobalPerMinute,
          DEFAULT_GLOBAL_LIMIT,
        );
      const key =
        String(userId);
      const userCount =
        perUser.get(key) ??
        0;
      const retryAfterSeconds =
        Math.max(
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

      if (
        userCount >=
        userLimit
      ) {
        return {
          allowed: false,
          scope: 'user',
          limit: userLimit,
          retryAfterSeconds,
        };
      }

      if (
        globalCount >=
        globalLimit
      ) {
        return {
          allowed: false,
          scope: 'global',
          limit: globalLimit,
          retryAfterSeconds,
        };
      }

      perUser.set(
        key,
        userCount + 1,
      );
      globalCount += 1;

      return {
        allowed: true,
        userRemaining:
          Math.max(
            0,
            userLimit -
            userCount -
            1,
          ),
        globalRemaining:
          Math.max(
            0,
            globalLimit -
            globalCount,
          ),
      };
    },
  };
}
