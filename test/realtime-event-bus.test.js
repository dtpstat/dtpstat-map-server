import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRealtimeEventBus,
} from '../src/shared/events/realtime-event-bus.js';

test('realtime event bus publishes immutable data-change events and resource revisions', () => {
  let id = 0;
  let tick = 0;
  const bus =
    createRealtimeEventBus({
      randomUUID:
        () => `event-${++id}`,
      now:
        () =>
          `2026-09-25T12:00:0${tick++}.000Z`,
    });
  const messages = [];
  const unsubscribe =
    bus.subscribe(
      (message) =>
        messages.push(message),
    );

  const change = bus.publish({
    resource: 'osm-boundaries',
    action: 'bulk-update',
    entityIds: [5, 5, 7],
    permission: 'osm-editor',
    originClientId: 'client-1',
    message: 'OSM changed',
  });

  assert.deepEqual(
    change.entityIds,
    [5, 7],
  );
  assert.equal(
    change.sequence,
    1,
  );
  assert.equal(
    messages[0].type,
    'data-change',
  );
  messages[0].change.entityIds.push(99);

  assert.deepEqual(
    bus.snapshot(),
    {
      sequence: 1,
      resources: {
        'osm-boundaries': {
          revision: 1,
          changedAt:
            '2026-09-25T12:00:00.000Z',
          action:
            'bulk-update',
          permission:
            'osm-editor',
        },
      },
    },
  );

  unsubscribe();
  bus.publish({
    resource: 'city-geometries',
  });
  assert.equal(
    messages.length,
    1,
  );
});
