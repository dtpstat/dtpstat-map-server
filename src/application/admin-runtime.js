import {
  createAdminTaskDerivedRefresh,
} from './derived-state-refresh.js';
import {
  createAdminTaskManager,
} from '../shared/tasks/admin-task-manager.js';
import {
  createRealtimeEventBus,
} from '../shared/events/realtime-event-bus.js';
import {
  createAdminWebSocketGateway,
} from '../http/admin-websocket.js';

const TASK_DATA_CHANGES =
  Object.freeze({
    'osm-city-update': {
      resource: 'osm-boundaries',
      permission: 'osm-editor',
      message:
        'OSM-объекты обновлены. Открытые редакторы синхронизированы.',
    },
    'city-geojson-import': {
      resource: 'osm-boundaries',
      permission: 'osm-editor',
      message:
        'OSM-объекты импортированы. Открытые редакторы синхронизированы.',
    },
    'population-update': {
      resource: 'osm-boundaries',
      permission: 'osm-editor',
      message:
        'Данные территорий обновлены. Открытые редакторы синхронизированы.',
    },
    'kml-update': {
      resource: 'city-geometries',
      permission: 'data',
      message:
        'Геометрии данных обновлены.',
    },
    'geojson-import': {
      resource: 'city-geometries',
      permission: 'data',
      message:
        'Геометрии данных импортированы.',
    },
  });

const DEFAULT_FACTORIES =
  Object.freeze({
    createAdminTaskDerivedRefresh,
    createAdminTaskManager,
    createRealtimeEventBus,
    createAdminWebSocketGateway,
  });

function taskDataChange(update) {
  const definition =
    TASK_DATA_CHANGES[
      update.taskType
    ];
  if (!definition) return null;
  return {
    ...definition,
    action: 'refresh',
    source: {
      kind: 'admin-task',
      id: update.taskId,
      taskType: update.taskType,
    },
  };
}

/**
 * Compose admin task execution, realtime data notifications, durable
 * success/audit callbacks and the authenticated WebSocket gateway after
 * bootstrap state has been loaded.
 *
 * @param {{
 *   initialSuccessfulUpdates: any[],
 *   adminTaskSuccessRepository: { record: (update: any) => Promise<any> },
 *   securityService: { appendAudit: (entry: any) => Promise<any> },
 *   adminAuth: any,
 *   derivedState: any,
 *   factories?: Partial<typeof DEFAULT_FACTORIES>
 * }} dependencies
 */
export function createAdminRuntime({
  initialSuccessfulUpdates,
  adminTaskSuccessRepository,
  securityService,
  adminAuth,
  derivedState,
  factories = {},
}) {
  const runtimeFactories = {
    ...DEFAULT_FACTORIES,
    ...factories,
  };

  const realtimeEvents =
    runtimeFactories
      .createRealtimeEventBus();

  const refreshAfterSuccessfulUpdate =
    runtimeFactories
      .createAdminTaskDerivedRefresh(
        derivedState,
      );

  const afterSuccessfulUpdate =
    async (update) => {
      const change =
        taskDataChange(update);
      try {
        return await refreshAfterSuccessfulUpdate(
          update,
        );
      } finally {
        if (change) {
          realtimeEvents.publish(change);
        }
      }
    };

  const adminTasks =
    runtimeFactories
      .createAdminTaskManager({
        initialSuccessfulUpdates,
        recordSuccessfulUpdate:
          (update) =>
            adminTaskSuccessRepository
              .record(update),
        recordTaskAudit:
          (entry) =>
            securityService
              .appendAudit(entry),
        afterSuccessfulUpdate,
      });

  const adminWebSocket =
    runtimeFactories
      .createAdminWebSocketGateway({
        adminTasks,
        adminAuth,
        realtimeEvents,
      });

  return {
    adminTasks,
    adminWebSocket,
    realtimeEvents,
  };
}
