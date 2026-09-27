import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminHasPermission,
} from '../src/modules/security/authorization-policy.js';

test('admin authorization policy keeps OSM editing independent from broad data management', () => {
  const user = {
    isSuperuser: false,
    canManageData: false,
    canEditOsm: true,
  };

  assert.equal(
    adminHasPermission(user, 'osm-editor'),
    true,
  );
  assert.equal(
    adminHasPermission(user, 'data'),
    false,
  );
});

test('admin authorization policy keeps geometry editing independent from broad data and OSM management', () => {
  const user = {
    isSuperuser: false,
    canManageData: false,
    canEditOsm: false,
    canEditGeometries: true,
  };

  assert.equal(adminHasPermission(user, 'geometry-editor'), true);
  assert.equal(adminHasPermission(user, 'osm-editor'), false);
  assert.equal(adminHasPermission(user, 'data'), false);
});

test('admin authorization policy maps each explicit capability without cross-granting', () => {
  const user = {
    isSuperuser: false,
    canManageData: true,
    canManageInterface: false,
    canEditOsm: false,
    canEditGeometries: false,
    canManageUsers: true,
    canViewAudit: false,
    canManageSecurity: true,
  };

  assert.equal(adminHasPermission(user, 'any'), true);
  assert.equal(adminHasPermission(user, 'profile'), true);
  assert.equal(adminHasPermission(user, 'data'), true);
  assert.equal(adminHasPermission(user, 'interface'), false);
  assert.equal(adminHasPermission(user, 'osm-editor'), false);
  assert.equal(adminHasPermission(user, 'geometry-editor'), false);
  assert.equal(adminHasPermission(user, 'users'), true);
  assert.equal(adminHasPermission(user, 'audit'), false);
  assert.equal(
    adminHasPermission(user, 'users-or-audit'),
    true,
  );
  assert.equal(adminHasPermission(user, 'security'), true);
  assert.equal(adminHasPermission(user, 'superuser'), false);
  assert.equal(adminHasPermission(user, 'unknown'), false);
});

test('admin authorization policy grants every known permission to a superuser only through the superuser flag', () => {
  const user = {
    isSuperuser: true,
    canManageData: false,
    canManageInterface: false,
    canEditOsm: false,
    canEditGeometries: false,
    canManageUsers: false,
    canViewAudit: false,
    canManageSecurity: false,
  };

  for (const permission of [
    'any',
    'profile',
    'data',
    'interface',
    'osm-editor',
    'geometry-editor',
    'users',
    'audit',
    'users-or-audit',
    'security',
    'superuser',
  ]) {
    assert.equal(
      adminHasPermission(user, permission),
      true,
      permission,
    );
  }

  assert.equal(adminHasPermission(null, 'any'), false);
});
