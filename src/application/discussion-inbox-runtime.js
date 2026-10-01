import {
  createDiscussionStorage,
} from '../db/discussion-storage.js';
import {
  createDiscussionInboxService,
} from '../modules/discussions/inbox-service.js';

export function createDiscussionInboxRuntime(
  database,
) {
  return createDiscussionInboxService(
    createDiscussionStorage(
      database,
    ),
  );
}
