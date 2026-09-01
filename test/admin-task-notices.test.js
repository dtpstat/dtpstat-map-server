import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaskNotices } from '../admin/task-notices.js';

test('admin notices stay attached to their own task tabs', () => {
  const osm = {
    dataset: { taskNotice: 'osm' },
    textContent: '',
    className: 'notice',
  };
  const kml = {
    dataset: { taskNotice: 'kml' },
    textContent: '',
    className: 'notice',
  };
  const notices = createTaskNotices([osm, kml], {
    osm: 'Города OSM',
    kml: 'Линии KML',
  });

  assert.equal(
    notices.setForTask('kml', 'операция завершилась с ошибкой.', 'error'),
    true,
  );
  assert.equal(kml.textContent, 'Линии KML: операция завершилась с ошибкой.');
  assert.equal(kml.className, 'notice notice-error');
  assert.equal(osm.textContent, '');
  assert.equal(osm.className, 'notice');
});
