import 'dotenv/config';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  databaseApplicationName,
  databaseSearchPath,
  loadAdminDatabaseConnection,
  loadApplicationDatabaseConnection,
  loadDatabaseSchema,
} from '../src/db/database-environment.js';

const { Client } = pg;
const scriptPath = fileURLToPath(import.meta.url);

function validateIdentifier(value, label) {
  if (value.includes('\0') || Buffer.byteLength(value, 'utf8') > 63) {
    throw new Error(`${label} must be a valid PostgreSQL identifier up to 63 bytes`);
  }
}

export async function configureRole(client, role, password) {
  const existing = await client.query(
    'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists',
    [role],
  );

  await client.query(
    `SELECT
       set_config('dtpstat.role_name', $1, false),
       set_config('dtpstat.role_password', $2, false)`,
    [role, password],
  );

  if (existing.rows[0].exists) {
    await client.query(`
      DO $block$
      BEGIN
        EXECUTE format(
          'ALTER ROLE %I WITH LOGIN PASSWORD %L',
          current_setting('dtpstat.role_name'),
          current_setting('dtpstat.role_password')
        );
      END
      $block$
    `);
    return 'updated';
  }

  await client.query(`
    DO $block$
    BEGIN
      EXECUTE format(
        'CREATE ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
        current_setting('dtpstat.role_name'),
        current_setting('dtpstat.role_password')
      );
    END
    $block$
  `);
  return 'created';
}

export async function configureDatabase(client, database, role) {
  const existing = await client.query(
    `SELECT roles.rolname AS owner
     FROM pg_database AS databases
     JOIN pg_roles AS roles ON roles.oid = databases.datdba
     WHERE databases.datname = $1`,
    [database],
  );

  if (existing.rows.length > 0) {
    if (existing.rows[0].owner === role) {
      return 'exists';
    }

    const statement = await client.query(
      "SELECT format('ALTER DATABASE %I OWNER TO %I', $1::text, $2::text) AS sql",
      [database, role],
    );
    await client.query(statement.rows[0].sql);
    return 'ownership-updated';
  }

  const statement = await client.query(
    `SELECT format(
       'CREATE DATABASE %I WITH OWNER %I ENCODING %L TEMPLATE template0',
       $1::text,
       $2::text,
       'UTF8'
     ) AS sql`,
    [database, role],
  );
  await client.query(statement.rows[0].sql);
  return 'created';
}

const USER_SCHEMA_FILTER = `
  namespace.nspname <> 'information_schema'
  AND namespace.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
`;

/**
 * Transfers every non-system, non-extension-owned object to the application
 * role. PostGIS objects remain owned by the extension owner so extension
 * upgrades continue to work.
 */
export async function transferObjectOwnership(client, role) {
  const result = await client.query(
    `
      SELECT ownership.sql
      FROM (
        SELECT 10 AS priority,
               namespace.oid AS object_oid,
               format(
                 'ALTER SCHEMA %I OWNER TO %I',
                 namespace.nspname,
                 $1::text
               ) AS sql
        FROM pg_namespace AS namespace
        WHERE ${USER_SCHEMA_FILTER}

        UNION ALL

        SELECT 20 AS priority,
               type.oid AS object_oid,
               format(
                 CASE WHEN type.typtype = 'd'
                   THEN 'ALTER DOMAIN %I.%I OWNER TO %I'
                   ELSE 'ALTER TYPE %I.%I OWNER TO %I'
                 END,
                 namespace.nspname,
                 type.typname,
                 $1::text
               ) AS sql
        FROM pg_type AS type
        JOIN pg_namespace AS namespace
          ON namespace.oid = type.typnamespace
        LEFT JOIN pg_class AS relation
          ON relation.oid = type.typrelid
        WHERE ${USER_SCHEMA_FILTER}
          AND (
            type.typtype IN ('d', 'e', 'r', 'm')
            OR (type.typtype = 'c' AND relation.relkind = 'c')
            OR (type.typtype = 'b' AND type.typelem = 0)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_depend AS dependency
            WHERE dependency.classid = 'pg_type'::regclass
              AND dependency.objid = type.oid
              AND dependency.deptype = 'e'
          )

        UNION ALL

        SELECT 30 AS priority,
               relation.oid AS object_oid,
               format(
                 CASE relation.relkind
                   WHEN 'S' THEN 'ALTER SEQUENCE %I.%I OWNER TO %I'
                   WHEN 'v' THEN 'ALTER VIEW %I.%I OWNER TO %I'
                   WHEN 'm' THEN 'ALTER MATERIALIZED VIEW %I.%I OWNER TO %I'
                   WHEN 'f' THEN 'ALTER FOREIGN TABLE %I.%I OWNER TO %I'
                   ELSE 'ALTER TABLE %I.%I OWNER TO %I'
                 END,
                 namespace.nspname,
                 relation.relname,
                 $1::text
               ) AS sql
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
        WHERE ${USER_SCHEMA_FILTER}
          AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
          AND (
            relation.relkind <> 'S'
            OR NOT EXISTS (
              SELECT 1
              FROM pg_depend AS ownership_dependency
              WHERE ownership_dependency.classid = 'pg_class'::regclass
                AND ownership_dependency.objid = relation.oid
                AND ownership_dependency.refclassid = 'pg_class'::regclass
                AND ownership_dependency.deptype IN ('a', 'i')
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_depend AS dependency
            WHERE dependency.classid = 'pg_class'::regclass
              AND dependency.objid = relation.oid
              AND dependency.deptype = 'e'
          )

        UNION ALL

        SELECT 40 AS priority,
               routine.oid AS object_oid,
               format(
                 'ALTER ROUTINE %I.%I(%s) OWNER TO %I',
                 namespace.nspname,
                 routine.proname,
                 pg_get_function_identity_arguments(routine.oid),
                 $1::text
               ) AS sql
        FROM pg_proc AS routine
        JOIN pg_namespace AS namespace
          ON namespace.oid = routine.pronamespace
        WHERE ${USER_SCHEMA_FILTER}
          AND NOT EXISTS (
            SELECT 1
            FROM pg_depend AS dependency
            WHERE dependency.classid = 'pg_proc'::regclass
              AND dependency.objid = routine.oid
              AND dependency.deptype = 'e'
          )
      ) AS ownership
      ORDER BY ownership.priority, ownership.object_oid
    `,
    [role],
  );

  for (const row of result.rows) {
    await client.query(row.sql);
  }
  return result.rows.length;
}

async function normalizeDatabaseOwnership(
  adminConnection,
  applicationConnection,
  schema,
) {
  const client = new Client({
    ...adminConnection,
    database: applicationConnection.database,
    application_name: databaseApplicationName(schema, 'ownership-init'),
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    const count = await transferObjectOwnership(
      client,
      applicationConnection.user,
    );
    await client.query('COMMIT');
    return count;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function installPostgis(adminConnection, applicationConnection, schema) {
  const client = new Client({
    ...adminConnection,
    database: applicationConnection.database,
    application_name: databaseApplicationName(schema, 'initializer'),
  });
  await client.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS POSTGIS WITH SCHEMA PUBLIC');
    const grant = await client.query(
      "SELECT format('GRANT USAGE ON SCHEMA public TO %I', $1::text) AS sql",
      [applicationConnection.user],
    );
    await client.query(grant.rows[0].sql);
  } finally {
    await client.end();
  }
}

async function verifyApplicationConnection(applicationConnection, schema) {
  const client = new Client({
    ...applicationConnection,
    application_name: databaseApplicationName(schema, 'initializer-check'),
    options: databaseSearchPath(schema),
  });
  await client.connect();
  try {
    const result = await client.query(
      'SELECT current_user AS role, current_database() AS database, PostGIS_Version() AS postgis',
    );
    return result.rows[0];
  } finally {
    await client.end();
  }
}

async function main() {
  const adminConnection = loadAdminDatabaseConnection();
  const applicationConnection = loadApplicationDatabaseConnection();
  const schema = loadDatabaseSchema();
  validateIdentifier(applicationConnection.user, 'DATABASE_ROLE');
  validateIdentifier(applicationConnection.database, 'DATABASE_NAME');
  if (applicationConnection.user === adminConnection.user) {
    throw new Error('DATABASE_ROLE must not be postgres');
  }
  if (applicationConnection.database === adminConnection.database) {
    throw new Error('DATABASE_NAME must differ from POSTGRES_ADMIN_DATABASE');
  }

  const admin = new Client({
    ...adminConnection,
    application_name: databaseApplicationName(schema, 'initializer-admin'),
  });
  await admin.connect();
  let roleStatus;
  let databaseStatus;
  try {
    roleStatus = await configureRole(
      admin,
      applicationConnection.user,
      applicationConnection.password,
    );
    databaseStatus = await configureDatabase(
      admin,
      applicationConnection.database,
      applicationConnection.user,
    );
  } finally {
    await admin.end();
  }

  await installPostgis(adminConnection, applicationConnection, schema);
  const transferredObjects = await normalizeDatabaseOwnership(
    adminConnection,
    applicationConnection,
    schema,
  );
  const verification = await verifyApplicationConnection(
    applicationConnection,
    schema,
  );
  console.log(
    `Database initialization complete: role ${roleStatus}, ` +
      `database ${databaseStatus}, schema ${schema}, ` +
      `PostGIS ${verification.postgis}; ` +
      `${transferredObjects} object owners normalized; ` +
      `verified as ${verification.role}.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error('Database initialization failed', error);
    process.exitCode = 1;
  });
}
