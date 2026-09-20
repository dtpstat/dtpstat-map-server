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
 *     listCities: Function,
 *     listCity: Function,
 *     listTags: Function,
 *     create: Function,
 *     update: Function,
 *     delete: Function,
 *     merge: Function,
 *     cut: Function
 *   },
 *   lineTypesRepository: { list: Function },
 *   adminAuth: any,
 *   securityService: any,
 *   maxBodyBytes: number,
 *   afterChange?: (details?: object) => Promise<any>
 * }} dependencies
 */
export function createGeometryEditorRouter({
  geometryEditorRepository,
  lineTypesRepository,
  adminAuth,
  securityService,
  maxBodyBytes,
  afterChange = async () => undefined,
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
        const [cities, lineTypes, tags] = await Promise.all([
          geometryEditorRepository.listCities(),
          lineTypesRepository.list(),
          geometryEditorRepository.listTags(),
        ]);
        response.set('Cache-Control', 'no-store').json({
          cities,
          lineTypes,
          tags,
        });
      } catch (error) { next(error); }
    },
  );

  router.get(
    '/admin/geometry-editor/cities/:cityId',
    adminAuth.requireGeometryEditor,
    async (request, response, next) => {
      try {
        const cityId = normalizeGeometryId(request.params.cityId, 'cityId');
        const result = await geometryEditorRepository.listCity(cityId);
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
        const derived = await afterChange({ operation: 'create', geometryId: geometry.id });
        response.set('Cache-Control', 'no-store').status(201).json({ geometry, derived });
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
        const derived = await afterChange({ operation: 'update', geometryId });
        response.set('Cache-Control', 'no-store').json({ geometry, derived });
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
        const derived = await afterChange({ operation: 'delete', geometryId });
        response.set('Cache-Control', 'no-store').json({ deleted: geometry, derived });
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
        const derived = await afterChange({ operation: 'merge', geometryId: geometry.id });
        response.set('Cache-Control', 'no-store').json({ geometry, derived });
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
        const derived = await afterChange({ operation: 'cut', geometryId });
        response.set('Cache-Control', 'no-store').json({ geometry, derived });
      } catch (error) {
        if (validationError(response, error)) return;
        next(error);
      }
    },
  );

  return router;
}
