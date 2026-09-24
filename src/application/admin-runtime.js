import {
  createAdminTaskDerivedRefresh,
} from './derived-state-refresh.js';
import {
  createAdminTaskManager,
} from '../shared/tasks/admin-task-manager.js';
import {
  createAdminWebSocketGateway,
} from '../http/admin-websocket.js';

const DEFAULT_FACTORIES =
  Object.freeze({
    createAdminTaskDerivedRefresh,
    createAdminTaskManager,
    createAdminWebSocketGateway,
  });

/**
 * Compose admin task execution, durable success/audit callbacks and the
 * authenticated WebSocket gateway after bootstrap state has been loaded.
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
        afterSuccessfulUpdate:
          runtimeFactories
            .createAdminTaskDerivedRefresh(
              derivedState,
            ),
      });

  const adminWebSocket =
    runtimeFactories
      .createAdminWebSocketGateway({
        adminTasks,
        adminAuth,
      });

  return {
    adminTasks,
    adminWebSocket,
  };
}
