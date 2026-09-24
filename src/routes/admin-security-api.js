import express, {
  Router,
} from 'express';
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

  const jsonBody = express.json({
    limit:
      Math.min(
        maxBodyBytes,
        256 * 1024,
      ),
    strict: true,
    inflate: true,
    type: 'application/json',
  });

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
