import crypto from 'node:crypto';

function normalizedString(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function normalizedEntityIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .filter((value) =>
        typeof value === 'string' ||
        typeof value === 'number')
      .map((value) => value),
  )];
}

export function createRealtimeEventBus(dependencies = {}) {
  const randomUUID =
    dependencies.randomUUID ??
    crypto.randomUUID;
  const now =
    dependencies.now ??
    (() => new Date().toISOString());
  const listeners = new Set();
  const resources = new Map();
  let sequence = 0;

  function emit(message) {
    for (const listener of listeners) {
      try {
        listener(structuredClone(message));
      } catch (error) {
        console.error(
          'Realtime event listener failed',
          error,
        );
      }
    }
  }

  return {
    publish(definition) {
      if (
        !definition ||
        typeof definition !== 'object' ||
        Array.isArray(definition)
      ) {
        throw new TypeError(
          'Realtime event definition must be an object',
        );
      }

      const resource =
        normalizedString(
          definition.resource,
        );
      if (!resource) {
        throw new TypeError(
          'Realtime event resource is required',
        );
      }

      sequence += 1;
      const changedAt = now();
      const change = {
        id: randomUUID(),
        sequence,
        resource,
        action:
          normalizedString(
            definition.action,
            'updated',
          ),
        entityIds:
          normalizedEntityIds(
            definition.entityIds,
          ),
        changedAt,
        permission:
          normalizedString(
            definition.permission,
            'any',
          ),
        originClientId:
          normalizedString(
            definition.originClientId,
          ),
        message:
          normalizedString(
            definition.message,
          ),
        source:
          definition.source &&
          typeof definition.source === 'object' &&
          !Array.isArray(definition.source)
            ? structuredClone(
              definition.source,
            )
            : null,
      };

      resources.set(
        resource,
        {
          revision: sequence,
          changedAt,
          action: change.action,
          permission: change.permission,
        },
      );

      const message = {
        type: 'data-change',
        change,
      };
      emit(message);
      return structuredClone(change);
    },

    snapshot() {
      return {
        sequence,
        resources:
          Object.fromEntries(
            [...resources.entries()]
              .map(
                ([resource, value]) => [
                  resource,
                  structuredClone(value),
                ],
              ),
          ),
      };
    },

    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError(
          'Realtime event listener must be a function',
        );
      }
      listeners.add(listener);
      return () =>
        listeners.delete(listener);
    },
  };
}
