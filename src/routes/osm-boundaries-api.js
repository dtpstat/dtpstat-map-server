import express, { Router } from 'express';
import {
  normalizeOsmUpdateUrl,
  OsmCityUpdateValidationError,
} from '../data/osm-city-update-options.js';
import { OsmBoundaryAdminValidationError } from '../db/osm-boundary-admin-repository.js';
import {
  createAdminOperationAudit,
  recordAdminOperationChanges,
  recordAdminOperationDetails,
} from '../http/admin-auth.js';

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function bool(value, name) {
  if (typeof value !== 'boolean') {
    throw new OsmCityUpdateValidationError(`${name} must be boolean`);
  }
  return value;
}

function integer(value, name, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new OsmCityUpdateValidationError(
      `${name} must be an integer between ${min} and ${max}`,
    );
  }
  return number;
}

function settingsPayload(value, config) {
  if (!object(value)) {
    throw new OsmCityUpdateValidationError('OSM settings body must be an object');
  }
  const allowed = new Set([
    'sourceURL', 'includeCity', 'includeTown', 'includeAdministrative',
    'adminLevelMin', 'adminLevelMax', 'batchSize', 'minDelayMs', 'timeoutMs',
    'queryTimeoutSeconds', 'maxResponseBytes', 'maxTotalBytes', 'maxRetries',
    'retryBaseDelayMs', 'retryMaxDelayMs',
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new OsmCityUpdateValidationError(
      `OSM settings contain unsupported properties: ${unknown.join(', ')}`,
    );
  }
  const sourceURL = normalizeOsmUpdateUrl(String(value.sourceURL ?? ''), config.allowedHosts);
  if (!config.allowedURLs.has(sourceURL)) {
    throw new OsmCityUpdateValidationError(
      `OSM URL is not in the allowed URL list: ${sourceURL}`,
    );
  }
  const result = {
    sourceURL,
    includeCity: bool(value.includeCity, 'includeCity'),
    includeTown: bool(value.includeTown, 'includeTown'),
    includeAdministrative: bool(value.includeAdministrative, 'includeAdministrative'),
    adminLevelMin: integer(value.adminLevelMin, 'adminLevelMin', 1, 20),
    adminLevelMax: integer(value.adminLevelMax, 'adminLevelMax', 1, 20),
    batchSize: integer(value.batchSize, 'batchSize', 1, config.maxBatchSize),
    minDelayMs: integer(value.minDelayMs, 'minDelayMs', 0, 300000),
    timeoutMs: integer(value.timeoutMs, 'timeoutMs', 1000, 900000),
    queryTimeoutSeconds: integer(
      value.queryTimeoutSeconds,
      'queryTimeoutSeconds',
      1,
      600,
    ),
    maxResponseBytes: integer(
      value.maxResponseBytes,
      'maxResponseBytes',
      1024 * 1024,
      512 * 1024 * 1024,
    ),
    maxTotalBytes: integer(
      value.maxTotalBytes,
      'maxTotalBytes',
      1024 * 1024,
      8 * 1024 * 1024 * 1024,
    ),
    maxRetries: integer(value.maxRetries, 'maxRetries', 0, 20),
    retryBaseDelayMs: integer(value.retryBaseDelayMs, 'retryBaseDelayMs', 1000, 3600000),
    retryMaxDelayMs: integer(value.retryMaxDelayMs, 'retryMaxDelayMs', 1000, 3600000),
  };
  if (!result.includeCity && !result.includeTown && !result.includeAdministrative) {
    throw new OsmCityUpdateValidationError('At least one OSM object class must be enabled');
  }
  if (result.adminLevelMin > result.adminLevelMax) {
    throw new OsmCityUpdateValidationError('adminLevelMin must not exceed adminLevelMax');
  }
  if (result.retryBaseDelayMs > result.retryMaxDelayMs) {
    throw new OsmCityUpdateValidationError('retryBaseDelayMs must not exceed retryMaxDelayMs');
  }
  if (result.maxResponseBytes > result.maxTotalBytes) {
    throw new OsmCityUpdateValidationError(
      'maxResponseBytes must not exceed maxTotalBytes',
    );
  }
  return result;
}

/**
 * @param {{
 *   settingsRepository: { get: Function, save: Function },
 *   boundaryRepository: {
 *     list: Function,
 *     getGeometry: Function,
 *     update: Function,
 *     setSubtreeActive: Function
 *   },
 *   adminAuth: any,
 *   securityService: any,
 *   osmConfig: any,
 *   afterBoundaryChange?: () => Promise<any>
 * }} dependencies
 */
export function createOsmBoundariesRouter({
  settingsRepository,
  boundaryRepository,
  adminAuth,
  securityService,
  osmConfig,
  afterBoundaryChange,
}) {
  const router = Router();
  const jsonBody = express.json({
    limit: 256 * 1024,
    strict: true,
    inflate: true,
    type: 'application/json',
  });
  const audit = (operation) => createAdminOperationAudit(securityService, operation);

  router.get('/admin/osm-settings', adminAuth.requireData, async (_request, response, next) => {
    try {
      const settings = await settingsRepository.get();
      response.set('Cache-Control', 'no-store').json({
        settings,
        allowedURLs: [...osmConfig.allowedURLs],
        limits: {
          maxBatchSize: osmConfig.maxBatchSize,
          timeoutMs: 900000,
          queryTimeoutSeconds: 600,
          maxResponseBytes: 512 * 1024 * 1024,
          maxTotalBytes: 8 * 1024 * 1024 * 1024,
          maxRetries: 20,
        },
      });
    } catch (error) { next(error); }
  });

  router.put(
    '/admin/osm-settings',
    adminAuth.requireData,
    audit('data.osm-settings.update'),
    jsonBody,
    async (request, response, next) => {
      try {
        const previous = await settingsRepository.get();
        const settings = await settingsRepository.save(
          settingsPayload(request.body, osmConfig),
        );
        recordAdminOperationChanges(response, previous, settings);
        response.set('Cache-Control', 'no-store').json({ settings });
      } catch (error) {
        if (error instanceof OsmCityUpdateValidationError) {
          response.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  router.get('/admin/osm-boundaries', adminAuth.requireData, async (_request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store').json({
        boundaries: await boundaryRepository.list(),
      });
    } catch (error) { next(error); }
  });

  router.get(
    '/admin/osm-boundaries/:boundaryId/geometry',
    adminAuth.requireData,
    async (request, response, next) => {
      try {
        const feature = await boundaryRepository.getGeometry(request.params.boundaryId);
        if (!feature) {
          response.status(404).json({ error: 'OSM boundary not found' });
          return;
        }
        response.set('Cache-Control', 'no-store').json(feature);
      } catch (error) {
        if (error instanceof OsmBoundaryAdminValidationError) {
          response.status(error.statusCode).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  router.patch(
    '/admin/osm-boundaries/:boundaryId/subtree',
    adminAuth.requireData,
    audit('data.osm-boundary.subtree-active'),
    jsonBody,
    async (request, response, next) => {
      try {
        if (!object(request.body) || typeof request.body.active !== 'boolean') {
          throw new OsmBoundaryAdminValidationError(
            'Request body must contain boolean active',
          );
        }
        const unknown = Object.keys(request.body).filter((key) => key !== 'active');
        if (unknown.length > 0) {
          throw new OsmBoundaryAdminValidationError(
            `Unsupported subtree fields: ${unknown.join(', ')}`,
          );
        }

        const result = await boundaryRepository.setSubtreeActive(
          request.params.boundaryId,
          request.body.active,
        );
        if (!result) {
          response.status(404).json({ error: 'OSM boundary not found' });
          return;
        }

        const derived = result.changedCount > 0
          ? await afterBoundaryChange?.()
          : undefined;
        recordAdminOperationDetails(response, {
          rootBoundaryId: result.root.id,
          rootDisplayName: result.root.displayName,
          active: result.active,
          affectedCount: result.affectedCount,
          changedCount: result.changedCount,
          previousActiveCount: result.previousActiveCount,
          previousInactiveCount: result.previousInactiveCount,
        });
        response.set('Cache-Control', 'no-store').json({
          subtree: result,
          derived,
        });
      } catch (error) {
        if (error instanceof OsmBoundaryAdminValidationError) {
          response.status(error.statusCode).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  router.patch(
    '/admin/osm-boundaries/:boundaryId',
    adminAuth.requireData,
    audit('data.osm-boundary.update'),
    jsonBody,
    async (request, response, next) => {
      try {
        const previous = (await boundaryRepository.list()).find(
          (item) => String(item.id) === String(request.params.boundaryId),
        ) ?? null;
        const boundary = await boundaryRepository.update(
          request.params.boundaryId,
          request.body,
        );
        if (!boundary) {
          response.status(404).json({ error: 'OSM boundary not found' });
          return;
        }
        const derived = await afterBoundaryChange?.();
        recordAdminOperationChanges(response, previous, boundary);
        response.set('Cache-Control', 'no-store').json({ boundary, derived });
      } catch (error) {
        if (error instanceof OsmBoundaryAdminValidationError) {
          response.status(error.statusCode).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  return router;
}
