export function logAdminTaskProgress(context, progress) {
  let message = `Прогресс: ${progress.phase}`;
  if (progress.phase === 'resume') {
    message = `OSM: возобновление checkpoint ${progress.checkpointId}; уже загружено ${progress.stagedPlaces}/${progress.indexedPlaces}, осталось ${progress.remainingPlaces}`;
    if ((progress.unbuildableGeometryPlaces ?? 0) > 0) {
      message += `; без построенного полигона ${progress.unbuildableGeometryPlaces}`;
    }
  } else if (progress.phase === 'index') {
    message =
      `OSM: загружена часть индекса ${progress.indexPart}/${progress.indexPartCount}`;
  } else if (progress.phase === 'geometry') {
    message = `OSM: обработан пакет ${progress.batch}/${progress.batchCount}`;
    if ((progress.batchUnbuildableGeometryPlaces ?? 0) > 0) {
      message +=
        `; без построенного полигона ${progress.batchUnbuildableGeometryPlaces}`;
    }
  } else if (progress.phase === 'retry') {
    const target = progress.requestPhase === 'geometry'
      ? `пакет ${progress.batch}/${progress.batchCount}`
      : `часть индекса ${progress.indexPart}/${progress.indexPartCount}`;
    const reason = progress.retryKind === 'network'
      ? `сетевая ошибка ${progress.networkCode ?? progress.networkMessage ?? 'fetch'}`
      : `HTTP ${progress.statusCode}`;
    message =
      `OSM: ${reason}, ${target}; повтор ${progress.attempt}/` +
      `${progress.maxRetries} через ${Math.ceil(progress.waitMs / 1000)} сек.`;
  } else if (progress.phase === 'split') {
    message = progress.reason === 'http-504'
      ? `OSM: пакет ${progress.batch} получил HTTP 504 после ${progress.retryCount} повторов; разделён ${progress.objectCount} → ${progress.splitSizes.join(' + ')} объектов`
      : `OSM: пакет ${progress.batch} слишком большой; разделён ${progress.objectCount} → ${progress.splitSizes.join(' + ')} объектов`;
  } else if (progress.phase === 'kml-source') {
    message =
      `KML: обработан источник ${progress.source}/${progress.sourceCount}`;
  } else if (progress.phase === 'stage-write') {
    message =
      `PostgreSQL/PostGIS: запись staging-пакета ${progress.batch ?? '?'}` +
      ` (${progress.batchPlaces ?? '?'} объектов)`;
  } else if (progress.phase === 'stage') {
    message =
      `PostgreSQL/PostGIS: staging-пакет ${progress.batch ?? '?'} записан; ` +
      `всего ${progress.stagedPlaces ?? '?'} объектов`;
  } else if (progress.phase === 'delete-boundaries') {
    message =
      'Удаление старого snapshot территорий' +
      (progress.places ? `; новый snapshot: ${progress.places} объектов` : '');
  } else if (progress.phase === 'insert-boundaries') {
    message =
      'Вставка нового snapshot территорий' +
      (progress.places ? `; объектов: ${progress.places}` : '');
  } else if (progress.phase === 'hierarchy') {
    message =
      `Иерархия территорий: ${progress.processed ?? 0}/${progress.total ?? '?'}` +
      (progress.batchCount
        ? `; пакет ${progress.batch ?? 0}/${progress.batchCount}`
        : '');
  } else if (progress.phase === 'validated') {
    message = 'Входные данные проверены';
  } else if (progress.phase === 'warnings') {
    message =
      'Импорт продолжен с предупреждениями: ' +
      `${progress.warningCount ?? 0}; пропущено записей: ` +
      `${progress.skippedCount ?? 0}`;
  } else if (progress.phase === 'database') {
    message = 'Изменения базы данных подготовлены';
  }

  context.log(
    message,
    progress,
    progress.phase === 'warnings' ? 'warning' : 'info',
  );
}
