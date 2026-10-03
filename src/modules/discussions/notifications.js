function actorName(
  actor,
) {
  return (
    String(
      actor?.displayName ??
      actor?.username ??
      'Пользователь',
    ).trim() ||
    'Пользователь'
  );
}

function subjectName(
  target,
  subjectType,
  subjectId,
) {
  return String(
    target?.subject?.title ??
    target?.subject?.subtitle ??
    (
      subjectType ===
      'geometry'
        ? 'Геометрия #' +
          subjectId
        : 'OSM-объект #' +
          subjectId
    ),
  ).trim();
}

export function publishDiscussionNotifications(
  notificationEvents,
  {
    permission,
    actor,
    subjectType,
    subjectId,
    targets,
  },
) {
  if (
    !notificationEvents?.publish ||
    !targets
  ) {
    return {
      participantCount: 0,
      mentionCount: 0,
    };
  }

  const mentionUserIds =
    [
      ...new Set(
        (
          targets
            .mentionedUsers ??
          []
        )
          .map(
            (item) =>
              Number(
                item.userId,
              ),
          )
          .filter(
            (id) =>
              Number.isSafeInteger(
                id,
              ) &&
              id > 0,
          ),
      ),
    ];

  if (
    mentionUserIds.length ===
    0
  ) {
    return {
      participantCount: 0,
      mentionCount: 0,
    };
  }

  const name =
    actorName(
      actor,
    );
  const subject =
    subjectName(
      targets,
      subjectType,
      subjectId,
    );
  const source = {
    kind:
      'discussion-thread',
    id:
      subjectType +
      ':' +
      subjectId,
  };

  notificationEvents.publish({
    level: 'info',
    code:
      'discussion-mention',
    message:
      name +
      ' упомянул вас в «' +
      subject +
      '».',
    timeoutMs:
      12_000,
    permission,
    audience: {
      userIds:
        mentionUserIds,
    },
    source,
  });

  return {
    participantCount: 0,
    mentionCount:
      mentionUserIds.length,
  };
}
