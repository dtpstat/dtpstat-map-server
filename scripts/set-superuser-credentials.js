import 'dotenv/config';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  hashAdminPassword,
  normalizeAdminUsername,
} from '../src/data/admin-security.js';
import { loadDatabaseSchema } from '../src/db/database-environment.js';
import { createDatabaseClient } from './database.js';

const USAGE = `Usage:
  npm run admin:set-superuser
  npm run admin:set-superuser -- --username <login> --password <password>

By default the command takes the desired login/password from
IMPORT_API_USERNAME and IMPORT_API_PASSWORD in .env.
Command-line values override the corresponding .env values.

The command requires exactly one row with is_superuser = TRUE. It updates that
account only, resets account lockout/manual-block state, restores all superuser
permissions, and revokes its existing sessions.`;

function optionValue(argv, index, name) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function resolveSuperuserCredentials(argv, env = process.env) {
  let username = env.IMPORT_API_USERNAME ?? '';
  let password = env.IMPORT_API_PASSWORD ?? '';
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--username' || argument === '--user' || argument === '--login') {
      username = optionValue(argv, index, argument);
      index += 1;
      continue;
    }
    if (argument.startsWith('--username=')) {
      username = argument.slice('--username='.length);
      continue;
    }
    if (argument.startsWith('--user=')) {
      username = argument.slice('--user='.length);
      continue;
    }
    if (argument.startsWith('--login=')) {
      username = argument.slice('--login='.length);
      continue;
    }
    if (argument === '--password') {
      password = optionValue(argv, index, argument);
      index += 1;
      continue;
    }
    if (argument.startsWith('--password=')) {
      password = argument.slice('--password='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (help) return { help: true, username: null, password: null };

  const normalizedUsername = normalizeAdminUsername(String(username));
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error(
      'Password is required: set IMPORT_API_PASSWORD in .env or pass --password',
    );
  }

  return {
    help: false,
    username: normalizedUsername,
    password,
  };
}

/**
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[], rowCount?: number }> }} database
 * @param {{ username: string, passwordHash: string }} credentials
 */
export async function setSuperuserCredentials(database, credentials) {
  const currentResult = await database.query(`
    SELECT id::integer AS id, username
    FROM admin_users
    WHERE is_superuser = TRUE
    ORDER BY id
    FOR UPDATE
  `);

  if (currentResult.rows.length !== 1) {
    throw new Error(
      `Expected exactly one superuser, found ${currentResult.rows.length}`,
    );
  }

  const current = currentResult.rows[0];
  const updateResult = await database.query(`
    UPDATE admin_users
    SET
      username = $2,
      password_hash = $3,
      can_manage_data = TRUE,
      can_manage_interface = TRUE,
      can_manage_users = TRUE,
      can_view_audit = TRUE,
      can_manage_security = TRUE,
      is_blocked = FALSE,
      manual_blocked_at = NULL,
      manual_blocked_until = NULL,
      manual_block_reason = NULL,
      manual_blocked_by = NULL,
      must_change_password = FALSE,
      failed_login_count = 0,
      failed_login_window_started_at = NULL,
      locked_until = NULL,
      password_changed_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
      AND is_superuser = TRUE
    RETURNING id::integer AS id, username
  `, [current.id, credentials.username, credentials.passwordHash]);

  if (updateResult.rows.length !== 1) {
    throw new Error('Superuser changed while credentials were being updated');
  }

  const sessionsResult = await database.query(`
    DELETE FROM admin_sessions
    WHERE user_id = $1
  `, [current.id]);

  return {
    id: updateResult.rows[0].id,
    previousUsername: current.username,
    username: updateResult.rows[0].username,
    revokedSessions: sessionsResult.rowCount ?? sessionsResult.rows.length,
  };
}

/** @param {string[]} [argv] */
export async function main(argv = process.argv.slice(2)) {
  const credentials = resolveSuperuserCredentials(argv);
  if (credentials.help) {
    console.log(USAGE);
    return;
  }

  // Recovery must accept the same non-empty bootstrap password that could have
  // originally been provisioned through IMPORT_API_PASSWORD.
  const passwordHash = await hashAdminPassword(credentials.password, { bootstrap: true });
  const database = createDatabaseClient();
  await database.connect();

  try {
    await database.query('BEGIN');
    const result = await setSuperuserCredentials(database, {
      username: credentials.username,
      passwordHash,
    });
    await database.query('COMMIT');

    console.log(`Superuser credentials updated in schema ${loadDatabaseSchema()}.`);
    console.log(
      `Account id=${result.id}: ${result.previousUsername} -> ${result.username}; ` +
      `sessions revoked: ${result.revokedSessions}.`,
    );
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  } finally {
    await database.end();
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(`Superuser credential update failed: ${error.message}`);
    process.exitCode = 1;
  });
}
