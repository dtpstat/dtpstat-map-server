import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  createProjectSettingsTransferService,
} from '../src/application/data-transfer/project-settings-service.js';
import {
  createDataExportStorageRepository,
} from '../src/db/data-export-storage-repository.js';
import {
  loadAdminDatabaseConnection,
  normalizeDatabaseSchema,
} from '../src/db/database-environment.js';
import {
  applyMigrations,
  loadMigrations,
} from '../src/db/migration-runner.js';
import {
  createProjectSettingsTransferRepository,
} from '../src/db/project-settings-transfer-repository.js';
import {
  createPointTypesRepository,
} from '../src/db/point-types-repository.js';
import {
  createGeometryEditorStorage,
} from '../src/db/geometry-editor-storage.js';
import {
  createGeometryEditLeaseStorage,
} from '../src/db/geometry-edit-lease-storage.js';
import {
  createGeometryEditorService,
} from '../src/modules/geometry/editor-service.js';

const {
  Client,
  Pool,
} = pg;

const projectRoot =
  path.resolve(
    path.dirname(
      fileURLToPath(
        import.meta.url,
      ),
    ),
    '..',
  );

function integrationConnection() {
  const database =
    process.env
      .DATABASE_NAME
      ?.trim();

  if (!database) {
    throw new Error(
      'DATABASE_NAME is required for PostgreSQL integration testing',
    );
  }

  return {
    ...loadAdminDatabaseConnection(),
    database,
  };
}

function temporarySchema() {
  return normalizeDatabaseSchema(
    `dtpstat_it_${process.pid}_${crypto
      .randomBytes(5)
      .toString('hex')}`,
  );
}

async function verifyPostgis(
  client,
) {
  const result =
    await client.query(
      'SELECT PostGIS_Version() AS version',
    );

  assert.equal(
    typeof result.rows[0]?.version,
    'string',
  );

  assert.ok(
    result.rows[0]
      .version.length > 0,
  );

  return result.rows[0]
    .version;
}

async function verifyMigratedSchema(
  client,
  schema,
  migrationCount,
) {
  const result =
    await client.query(
      `
        SELECT
          COUNT(*)::integer AS count,
          MAX(version)::integer AS version
        FROM ${schema}.schema_versions
      `,
    );

  assert.equal(
    result.rows[0]?.count,
    migrationCount,
  );

  assert.equal(
    result.rows[0]?.version,
    migrationCount,
  );

  for (
    const table of [
      'project_settings',
      'line_types',
      'point_types',
      'report_config',
      'admin_security_settings',
      'city_boundaries',
      'city_geometries',
    ]
  ) {
    const exists =
      await client.query(
        'SELECT to_regclass($1) AS relation',
        [
          `${schema}.${table}`,
        ],
      );

    assert.ok(
      exists.rows[0]
        ?.relation,
      `missing migrated table ${table}`,
    );
  }
}

async function verifySettingsTransfer(
  pool,
  repository,
) {
  const service =
    createProjectSettingsTransferService(
      pool,
      {
        repository,
        acquireLock:
          async () => {},
      },
    );

  const payload =
    await service.exportSettings();

  assert.equal(
    payload._dtpstat.kind,
    'project-settings',
  );

  assert.equal(
    typeof payload
      .projectSettings
      .projectName,
    'string',
  );

  assert.ok(
    Array.isArray(
      payload.lineTypes,
    ),
  );

  assert.ok(
    payload.reportConfig &&
    typeof payload.reportConfig ===
      'object',
  );

  assert.equal(
    typeof payload
      .securitySettings
      .maxFailedAttempts,
    'number',
  );
}

async function verifyLineTypeStaging(
  pool,
  repository,
) {
  const client =
    await pool.connect();

  const name =
    `integration_${crypto
      .randomBytes(4)
      .toString('hex')}`;

  try {
    await client.query('BEGIN');

    await repository
      .replaceLineTypes(
        client,
        [
          {
            name,
            title:
              'Integration line',
            color: '#045b69',
            style: 'solid',
            width: 4,
          },
        ],
      );

    const names =
      await repository
        .currentLineTypeNames(
          client,
        );

    assert.ok(
      names.includes(name),
    );

    await client.query(
      'ROLLBACK',
    );

    const afterRollback =
      await repository
        .currentLineTypeNames(
          client,
        );

    assert.equal(
      afterRollback
        .includes(name),
      false,
    );
  } catch (error) {
    await client.query(
      'ROLLBACK',
    ).catch(() => {});

    throw error;
  } finally {
    client.release();
  }
}

async function verifySpatialExports(
  pool,
) {
  const storage =
    createDataExportStorageRepository();

  const cities =
    await storage
      .exportCityBoundaries(
        pool,
      );

  assert.equal(
    cities.type,
    'FeatureCollection',
  );

  assert.ok(
    Array.isArray(
      cities.features,
    ),
  );

  const lines =
    await storage
      .exportLines(pool);

  assert.equal(
    lines.type,
    'FeatureCollection',
  );

  assert.ok(
    Array.isArray(
      lines.lineTypes,
    ),
  );

  assert.ok(
    Array.isArray(
      lines.features,
    ),
  );

  const populations =
    await storage
      .populationRows(pool);

  assert.ok(
    Array.isArray(
      populations.rows,
    ),
  );

  const client =
    await pool.connect();

  try {
    await client.query(
      'BEGIN READ ONLY',
    );

    const cityItems = [];

    for await (
      const item of
      storage
        .streamCityBoundaryItems(
          client,
          2,
        )
    ) {
      cityItems.push(item);
    }

    assert.deepEqual(
      cityItems,
      [],
    );

    const lineItems = [];

    for await (
      const item of
      storage.streamLineItems(
        client,
        2,
      )
    ) {
      lineItems.push(item);
    }

    assert.deepEqual(
      lineItems,
      [],
    );

    await client.query(
      'ROLLBACK',
    );
  } catch (error) {
    await client.query(
      'ROLLBACK',
    ).catch(() => {});

    throw error;
  } finally {
    client.release();
  }
}

async function verifyPointTypeIconMetadata(
  pool,
) {
  const repository =
    createPointTypesRepository(
      pool,
    );
  const pointType =
    await repository.create({
      name:
        'Integration point ' +
        crypto
          .randomBytes(4)
          .toString('hex'),
    });

  assert.ok(
    pointType?.id > 0,
    'Point type was not created',
  );

  const sha256 =
    'a'.repeat(64);
  const fileName =
    pointType.id +
    '-' +
    sha256 +
    '.svg';

  const saved =
    await repository
      .saveIconMetadata(
        pointType.id,
        {
          fileName,
          mime:
            'image/svg+xml',
          width: 24,
          height: 24,
          sha256,
        },
      );

  assert.equal(
    saved
      .previousIconFileName,
    null,
  );
  assert.equal(
    saved
      .pointType
      .iconConfigured,
    true,
  );
  assert.equal(
    saved
      .pointType
      .iconMime,
    'image/svg+xml',
  );
  assert.equal(
    saved
      .pointType
      .iconSourceWidth,
    24,
  );
  assert.deepEqual(
    await repository
      .listIconFileNames(),
    [fileName],
  );

  const internal =
    await repository.get(
      pointType.id,
    );

  assert.equal(
    internal.iconFileName,
    fileName,
  );
  assert.equal(
    internal.iconSha256,
    sha256,
  );

  const cleared =
    await repository
      .clearIconMetadata(
        pointType.id,
      );

  assert.equal(
    cleared
      .previousIconFileName,
    fileName,
  );
  assert.equal(
    cleared
      .pointType
      .iconConfigured,
    false,
  );
  assert.deepEqual(
    await repository
      .listIconFileNames(),
    [],
  );

  const deleted =
    await repository.delete(
      pointType.id,
    );

  assert.equal(
    deleted.id,
    pointType.id,
  );
  assert.equal(
    deleted
      .unlinkedGeometryCount,
    0,
  );
}

async function verifyGeometryEditorInfrastructure(
  pool,
) {
  const storage =
    createGeometryEditorStorage(
      pool,
    );
  const leaseStorage =
    createGeometryEditLeaseStorage(
      pool,
    );

  const client =
    await pool.connect();

  let parentBoundaryId;
  let childBoundaryId;

  try {
    await client.query(
      'BEGIN',
    );

    const parent =
      await client.query(
        `
          WITH prepared AS (
            SELECT ST_Multi(
              ST_GeomFromText(
                'POLYGON((30 50,30.1 50,30.1 50.1,30 50.1,30 50))',
                4326
              )
            ) AS geom
          )
          INSERT INTO city_boundaries (
            place_type,
            admin_level,
            osm_type,
            osm_id,
            osm_name,
            tags,
            geom,
            bounds,
            is_active,
            display_name,
            display_type,
            area_m2
          )
          SELECT
            NULL,
            4,
            'relation',
            998000001,
            'Integration Region',
            '{"name":"Integration Region"}'::jsonb,
            geom,
            ST_Envelope(geom),
            TRUE,
            'Integration Region',
            'administrative',
            ST_Area(geom::geography)
          FROM prepared
          RETURNING id::bigint AS id
        `,
      );

    parentBoundaryId =
      Number(
        parent.rows[0]
          .id,
      );

    const child =
      await client.query(
        `
          WITH prepared AS (
            SELECT ST_Multi(
              ST_GeomFromText(
                'POLYGON((30.02 50.02,30.04 50.02,30.04 50.04,30.02 50.04,30.02 50.02))',
                4326
              )
            ) AS geom
          )
          INSERT INTO city_boundaries (
            place_type,
            admin_level,
            osm_type,
            osm_id,
            osm_name,
            tags,
            geom,
            bounds,
            is_active,
            display_name,
            display_type,
            area_m2
          )
          SELECT
            'city',
            8,
            'relation',
            998000002,
            'Integration City',
            '{"name":"Integration City"}'::jsonb,
            geom,
            ST_Envelope(geom),
            TRUE,
            'Integration City',
            'city',
            ST_Area(geom::geography)
          FROM prepared
          RETURNING id::bigint AS id
        `,
      );

    childBoundaryId =
      Number(
        child.rows[0]
          .id,
      );

    await client.query(
      'SELECT rebuild_city_boundary_hierarchy()',
    );
    await client.query(
      'SELECT sync_active_boundary_cities()',
    );
    await client.query(
      'SELECT relink_all_city_geometries()',
    );
    await client.query(
      'COMMIT',
    );
  } catch (error) {
    await client.query(
      'ROLLBACK',
    ).catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const lineType =
    await pool.query(
      `
        SELECT id::bigint AS id
        FROM line_types
        ORDER BY id
        LIMIT 1
      `,
    );
  const lineTypeId =
    Number(
      lineType.rows[0]
        ?.id,
    );

  assert.ok(
    lineTypeId > 0,
    'Geometry integration requires one line type',
  );

  const editUser =
    await pool.query(
      `
        INSERT INTO admin_users (
          username,
          password_hash,
          can_edit_geometries
        )
        VALUES (
          $1,
          'integration-hash',
          TRUE
        )
        RETURNING id::bigint AS id
      `,
      [
        `geometry-integration-${process.pid}`,
      ],
    );
  const editUserId =
    Number(
      editUser.rows[0]
        .id,
    );

  const service =
    createGeometryEditorService(
      pool,
      {
        storage,
        leaseStorage,
        acquireLock:
          async () => {},
        randomUUID:
          (() => {
            let sequence = 0;
            return () =>
              `00000000-0000-4000-8000-${String(
                ++sequence,
              ).padStart(
                12,
                '0',
              )}`;
          })(),
        leaseSeconds: 90,
      },
    );

  const created =
    await service.sync(
      {
        items: [{
          kind: 'create',
          localId: 'integration-local-line',
          value: {
            geometry: {
              type: 'LineString',
              coordinates: [
                [
                  30.019,
                  50.03,
                ],
                [
                  30.039,
                  50.03,
                ],
              ],
            },
            lineTypeId,
            lanes: 1,
            displayName:
              'Integration nested line',
          },
        }],
      },
      {
        id: editUserId,
        username:
          'geometry-integration',
        isSuperuser: false,
      },
    );

  assert.equal(
    created.createdCount,
    1,
  );

  const geometry =
    created.created[0]
      .geometry;

  assert.equal(
    geometry.boundaryId,
    childBoundaryId,
    'Nested active city must beat the containing region for majority coverage',
  );

  const initialRevision =
    new Date(
      geometry.updatedAt,
    ).toISOString();

  const lease =
    await service.beginEdit(
      geometry.id,
      {
        id: editUserId,
        username:
          'geometry-integration',
        isSuperuser: false,
      },
      'integration-client',
    );

  assert.ok(
    lease?.token,
    'Explicit edit start did not issue a token',
  );

  const updated =
    await service.sync(
      {
        items: [{
          kind: 'update',
          id: geometry.id,
          baseUpdatedAt:
            initialRevision,
          editToken:
            lease.token,
          changes: {
            displayName:
              'Integration edited line',
          },
        }],
      },
      {
        id: editUserId,
        username:
          'geometry-integration',
        isSuperuser: false,
      },
    );

  assert.equal(
    updated.updatedCount,
    1,
  );
  assert.equal(
    updated.updated[0]
      .boundaryId,
    childBoundaryId,
  );

  const validated =
    await service
      .validateEditTokens(
        {
          items: [{
            id:
              geometry.id,
            token:
              lease.token,
          }],
        },
        {
          id:
            editUserId,
          username:
            'geometry-integration',
          isSuperuser:
            false,
        },
        'integration-client-reloaded',
      );

  assert.equal(
    validated.results[0]
      .status,
    'valid',
  );
  assert.equal(
    validated.results[0]
      .lease
      .clientId,
    'integration-client-reloaded',
  );

  const revisionBeforeAdministrativeRelink =
    new Date(
      updated.updated[0]
        .updatedAt,
    ).toISOString();

  const boundaryClient =
    await pool.connect();

  try {
    await boundaryClient.query(
      'BEGIN',
    );
    await boundaryClient.query(
      `
        UPDATE city_boundaries
        SET is_active = FALSE
        WHERE id = $1
      `,
      [childBoundaryId],
    );
    await boundaryClient.query(
      'SELECT relink_all_city_geometries()',
    );
    await boundaryClient.query(
      'COMMIT',
    );
  } catch (error) {
    await boundaryClient.query(
      'ROLLBACK',
    ).catch(() => {});
    throw error;
  } finally {
    boundaryClient.release();
  }

  const parentLinked =
    await storage.getGeometry(
      pool,
      geometry.id,
    );

  assert.equal(
    parentLinked.boundaryId,
    parentBoundaryId,
    'Deactivating the nested city must spatially fall back to the containing active region',
  );
  assert.equal(
    new Date(
      parentLinked.updatedAt,
    ).toISOString(),
    revisionBeforeAdministrativeRelink,
    'Administrative relinking changed the editable geometry revision',
  );

  const reactivateClient =
    await pool.connect();

  try {
    await reactivateClient.query(
      'BEGIN',
    );
    await reactivateClient.query(
      `
        UPDATE city_boundaries
        SET is_active = TRUE
        WHERE id = $1
      `,
      [childBoundaryId],
    );
    await reactivateClient.query(
      'SELECT relink_all_city_geometries()',
    );
    await reactivateClient.query(
      'COMMIT',
    );
  } catch (error) {
    await reactivateClient.query(
      'ROLLBACK',
    ).catch(() => {});
    throw error;
  } finally {
    reactivateClient.release();
  }

  const childLinkedAgain =
    await storage.getGeometry(
      pool,
      geometry.id,
    );

  assert.equal(
    childLinkedAgain.boundaryId,
    childBoundaryId,
    'Reactivated nested city did not regain the geometry',
  );

  const takeover =
    await service.forceTakeover(
      geometry.id,
      {
        id: editUserId,
        username:
          'geometry-integration',
        isSuperuser: true,
      },
      'integration-superuser-client',
    );

  assert.equal(
    takeover.previous
      ?.clientId,
    'integration-client-reloaded',
  );
  assert.ok(
    takeover.lease
      .generation >
      lease.generation,
    'Forced takeover did not advance the edit generation',
  );

  const revoked =
    await service
      .validateEditTokens(
        {
          items: [{
            id:
              geometry.id,
            token:
              lease.token,
          }],
        },
        {
          id:
            editUserId,
          username:
            'geometry-integration',
          isSuperuser:
            false,
        },
        'integration-old-client',
      );

  assert.equal(
    revoked.results[0]
      .status,
    'revoked',
    'Old token remained valid after forced takeover',
  );

  const splitRevision =
    new Date(
      childLinkedAgain
        .updatedAt,
    ).toISOString();

  const splitResult =
    await service.split(
      geometry.id,
      {
        blade: {
          type:
            'LineString',
          coordinates: [
            [
              30.029,
              50.01,
            ],
            [
              30.029,
              50.05,
            ],
          ],
        },
      },
      {
        expectedUpdatedAt:
          splitRevision,
        editToken:
          takeover.lease.token,
      },
      {
        id: editUserId,
        username:
          'geometry-integration',
        isSuperuser: true,
      },
    );

  assert.equal(
    splitResult
      .geometries
      .length,
    2,
    'Line split must create exactly two geometry records',
  );
  assert.equal(
    splitResult
      .sourceGeometryId,
    geometry.id,
  );
  assert.notEqual(
    splitResult
      .geometries[0]
      .id,
    splitResult
      .geometries[1]
      .id,
  );
  assert.deepEqual(
    splitResult
      .geometries
      .map(
        (item) =>
          item.boundaryId,
      ),
    [
      childBoundaryId,
      childBoundaryId,
    ],
    'Both split parts must be spatially relinked',
  );

  const unlinked =
    await service.sync(
      {
        items: [{
          kind: 'create',
          localId:
            'integration-local-point',
          value: {
            geometry: {
              type: 'Point',
              coordinates: [
                31,
                51,
              ],
            },
            displayName:
              'Integration unlinked point',
          },
        }],
      },
      {
        id: editUserId,
        username:
          'geometry-integration',
        isSuperuser: false,
      },
    );

  assert.equal(
    unlinked.created[0]
      .geometry
      .cityId,
    null,
  );
  assert.equal(
    unlinked.created[0]
      .geometry
      .boundaryId,
    null,
  );
}

async function main() {
  const connection =
    integrationConnection();

  const schema =
    temporarySchema();

  const admin =
    new Client(connection);

  let pool;

  console.log(
    `Integration database: ${connection.database}`,
  );

  console.log(
    `Integration schema: ${schema}`,
  );

  await admin.connect();

  try {
    const postgis =
      await verifyPostgis(
        admin,
      );

    console.log(
      `PostGIS: ${postgis}`,
    );

    const migrations =
      await loadMigrations(
        path.join(
          projectRoot,
          'db',
          'migrations',
        ),
      );

    await applyMigrations(
      admin,
      migrations,
      {
        schema,
      },
    );

    await verifyMigratedSchema(
      admin,
      schema,
      migrations.length,
    );

    pool =
      new Pool({
        ...connection,
        application_name:
          `${schema}:integration`,
        options:
          `-c search_path=${schema},public`,
        max: 3,
      });

    const repository =
      createProjectSettingsTransferRepository();

    await verifySettingsTransfer(
      pool,
      repository,
    );

    await verifyLineTypeStaging(
      pool,
      repository,
    );

    await verifySpatialExports(
      pool,
    );

    await verifyPointTypeIconMetadata(
      pool,
    );

    await verifyGeometryEditorInfrastructure(
      pool,
    );

    console.log(
      'PostgreSQL/PostGIS integration: PASS',
    );
  } finally {
    if (pool) {
      await pool.end()
        .catch(() => {});
    }

    await admin.query(
      `DROP SCHEMA IF EXISTS ${schema} CASCADE`,
    ).catch((error) => {
      console.error(
        `Failed to remove integration schema ${schema}: ${error.message}`,
      );
    });

    await admin.end()
      .catch(() => {});
  }
}

main().catch((error) => {
  console.error(
    'PostgreSQL/PostGIS integration: FAIL',
    error,
  );

  process.exitCode = 1;
});
