import express, { Router } from 'express';
import { CITY_MARKER_ICON } from '../../public/js/city-marker-icon.js';
import {
  CITY_MARKER_ICON_MAX_BYTES,
  CityMarkerIconValidationError,
  validateCityMarkerIcon,
} from '../data/city-marker-icon.js';
import { MapboxAccessTokenValidationError } from '../data/mapbox-access-token.js';
import {
  PROJECT_CONTENT_CLASSES,
  PROJECT_CONTENT_TAGS,
  PUBLIC_THEME_PRESETS,
  ProjectSettingsValidationError,
} from '../data/project-settings.js';
import { PUBLIC_DOWNLOAD_NAME_MAX_LENGTH } from '../data/public-download-name.js';
import {
  createAdminOperationAudit,
  recordAdminOperationChanges,
} from '../http/admin-auth.js';

const DEFAULT_CITY_MARKER_PNG = Buffer.from(CITY_MARKER_ICON.split(',')[1], 'base64');

/**
 * @param {{
 *   projectSettingsRepository: {
 *     get: () => Promise<any>,
 *     save: (payload: unknown) => Promise<any>,
 *     savePublicDownloadName?: (value: unknown) => Promise<any>,
 *     getPublicMapConfig?: () => Promise<any>,
 *     getCityMarkerIcon?: () => Promise<any>,
 *     saveCityMarkerIcon?: (icon: object) => Promise<any>,
 *     clearCityMarkerIcon?: () => Promise<any>
 *   },
 *   adminAuth: ReturnType<import('../http/admin-auth.js').createAdminAuthorization>,
 *   securityService: ReturnType<import('../data/admin-security.js').createAdminSecurityService>,
 *   maxBodyBytes: number,
 *   afterPublicDownloadNameSave?: () => Promise<any>
 * }} dependencies
 */
export function createProjectSettingsRouter({
  projectSettingsRepository,
  adminAuth,
  securityService,
  maxBodyBytes,
  afterPublicDownloadNameSave,
}) {
  const router = Router();
  const jsonBody = express.json({
    limit: Math.min(maxBodyBytes, 256 * 1024),
    strict: true,
    inflate: true,
    type: 'application/json',
  });
  const cityMarkerBody = express.raw({
    limit: CITY_MARKER_ICON_MAX_BYTES,
    inflate: false,
    type: 'image/png',
  });

  // In production this route is registered before the general API router, so
  // /api/config is backed by PROJECT_SETTINGS. Small isolated test repositories
  // may omit getPublicMapConfig and keep using the legacy test fallback route.
  if (typeof projectSettingsRepository.getPublicMapConfig === 'function') {
    router.get('/config', async (_request, response, next) => {
      try {
        const map = await projectSettingsRepository.getPublicMapConfig();
        response.set('Cache-Control', 'no-cache');
        response.json({ map });
      } catch (error) {
        next(error);
      }
    });
  }

  router.get('/city-marker-icon', async (_request, response, next) => {
    try {
      const icon = typeof projectSettingsRepository.getCityMarkerIcon === 'function'
        ? await projectSettingsRepository.getCityMarkerIcon()
        : null;
      response
        .set('Cache-Control', 'no-cache')
        .type(icon?.mime ?? 'image/png')
        .send(icon?.data ?? DEFAULT_CITY_MARKER_PNG);
    } catch (error) {
      next(error);
    }
  });

  router.get('/project', async (_request, response, next) => {
    try {
      const settings = await projectSettingsRepository.get();
      response.set('Cache-Control', 'no-cache');
      response.json(settings);
    } catch (error) {
      next(error);
    }
  });

  router.get(
    '/admin/project-settings',
    adminAuth.requireInterface,
    async (_request, response, next) => {
      try {
        const settings = await projectSettingsRepository.get();
        response.set('Cache-Control', 'no-store');
        response.json({
          settings,
          editor: {
            tags: PROJECT_CONTENT_TAGS,
            classes: PROJECT_CONTENT_CLASSES,
            themes: PUBLIC_THEME_PRESETS,
            publicDownloadName: {
              maxLength: PUBLIC_DOWNLOAD_NAME_MAX_LENGTH,
            },
            cityMarkerIcon: {
              mime: 'image/png',
              maxBytes: CITY_MARKER_ICON_MAX_BYTES,
              minSize: 16,
              maxSize: 256,
              square: true,
            },
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/admin/project-settings',
    adminAuth.requireInterface,
    createAdminOperationAudit(securityService, 'interface.project.update'),
    jsonBody,
    async (request, response, next) => {
      try {
        const previousSettings = await projectSettingsRepository.get();
        const settings = await projectSettingsRepository.save(request.body);
        recordAdminOperationChanges(response, previousSettings, settings);
        response.set('Cache-Control', 'no-store');
        response.json({ settings });
      } catch (error) {
        if (
          error instanceof ProjectSettingsValidationError ||
          error instanceof MapboxAccessTokenValidationError
        ) {
          response.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  if (typeof projectSettingsRepository.savePublicDownloadName === 'function') {
    router.put(
      '/admin/project-settings/public-download-name',
      adminAuth.requireInterface,
      createAdminOperationAudit(securityService, 'interface.project.public-download-name.update'),
      jsonBody,
      async (request, response, next) => {
        let previousName;
        try {
          previousName = (await projectSettingsRepository.get()).publicDownloadName;
          const settings = await projectSettingsRepository.savePublicDownloadName(
            request.body?.publicDownloadName,
          );
          const publicDownloads = await afterPublicDownloadNameSave?.();
          recordAdminOperationChanges(
            response,
            { publicDownloadName: previousName },
            { publicDownloadName: settings.publicDownloadName },
          );
          response.set('Cache-Control', 'no-store').json({ settings, publicDownloads });
        } catch (error) {
          if (error instanceof ProjectSettingsValidationError) {
            response.status(400).json({ error: error.message });
            return;
          }
          if (previousName !== undefined && typeof afterPublicDownloadNameSave === 'function') {
            try {
              await projectSettingsRepository.savePublicDownloadName(previousName);
              await afterPublicDownloadNameSave();
            } catch {
              // Preserve the original failure. Startup refresh will repair any
              // filesystem/DB mismatch if rollback materialization also fails.
            }
          }
          next(error);
        }
      },
    );
  }

  if (typeof projectSettingsRepository.saveCityMarkerIcon === 'function') {
    router.put(
      '/admin/project-settings/city-marker-icon',
      adminAuth.requireInterface,
      createAdminOperationAudit(securityService, 'interface.project.city-marker-icon.update'),
      cityMarkerBody,
      async (request, response, next) => {
        try {
          const previousIcon = typeof projectSettingsRepository.getCityMarkerIcon === 'function'
            ? await projectSettingsRepository.getCityMarkerIcon()
            : null;
          const icon = validateCityMarkerIcon(
            request.body,
            request.get('content-type'),
          );
          const settings = await projectSettingsRepository.saveCityMarkerIcon(icon);
          recordAdminOperationChanges(
            response,
            {
              cityMarkerIcon: previousIcon
                ? { custom: true, mime: previousIcon.mime, bytes: previousIcon.data?.length ?? null }
                : { custom: false },
            },
            {
              cityMarkerIcon: {
                custom: true,
                mime: icon.mime,
                width: icon.width,
                height: icon.height,
                bytes: icon.data.length,
              },
            },
          );
          response.set('Cache-Control', 'no-store').json({ settings });
        } catch (error) {
          if (error instanceof CityMarkerIconValidationError) {
            response.status(400).json({ error: error.message });
            return;
          }
          next(error);
        }
      },
    );
  }

  if (typeof projectSettingsRepository.clearCityMarkerIcon === 'function') {
    router.delete(
      '/admin/project-settings/city-marker-icon',
      adminAuth.requireInterface,
      createAdminOperationAudit(securityService, 'interface.project.city-marker-icon.reset'),
      async (_request, response, next) => {
        try {
          const previousIcon = typeof projectSettingsRepository.getCityMarkerIcon === 'function'
            ? await projectSettingsRepository.getCityMarkerIcon()
            : null;
          const settings = await projectSettingsRepository.clearCityMarkerIcon();
          recordAdminOperationChanges(
            response,
            {
              cityMarkerIcon: previousIcon
                ? { custom: true, mime: previousIcon.mime, bytes: previousIcon.data?.length ?? null }
                : { custom: false },
            },
            { cityMarkerIcon: { custom: false } },
          );
          response.set('Cache-Control', 'no-store').json({ settings });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  return router;
}
