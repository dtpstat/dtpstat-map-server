import {
  discussionMentionLogins,
} from './policy.js';

function allowedSubjectTypes(
  user,
) {
  const types = [];

  if (
    user?.isSuperuser ||
    user?.canEditGeometries
  ) {
    types.push(
      'geometry',
    );
  }

  if (
    user?.isSuperuser ||
    user?.canEditOsm
  ) {
    types.push(
      'osm-boundary',
    );
  }

  return types;
}

function authorAvatarUrl(
  item,
) {
  if (
    !item.latestAuthorHasAvatar ||
    !item.latestAuthorUserId
  ) {
    return null;
  }

  const base =
    item.subjectType ===
    'geometry'
      ? '/api/admin/geometry-editor/users/'
      : '/api/admin/osm-boundaries/users/';

  const version =
    encodeURIComponent(
      item.latestAuthorUpdatedAt ??
      '1',
    );

  return (
    base +
    item.latestAuthorUserId +
    '/avatar?v=' +
    version
  );
}

export function createDiscussionInboxService(
  storage,
) {
  if (!storage) {
    throw new TypeError(
      'Discussion storage dependency is required',
    );
  }

  return {
    async listInbox(
      user,
    ) {
      const userId =
        Number(
          user?.id,
        );
      if (
        !Number.isSafeInteger(
          userId,
        ) ||
        userId <= 0
      ) {
        throw new TypeError(
          'Authenticated user id is required',
        );
      }

      const subjectTypes =
        allowedSubjectTypes(
          user,
        );

      if (
        subjectTypes.length ===
        0
      ) {
        return {
          items: [],
          totalUnread: 0,
        };
      }

      const rows =
        await storage
          .listInbox(
            userId,
            subjectTypes,
          );

      const items =
        rows.map(
          (item) => ({
            subjectType:
              item.subjectType,
            subjectId:
              item.subjectId,
            subjectTitle:
              item.subjectTitle,
            subjectSubtitle:
              item.subjectSubtitle,
            subjectExists:
              Boolean(
                item.subjectExists,
              ),
            subjectCityId:
              item.subjectCityId ??
              null,
            latestMessageId:
              item.latestMessageId,
            latestMessage:
              item.latestMessage,
            latestCreatedAt:
              item.latestCreatedAt,
            unreadCount:
              Number(
                item.unreadCount ??
                0,
              ),
            latestAuthor: {
              userId:
                item.latestAuthorUserId,
              username:
                item.latestAuthorUsername,
              displayName:
                item.latestAuthorDisplayName ??
                item.latestAuthorUsername ??
                'Удалённый пользователь',
              avatarUrl:
                authorAvatarUrl(
                  item,
                ),
            },
          }),
        );

      return {
        items,
        totalUnread:
          items.reduce(
            (
              total,
              item,
            ) =>
              total +
              item.unreadCount,
            0,
          ),
      };
    },

    async markAllRead(
      user,
    ) {
      const userId =
        Number(
          user?.id,
        );
      if (
        !Number.isSafeInteger(
          userId,
        ) ||
        userId <= 0
      ) {
        throw new TypeError(
          'Authenticated user id is required',
        );
      }

      const subjectTypes =
        allowedSubjectTypes(
          user,
        );

      if (
        subjectTypes.length ===
        0
      ) {
        return {
          items: [],
        };
      }

      return {
        items:
          await storage
            .markAllRead(
              userId,
              subjectTypes,
            ),
      };
    },

    async mentionSuggestions(
      user,
      {
        subjectType,
        query,
      },
    ) {
      const userId =
        Number(
          user?.id,
        );
      if (
        !Number.isSafeInteger(
          userId,
        ) ||
        userId <= 0
      ) {
        throw new TypeError(
          'Authenticated user id is required',
        );
      }

      if (
        !allowedSubjectTypes(
          user,
        ).includes(
          subjectType,
        )
      ) {
        return {
          users: [],
        };
      }

      const normalizedQuery =
        String(
          query ??
          '',
        )
          .normalize('NFC')
          .trim()
          .replace(
            /^@/u,
            '',
          )
          .slice(
            0,
            64,
          );

      return {
        users:
          await storage
            .mentionSuggestions(
              subjectType,
              normalizedQuery,
              8,
            ),
      };
    },

    async notificationTargets(
      user,
      {
        subjectType,
        subjectId,
        message,
      },
    ) {
      const userId =
        Number(
          user?.id,
        );
      if (
        !Number.isSafeInteger(
          userId,
        ) ||
        userId <= 0
      ) {
        throw new TypeError(
          'Authenticated user id is required',
        );
      }

      if (
        !allowedSubjectTypes(
          user,
        ).includes(
          subjectType,
        )
      ) {
        return {
          subject: null,
          participantUserIds: [],
          mentionedUsers: [],
        };
      }

      return storage
        .notificationTargets(
          subjectType,
          Number(subjectId),
          userId,
          discussionMentionLogins(
            message,
          ),
        );
    },
  };
}
