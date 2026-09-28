import express, {
  Router,
} from 'express';
import {
  jsonBody as createJsonBody,
} from '../http/admin-json-body.js';
import {
  registerAdminAuditRoutes,
} from './security/audit-routes.js';
import {
  registerAdminSecurityControlRoutes,
} from './security/control-routes.js';
import {
  registerAdminProfileRoutes,
} from './security/profile-routes.js';
import {
  registerAdminUserRoutes,
} from './security/user-routes.js';

export function createAdminSecurityRouter({
  securityService,
  adminAuth,
  maxBodyBytes,
}) {
  const router = Router();

  const jsonBody =
    createJsonBody(
      Math.min(
        maxBodyBytes,
        256 * 1024,
      ),
      'application/json',
    );

  const avatarBody = express.raw({
    limit: 256 * 1024,
    inflate: false,
    type: () => true,
  });

  registerAdminProfileRoutes(
    router,
    {
      securityService,
      adminAuth,
      jsonBody,
      avatarBody,
    },
  );

  registerAdminUserRoutes(
    router,
    {
      securityService,
      adminAuth,
      jsonBody,
    },
  );

  registerAdminSecurityControlRoutes(
    router,
    {
      securityService,
      adminAuth,
      jsonBody,
    },
  );

  registerAdminAuditRoutes(
    router,
    {
      securityService,
      adminAuth,
    },
  );

  return router;
}
