import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findDuplicateJsonKeys,
  verifyNoDuplicateJsonKeys,
} from '../src/http/json-duplicate-key-guard.js';

test('duplicate JSON keys are detected before JSON.parse can overwrite them', () => {
  assert.deepEqual(
    findDuplicateJsonKeys(
      '{"roleId":1,"roleId":2}',
    ),
    ['roleId'],
  );

  assert.deepEqual(
    findDuplicateJsonKeys(
      '{"outer":{"ro\\u006ceId":1,"roleId":2}}',
    ),
    ['outer.roleId'],
  );

  assert.deepEqual(
    findDuplicateJsonKeys(
      '{"items":[{"id":1,"id":2},{"id":3}]}',
    ),
    ['items.0.id'],
  );
});

test('duplicate JSON guard ignores malformed JSON so the normal parser reports syntax errors', () => {
  assert.deepEqual(
    findDuplicateJsonKeys(
      '{"id":1,',
    ),
    [],
  );
});

test('duplicate JSON guard raises a typed request security error', () => {
  assert.throws(
    () =>
      verifyNoDuplicateJsonKeys(
        {},
        {},
        Buffer.from(
          '{"RoleID":1,"RoleID":2}',
        ),
        'utf-8',
      ),
    (error) => {
      assert.equal(
        error.type,
        'entity.duplicate.json.key',
      );
      assert.equal(
        error.status,
        400,
      );
      assert.deepEqual(
        error.duplicateJsonKeys,
        ['RoleID'],
      );
      return true;
    },
  );
});
