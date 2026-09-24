import {
  serializeLinesKml,
} from '../../data/kml-transfer.js';
import {
  createAdminOperationAudit,
} from '../../http/admin-operation-audit.js';

export function registerKmlExportRoutes(
  router,
  {
    exportRepository,
    adminAuth,
    securityService,
  },
) {
  router.get(
    '/admin/export/lines.kml',
    adminAuth.requireData,
    createAdminOperationAudit(
      securityService,
      'data.export.lines-kml',
    ),
    async (
      _request,
      response,
      next,
    ) => {
      try {
        const geojson =
          await exportRepository
            .exportLines();

        const kml =
          serializeLinesKml(
            geojson,
          );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .set(
            'Content-Disposition',
            'attachment; filename="lines.kml"',
          )
          .type(
            'application/vnd.google-earth.kml+xml',
          )
          .send(kml);
      } catch (error) {
        next(error);
      }
    },
  );
}
