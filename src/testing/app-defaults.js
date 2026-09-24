import {
  DEFAULT_PUBLIC_DOWNLOAD_NAME,
} from '../modules/project/public-download-policy.js';
import {
  DEFAULT_REPORT_CONFIG,
  validateReportConfig,
} from '../modules/reporting/config-policy.js';
import {
  createBasicAuth,
} from '../http/basic-auth.js';

const TEST_PROJECT_SETTINGS =
  Object.freeze({
    projectName:
      'Выделенные полосы в России',
    keywords: [
      'выделенные полосы',
      'общественный транспорт',
    ],
    footerHtml:
      '<h2>О проекте</h2><p>Тестовые настройки проекта.</p>',
    yandexMetrikaId: null,
    googleAnalyticsId: null,
    themePreset: 'classic',
    showLineLabels: false,
    showLinePopups: true,
    largeCityPopulationThreshold:
      400000,
    largeCityAreaKm2Threshold:
      null,
    publicDownloadName:
      DEFAULT_PUBLIC_DOWNLOAD_NAME,
    updatedAt:
      '2026-01-01T00:00:00.000Z',
  });

function projectSettingsRepository() {
  let settings = {
    ...TEST_PROJECT_SETTINGS,
  };

  return {
    async get() {
      return settings;
    },

    async save(payload) {
      settings = {
        ...payload,
        updatedAt:
          new Date().toISOString(),
      };

      return settings;
    },

    async savePublicDownloadName(
      value,
    ) {
      settings = {
        ...settings,
        publicDownloadName:
          value,
        updatedAt:
          new Date().toISOString(),
      };

      return {
        publicDownloadName:
          settings
            .publicDownloadName,
        updatedAt:
          settings.updatedAt,
      };
    },
  };
}

function lineTypesRepository() {
  return {
    async list() {
      return [];
    },

    async save() {
      return [];
    },
  };
}

function reportConfigService() {
  let config =
    structuredClone(
      DEFAULT_REPORT_CONFIG,
    );

  return {
    async get() {
      return structuredClone(
        config,
      );
    },

    async save(payload) {
      config = {
        ...validateReportConfig(
          payload,
        ),
        updatedAt:
          new Date().toISOString(),
      };

      return {
        config:
          structuredClone(config),
        materialized: {
          cities: 0,
          metrics:
            config.metrics.length,
          rankMetricKey:
            config.rank.metricKey,
          rankDirection:
            config.rank.direction,
        },
      };
    },
  };
}

function securitySettings() {
  return {
    maxFailedAttempts: 5,
    failureWindowSeconds: 900,
    lockoutSeconds: 900,
    ipMaxFailedAttempts: 20,
    ipFailureWindowSeconds: 900,
    ipLockoutSeconds: 3600,
    sessionIdleSeconds: 1800,
    sessionAbsoluteSeconds: 43200,
    auditRetentionDays: 365,
    passwordMinLength: 12,
    passwordMaxLength: 1024,
    passwordRequireLowercase: false,
    passwordRequireUppercase: false,
    passwordRequireDigit: false,
    passwordRequireSpecial: false,
  };
}

function settingsTransferService() {
  return {
    async exportSettings() {
      return {
        _dtpstat: {
          kind:
            'project-settings',
          schemaVersion: 8,
          exportedAt:
            '2026-01-01T00:00:00.000Z',
        },
        projectSettings:
          TEST_PROJECT_SETTINGS,
        lineTypes: [],
        reportConfig:
          structuredClone(
            DEFAULT_REPORT_CONFIG,
          ),
        securitySettings:
          securitySettings(),
      };
    },

    async importSettings() {
      return {
        projectName:
          TEST_PROJECT_SETTINGS
            .projectName,
        lineTypes: 0,
        metrics:
          DEFAULT_REPORT_CONFIG
            .metrics.length,
        materializedCities: 0,
      };
    },
  };
}

function security(config) {
  const username =
    config.importApi.username ??
    config.importApi
      .bootstrapUsername ??
    'importer';

  const password =
    config.importApi.password ??
    config.importApi
      .bootstrapPassword ??
    'test-secret';

  const basic =
    createBasicAuth({
      username,
      password,
      realm: 'dtpstat-admin',
    });

  const testUser = {
    id: 1,
    username,
    displayName: username,
    email: null,
    canManageData: true,
    canManageInterface: true,
    canEditOsm: true,
    canManageUsers: true,
    canViewAudit: true,
    canManageSecurity: true,
    isSuperuser: true,
    isBootstrap: true,
    isBlocked: false,
    mustChangePassword: false,
    hasAvatar: false,
  };

  const requireAuth =
    (
      request,
      response,
      next,
    ) =>
      basic(
        request,
        response,
        () => {
          request.adminUser =
            testUser;
          request.adminSessionId =
            null;
          request.adminAuthMethod =
            'basic';
          next();
        },
      );

  const adminAuth = {
    requireAny: requireAuth,
    requireAdminEntry:
      requireAuth,
    requireProfile: requireAuth,
    requireData: requireAuth,
    requireInterface: requireAuth,
    requireOsmEditor:
      requireAuth,
    requireUsers: requireAuth,
    requireAudit: requireAuth,
    requireUsersOrAudit:
      requireAuth,
    requireSecurity: requireAuth,
    requireSuperuser: requireAuth,
  };

  const securityService = {
    async login(payload) {
      if (
        payload?.username !==
          username ||
        payload?.password !==
          password
      ) {
        return {
          status: 'invalid',
        };
      }

      return {
        status: 'success',
        user: testUser,
        token:
          'test-session-token',
        sessionId: 1,
        expiresAt:
          new Date(
            Date.now() + 3600000,
          ).toISOString(),
      };
    },

    async logout() {},
    async appendAudit() {},

    async listUsers() {
      return [testUser];
    },

    async createUser() {
      return {
        user: testUser,
        temporaryPassword:
          'Temp-Password-1234',
      };
    },

    async updateUser() {
      return testUser;
    },

    async deleteUser() {
      return testUser;
    },

    async resetTemporaryPassword() {
      return {
        user: testUser,
        temporaryPassword:
          'Temp-Password-1234',
      };
    },

    async blockUser() {
      return testUser;
    },

    async unblockUser() {
      return testUser;
    },

    async updateOwnProfile() {
      return testUser;
    },

    async changeOwnPassword() {
      return testUser;
    },

    async getAvatar() {
      return null;
    },

    async saveAvatar() {
      return testUser;
    },

    async clearAvatar() {
      return testUser;
    },

    async listUserSessions() {
      return [];
    },

    async revokeSession() {
      return true;
    },

    async revokeOtherSessions() {
      return 0;
    },

    async getSecuritySettings() {
      return securitySettings();
    },

    async getPasswordPolicy() {
      const settings =
        securitySettings();

      return {
        passwordMinLength:
          settings
            .passwordMinLength,
        passwordMaxLength:
          settings
            .passwordMaxLength,
        passwordRequireLowercase:
          settings
            .passwordRequireLowercase,
        passwordRequireUppercase:
          settings
            .passwordRequireUppercase,
        passwordRequireDigit:
          settings
            .passwordRequireDigit,
        passwordRequireSpecial:
          settings
            .passwordRequireSpecial,
      };
    },

    async saveSecuritySettings(
      payload,
    ) {
      return payload;
    },

    async listIpBlocks() {
      return [];
    },

    async createIpBlock(payload) {
      return {
        id: 1,
        ...payload,
      };
    },

    async deleteIpBlock() {
      return true;
    },

    async listAudit() {
      return [];
    },

    async auditFacets() {
      return {
        eventTypes: [],
        operationTypes: [],
        statuses: [],
      };
    },
  };

  return {
    adminAuth,
    securityService,
  };
}

export function createTestAppDefaults(
  config,
) {
  const auth = security(config);

  return {
    lineTypesRepository:
      lineTypesRepository(),
    projectSettingsRepository:
      projectSettingsRepository(),
    settingsTransferService:
      settingsTransferService(),
    reportConfigService:
      reportConfigService(),
    adminAuth:
      auth.adminAuth,
    securityService:
      auth.securityService,
  };
}
