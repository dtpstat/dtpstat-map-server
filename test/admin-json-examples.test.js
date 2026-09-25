import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  KML_SOURCES_EXAMPLE,
  POPULATION_JSON_EXAMPLE,
} from '../admin/json-examples.js';
import { validateKmlSources } from '../src/modules/lines/kml-update-options.js';
import { buildPopulationPlan } from '../src/data/population-plan.js';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

test('admin KML hint is accepted by the real KML schema', () => {
  const sources = validateKmlSources(KML_SOURCES_EXAMPLE, {
    maxSources: 10,
    allowedHosts: new Set(['www.google.com']),
  });

  assert.equal(sources.length, 1);
  assert.deepEqual(
    sources[0].layers.map(({ name, multiple, type }) => ({ name, multiple, type })),
    [
      { name: 'Двусторонние', multiple: 2, type: 'Двусторонние' },
      { name: 'Односторонние', multiple: 1, type: 'Односторонние' },
    ],
  );
});

test('admin population hint shows and validates the region-city structure', () => {
  const plan = buildPopulationPlan(POPULATION_JSON_EXAMPLE);

  assert.equal(plan.schemaVersion, 2);
  assert.equal(plan.asOf, '2026-01-01');
  assert.equal(plan.source, 'Росстат');
  assert.equal(plan.regionCount, 1);
  assert.equal(plan.cityCount, 2);
  assert.equal(plan.cities[0].regionName, 'Республика Татарстан');
  assert.equal(plan.cities[0].cityName, 'Казань');
  assert.equal(plan.cities[0].population, 1320000);
  assert.equal(plan.cities[1].cityName, 'Набережные Челны');
  assert.equal(plan.cities[1].asOf, '2025-01-01');
  assert.equal(plan.cities[1].source, 'Татарстанстат');
});


test('admin loads schema-backed examples explicitly and explains NAME/CODE/TITLE ownership', async () => {
  const [html, shell, examples] = await Promise.all([
    fs.readFile(path.join(projectRoot, 'admin/index.html'), 'utf8'),
    fs.readFile(path.join(projectRoot, 'admin/admin-shell.js'), 'utf8'),
    fs.readFile(path.join(projectRoot, 'admin/json-examples.js'), 'utf8'),
  ]);

  assert.match(shell, /await import\('\.\/json-examples\.js'\)/);
  assert.doesNotMatch(html, /src="\/admin\/json-examples\.js"/);
  assert.doesNotMatch(html, /"populations":\[…\]/);
  assert.match(examples, /multiple \(1 или 2\)/);
  assert.match(examples, /type — NAME бизнес-типа из источника/);
  assert.match(examples, /CODE назначает БД/);
  assert.match(examples, /TITLE сначала равен NAME/);
  assert.match(examples, /schemaVersion:\s*2/);
  assert.match(examples, /regions:/);
  assert.match(examples, /cities:/);
  assert.doesNotMatch(examples, /osmId|osmType/);
});
