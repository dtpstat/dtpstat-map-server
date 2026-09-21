import express, { Router } from 'express';
import {
  GeometryEditorValidationError,
  geometryFamily,
  normalizeGeometryEditorPayload,
  normalizeGeometryId,
  normalizeGeometryIdList,
  validateEditorGeometry,
} from '../data/geometry-editor.js';
import {
  createAdminOperationAudit,
  recordAdminOperationChanges,
  recordAdminOperationDetails,
} from '../http/admin-auth.js';

function validationError(response, error) {
  if (!(error instanceof GeometryEditorValidationError)) return false;
  response.status(error.statusCode ?? 400).json({ error: error.message });
  return true;
}

/**
 * @param {{
 *   geometryEditorRepository: {
 *     get: Function,
 *     recalculate: Function,
 *     listCities: Function,
 *     listCityGeometries: Function,
 *     create: Function,
 *     update: Function,
 *     delete: Function,
 *     merge: Function,
 *     cut: Function
 *   },
 *   adminAuth: any,
 *   securityService: any,
 *   maxBodyBytes: number,
 *   afterRecalculate?: (details?: object) => Promise<any>
 * }} dependencies
 */
export function createGeometryEditorRouter({
  geometryEditorRepository,
  adminAuth,
  securityService,
  maxBodyBytes,
  afterRecalculate = async () => undefined,
}) {
  const router = Router();
  const jsonBody = express.json({
    limit: Math.min(maxBodyBytes, 8 * 1024 * 1024),
    strict: true,
    inflate: true,
    type: 'application/json',
  });
  const audit = (operation) => createAdminOperationAudit(securityService, operation);

  router.get(
    '/admin/geometry-editor/cities',
    adminAuth.requireGeometryEditor,
    async (_request, response, next) => {
      try {
        const cityResult = await geometryEditorRepository.listCities();
        response.set('Cache-Control', 'no-store').json({
          cities: cityResult.cities,
          cityLinkState: cityResult.linkState,
        });
      } catch (error) { next(error); }
    },
  );

  router.get(
    '/admin/geometry-editor/cities/:cityId/geometries',
    adminAuth.requireGeometryEditor,
    async (request, response, next) => {
      try {
        const cityId = normalizeGeometryId(request.params.cityId, 'cityId');
        const result = await geometryEditorRepository.listCityGeometries(cityId);
        if (!result) {
          response.status(404).json({ error: 'City not found or has no active boundary' });
          return;
        }
        response.set('Cache-Control', 'no-store').json(result);
      } catch (error) {
        if (validationError(response, error)) return;
        next(error);
      }
    },
  );

  router.post(
    '/admin/geometry-editor/recalculate',
    adminAuth.requireGeometryEditor,
    audit('geometry.recalculate'),
    async (_request, response, next) => {
      try {
        const statistics = await geometryEditorRepository.recalculate();
        const derived = await afterRecalculate({
          operation: 'recalculate',
          cities: statistics.cities,
        });
        recordAdminOperationDetails(response, {
          cities: statistics.cities,
        });
        response.set('Cache-Control', 'no-store').json({
          statistics,
          derived,
        });
      } catch (error) {
        if (validationError(response, error)) return;
        next(error);
      }
    },
  );

  router.get(
    '/admin/geometry-editor/geometries/:geometryId',
    adminAuth.requireGeometryEditor,
    async (request, response, next) => {
      try {
        const geometryId = normalizeGeometryId(request.params.geometryId);
        const geometry = await geometryEditorRepository.get(geometryId);
        if (!geometry) {
          response.status(404).json({ error: 'Geometry not found' });
          return;
        }
        response.set('Cache-Control', 'no-store').json({ geometry });
      } catch (error) {
        if (validationError(response, error)) return;
        next(error);
      }
    },
  );

  router.post(
    '/admin/geometry-editor/geometries',
    adminAuth.requireGeometryEditor,
    audit('geometry.create'),
    jsonBody,
    async (request, response, next) => {
      try {
        const geometry = await geometryEditorRepository.create(
          normalizeGeometryEditorPayload(request.body, { creating: true }),
        );
        recordAdminOperationDetails(response, {
          geometryId: geometry.id,
          cityId: geometry.cityId,
          family: geometry.family,
        });
        response.set('Cache-Control', 'no-store').status(201).json({ geometry });
      } catch (error) {
        if (validationError(response, error)) return;
        next(error);
      }
    },
  );

  router.patch(
    '/admin/geometry-editor/geometries/:geometryId',
    adminAuth.requireGeometryEditor,
    audit('geometry.update'),
    jsonBody,
    async (request, response, next) => {
      try {
        const geometryId = normalizeGeometryId(request.params.geometryId);
        const previous = await geometryEditorRepository.get(geometryId);
        const geometry = await geometryEditorRepository.update(
          geometryId,
          normalizeGeometryEditorPayload(request.body),
        );
        if (!geometry) {
          response.status(404).json({ error: 'Geometry not found' });
          return;
        }
        recordAdminOperationChanges(response, previous, geometry);
        response.set('Cache-Control', 'no-store').json({ geometry });
      } catch (error) {
        if (validationError(response, error)) return;
        next(error);
      }
    },
  );

  router.delete(
    '/admin/geometry-editor/geometries/:geometryId',
    adminAuth.requireGeometryEditor,
    audit('geometry.delete'),
    async (request, response, next) => {
      try {
        const geometryId = normalizeGeometryId(request.params.geometryId);
        const geometry = await geometryEditorRepository.delete(geometryId);
        if (!geometry) {
          response.status(404).json({ error: 'Geometry not found' });
          return;
        }
        recordAdminOperationDetails(response, {
          geometryId,
          cityId: geometry.cityId,
          family: geometry.family,
          displayName: geometry.displayName,
        });
        response.set('Cache-Control', 'no-store').json({ deleted: geometry });
      } catch (error) {
        if (validationError(response, error)) return;
        next(error);
      }
    },
  );

  router.post(
    '/admin/geometry-editor/merge',
    adminAuth.requireGeometryEditor,
    audit('geometry.merge'),
    jsonBody,
    async (request, response, next) => {
      try {
        const ids = normalizeGeometryIdList(request.body?.ids);
        const geometry = await geometryEditorRepository.merge(ids);
        recordAdminOperationDetails(response, {
          sourceGeometryIds: ids,
          resultGeometryId: geometry.id,
          cityId: geometry.cityId,
          family: geometry.family,
        });
        response.set('Cache-Control', 'no-store').json({ geometry });
      } catch (error) {
        if (validationError(response, error)) return;
        next(error);
      }
    },
  );

  router.post(
    '/admin/geometry-editor/geometries/:geometryId/cut',
    adminAuth.requireGeometryEditor,
    audit('geometry.cut'),
    jsonBody,
    async (request, response, next) => {
      try {
        const geometryId = normalizeGeometryId(request.params.geometryId);
        const cutter = validateEditorGeometry(request.body?.geometry);
        if (geometryFamily(cutter) !== 'polygon') {
          throw new GeometryEditorValidationError('Cut geometry must be Polygon or MultiPolygon');
        }
        const geometry = await geometryEditorRepository.cut(geometryId, cutter);
        if (!geometry) {
          response.status(404).json({ error: 'Geometry not found' });
          return;
        }
        recordAdminOperationDetails(response, {
          geometryId,
          cityId: geometry.cityId,
          family: geometry.family,
        });
        response.set('Cache-Control', 'no-store').json({ geometry });
      } catch (error) {
        if (validationError(response, error)) return;
        next(error);
      }
    },
  );

  return router;
}
