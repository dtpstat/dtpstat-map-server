import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateBoundaryBranchStatus,
  buildBoundaryTreeIndex,
} from '../admin/osm-boundary-editor.js';

const tree = [
  { id: 1, parentId: null, active: false, displayName: 'Регион' },
  { id: 2, parentId: 1, active: false, displayName: 'Округ' },
  { id: 3, parentId: 2, active: false, displayName: 'Город A' },
  { id: 4, parentId: 2, active: false, displayName: 'Город B' },
];

function statusFor(items, id) {
  const { byId, childrenByParent } = buildBoundaryTreeIndex(items);
  return aggregateBoundaryBranchStatus(byId.get(id), childrenByParent);
}

test('OSM branch status is inactive when the whole subtree is disabled', () => {
  assert.deepEqual(statusFor(tree, 1), {
    status: 'inactive',
    activeCount: 0,
    totalCount: 4,
  });
});

test('OSM branch status is active when the whole subtree is enabled', () => {
  const enabled = tree.map((item) => ({ ...item, active: true }));
  assert.deepEqual(statusFor(enabled, 1), {
    status: 'active',
    activeCount: 4,
    totalCount: 4,
  });
});

test('enabling one child under disabled parents makes ancestors partial, not active', () => {
  const mixed = tree.map((item) => ({
    ...item,
    active: item.id === 3,
  }));

  assert.deepEqual(statusFor(mixed, 3), {
    status: 'active',
    activeCount: 1,
    totalCount: 1,
  });
  assert.deepEqual(statusFor(mixed, 2), {
    status: 'partial',
    activeCount: 1,
    totalCount: 3,
  });
  assert.deepEqual(statusFor(mixed, 1), {
    status: 'partial',
    activeCount: 1,
    totalCount: 4,
  });

  assert.equal(mixed.find((item) => item.id === 1).active, false);
  assert.equal(mixed.find((item) => item.id === 2).active, false);
});
