import {
  Router,
} from 'express';

export function createDiscussionInboxRouter({
  discussionInboxService,
  adminAuth,
  realtimeEvents = null,
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

  router.post(
    '/admin/profile/discussions/read-all',
    adminAuth.requireProfile,
    async (
      request,
      response,
      next,
    ) => {
      try {
        const result =
          await discussionInboxService
            .markAllRead(
              request.adminUser,
            );

        realtimeEvents?.publish({
          resource:
            'discussion-inbox',
          action:
            'read-all',
          permission:
            'profile',
          entityIds: [],
          source: {
            readerUserId:
              request.adminUser?.id ??
              null,
          },
          message:
            'Все доступные обсуждения отмечены прочитанными.',
        });

        response
          .set(
            'Cache-Control',
            'no-store',
          )
          .json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
