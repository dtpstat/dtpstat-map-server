import {
  migrateDatabase,
} from '../db/migration-runner.js';
import {
  verifyDatabaseMigrationState,
} from '../db/migration-state.js';
import {
  cleanupStagedUploads,
} from '../shared/files/upload-staging.js';
import {
  runServiceOperation,
  serviceLog,
} from '../service-log.js';

/**
 * Prepare the configured database before any repository/service wiring is used.
 * Migration filename/version/checksum validation stays owned by the existing
 * migration runner and verifier.
 *
 * @param {{
 *   config: any,
 *   pool: any,
 *   migrate?: typeof migrateDatabase,
 *   verifyMigrations?: typeof verifyDatabaseMigrationState,
 *   runOperation?: typeof runServiceOperation,
 *   log?: typeof serviceLog
 * }} dependencies
 */
export async function prepareServerDatabase({
  config,
  pool,
  migrate = migrateDatabase,
  verifyMigrations =
    verifyDatabaseMigrationState,
  runOperation = runServiceOperation,
  log = serviceLog,
}) {
  await runOperation(
    'database.migrations.apply',
    () =>
      migrate(pool, {
        projectRoot:
          config.projectRoot,
        schema:
          config.database.schema,
        logger(event) {
          if (
            event.status !==
            'applied'
          ) {
            return;
          }

          log(
            'info',
            'database.migration:applied',
            {
              version:
                event.migration.version,
              fileName:
                event.migration.fileName,
            },
          );
        },
      }),
    {
      successDetails:
        (result) => ({
          currentVersion:
            result.version,
          applied:
            result.appliedCount,
          known:
            result.totalCount,
        }),
    },
  );

  await runOperation(
    'database.migrations.verify',
    () =>
      verifyMigrations(pool, {
        projectRoot:
          config.projectRoot,
        schema:
          config.database.schema,
      }),
    {
      successDetails:
        (state) => state,
    },
  );
}

/**
 * Run startup work that requires fully constructed repositories/services.
 * Returns state required by the admin task manager.
 *
 * @param {{
 *   config: any,
 *   repository: { health: () => Promise<any> },
 *   osmImportSettingsRepository: { bootstrap: (options: any) => Promise<any> },
 *   securityService: { bootstrap: (credentials: object) => Promise<any> },
 *   projectSettingsRepository: {
 *     bootstrapMapboxAccessToken: (token: any) => Promise<any>,
 *     get: () => Promise<any>
 *   },
 *   adminTaskSuccessRepository: { list: () => Promise<any[]> },
 *   derivedState: { refreshAll: (details?: object) => Promise<any> },
 *   cleanupUploads?: typeof cleanupStagedUploads,
 *   runOperation?: typeof runServiceOperation
 * }} dependencies
 */
export async function bootstrapServerApplication({
  config,
  repository,
  osmImportSettingsRepository,
  securityService,
  projectSettingsRepository,
  adminTaskSuccessRepository,
  derivedState,
  cleanupUploads =
    cleanupStagedUploads,
  runOperation =
    runServiceOperation,
}) {
  await runOperation(
    'database.health',
    () => repository.health(),
    {
      details: {
        schema:
          config.database.schema,
      },
    },
  );

  await runOperation(
    'portable-import-spool.cleanup',
    () =>
      cleanupUploads(
        config.importApi
          .streamUploadDirectory,
      ),
    {
      successDetails:
        (removed) => ({
          directory:
            config.importApi
              .streamUploadDirectory,
          removed,
        }),
    },
  );

  await runOperation(
    'osm-import-settings.bootstrap',
    () =>
      osmImportSettingsRepository
        .bootstrap(
          config.osmCityUpdate,
        ),
    {
      successDetails:
        (result) => result,
    },
  );

  await runOperation(
    'admin-security.bootstrap',
    () =>
      securityService.bootstrap({
        username:
          config.importApi
            .bootstrapUsername,
        password:
          config.importApi
            .bootstrapPassword,
      }),
    {
      successDetails:
        (result) => ({
          created:
            result.created,
        }),
    },
  );

  await runOperation(
    'project-settings.mapbox.bootstrap',
    () =>
      projectSettingsRepository
        .bootstrapMapboxAccessToken(
          config.publicMap
            .bootstrapAccessToken,
        ),
    {
      successDetails:
        (result) => ({
          initializedFromEnvironment:
            result.initialized,
          configured:
            result.configured,
        }),
    },
  );

  await runOperation(
    'project-settings.load',
    () =>
      projectSettingsRepository.get(),
    {
      successDetails:
        (settings) => ({
          projectName:
            settings.projectName,
        }),
    },
  );

  await derivedState.refreshAll({
    reason: 'startup',
  });

  const initialSuccessfulUpdates =
    await runOperation(
      'admin-success-state.load',
      () =>
        adminTaskSuccessRepository
          .list(),
      {
        successDetails:
          (updates) => ({
            records:
              updates.length,
          }),
      },
    );

  return {
    initialSuccessfulUpdates,
  };
}
