import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  fileURLToPath,
} from 'node:url';
import {
  API_REQUEST_CONTRACTS,
  apiContractKey,
} from '../src/http/api-request-contract.js';

const root =
  path.resolve(
    path.dirname(
      fileURLToPath(
        import.meta.url,
      ),
    ),
    '..',
  );

const ROUTE_IMPLEMENTATION_ALIAS_ALLOWLIST =
  Object.freeze({
    'GET /config':
      Object.freeze([
        'src/modules/map/routes.js',
        'src/routes/project/public-routes.js',
      ]),
  });

function allowedDuplicateRoute(
  key,
  locations,
) {
  const allowed =
    ROUTE_IMPLEMENTATION_ALIAS_ALLOWLIST[
      key
    ];

  if (!allowed) {
    return false;
  }

  return (
    locations.length ===
      allowed.length &&
    [...locations]
      .sort()
      .every(
        (location, index) =>
          location ===
          [...allowed]
            .sort()[
              index
            ],
      )
  );
}

async function javascriptFiles(
  directory,
) {
  const result = [];

  for (
    const entry of
    await fs.readdir(
      directory,
      {
        withFileTypes: true,
      },
    )
  ) {
    const full =
      path.join(
        directory,
        entry.name,
      );

    if (entry.isDirectory()) {
      result.push(
        ...await javascriptFiles(
          full,
        ),
      );
      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith(
        '.js',
      )
    ) {
      result.push(full);
    }
  }

  return result;
}

test('every literal HTTP API route has exactly one strict request contract and vice versa', async () => {
  const routeFiles =
    await javascriptFiles(
      path.join(
        root,
        'src',
      ),
    );
  const routeKeys =
    new Map();
  const routePattern =
    /\brouter\.(get|post|put|patch|delete)\(\s*(['"])([^'"]+)\2/gmu;

  for (const file of routeFiles) {
    const source =
      await fs.readFile(
        file,
        'utf8',
      );

    for (
      const match of
      source.matchAll(
        routePattern,
      )
    ) {
      const key =
        apiContractKey(
          match[1],
          match[3],
        );
      const locations =
        routeKeys.get(key) ??
        [];
      locations.push(
        path.relative(
          root,
          file,
        ),
      );
      routeKeys.set(
        key,
        locations,
      );
    }
  }

  const contractKeys =
    new Map();

  for (
    const contract of
    API_REQUEST_CONTRACTS
  ) {
    const key =
      apiContractKey(
        contract.method,
        contract.path,
      );
    const count =
      contractKeys.get(key) ??
      0;
    contractKeys.set(
      key,
      count + 1,
    );
  }

  const duplicateContracts =
    [...contractKeys]
      .filter(
        (
          [
            ,
            count,
          ],
        ) =>
          count !== 1,
      );
  assert.deepEqual(
    duplicateContracts,
    [],
    'API contracts must be unique',
  );

  const duplicateRoutes =
    [...routeKeys]
      .filter(
        (
          [
            key,
            locations,
          ],
        ) =>
          locations.length !== 1 &&
          !allowedDuplicateRoute(
            key,
            locations,
          ),
      );
  assert.deepEqual(
    duplicateRoutes,
    [],
    'Literal API routes must be unique',
  );

  for (
    const [
      key,
      expectedLocations,
    ] of Object.entries(
      ROUTE_IMPLEMENTATION_ALIAS_ALLOWLIST,
    )
  ) {
    assert.deepEqual(
      [
        ...(
          routeKeys.get(key) ??
          []
        ),
      ].sort(),
      [
        ...expectedLocations,
      ].sort(),
      key +
        ' fallback implementations changed and require explicit security review',
    );
  }

  const missingContracts =
    [...routeKeys.keys()]
      .filter(
        (key) =>
          !contractKeys.has(
            key,
          ),
      )
      .sort();
  assert.deepEqual(
    missingContracts,
    [],
    'Every literal API route must have a strict request contract',
  );

  const orphanContracts =
    [...contractKeys.keys()]
      .filter(
        (key) =>
          !routeKeys.has(key),
      )
      .sort();
  assert.deepEqual(
    orphanContracts,
    [],
    'Every request contract must correspond to a literal API route',
  );
});
