import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('V032 separates territory population data from active projection', async () => {
  const sql = await fs.readFile(
    path.join(
      root,
      'db/migrations/V032__boundary_population_attributes.sql',
    ),
    'utf8',
  );

  assert.match(
    sql,
    /ALTER TABLE BUSLANES\.CITY_BOUNDARIES[\s\S]*ADD COLUMN IF NOT EXISTS POPULATION INTEGER/i,
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS POPULATION_AS_OF DATE/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS POPULATION_SOURCE TEXT/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS ATTRIBUTES JSONB/i);
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION BUSLANES\.SYNC_ACTIVE_BOUNDARY_POPULATIONS\(\)/i,
  );
  assert.match(
    sql,
    /FROM BUSLANES\.CITY_BOUNDARIES AS BOUNDARY[\s\S]*WHERE BOUNDARY\.IS_ACTIVE/i,
  );
  assert.match(
    sql,
    /COMMENT ON COLUMN BUSLANES\.CITY_BOUNDARIES\.POPULATION[\s\S]*independent from IS_ACTIVE/i,
  );
  assert.doesNotMatch(
    sql,
    /CHECK\s*\([^)]*IS_ACTIVE[^)]*POPULATION|CHECK\s*\([^)]*POPULATION[^)]*IS_ACTIVE/i,
  );
});
