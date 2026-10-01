const avatarObjectUrls =
  new Map();

export async function adminAvatarObjectUrl(
  url,
) {
  const key =
    String(url ?? '');

  if (!key.startsWith('/api/admin/')) {
    throw new Error(
      'Admin avatar URL must use the protected admin API',
    );
  }

  if (avatarObjectUrls.has(key)) {
    return avatarObjectUrls.get(key);
  }

  const pending =
    fetch(
      key,
      {
        credentials:
          'same-origin',
        headers: {
          Accept: 'image/*',
        },
      },
    )
      .then(
        async (response) => {
          if (!response.ok) {
            throw new Error(
              'HTTP ' +
              response.status,
            );
          }

          const blob =
            await response.blob();

          if (
            !blob.type
              .toLocaleLowerCase(
                'en-US',
              )
              .startsWith(
                'image/',
              )
          ) {
            throw new Error(
              'Admin avatar response is not an image',
            );
          }

          return URL.createObjectURL(
            blob,
          );
        },
      )
      .catch(
        (error) => {
          avatarObjectUrls.delete(
            key,
          );
          throw error;
        },
      );

  avatarObjectUrls.set(
    key,
    pending,
  );

  return pending;
}
