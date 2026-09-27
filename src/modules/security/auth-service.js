import { securityLog } from '../../service-log.js';
import {
  AdminSecurityValidationError,
  normalizeAdminIp,
  normalizeAdminUsername,
  publicAdminUser,
  secondsUntil,
} from './policy.js';
import {
  adminSessionTokenHash,
  burnUnknownPasswordCheck,
  generateAdminSessionToken,
  parseBasicAuthorization,
  verifyAdminPassword,
} from './credentials.js';

export function createSecurityAuthService(
  repository,
  { appendAudit },
) {
  async function ipAccessState(ipAddress) {
    const ip = normalizeAdminIp(ipAddress);
    if (!ip) return { status: 'ok', ipAddress: null };

    const manualBlock = await repository.isIpBlocked(ip);
    if (manualBlock) {
      return {
        status: 'ip-blocked',
        ipAddress: ip,
        block: manualBlock,
      };
    }

    const state = await repository.getIpState(ip);
    const retryAfterSeconds =
      secondsUntil(state?.lockedUntil);

    if (retryAfterSeconds) {
      return {
        status: 'ip-locked',
        ipAddress: ip,
        retryAfterSeconds,
      };
    }

    return { status: 'ok', ipAddress: ip };
  }

  async function recordFailedIp(
    ipAddress,
    username,
    settings,
    startedAt,
  ) {
    const ip = normalizeAdminIp(ipAddress);
    securityLog('admin.auth.failed', {
      username: username || null,
      ip,
    });

    if (!ip) return null;

    const state = await repository.recordFailedIp(
      ip,
      new Date().toISOString(),
      settings,
    );
    const retryAfterSeconds =
      secondsUntil(state?.lockedUntil);

    if (retryAfterSeconds) {
      securityLog('admin.auth.ip_lockout', {
        username: username || null,
        ip,
        attempts: state.failedLoginCount,
        lockoutSeconds: retryAfterSeconds,
      });
      await appendAudit({
        eventType: 'authentication',
        operationType: 'admin.ip-lockout',
        status: 'locked',
        durationMs: Date.now() - startedAt,
        ipAddress: ip,
        username: username || null,
        details: {
          failedLoginCount: state.failedLoginCount,
          retryAfterSeconds,
        },
      });
    }

    return retryAfterSeconds;
  }

  async function authenticateCredentials(
    usernameValue,
    password,
    context = {},
  ) {
    const startedAt = Date.now();
    const ipState =
      await ipAccessState(context.ipAddress);

    if (ipState.status !== 'ok') {
      return ipState;
    }

    const settings =
      await repository.getSecuritySettings();

    let username;
    try {
      username =
        normalizeAdminUsername(usernameValue);
    } catch {
      username =
        String(usernameValue ?? '').slice(0, 64);
    }

    const user =
      await repository.findUserByUsername(username);

    if (!user) {
      await burnUnknownPasswordCheck(password);
      const ipRetry = await recordFailedIp(
        ipState.ipAddress,
        username,
        settings,
        startedAt,
      );

      await appendAudit({
        eventType: 'authentication',
        operationType: 'admin.login',
        status: ipRetry ? 'locked' : 'failed',
        durationMs: Date.now() - startedAt,
        ipAddress: ipState.ipAddress,
        username: username || null,
        details: {
          reason: 'invalid-credentials',
        },
      });

      return ipRetry
        ? {
          status: 'ip-locked',
          user: null,
          retryAfterSeconds: ipRetry,
        }
        : {
          status: 'invalid',
          user: null,
        };
    }

    const now = new Date();

    if (user.isBlocked) {
      const manualRetry =
        secondsUntil(user.manualBlockedUntil, now);

      if (!user.manualBlockedUntil || manualRetry) {
        await appendAudit({
          eventType: 'authentication',
          operationType: 'admin.login',
          status: 'blocked',
          durationMs: Date.now() - startedAt,
          ipAddress: ipState.ipAddress,
          userId: user.id,
          username: user.username,
          details: {
            reason: 'manual-block',
            retryAfterSeconds: manualRetry,
          },
        });

        return {
          status: 'blocked',
          user: publicAdminUser(user),
          retryAfterSeconds: manualRetry,
        };
      }

      await repository.updateUser(user.id, {
        ...user,
        isBlocked: false,
        manualBlockedAt: null,
        manualBlockedUntil: null,
        manualBlockReason: null,
        manualBlockedBy: null,
      });
      user.isBlocked = false;
    }

    const accountRetry =
      secondsUntil(user.lockedUntil, now);

    if (accountRetry) {
      await appendAudit({
        eventType: 'authentication',
        operationType: 'admin.login',
        status: 'locked',
        durationMs: Date.now() - startedAt,
        ipAddress: ipState.ipAddress,
        userId: user.id,
        username: user.username,
        details: {
          retryAfterSeconds: accountRetry,
        },
      });

      return {
        status: 'locked',
        user: publicAdminUser(user),
        retryAfterSeconds: accountRetry,
      };
    }

    if (
      !await verifyAdminPassword(
        password,
        user.passwordHash,
      )
    ) {
      const updated =
        await repository.recordFailedLogin(
          user.id,
          now.toISOString(),
          settings,
        );

      const retryAfterSeconds =
        secondsUntil(updated?.lockedUntil, now);

      const ipRetry = await recordFailedIp(
        ipState.ipAddress,
        user.username,
        settings,
        startedAt,
      );

      if (retryAfterSeconds) {
        securityLog('admin.auth.lockout', {
          username: user.username,
          ip: ipState.ipAddress,
          attempts:
            updated?.failedLoginCount ?? null,
          lockoutSeconds: retryAfterSeconds,
        });
      }

      await appendAudit({
        eventType: 'authentication',
        operationType: 'admin.login',
        status:
          retryAfterSeconds || ipRetry
            ? 'locked'
            : 'failed',
        durationMs: Date.now() - startedAt,
        ipAddress: ipState.ipAddress,
        userId: user.id,
        username: user.username,
        details: {
          reason: 'invalid-credentials',
          failedLoginCount:
            updated?.failedLoginCount ?? null,
          ...(retryAfterSeconds
            ? { retryAfterSeconds }
            : {}),
          ...(ipRetry
            ? { ipRetryAfterSeconds: ipRetry }
            : {}),
        },
      });

      if (ipRetry) {
        return {
          status: 'ip-locked',
          user: null,
          retryAfterSeconds: ipRetry,
        };
      }

      return retryAfterSeconds
        ? {
          status: 'locked',
          user: null,
          retryAfterSeconds,
        }
        : {
          status: 'invalid',
          user: null,
        };
    }

    await repository.clearIpFailures(
      ipState.ipAddress,
    );

    const authenticated =
      await repository.recordSuccessfulLogin(
        user.id,
        now.toISOString(),
      ) ?? user;

    if (context.recordLogin !== false) {
      await appendAudit({
        eventType: 'authentication',
        operationType: 'admin.login',
        status: 'succeeded',
        durationMs: Date.now() - startedAt,
        ipAddress: ipState.ipAddress,
        userId: user.id,
        username: user.username,
        details: {
          method:
            context.method ?? 'password',
        },
      });
    }

    return {
      status: 'success',
      user: publicAdminUser(authenticated),
      rawUser: authenticated,
    };
  }

  async function authenticate(
    authorization,
    context = {},
  ) {
    const credentials =
      parseBasicAuthorization(authorization);

    if (credentials.status === 'missing') {
      return {
        status: 'missing',
        user: null,
      };
    }
    if (credentials.status !== 'credentials') {
      return {
        status: 'invalid',
        user: null,
      };
    }

    return authenticateCredentials(
      credentials.username,
      credentials.password,
      {
        ...context,
        method: 'basic',
        recordLogin:
          context.recordLogin ?? false,
      },
    );
  }

  async function login(payload, context = {}) {
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload)
    ) {
      throw new AdminSecurityValidationError(
        'Request body must be a JSON object',
      );
    }

    const result =
      await authenticateCredentials(
        payload.username,
        payload.password,
        {
          ...context,
          method: 'session',
          recordLogin: true,
        },
      );

    if (result.status !== 'success') {
      return result;
    }

    const settings =
      await repository.getSecuritySettings();
    const token =
      generateAdminSessionToken();
    const expiresAt = new Date(
      Date.now() +
      settings.sessionAbsoluteSeconds * 1000,
    ).toISOString();

    const session = await repository.createSession({
      userId: result.user.id,
      tokenHash: adminSessionTokenHash(token),
      expiresAt,
      ipAddress:
        normalizeAdminIp(context.ipAddress),
      userAgent:
        String(context.userAgent ?? '')
          .slice(0, 1000) || null,
    });

    return {
      status: 'success',
      user: result.user,
      token,
      sessionId: session.id,
      expiresAt,
    };
  }

  async function authenticateSession(
    token,
    context = {},
  ) {
    if (!token) {
      return {
        status: 'missing',
        user: null,
      };
    }

    const ipState =
      await ipAccessState(context.ipAddress);

    if (ipState.status !== 'ok') {
      return ipState;
    }

    const session = await repository.findSession(
      adminSessionTokenHash(token),
    );

    if (!session) {
      return {
        status: 'invalid',
        user: null,
      };
    }

    const now = new Date();
    const settings =
      await repository.getSecuritySettings();

    const absoluteExpired =
      new Date(session.sessionExpiresAt) <= now;

    const idleExpired =
      new Date(
        session.sessionLastSeenAt,
      ).valueOf() +
      settings.sessionIdleSeconds * 1000 <=
      now.valueOf();

    if (absoluteExpired || idleExpired) {
      await repository.revokeSessionByHash(
        adminSessionTokenHash(token),
      );
      return {
        status: 'expired',
        user: null,
      };
    }

    const user = publicAdminUser(session);

    if (user.isBlocked) {
      const retryAfterSeconds =
        secondsUntil(
          user.manualBlockedUntil,
          now,
        );

      if (
        !user.manualBlockedUntil ||
        retryAfterSeconds
      ) {
        return {
          status: 'blocked',
          user,
          retryAfterSeconds,
        };
      }
    }

    let lastSeenAt =
      new Date(session.sessionLastSeenAt);

    const idleTouchIntervalMs = Math.min(
      60_000,
      Math.max(
        1_000,
        Math.floor(
          settings.sessionIdleSeconds *
          1000 /
          2,
        ),
      ),
    );

    if (
      now.valueOf() -
      lastSeenAt.valueOf() >=
      idleTouchIntervalMs
    ) {
      lastSeenAt = now;
      await repository.touchSession(
        session.sessionId,
        now.toISOString(),
      );
    }

    const absoluteExpiresAt =
      new Date(session.sessionExpiresAt);
    const idleExpiresAt = new Date(
      lastSeenAt.valueOf() +
      settings.sessionIdleSeconds * 1000,
    );
    const effectiveExpiresAt = new Date(
      Math.min(
        absoluteExpiresAt.valueOf(),
        idleExpiresAt.valueOf(),
      ),
    );

    return {
      status: 'success',
      user,
      sessionId: session.sessionId,
      authMethod: 'session',
      token,
      sessionAbsoluteExpiresAt:
        absoluteExpiresAt.toISOString(),
      sessionIdleExpiresAt:
        idleExpiresAt.toISOString(),
      sessionEffectiveExpiresAt:
        effectiveExpiresAt.toISOString(),
    };
  }

  async function authenticateRequest({
    authorization,
    sessionToken,
    ...context
  }) {
    if (sessionToken) {
      const sessionResult =
        await authenticateSession(
          sessionToken,
          context,
        );

      if (
        sessionResult.status === 'success'
      ) {
        return sessionResult;
      }

      if (
        sessionResult.status !== 'invalid' &&
        sessionResult.status !== 'expired'
      ) {
        return sessionResult;
      }
    }

    const basicResult =
      await authenticate(
        authorization,
        context,
      );

    return basicResult.status === 'success'
      ? {
        ...basicResult,
        authMethod: 'basic',
        sessionId: null,
      }
      : basicResult;
  }

  async function logout(token) {
    if (token) {
      await repository.revokeSessionByHash(
        adminSessionTokenHash(token),
      );
    }
  }

  return {
    authenticate,
    authenticateRequest,
    login,
    logout,
  };
}
