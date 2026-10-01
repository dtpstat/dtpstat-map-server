import { securityLog } from '../../service-log.js';
import {
  AdminSecurityValidationError,
  isLoopbackAdminIp,
  normalizeAdminIp,
  normalizeAdminUsername,
  publicAdminUser,
  secondsUntil,
} from './policy.js';
import {
  adminSessionTokenHash,
  burnUnknownPasswordCheck,
  generateAdminSessionToken,
  verifyAdminPassword,
} from './credentials.js';
import {
  decryptMfaSecret,
  generateMfaChallengeToken,
  mfaChallengeTokenHash,
  recoveryCodeHash,
  verifyTotpCode,
} from './mfa.js';

export function createSecurityAuthService(
  repository,
  {
    appendAudit,
    mfaEncryptionKey = null,
  },
) {
  async function ipAccessState(ipAddress) {
    const ip = normalizeAdminIp(ipAddress);
    if (!ip) return { status: 'ok', ipAddress: null };
    if (isLoopbackAdminIp(ip)) {
      return {
        status: 'ok',
        ipAddress: ip,
        loopback: true,
      };
    }

    const manualBlock = await repository.isIpBlocked(ip);
    if (manualBlock) {
      return {
        status: 'ip-blocked',
        ipAddress: ip,
        block: manualBlock,
      };
    }

    const state =
      await repository
        .getIpState(ip);
    const loginRetry =
      secondsUntil(
        state?.lockedUntil,
      );
    const requestRetry =
      secondsUntil(
        state
          ?.requestLockedUntil,
      );
    const retryAfterSeconds =
      Math.max(
        loginRetry,
        requestRetry,
      );

    if (retryAfterSeconds) {
      return {
        status: 'ip-locked',
        ipAddress: ip,
        retryAfterSeconds,
        lockReason:
          requestRetry >=
            loginRetry &&
          requestRetry > 0
            ? 'request-security'
            : 'authentication',
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

    if (
      !ip ||
      isLoopbackAdminIp(ip)
    ) {
      return null;
    }

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


  async function recordRequestSecurityIncident(
    ipAddress,
    details = {},
  ) {
    const ip =
      normalizeAdminIp(
        ipAddress,
      );

    if (
      !ip ||
      isLoopbackAdminIp(ip)
    ) {
      return {
        locked: false,
        retryAfterSeconds: 0,
        loopback: Boolean(
          ip &&
          isLoopbackAdminIp(ip),
        ),
      };
    }

    const settings =
      await repository
        .getSecuritySettings();
    const state =
      await repository
        .recordRequestSecurityIncident(
          ip,
          new Date().toISOString(),
          settings,
          5,
        );

    const retryAfterSeconds =
      secondsUntil(
        state
          ?.requestLockedUntil,
      );
    const locked =
      retryAfterSeconds > 0;

    securityLog(
      locked
        ? 'admin.request.ip_lockout'
        : 'admin.request.security_incident',
      {
        ip,
        attempts:
          state
            ?.requestIncidentCount ??
          0,
        retryAfterSeconds:
          retryAfterSeconds ||
          null,
        reason:
          details.reason ??
          'api-contract',
        method:
          details.method ??
          null,
        path:
          details.path ??
          null,
        fields:
          Array.isArray(
            details.fields,
          )
            ? details.fields
                .slice(0, 32)
            : [],
      },
    );

    await appendAudit({
      eventType:
        'security',
      operationType:
        locked
          ? 'admin.request.ip-lockout'
          : 'admin.request.contract-violation',
      status:
        locked
          ? 'locked'
          : 'blocked',
      durationMs: null,
      ipAddress: ip,
      userId: null,
      username: null,
      details: {
        reason:
          details.reason ??
          'api-contract',
        method:
          details.method ??
          null,
        path:
          details.path ??
          null,
        fields:
          Array.isArray(
            details.fields,
          )
            ? details.fields
                .slice(0, 32)
            : [],
        requestIncidentCount:
          state
            ?.requestIncidentCount ??
          0,
        retryAfterSeconds:
          retryAfterSeconds ||
          null,
      },
    });

    return {
      locked,
      retryAfterSeconds,
      state,
    };
  }

  async function completeSuccessfulAuthentication(
    rawUser,
    settings,
    context,
    startedAt,
    method,
  ) {
    const ipAddress =
      normalizeAdminIp(
        context.ipAddress,
      );
    const now =
      new Date();

    await repository.clearIpFailures(
      ipAddress,
    );

    const authenticated =
      await repository.recordSuccessfulLogin(
        rawUser.id,
        now.toISOString(),
      ) ??
      rawUser;

    await appendAudit({
      eventType:
        'authentication',
      operationType:
        'admin.login',
      status:
        'succeeded',
      durationMs:
        Date.now() -
        startedAt,
      ipAddress,
      userId:
        rawUser.id,
      username:
        rawUser.username,
      details: {
        method,
      },
    });

    return {
      user:
        publicAdminUser(
          authenticated,
        ),
      rawUser:
        authenticated,
      securitySettings:
        settings,
    };
  }

  async function createLoginSession(
    authenticated,
    context,
  ) {
    const settings =
      authenticated
        .securitySettings ??
      await repository
        .getSecuritySettings();
    const token =
      generateAdminSessionToken();
    const expiresAt =
      new Date(
        Date.now() +
        settings
          .sessionAbsoluteSeconds *
        1000,
      ).toISOString();
    const userAgent =
      String(
        context.userAgent ??
        '',
      )
        .slice(
          0,
          1000,
        ) ||
      null;
    const ipAddress =
      normalizeAdminIp(
        context.ipAddress,
      );

    const session =
      await repository.createSession({
        userId:
          authenticated
            .user.id,
        tokenHash:
          adminSessionTokenHash(
            token,
          ),
        expiresAt,
        ipAddress,
        userAgent,
      });

    return {
      status:
        'success',
      user:
        authenticated.user,
      token,
      sessionId:
        session.id,
      expiresAt,
    };
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

    if (
      context.deferSuccess ===
      true
    ) {
      return {
        status:
          'success',
        user:
          publicAdminUser(
            user,
          ),
        rawUser:
          user,
        securitySettings:
          settings,
        startedAt,
      };
    }

    const completed =
      await completeSuccessfulAuthentication(
        user,
        settings,
        context,
        startedAt,
        context.method ??
          'password',
      );

    return {
      status:
        'success',
      ...completed,
    };
  }

  async function login(
    payload,
    context = {},
  ) {
    if (
      !payload ||
      typeof payload !==
        'object' ||
      Array.isArray(
        payload,
      )
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
          method:
            'session',
          deferSuccess:
            true,
        },
      );

    if (
      result.status !==
      'success'
    ) {
      return result;
    }

    const mfaState =
      typeof repository
        .getMfaState ===
        'function'
        ? await repository
            .getMfaState(
              result.rawUser.id,
            )
        : null;

    if (
      mfaState?.enabled
    ) {
      if (
        !mfaEncryptionKey
      ) {
        await appendAudit({
          eventType:
            'authentication',
          operationType:
            'admin.login',
          status:
            'failed',
          durationMs:
            Date.now() -
            result.startedAt,
          ipAddress:
            normalizeAdminIp(
              context.ipAddress,
            ),
          userId:
            result.rawUser.id,
          username:
            result.rawUser
              .username,
          details: {
            reason:
              'mfa-key-unavailable',
          },
        });

        return {
          status:
            'mfa-unavailable',
        };
      }

      await repository
        .purgeExpiredMfaChallenges();

      const challengeToken =
        generateMfaChallengeToken();
      const expiresAt =
        new Date(
          Date.now() +
          5 * 60 * 1000,
        ).toISOString();
      const ipAddress =
        normalizeAdminIp(
          context.ipAddress,
        );
      const userAgent =
        String(
          context.userAgent ??
          '',
        )
          .slice(
            0,
            1000,
          ) ||
        null;

      await repository
        .createMfaChallenge({
          tokenHash:
            mfaChallengeTokenHash(
              challengeToken,
            ),
          userId:
            result.rawUser.id,
          expiresAt,
          ipAddress,
          userAgent,
        });

      await appendAudit({
        eventType:
          'authentication',
        operationType:
          'admin.login',
        status:
          'challenge',
        durationMs:
          Date.now() -
          result.startedAt,
        ipAddress,
        userId:
          result.rawUser.id,
        username:
          result.rawUser
            .username,
        details: {
          method:
            'password+mfa',
        },
      });

      return {
        status:
          'mfa-required',
        challengeToken,
        expiresAt,
      };
    }

    const authenticated =
      await completeSuccessfulAuthentication(
        result.rawUser,
        result.securitySettings,
        context,
        result.startedAt,
        'password',
      );

    return createLoginSession(
      authenticated,
      context,
    );
  }

  async function completeMfaLogin(
    payload,
    context = {},
  ) {
    if (
      !payload ||
      typeof payload !==
        'object' ||
      Array.isArray(
        payload,
      )
    ) {
      throw new AdminSecurityValidationError(
        'Request body must be a JSON object',
      );
    }

    const challengeToken =
      typeof payload
        .challengeToken ===
        'string'
        ? payload
            .challengeToken
            .trim()
        : '';
    const code =
      typeof payload.code ===
        'string'
        ? payload.code
            .trim()
        : '';

    if (
      !/^[A-Za-z0-9_-]{40,128}$/u
        .test(
          challengeToken,
        ) ||
      code.length >
        128
    ) {
      return {
        status:
          'invalid-challenge',
      };
    }

    const challenge =
      await repository
        .consumeMfaChallenge(
          mfaChallengeTokenHash(
            challengeToken,
          ),
        );

    if (!challenge) {
      return {
        status:
          'invalid-challenge',
      };
    }

    const requestIp =
      normalizeAdminIp(
        context.ipAddress,
      );
    const requestUserAgent =
      String(
        context.userAgent ??
        '',
      )
        .slice(
          0,
          1000,
        ) ||
      null;

    if (
      (
        challenge.ipAddress ??
        null
      ) !==
        requestIp ||
      (
        challenge.userAgent ??
        null
      ) !==
        requestUserAgent
    ) {
      await appendAudit({
        eventType:
          'authentication',
        operationType:
          'admin.login',
        status:
          'failed',
        durationMs:
          null,
        ipAddress:
          requestIp,
        userId:
          challenge.userId,
        username:
          null,
        details: {
          reason:
            'mfa-challenge-context-mismatch',
        },
      });

      return {
        status:
          'invalid-challenge',
      };
    }

    const rawUser =
      await repository
        .getAuthUser(
          challenge.userId,
        );
    const mfaState =
      rawUser &&
      await repository
        .getMfaState(
          challenge.userId,
        );

    if (
      !rawUser ||
      !mfaState?.enabled ||
      !mfaState
        .secretCiphertext
    ) {
      return {
        status:
          'invalid-challenge',
      };
    }

    if (
      !mfaEncryptionKey
    ) {
      return {
        status:
          'mfa-unavailable',
      };
    }

    const settings =
      await repository
        .getSecuritySettings();
    const startedAt =
      Date.now();
    let method =
      null;
    let valid =
      false;

    if (
      /^\d{6}$/u.test(
        code,
      )
    ) {
      const secret =
        decryptMfaSecret(
          mfaState
            .secretCiphertext,
          mfaEncryptionKey,
        );
      const verification =
        verifyTotpCode(
          secret,
          code,
          {
            lastUsedStep:
              mfaState
                .lastUsedStep,
          },
        );

      if (
        verification.valid &&
        await repository
          .advanceMfaStep(
            rawUser.id,
            verification.step,
          )
      ) {
        valid =
          true;
        method =
          'password+totp';
      }
    } else {
      const hash =
        recoveryCodeHash(
          code,
        );

      if (
        hash &&
        await repository
          .consumeMfaRecoveryCode(
            rawUser.id,
            hash,
          )
      ) {
        valid =
          true;
        method =
          'password+recovery';
      }
    }

    if (!valid) {
      const updated =
        await repository
          .recordFailedLogin(
            rawUser.id,
            new Date()
              .toISOString(),
            settings,
          );
      const accountRetry =
        secondsUntil(
          updated
            ?.lockedUntil,
        );
      const ipRetry =
        await recordFailedIp(
          requestIp,
          rawUser.username,
          settings,
          startedAt,
        );

      await appendAudit({
        eventType:
          'authentication',
        operationType:
          'admin.login',
        status:
          accountRetry ||
          ipRetry
            ? 'locked'
            : 'failed',
        durationMs:
          Date.now() -
          startedAt,
        ipAddress:
          requestIp,
        userId:
          rawUser.id,
        username:
          rawUser.username,
        details: {
          reason:
            'invalid-mfa',
        },
      });

      if (ipRetry) {
        return {
          status:
            'ip-locked',
          retryAfterSeconds:
            ipRetry,
        };
      }

      if (accountRetry) {
        return {
          status:
            'locked',
          retryAfterSeconds:
            accountRetry,
        };
      }

      return {
        status:
          'invalid-mfa',
      };
    }

    const authenticated =
      await completeSuccessfulAuthentication(
        rawUser,
        settings,
        context,
        startedAt,
        method,
      );

    return createLoginSession(
      authenticated,
      context,
    );
  }

  async function authenticateSession(
    token,
    context = {},
  ) {
    const touchActivity =
      context.touchActivity !==
        false;
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
      touchActivity &&
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
      securitySettings:
        settings,
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
    sessionToken,
    ...context
  }) {
    return authenticateSession(
      sessionToken,
      context,
    );
  }

  async function authenticateRealtime({
    sessionToken,
    ...context
  }) {
    return authenticateSession(
      sessionToken,
      {
        ...context,
        touchActivity:
          false,
      },
    );
  }

  async function logout(token) {
    if (token) {
      await repository.revokeSessionByHash(
        adminSessionTokenHash(token),
      );
    }
  }

  return {
    ipAccessState,
    recordRequestSecurityIncident,
    authenticateRequest,
    authenticateRealtime,
    login,
    completeMfaLogin,
    logout,
  };
}
