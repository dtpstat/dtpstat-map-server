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
  createCitiesRepository,
} from '../src/db/cities-repository.js';
import {
  createGeometryEditorStorage,
} from '../src/db/geometry-editor-storage.js';
import {
  createGeometryEditLeaseStorage,
} from '../src/db/geometry-edit-lease-storage.js';
import {
  createGeometryEditorService,
} from '../src/modules/geometry/editor-service.js';
import {
  configureDatabase,
  configureRole,
  configureRuntimePrivileges,
  configureSchemaOwnership,
} from './init-database.js';

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

  const polygonCreated =
    await service.sync(
      {
        items: [{
          kind:
            'create',
          localId:
            'integration-local-polygon',
          value: {
            geometry: {
              type:
                'Polygon',
              coordinates: [[
                [30.022, 50.022],
                [30.038, 50.022],
                [30.038, 50.038],
                [30.022, 50.038],
                [30.022, 50.022],
              ]],
            },
            displayName:
              'Integration polygon cutout',
          },
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
    );

  const polygon =
    polygonCreated
      .created[0]
      .geometry;

  assert.equal(
    polygon.boundaryId,
    childBoundaryId,
    'Cutout polygon must start inside the nested active city',
  );

  const polygonLease =
    await service.beginEdit(
      polygon.id,
      {
        id:
          editUserId,
        username:
          'geometry-integration',
        isSuperuser:
          false,
      },
      'integration-polygon-client',
    );

  const cutPreview =
    await service.previewCut({
      sourceGeometry:
        polygon.geometry,
      cutterGeometry: {
        type:
          'Polygon',
        coordinates: [[
          [30.027, 50.027],
          [30.033, 50.027],
          [30.033, 50.033],
          [30.027, 50.033],
          [30.027, 50.027],
        ]],
      },
    });

  const ringsBeforeCutSync =
    await pool.query(
      `
        SELECT
          COALESCE(
            SUM(
              ST_NumInteriorRings(
                part.geom
              )
            ),
            0
          )::integer AS "ringCount"
        FROM city_geometries
          AS geometry
        CROSS JOIN LATERAL ST_Dump(
          ST_CollectionExtract(
            geometry.geom,
            3
          )
        ) AS part
        WHERE geometry.id =
              $1::bigint
      `,
      [
        polygon.id,
      ],
    );

  assert.equal(
    Number(
      ringsBeforeCutSync
        .rows[0]
        ?.ringCount,
    ),
    0,
    'Cut preview mutated the persisted polygon before sync',
  );

  const cutSync =
    await service.sync(
      {
        items: [{
          kind:
            'update',
          id:
            polygon.id,
          baseUpdatedAt:
            new Date(
              polygon.updatedAt,
            ).toISOString(),
          editToken:
            polygonLease.token,
          changes: {
            geometry:
              cutPreview,
          },
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
    );

  const cutPolygon =
    cutSync.updated[0];

  assert.equal(
    cutPolygon.id,
    polygon.id,
  );
  assert.equal(
    cutPolygon.boundaryId,
    childBoundaryId,
  );

  const cutoutRings =
    await pool.query(
      `
        SELECT
          COALESCE(
            SUM(
              ST_NumInteriorRings(
                part.geom
              )
            ),
            0
          )::integer AS "ringCount"
        FROM city_geometries
          AS geometry
        CROSS JOIN LATERAL ST_Dump(
          ST_CollectionExtract(
            geometry.geom,
            3
          )
        ) AS part
        WHERE geometry.id =
              $1::bigint
      `,
      [
        polygon.id,
      ],
    );

  assert.equal(
    Number(
      cutoutRings
        .rows[0]
        ?.ringCount,
    ),
    1,
    'Interior polygon cut must persist exactly one polygon hole after sync',
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

    const relinkDiagnostics =
      await boundaryClient.query(
        `
          SELECT
            child.is_active
              AS "childActive",
            child.parent_id::bigint
              AS "childParentId",
            parent.is_active
              AS "parentActive",
            GeometryType(geometry.geom)
              AS "geometryType",
            ST_Intersects(
              parent.geom,
              geometry.geom
            ) AS "parentIntersects",
            GeometryType(
              ST_Intersection(
                parent.geom,
                geometry.geom
              )
            ) AS "intersectionType",
            ST_IsEmpty(
              ST_Intersection(
                parent.geom,
                geometry.geom
              )
            ) AS "intersectionEmpty",
            ST_Length(
              ST_CollectionExtract(
                ST_Intersection(
                  parent.geom,
                  geometry.geom
                ),
                2
              )::geography
            )::double precision
              AS "parentMatchedLength",
            resolved.boundary_id::bigint
              AS "resolvedBoundaryId",
            resolved.city_id::bigint
              AS "resolvedCityId"
          FROM city_geometries
            AS geometry
          JOIN city_boundaries
            AS child
            ON child.id =
               $2::bigint
          JOIN city_boundaries
            AS parent
            ON parent.id =
               $3::bigint
          LEFT JOIN LATERAL
            resolve_geometry_admin_links(
              geometry.geom
            ) AS resolved
            ON TRUE
          WHERE geometry.id =
                $1::bigint
        `,
        [
          geometry.id,
          childBoundaryId,
          parentBoundaryId,
        ],
      );

    const relinkDiagnostic =
      relinkDiagnostics.rows[0];

    assert.equal(
      Number(
        relinkDiagnostic
          ?.resolvedBoundaryId,
      ),
      parentBoundaryId,
      'Direct spatial resolver did not fall back to the active parent: ' +
        JSON.stringify(
          relinkDiagnostic,
        ),
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

  const pointTypesRepository =
    createPointTypesRepository(
      pool,
    );
  const publicCitiesRepository =
    createCitiesRepository(
      pool,
    );
  const publicPointType =
    await pointTypesRepository
      .create({
        name:
          'Integration public point ' +
          crypto
            .randomBytes(4)
            .toString('hex'),
      });

  const typedPointResult =
    await service.sync(
      {
        items: [{
          kind: 'create',
          localId:
            'integration-typed-point',
          value: {
            geometry: {
              type: 'Point',
              coordinates: [
                30.03,
                50.03,
              ],
            },
            pointTypeId:
              publicPointType.id,
            displayName:
              'Integration typed point',
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

  const typedPoint =
    typedPointResult
      .created[0]
      .geometry;

  assert.equal(
    typedPoint.pointTypeId,
    publicPointType.id,
  );
  assert.equal(
    typedPoint.boundaryId,
    childBoundaryId,
  );

  const publicViewport = {
    west: 30.02,
    south: 50.02,
    east: 30.04,
    north: 50.04,
    centerLng: 30.03,
    centerLat: 50.03,
  };

  const activePointFeed =
    await publicCitiesRepository
      .getViewportGeometries(
        publicViewport,
      );
  const activePointFeature =
    activePointFeed.features.find(
      (feature) =>
        Number(feature.id) ===
        Number(typedPoint.id),
    );

  assert.equal(
    activePointFeature
      ?.geometry
      ?.type,
    'Point',
  );
  assert.equal(
    Number(
      activePointFeature
        ?.properties
        ?.pointTypeId,
    ),
    publicPointType.id,
  );

  await pointTypesRepository
    .update(
      publicPointType.id,
      {
        isActive: false,
      },
    );

  const inactivePointFeed =
    await publicCitiesRepository
      .getViewportGeometries(
        publicViewport,
      );

  assert.equal(
    inactivePointFeed.features.some(
      (feature) =>
        Number(feature.id) ===
        Number(typedPoint.id),
    ),
    false,
    'Inactive point type remained visible in the public viewport',
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
  const splitBlade = {
    type:
      'LineString',
    coordinates: [
      [
        30.029,
        50.01,
      ],
      [
        30.029,
        50.02,
      ],
    ],
  };

  const countBeforeSplitPreview =
    await pool.query(
      'SELECT COUNT(*)::integer AS count FROM city_geometries',
    );

  const splitPreview =
    await service.previewSplit({
      sourceGeometry:
        childLinkedAgain
          .geometry,
      blade:
        splitBlade,
    });

  assert.equal(
    splitPreview.length,
    2,
    'Line split preview must return exactly two geometry parts',
  );

  const countAfterSplitPreview =
    await pool.query(
      'SELECT COUNT(*)::integer AS count FROM city_geometries',
    );

  assert.equal(
    countAfterSplitPreview
      .rows[0]
      .count,
    countBeforeSplitPreview
      .rows[0]
      .count,
    'Split preview inserted a geometry before sync',
  );

  const persistedBeforeSplitSync =
    await storage.getGeometry(
      pool,
      geometry.id,
    );

  assert.deepEqual(
    persistedBeforeSplitSync
      .geometry,
    childLinkedAgain
      .geometry,
    'Split preview changed the persisted source geometry before sync',
  );

  const splitSync =
    await service.sync(
      {
        items: [
          {
            kind:
              'update',
            id:
              geometry.id,
            baseUpdatedAt:
              splitRevision,
            editToken:
              takeover.lease.token,
            changes: {
              geometry:
                splitPreview[0],
            },
          },
          {
            kind:
              'create',
            localId:
              'integration-split-part-2',
            sourceGeometryId:
              geometry.id,
            value: {
              geometry:
                splitPreview[1],
              displayName:
                childLinkedAgain
                  .displayName,
              tooltip:
                childLinkedAgain
                  .tooltip,
              tags:
                childLinkedAgain
                  .tags,
              isVisible:
                childLinkedAgain
                  .isVisible,
              lineTypeId:
                childLinkedAgain
                  .lineTypeId,
              lanes:
                childLinkedAgain
                  .lanes,
            },
          },
        ],
      },
      {
        id:
          editUserId,
        username:
          'geometry-integration',
        isSuperuser:
          true,
      },
    );

  const splitResult = {
    sourceGeometryId:
      geometry.id,
    geometries: [
      splitSync.updated
        .find(
          (item) =>
            item.id ===
            geometry.id,
        ),
      splitSync.created[0]
        .geometry,
    ],
  };

  assert.equal(
    splitResult
      .geometries
      .length,
    2,
    'Atomic split sync must persist exactly two geometry records',
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

  const countAfterSplitSync =
    await pool.query(
      'SELECT COUNT(*)::integer AS count FROM city_geometries',
    );

  assert.equal(
    countAfterSplitSync
      .rows[0]
      .count,
    countBeforeSplitPreview
      .rows[0]
      .count + 1,
    'Atomic split sync did not create exactly one companion geometry',
  );

  const splitRelinkDiagnostics =
    await pool.query(
      `
        SELECT
          geometry.id::bigint AS "geometryId",
          geometry.boundary_id::bigint AS "linkedBoundaryId",
          GeometryType(geometry.geom)
            AS "geometryType",
          ST_AsText(geometry.geom)
            AS wkt,
          ST_Intersects(
            child.geom,
            geometry.geom
          ) AS "childIntersects",
          ST_Covers(
            child.geom,
            geometry.geom
          ) AS "childCovers",
          ST_Length(
            ST_CollectionExtract(
              ST_Intersection(
                child.geom,
                geometry.geom
              ),
              2
            )::geography
          )::double precision
            AS "childRawLength",
          ST_IsEmpty(
            ST_Intersection(
              child.geom,
              geometry.geom
            )
          ) AS "childRawEmpty",
          ST_Length(
            ST_CollectionExtract(
              ST_Intersection(
                ST_ReducePrecision(
                  child.geom,
                  0.000000001
                ),
                ST_ReducePrecision(
                  geometry.geom,
                  0.000000001
                )
              ),
              2
            )::geography
          )::double precision
            AS "childReducedLength",
          ST_IsEmpty(
            ST_Intersection(
              ST_ReducePrecision(
                child.geom,
                0.000000001
              ),
              ST_ReducePrecision(
                geometry.geom,
                0.000000001
              )
            )
          ) AS "childReducedEmpty",
          ST_Length(
            geometry.geom::geography
          )::double precision
            AS "totalLength",
          resolved.boundary_id::bigint
            AS "resolvedBoundaryId"
        FROM city_geometries
          AS geometry
        JOIN city_boundaries
          AS child
          ON child.id =
             $2::bigint
        LEFT JOIN LATERAL
          resolve_geometry_admin_links(
            geometry.geom
          ) AS resolved
          ON TRUE
        WHERE geometry.id =
              ANY($1::bigint[])
        ORDER BY geometry.id
      `,
      [
        splitResult
          .geometries
          .map(
            (item) =>
              item.id,
          ),
        childBoundaryId,
      ],
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
    'Both split parts must be spatially relinked: ' +
      JSON.stringify(
        splitRelinkDiagnostics
          .rows,
      ),
  );

  const unionCountBeforePreview =
    await pool.query(
      'SELECT COUNT(*)::integer AS count FROM city_geometries',
    );

  const unionPreview =
    await service.previewUnion({
      geometries:
        splitResult
          .geometries
          .map(
            (item) =>
              item.geometry,
          ),
    });

  assert.equal(
    unionPreview.type,
    'LineString',
    'Union of contiguous split parts must normalize to LineString',
  );

  const unionCountAfterPreview =
    await pool.query(
      'SELECT COUNT(*)::integer AS count FROM city_geometries',
    );

  assert.equal(
    unionCountAfterPreview
      .rows[0]
      .count,
    unionCountBeforePreview
      .rows[0]
      .count,
    'Union preview mutated persisted rows',
  );

  const companion =
    splitResult
      .geometries[1];
  const companionLease =
    await service.beginEdit(
      companion.id,
      {
        id:
          editUserId,
        username:
          'geometry-integration',
        isSuperuser:
          true,
      },
      'integration-union-companion',
    );

  const unionSync =
    await service.sync(
      {
        items: [
          {
            kind:
              'update',
            id:
              splitResult
                .geometries[0]
                .id,
            baseUpdatedAt:
              new Date(
                splitResult
                  .geometries[0]
                  .updatedAt,
              ).toISOString(),
            editToken:
              takeover.lease.token,
            changes: {
              geometry:
                unionPreview,
            },
          },
          {
            kind:
              'delete',
            id:
              companion.id,
            baseUpdatedAt:
              new Date(
                companion.updatedAt,
              ).toISOString(),
            editToken:
              companionLease.token,
          },
        ],
      },
      {
        id:
          editUserId,
        username:
          'geometry-integration',
        isSuperuser:
          true,
      },
    );

  assert.equal(
    unionSync.updated[0]
      .geometry
      .type,
    'LineString',
    'Persisted union result must remain LineString',
  );
  assert.equal(
    unionSync.deleted.length,
    1,
    'Union sync must delete exactly one absorbed server geometry',
  );

  const mergedLinePointNormalization =
    await pool.query(
      `
        SELECT
          ST_NPoints(geom)::integer
            AS "pointCount",
          ST_NPoints(
            ST_RemoveRepeatedPoints(
              geom,
              0.0
            )
          )::integer
            AS "normalizedPointCount"
        FROM city_geometries
        WHERE id = $1::bigint
      `,
      [
        splitResult
          .geometries[0]
          .id,
      ],
    );

  assert.equal(
    mergedLinePointNormalization
      .rows[0]
      .pointCount,
    mergedLinePointNormalization
      .rows[0]
      .normalizedPointCount,
    'Unioned line must not retain consecutive duplicate points',
  );

  const countAfterUnionSync =
    await pool.query(
      'SELECT COUNT(*)::integer AS count FROM city_geometries',
    );

  assert.equal(
    countAfterUnionSync
      .rows[0]
      .count,
    countBeforeSplitPreview
      .rows[0]
      .count,
    'Union sync must remove the companion split geometry',
  );

  await service.releaseEdit(
    splitResult
      .geometries[0]
      .id,
    takeover.lease.token,
    {
      id:
        editUserId,
      username:
        'geometry-integration',
      isSuperuser:
        true,
    },
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

async function assertPermissionDenied(
  operation,
  label,
) {
  let failure = null;

  try {
    await operation();
  } catch (error) {
    failure = error;
  }

  assert.ok(
    failure,
    `${label} unexpectedly succeeded`,
  );
  assert.equal(
    failure.code,
    '42501',
    `${label} failed for an unexpected reason: ${failure.message}`,
  );
}

async function dropTemporaryDatabase(
  admin,
  database,
) {
  await admin.query(
    `
      SELECT
        pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE
        datname = $1::text
        AND pid <> pg_backend_pid()
    `,
    [database],
  );

  const statement =
    await admin.query(
      "SELECT format('DROP DATABASE IF EXISTS %I', $1::text) AS sql",
      [database],
    );

  await admin.query(
    statement.rows[0]
      .sql,
  );
}

async function dropTemporaryRole(
  admin,
  role,
) {
  const statement =
    await admin.query(
      "SELECT format('DROP ROLE IF EXISTS %I', $1::text) AS sql",
      [role],
    );

  await admin.query(
    statement.rows[0]
      .sql,
  );
}

async function verifyDatabasePrivilegeIsolation() {
  const suffix =
    crypto
      .randomBytes(5)
      .toString('hex');
  const database =
    `dtp_it_priv_${process.pid}_${suffix}`;
  const migrationRole =
    `dtp_it_mig_${process.pid}_${suffix}`;
  const runtimeRole =
    `dtp_it_app_${process.pid}_${suffix}`;
  const schema =
    'dtpstat_privileges';
  const migrationPassword =
    crypto
      .randomBytes(24)
      .toString('base64url');
  const runtimePassword =
    crypto
      .randomBytes(24)
      .toString('base64url');
  const adminConnection =
    loadAdminDatabaseConnection();
  const admin =
    new Client(
      adminConnection,
    );

  let databaseAdmin = null;
  let migrationClient = null;
  let runtimeClient = null;

  await admin.connect();

  try {
    await configureRole(
      admin,
      migrationRole,
      migrationPassword,
    );
    await configureRole(
      admin,
      runtimeRole,
      runtimePassword,
    );
    await configureDatabase(
      admin,
      database,
      migrationRole,
    );

    databaseAdmin =
      new Client({
        ...adminConnection,
        database,
        application_name:
          `${schema}:privilege-admin`,
      });
    await databaseAdmin.connect();

    await configureSchemaOwnership(
      databaseAdmin,
      schema,
      migrationRole,
    );
    await configureRuntimePrivileges(
      databaseAdmin,
      {
        database,
        schema,
        ownerRole:
          migrationRole,
        runtimeRole,
      },
    );

    migrationClient =
      new Client({
        ...adminConnection,
        database,
        user:
          migrationRole,
        password:
          migrationPassword,
        application_name:
          `${schema}:privilege-migration`,
        options:
          `-c search_path=${schema},public`,
      });
    await migrationClient.connect();

    await migrationClient.query(`
      CREATE TABLE privilege_probe (
        id bigint
          GENERATED BY DEFAULT AS IDENTITY
          PRIMARY KEY,
        value text NOT NULL
      )
    `);

    await migrationClient.query(`
      CREATE FUNCTION privilege_echo(
        input_value text
      )
      RETURNS text
      LANGUAGE SQL
      IMMUTABLE
      AS $function$
        SELECT input_value
      $function$
    `);

    runtimeClient =
      new Client({
        ...adminConnection,
        database,
        user:
          runtimeRole,
        password:
          runtimePassword,
        application_name:
          `${schema}:privilege-runtime`,
        options:
          `-c search_path=${schema},public`,
      });
    await runtimeClient.connect();

    const identity =
      await runtimeClient.query(
        `
          SELECT
            current_user AS role,
            has_schema_privilege(
              current_user,
              $1::text,
              'USAGE'
            ) AS schema_usage,
            has_schema_privilege(
              current_user,
              $1::text,
              'CREATE'
            ) AS schema_create,
            pg_has_role(
              current_user,
              $2::text,
              'MEMBER'
            ) AS migration_member
        `,
        [
          schema,
          migrationRole,
        ],
      );

    assert.equal(
      identity.rows[0]
        .role,
      runtimeRole,
    );
    assert.equal(
      identity.rows[0]
        .schema_usage,
      true,
    );
    assert.equal(
      identity.rows[0]
        .schema_create,
      false,
    );
    assert.equal(
      identity.rows[0]
        .migration_member,
      false,
    );

    const inserted =
      await runtimeClient.query(
        `
          INSERT INTO privilege_probe (
            value
          )
          VALUES ($1::text)
          RETURNING
            id::bigint AS id,
            value
        `,
        ['runtime-write'],
      );

    assert.ok(
      Number(
        inserted.rows[0]
          .id,
      ) > 0,
      'Runtime role could not use the identity sequence',
    );

    await runtimeClient.query(
      `
        UPDATE privilege_probe
        SET value = $2::text
        WHERE id = $1::bigint
      `,
      [
        inserted.rows[0]
          .id,
        'runtime-updated',
      ],
    );

    const selected =
      await runtimeClient.query(
        `
          SELECT
            value,
            privilege_echo(value)
              AS echoed
          FROM privilege_probe
          WHERE id = $1::bigint
        `,
        [
          inserted.rows[0]
            .id,
        ],
      );

    assert.deepEqual(
      selected.rows[0],
      {
        value:
          'runtime-updated',
        echoed:
          'runtime-updated',
      },
    );

    await runtimeClient.query(
      'CREATE TEMP TABLE privilege_temp (id integer)',
    );

    await runtimeClient.query(
      `
        DELETE FROM privilege_probe
        WHERE id = $1::bigint
      `,
      [
        inserted.rows[0]
          .id,
      ],
    );

    await assertPermissionDenied(
      () =>
        runtimeClient.query(
          `
            CREATE TABLE ${schema}.runtime_owned (
              id integer
            )
          `,
        ),
      'Runtime CREATE in application schema',
    );

    await assertPermissionDenied(
      () =>
        runtimeClient.query(
          `
            CREATE TABLE public.runtime_owned (
              id integer
            )
          `,
        ),
      'Runtime CREATE in public schema',
    );

    await assertPermissionDenied(
      () =>
        runtimeClient.query(
          `
            ALTER TABLE privilege_probe
            ADD COLUMN forbidden integer
          `,
        ),
      'Runtime ALTER TABLE',
    );

    await assertPermissionDenied(
      () =>
        runtimeClient.query(
          'DROP TABLE privilege_probe',
        ),
      'Runtime DROP TABLE',
    );

    await assertPermissionDenied(
      () =>
        runtimeClient.query(
          `SET ROLE ${migrationRole}`,
        ),
      'Runtime SET ROLE migration owner',
    );
  } finally {
    for (
      const client of [
        runtimeClient,
        migrationClient,
        databaseAdmin,
      ]
    ) {
      if (client) {
        await client.end()
          .catch(() => {});
      }
    }

    await dropTemporaryDatabase(
      admin,
      database,
    ).catch((error) => {
      console.error(
        `Failed to remove privilege integration database ${database}: ${error.message}`,
      );
    });

    for (
      const role of [
        runtimeRole,
        migrationRole,
      ]
    ) {
      await dropTemporaryRole(
        admin,
        role,
      ).catch((error) => {
        console.error(
          `Failed to remove privilege integration role ${role}: ${error.message}`,
        );
      });
    }

    await admin.end()
      .catch(() => {});
  }
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

    await verifyDatabasePrivilegeIsolation();

    console.log(
      'Database privilege isolation: PASS',
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
