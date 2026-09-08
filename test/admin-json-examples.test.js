import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  KML_SOURCES_EXAMPLE,
  POPULATION_JSON_EXAMPLE,
} from '../admin/json-examples.js';
import { validateKmlSources } from '../src/data/kml-update-options.js';
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

test('admin population hint shows and validates the complete item structure', () => {
  const plan = buildPopulationPlan(POPULATION_JSON_EXAMPLE);

  assert.equal(plan.asOf, '2026-01-01');
  assert.equal(plan.source, 'Росстат');
  assert.equal(plan.populations.length, 2);
  assert.deepEqual(plan.populations[0], {
    name: 'Москва',
    population: 13274285,
    asOf: '2026-01-01',
    source: 'Росстат',
    attributes: {},
  });
  assert.equal(plan.populations[1].asOf, '2025-01-01');
  assert.equal(plan.populations[1].source, 'Петростат');
  assert.equal(typeof plan.populations[1].attributes, 'object');
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
  assert.match(html, /populations\[\]\.name/);
  assert.match(html, /populations\[\]\.population/);
});
