import {
  Router,
} from 'express';

export function createDiscussionInboxRouter({
  discussionInboxService,
  adminAuth,
}) {
  const router =
    Router();

  router.get(
    '/admin/profile/discussions',
    adminAuth.requireProfile,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const inbox =
          await discussionInboxService
            .listInbox(
              request.adminUser,
            );

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json(
            inbox,
          );
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
