function versionToken(
  pointType,
) {
  const url =
    pointType?.iconUrl;
  if (!url) {
    return null;
  }

  try {
    const version =
      new URL(
        url,
        window.location.origin,
      ).searchParams.get('v');

    return (
      version &&
      /^[0-9a-f]{64}$/u
        .test(version)
    )
      ? version
      : 'current';
  } catch {
    return null;
  }
}

export function pointTypeImageId(
  pointType,
  prefix =
    'point-type',
) {
  const version =
    versionToken(
      pointType,
    );

  if (
    !version ||
    !Number.isSafeInteger(
      Number(pointType?.id),
    )
  ) {
    return null;
  }

  return (
    prefix +
    '-' +
    Number(pointType.id) +
    '-' +
    version
  );
}

export function pointTypeIconOffset(
  pointType,
) {
  const width =
    Number(
      pointType
        ?.displayWidth ??
      32,
    );
  const height =
    Number(
      pointType
        ?.displayHeight ??
      32,
    );
  const anchorX =
    Number(
      pointType?.anchorX ??
      width / 2,
    );
  const anchorY =
    Number(
      pointType?.anchorY ??
      height / 2,
    );

  return [
    width / 2 - anchorX,
    height / 2 - anchorY,
  ];
}

function loadImage(
  url,
) {
  return new Promise(
    (
      resolve,
      reject,
    ) => {
      const image =
        new Image();

      image.decoding =
        'async';
      image.onload =
        () => resolve(image);
      image.onerror =
        () =>
          reject(
            new Error(
              'Не удалось загрузить иконку типа точки.',
            ),
          );
      image.src = url;
    },
  );
}

export async function rasterizePointTypeIcon(
  pointType,
) {
  const width =
    Number(
      pointType
        ?.displayWidth,
    );
  const height =
    Number(
      pointType
        ?.displayHeight,
    );

  if (
    !pointType?.iconUrl ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    return null;
  }

  const image =
    await loadImage(
      pointType.iconUrl,
    );

  const canvas =
    document.createElement(
      'canvas',
    );
  canvas.width = width;
  canvas.height = height;

  const context =
    canvas.getContext(
      '2d',
      {
        alpha: true,
      },
    );

  if (!context) {
    throw new Error(
      'Canvas 2D недоступен для подготовки иконки типа точки.',
    );
  }

  context.clearRect(
    0,
    0,
    width,
    height,
  );
  context.drawImage(
    image,
    0,
    0,
    width,
    height,
  );

  return context.getImageData(
    0,
    0,
    width,
    height,
  );
}

export async function syncPointTypeImages(
  map,
  pointTypes,
  {
    prefix =
      'point-type',
    previousIds =
      new Set(),
  } = {},
) {
  const nextIds =
    new Set();

  const configured =
    pointTypes.filter(
      (pointType) =>
        Boolean(
          pointType
            ?.iconConfigured &&
          pointType?.iconUrl,
        ),
    );

  for (
    const pointType of
    configured
  ) {
    const imageId =
      pointTypeImageId(
        pointType,
        prefix,
      );
    if (!imageId) {
      continue;
    }

    nextIds.add(imageId);

    if (map.hasImage(imageId)) {
      continue;
    }

    try {
      const imageData =
        await rasterizePointTypeIcon(
          pointType,
        );
      if (
        imageData &&
        !map.hasImage(imageId)
      ) {
        map.addImage(
          imageId,
          imageData,
          {
            pixelRatio: 1,
          },
        );
      }
    } catch (error) {
      console.warn(
        'Не удалось подготовить иконку типа точки',
        pointType.id,
        error,
      );
    }
  }

  for (
    const imageId of
    previousIds
  ) {
    if (
      !nextIds.has(imageId) &&
      map.hasImage(imageId)
    ) {
      map.removeImage(
        imageId,
      );
    }
  }

  return nextIds;
}
