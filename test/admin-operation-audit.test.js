import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  createAdminOperationAudit,
  recordAdminOperationChanges,
  recordAdminOperationDetails,
} from '../src/http/admin-auth.js';

class FakeResponse extends EventEmitter {
  constructor(statusCode = 200) {
    super();
    this.statusCode = statusCode;
    this.locals = {};
  }
}

function request() {
  return {
    method: 'PUT',
    originalUrl: '/api/admin/project-settings',
    ip: '127.0.0.1',
    socket: {},
    adminUser: { id: 7, username: 'operator' },
  };
}

async function flushAudit() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('operation audit persists concrete non-security changes and extra details', async () => {
  const entries = [];
  const securityService = {
    async appendAudit(entry) { entries.push(entry); },
  };
  const response = new FakeResponse();
  const middleware = createAdminOperationAudit(securityService, 'interface.project.update');

  middleware(request(), response, () => {});
  recordAdminOperationChanges(
    response,
    { projectName: 'Before', mapboxAccessToken: 'pk.old' },
    { projectName: 'After', mapboxAccessToken: 'pk.new' },
  );
  recordAdminOperationDetails(response, { source: 'web-admin' });
  response.emit('finish');
  await flushAudit();

  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 'succeeded');
  assert.equal(entries[0].details.source, 'web-admin');
  assert.deepEqual(entries[0].details.changes, [
    {
      path: 'mapboxAccessToken',
      before: '[redacted]',
      after: '[redacted]',
      sensitive: true,
    },
    { path: 'projectName', before: 'Before', after: 'After' },
  ]);
  assert.doesNotMatch(JSON.stringify(entries[0]), /pk\.old|pk\.new/);
});

test('security and profile operations ignore attached value-level change details', async () => {
  for (const operationType of ['security.user.update', 'profile.update']) {
    const entries = [];
    const securityService = {
      async appendAudit(entry) { entries.push(entry); },
    };
    const response = new FakeResponse();
    const middleware = createAdminOperationAudit(securityService, operationType);

    middleware(request(), response, () => {});
    recordAdminOperationChanges(
      response,
      { password: 'old-secret', email: 'before@example.test' },
      { password: 'new-secret', email: 'after@example.test' },
    );
    recordAdminOperationDetails(response, { submittedValue: 'must-not-be-persisted' });
    response.emit('finish');
    await flushAudit();

    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].details, {
      method: 'PUT',
      path: '/api/admin/project-settings',
      statusCode: 200,
    });
    assert.doesNotMatch(JSON.stringify(entries[0]), /secret|example\.test|submittedValue/);
  }
});
