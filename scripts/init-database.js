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
  loadMigrationDatabaseConnection,
} from '../src/db/database-environment.js';

const { Client } = pg;
const scriptPath =
  fileURLToPath(
    import.meta.url,
  );

function validateIdentifier(
  value,
  label,
) {
  if (
    value.includes('\0') ||
    Buffer.byteLength(
      value,
      'utf8',
    ) > 63
  ) {
    throw new Error(
      `${label} must be a valid PostgreSQL identifier up to 63 bytes`,
    );
  }
}

export async function configureRole(
  client,
  role,
  password,
) {
  const existing =
    await client.query(
      'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists',
      [role],
    );

  await client.query(
    `SELECT
       set_config('dtpstat.role_name', $1, false),
       set_config('dtpstat.role_password', $2, false)`,
    [
      role,
      password,
    ],
  );

  if (
    existing.rows[0]
      .exists
  ) {
    await client.query(`
      DO $block$
      BEGIN
        EXECUTE format(
          'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
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
        'CREATE ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
        current_setting('dtpstat.role_name'),
        current_setting('dtpstat.role_password')
      );
    END
    $block$
  `);
  return 'created';
}

export async function configureDatabase(
  client,
  database,
  ownerRole,
) {
  const existing =
    await client.query(
      `SELECT roles.rolname AS owner
       FROM pg_database AS databases
       JOIN pg_roles AS roles
         ON roles.oid = databases.datdba
       WHERE databases.datname = $1`,
      [database],
    );

  if (
    existing.rows.length >
    0
  ) {
    if (
      existing.rows[0]
        .owner ===
      ownerRole
    ) {
      return 'exists';
    }

    const statement =
      await client.query(
        "SELECT format('ALTER DATABASE %I OWNER TO %I', $1::text, $2::text) AS sql",
        [
          database,
          ownerRole,
        ],
      );
    await client.query(
      statement.rows[0]
        .sql,
    );
    return 'ownership-updated';
  }

  const statement =
    await client.query(
      `SELECT format(
         'CREATE DATABASE %I WITH OWNER %I ENCODING %L TEMPLATE template0',
         $1::text,
         $2::text,
         'UTF8'
       ) AS sql`,
      [
        database,
        ownerRole,
      ],
    );
  await client.query(
    statement.rows[0]
      .sql,
  );
  return 'created';
}

export async function configureSchemaOwnership(
  client,
  schema,
  ownerRole,
) {
  await client.query(
    `SELECT
       set_config('dtpstat.schema_name', $1, false),
       set_config('dtpstat.owner_role', $2, false)`,
    [
      schema,
      ownerRole,
    ],
  );

  await client.query(`
    DO $block$
    BEGIN
      EXECUTE format(
        'CREATE SCHEMA IF NOT EXISTS %I AUTHORIZATION %I',
        current_setting('dtpstat.schema_name'),
        current_setting('dtpstat.owner_role')
      );
      EXECUTE format(
        'ALTER SCHEMA %I OWNER TO %I',
        current_setting('dtpstat.schema_name'),
        current_setting('dtpstat.owner_role')
      );
    END
    $block$
  `);
}

/**
 * Transfer existing application-schema objects to the migration/owner role.
 * PostGIS extension objects in public are deliberately outside this scope.
 */
export async function transferObjectOwnership(
  client,
  role,
  schema,
) {
  const result =
    await client.query(
      `
        SELECT ownership.sql
        FROM (
          SELECT
            20 AS priority,
            type.oid AS object_oid,
            format(
              CASE
                WHEN type.typtype = 'd'
                  THEN 'ALTER DOMAIN %I.%I OWNER TO %I'
                ELSE 'ALTER TYPE %I.%I OWNER TO %I'
              END,
              namespace.nspname,
              type.typname,
              $1::text
            ) AS sql
          FROM pg_type AS type
          JOIN pg_namespace AS namespace
            ON namespace.oid =
               type.typnamespace
          LEFT JOIN pg_class AS relation
            ON relation.oid =
               type.typrelid
          WHERE
            namespace.nspname =
              $2::text
            AND (
              type.typtype IN (
                'd',
                'e',
                'r',
                'm'
              )
              OR (
                type.typtype =
                  'c'
                AND relation.relkind =
                  'c'
              )
              OR (
                type.typtype =
                  'b'
                AND type.typelem =
                  0
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM pg_depend AS dependency
              WHERE
                dependency.classid =
                  'pg_type'::regclass
                AND dependency.objid =
                  type.oid
                AND dependency.deptype =
                  'e'
            )

          UNION ALL

          SELECT
            30 AS priority,
            relation.oid AS object_oid,
            format(
              CASE relation.relkind
                WHEN 'S'
                  THEN 'ALTER SEQUENCE %I.%I OWNER TO %I'
                WHEN 'v'
                  THEN 'ALTER VIEW %I.%I OWNER TO %I'
                WHEN 'm'
                  THEN 'ALTER MATERIALIZED VIEW %I.%I OWNER TO %I'
                WHEN 'f'
                  THEN 'ALTER FOREIGN TABLE %I.%I OWNER TO %I'
                ELSE 'ALTER TABLE %I.%I OWNER TO %I'
              END,
              namespace.nspname,
              relation.relname,
              $1::text
            ) AS sql
          FROM pg_class AS relation
          JOIN pg_namespace AS namespace
            ON namespace.oid =
               relation.relnamespace
          WHERE
            namespace.nspname =
              $2::text
            AND relation.relkind IN (
              'r',
              'p',
              'S',
              'v',
              'm',
              'f'
            )
            AND (
              relation.relkind <>
                'S'
              OR NOT EXISTS (
                SELECT 1
                FROM pg_depend AS ownership_dependency
                WHERE
                  ownership_dependency.classid =
                    'pg_class'::regclass
                  AND ownership_dependency.objid =
                    relation.oid
                  AND ownership_dependency.refclassid =
                    'pg_class'::regclass
                  AND ownership_dependency.deptype IN (
                    'a',
                    'i'
                  )
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM pg_depend AS dependency
              WHERE
                dependency.classid =
                  'pg_class'::regclass
                AND dependency.objid =
                  relation.oid
                AND dependency.deptype =
                  'e'
            )

          UNION ALL

          SELECT
            40 AS priority,
            routine.oid AS object_oid,
            format(
              'ALTER ROUTINE %I.%I(%s) OWNER TO %I',
              namespace.nspname,
              routine.proname,
              pg_get_function_identity_arguments(
                routine.oid
              ),
              $1::text
            ) AS sql
          FROM pg_proc AS routine
          JOIN pg_namespace AS namespace
            ON namespace.oid =
               routine.pronamespace
          WHERE
            namespace.nspname =
              $2::text
            AND NOT EXISTS (
              SELECT 1
              FROM pg_depend AS dependency
              WHERE
                dependency.classid =
                  'pg_proc'::regclass
                AND dependency.objid =
                  routine.oid
                AND dependency.deptype =
                  'e'
            )
        ) AS ownership
        ORDER BY
          ownership.priority,
          ownership.object_oid
      `,
      [
        role,
        schema,
      ],
    );

  for (
    const row of
    result.rows
  ) {
    await client.query(
      row.sql,
    );
  }

  return result.rows
    .length;
}

/**
 * Bound the runtime login to data access. It can use temp tables for streaming
 * imports, but cannot create schemas/objects or inherit the migration owner.
 * Default privileges make future migrations preserve the same boundary.
 */
export async function configureRuntimePrivileges(
  client,
  {
    database,
    schema,
    ownerRole,
    runtimeRole,
  },
) {
  await client.query(
    `SELECT
       set_config('dtpstat.database_name', $1, false),
       set_config('dtpstat.schema_name', $2, false),
       set_config('dtpstat.owner_role', $3, false),
       set_config('dtpstat.runtime_role', $4, false)`,
    [
      database,
      schema,
      ownerRole,
      runtimeRole,
    ],
  );

  await client.query(`
    DO $block$
    DECLARE
      database_name text :=
        current_setting(
          'dtpstat.database_name'
        );
      schema_name text :=
        current_setting(
          'dtpstat.schema_name'
        );
      owner_role text :=
        current_setting(
          'dtpstat.owner_role'
        );
      runtime_role text :=
        current_setting(
          'dtpstat.runtime_role'
        );
    BEGIN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON DATABASE %I FROM PUBLIC',
        database_name
      );
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I',
        database_name,
        runtime_role
      );
      EXECUTE format(
        'GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I',
        database_name,
        runtime_role
      );

      EXECUTE format(
        'REVOKE %I FROM %I',
        owner_role,
        runtime_role
      );

      EXECUTE format(
        'REVOKE CREATE ON SCHEMA public FROM PUBLIC'
      );
      EXECUTE format(
        'GRANT USAGE ON SCHEMA public TO %I',
        runtime_role
      );

      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON SCHEMA %I FROM PUBLIC',
        schema_name
      );
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON SCHEMA %I FROM %I',
        schema_name,
        runtime_role
      );
      EXECUTE format(
        'GRANT USAGE ON SCHEMA %I TO %I',
        schema_name,
        runtime_role
      );

      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM PUBLIC',
        schema_name
      );
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM %I',
        schema_name,
        runtime_role
      );
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I',
        schema_name,
        runtime_role
      );

      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC',
        schema_name
      );
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM %I',
        schema_name,
        runtime_role
      );
      EXECUTE format(
        'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO %I',
        schema_name,
        runtime_role
      );

      EXECUTE format(
        'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC',
        schema_name
      );
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM %I',
        schema_name,
        runtime_role
      );
      EXECUTE format(
        'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO %I',
        schema_name,
        runtime_role
      );

      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM PUBLIC',
        owner_role,
        schema_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
        owner_role,
        schema_name,
        runtime_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM PUBLIC',
        owner_role,
        schema_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I',
        owner_role,
        schema_name,
        runtime_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
        owner_role,
        schema_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO %I',
        owner_role,
        schema_name,
        runtime_role
      );
    END
    $block$
  `);
}

async function normalizeDatabaseOwnership(
  adminConnection,
  applicationConnection,
  migrationConnection,
  schema,
) {
  const client =
    new Client({
      ...adminConnection,
      database:
        applicationConnection.database,
      application_name:
        databaseApplicationName(
          schema,
          'ownership-init',
        ),
    });

  await client.connect();

  try {
    await client.query(
      'BEGIN',
    );

    await configureSchemaOwnership(
      client,
      schema,
      migrationConnection.user,
    );

    const count =
      await transferObjectOwnership(
        client,
        migrationConnection.user,
        schema,
      );

    if (
      migrationConnection.user !==
      applicationConnection.user
    ) {
      await configureRuntimePrivileges(
        client,
        {
          database:
            applicationConnection.database,
          schema,
          ownerRole:
            migrationConnection.user,
          runtimeRole:
            applicationConnection.user,
        },
      );
    }

    await client.query(
      'COMMIT',
    );
    return count;
  } catch (error) {
    await client.query(
      'ROLLBACK',
    );
    throw error;
  } finally {
    await client.end();
  }
}

async function installPostgis(
  adminConnection,
  applicationConnection,
  migrationConnection,
  schema,
) {
  const client =
    new Client({
      ...adminConnection,
      database:
        applicationConnection.database,
      application_name:
        databaseApplicationName(
          schema,
          'initializer',
        ),
    });

  await client.connect();

  try {
    await client.query(
      'CREATE EXTENSION IF NOT EXISTS POSTGIS WITH SCHEMA PUBLIC',
    );

    for (
      const role of
      new Set([
        applicationConnection.user,
        migrationConnection.user,
      ])
    ) {
      const grant =
        await client.query(
          "SELECT format('GRANT USAGE ON SCHEMA public TO %I', $1::text) AS sql",
          [role],
        );
      await client.query(
        grant.rows[0]
          .sql,
      );
    }
  } finally {
    await client.end();
  }
}

async function verifyApplicationConnection(
  applicationConnection,
  schema,
) {
  const client =
    new Client({
      ...applicationConnection,
      application_name:
        databaseApplicationName(
          schema,
          'initializer-check',
        ),
      options:
        databaseSearchPath(
          schema,
        ),
    });

  await client.connect();

  try {
    const result =
      await client.query(
        `SELECT
           current_user AS role,
           current_database() AS database,
           PostGIS_Version() AS postgis,
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
           has_database_privilege(
             current_user,
             current_database(),
             'TEMP'
           ) AS database_temp`,
        [schema],
      );

    return result.rows[0];
  } finally {
    await client.end();
  }
}

async function main() {
  const adminConnection =
    loadAdminDatabaseConnection();
  const applicationConnection =
    loadApplicationDatabaseConnection();
  const migrationConnection =
    loadMigrationDatabaseConnection();
  const schema =
    loadDatabaseSchema();

  validateIdentifier(
    applicationConnection.user,
    'DATABASE_ROLE',
  );
  validateIdentifier(
    migrationConnection.user,
    'DATABASE_MIGRATION_ROLE',
  );
  validateIdentifier(
    applicationConnection.database,
    'DATABASE_NAME',
  );

  if (
    applicationConnection.user ===
    adminConnection.user
  ) {
    throw new Error(
      'DATABASE_ROLE must not be postgres',
    );
  }

  if (
    migrationConnection.user ===
    adminConnection.user
  ) {
    throw new Error(
      'DATABASE_MIGRATION_ROLE must not be postgres',
    );
  }

  if (
    process.env.NODE_ENV ===
      'production' &&
    migrationConnection.user ===
      applicationConnection.user
  ) {
    throw new Error(
      'DATABASE_MIGRATION_ROLE must be a dedicated role in production',
    );
  }

  if (
    applicationConnection.database ===
    adminConnection.database
  ) {
    throw new Error(
      'DATABASE_NAME must differ from POSTGRES_ADMIN_DATABASE',
    );
  }

  const admin =
    new Client({
      ...adminConnection,
      application_name:
        databaseApplicationName(
          schema,
          'initializer-admin',
        ),
    });

  await admin.connect();

  let applicationRoleStatus;
  let migrationRoleStatus;
  let databaseStatus;

  try {
    migrationRoleStatus =
      await configureRole(
        admin,
        migrationConnection.user,
        migrationConnection.password,
      );

    applicationRoleStatus =
      migrationConnection.user ===
      applicationConnection.user
        ? migrationRoleStatus
        : await configureRole(
            admin,
            applicationConnection.user,
            applicationConnection.password,
          );

    databaseStatus =
      await configureDatabase(
        admin,
        applicationConnection.database,
        migrationConnection.user,
      );
  } finally {
    await admin.end();
  }

  await installPostgis(
    adminConnection,
    applicationConnection,
    migrationConnection,
    schema,
  );

  const transferredObjects =
    await normalizeDatabaseOwnership(
      adminConnection,
      applicationConnection,
      migrationConnection,
      schema,
    );

  const verification =
    await verifyApplicationConnection(
      applicationConnection,
      schema,
    );

  if (
    verification.schema_usage !==
    true
  ) {
    throw new Error(
      'DATABASE_ROLE must have USAGE on DATABASE_SCHEMA',
    );
  }

  if (
    migrationConnection.user !==
      applicationConnection.user &&
    verification.schema_create ===
      true
  ) {
    throw new Error(
      'DATABASE_ROLE must not have CREATE on DATABASE_SCHEMA',
    );
  }

  if (
    verification.database_temp !==
    true
  ) {
    throw new Error(
      'DATABASE_ROLE must have TEMP on DATABASE_NAME',
    );
  }

  console.log(
    'Database initialization complete: ' +
      `runtime role ${applicationRoleStatus}, ` +
      `migration role ${migrationRoleStatus}, ` +
      `database ${databaseStatus}, ` +
      `schema ${schema}, ` +
      `PostGIS ${verification.postgis}; ` +
      `${transferredObjects} object owners normalized; ` +
      `verified runtime as ${verification.role}.`,
  );
}

if (
  process.argv[1] &&
  path.resolve(
    process.argv[1],
  ) === scriptPath
) {
  main().catch(
    (error) => {
      console.error(
        'Database initialization failed',
        error,
      );
      process.exitCode =
        1;
    },
  );
}
