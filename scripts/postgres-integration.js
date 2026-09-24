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
  normalizeDatabaseSchema,
} from '../src/db/database-environment.js';
import {
  applyMigrations,
  loadMigrations,
} from '../src/db/migration-runner.js';
import {
  createProjectSettingsTransferRepository,
} from '../src/db/project-settings-transfer-repository.js';

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

function localHost(hostname) {
  return [
    '127.0.0.1',
    'localhost',
    '::1',
  ].includes(hostname);
}

function integerPort(
  value,
  fallback,
) {
  const port =
    value === undefined ||
    value === ''
      ? fallback
      : Number(value);

  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(
      'Integration database port is invalid',
    );
  }

  return port;
}

function integrationConfiguration() {
  const explicit =
    process.env
      .DTPSTAT_INTEGRATION_DATABASE_URL
      ?.trim();

  if (explicit) {
    const parsed =
      new URL(explicit);

    if (
      !localHost(parsed.hostname) &&
      process.env
        .DTPSTAT_INTEGRATION_ALLOW_REMOTE !==
        '1'
    ) {
      throw new Error(
        'Remote integration database is disabled by default; set DTPSTAT_INTEGRATION_ALLOW_REMOTE=1 only for a dedicated test database',
      );
    }

    return {
      mode: 'explicit',
      connection: {
        connectionString:
          explicit,
      },
    };
  }

  if (
    process.env
      .DTPSTAT_INTEGRATION_USE_COMPOSE !==
    '1'
  ) {
    throw new Error(
      'Set DTPSTAT_INTEGRATION_USE_COMPOSE=1 for local compose PostgreSQL or provide DTPSTAT_INTEGRATION_DATABASE_URL',
    );
  }

  const password =
    process.env
      .POSTGRES_ADMIN_PASSWORD;

  if (
    !password ||
    !password.trim()
  ) {
    throw new Error(
      'POSTGRES_ADMIN_PASSWORD is required for compose integration testing',
    );
  }

  return {
    mode: 'compose',
    adminConnection: {
      host: '127.0.0.1',
      port:
        integerPort(
          process.env
            .DATABASE_PORT,
          5432,
        ),
      database: 'postgres',
      user: 'postgres',
      password,
      ssl: false,
    },
  };
}

function temporaryDatabase() {
  return normalizeDatabaseSchema(
    `dtpstat_it_db_${process.pid}_${crypto
      .randomBytes(4)
      .toString('hex')}`,
  );
}

function temporarySchema() {
  return normalizeDatabaseSchema(
    `dtpstat_it_${process.pid}_${crypto
      .randomBytes(5)
      .toString('hex')}`,
  );
}

async function createComposeDatabase(
  admin,
  database,
) {
  await admin.query(
    `CREATE DATABASE ${database}`,
  );
}

async function dropComposeDatabase(
  admin,
  database,
) {
  await admin.query(
    `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`,
  );
}

async function installPostgis(
  connection,
) {
  const client =
    new Client(connection);

  await client.connect();

  try {
    await client.query(
      'CREATE EXTENSION IF NOT EXISTS POSTGIS WITH SCHEMA PUBLIC',
    );
  } finally {
    await client.end();
  }
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

async function main() {
  const configuration =
    integrationConfiguration();

  const schema =
    temporarySchema();

  let connection;
  let composeAdmin;
  let composeAdminConnected =
    false;
  let composeDatabase;
  let admin;
  let adminConnected = false;
  let pool;

  try {
    if (
      configuration.mode ===
      'compose'
    ) {
      composeDatabase =
        temporaryDatabase();

      composeAdmin =
        new Client(
          configuration
            .adminConnection,
        );

      await composeAdmin.connect();
      composeAdminConnected = true;

      await createComposeDatabase(
        composeAdmin,
        composeDatabase,
      );

      connection = {
        ...configuration
          .adminConnection,
        database:
          composeDatabase,
      };

      await installPostgis(
        connection,
      );

      console.log(
        `Integration database: ${composeDatabase}`,
      );
    } else {
      connection =
        configuration.connection;
    }

    admin =
      new Client(connection);

    console.log(
      `Integration schema: ${schema}`,
    );

    await admin.connect();
    adminConnected = true;

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

    console.log(
      'PostgreSQL/PostGIS integration: PASS',
    );
  } finally {
    if (pool) {
      await pool.end()
        .catch(() => {});
    }

    if (
      admin &&
      adminConnected
    ) {
      await admin.query(
        `DROP SCHEMA IF EXISTS ${schema} CASCADE`,
      ).catch((error) => {
        console.error(
          `Failed to remove integration schema ${schema}: ${error.message}`,
        );
      });
    }

    if (admin) {
      await admin.end()
        .catch(() => {});
    }

    if (
      composeAdmin &&
      composeAdminConnected &&
      composeDatabase
    ) {
      await dropComposeDatabase(
        composeAdmin,
        composeDatabase,
      ).catch((error) => {
        console.error(
          `Failed to remove integration database ${composeDatabase}: ${error.message}`,
        );
      });
    }

    if (composeAdmin) {
      await composeAdmin.end()
        .catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(
    'PostgreSQL/PostGIS integration: FAIL',
    error,
  );

  process.exitCode = 1;
});
