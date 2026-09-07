import 'dotenv/config';
import { isIP } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadDatabaseSchema } from '../src/db/database-environment.js';
import { createDatabaseClient } from './database.js';

const USAGE = `Usage:
  npm run admin:unblock -- --user <username>
  npm run admin:unblock -- --ip <address>
  npm run admin:unblock -- --user <username> --ip <address>

The command clears both automatic login lockouts and explicit manual blocks
for the supplied account/IP in the DATABASE_SCHEMA selected by .env.`;

function optionValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value.trim();
}

/** @param {string[]} argv */
export function parseAdminUnblockArgs(argv) {
  let username = null;
  let ipAddress = null;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--user' || argument === '--username') {
      username = optionValue(argv, index, argument);
      index += 1;
      continue;
    }
    if (argument.startsWith('--user=')) {
      username = argument.slice('--user='.length).trim();
      continue;
    }
    if (argument.startsWith('--username=')) {
      username = argument.slice('--username='.length).trim();
      continue;
    }
    if (argument === '--ip') {
      ipAddress = optionValue(argv, index, argument);
      index += 1;
      continue;
    }
    if (argument.startsWith('--ip=')) {
      ipAddress = argument.slice('--ip='.length).trim();
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (help) return { help, username, ipAddress };
  if (!username && !ipAddress) {
    throw new Error('Specify --user, --ip, or both');
  }
  if (username !== null && !username) {
    throw new Error('--user must not be empty');
  }
  if (ipAddress !== null && isIP(ipAddress) === 0) {
    throw new Error(`Invalid IP address: ${ipAddress}`);
  }

  return { help, username, ipAddress };
}

/**
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[], rowCount?: number }> }} database
 * @param {{ username: string | null, ipAddress: string | null }} targets
 */
export async function unblockAdminTargets(database, targets) {
  const result = {
    user: null,
    ip: null,
  };

  if (targets.username) {
    const userResult = await database.query(`
      UPDATE admin_users
      SET
        is_blocked = FALSE,
        manual_blocked_at = NULL,
        manual_blocked_until = NULL,
        manual_block_reason = NULL,
        manual_blocked_by = NULL,
        failed_login_count = 0,
        failed_login_window_started_at = NULL,
        locked_until = NULL,
        updated_at = NOW()
      WHERE LOWER(BTRIM(username)) = LOWER(BTRIM($1))
      RETURNING id::integer AS id, username
    `, [targets.username]);
    result.user = userResult.rows[0] ?? null;
  }

  if (targets.ipAddress) {
    const [throttleResult, manualResult] = await Promise.all([
      database.query(`
        DELETE FROM admin_login_ip_state
        WHERE ip_address = $1::inet
        RETURNING host(ip_address) AS "ipAddress"
      `, [targets.ipAddress]),
      database.query(`
        DELETE FROM admin_blocked_ips
        WHERE ip_address = $1::inet
          AND (expires_at IS NULL OR expires_at > NOW())
        RETURNING id::integer AS id
      `, [targets.ipAddress]),
    ]);
    result.ip = {
      ipAddress: targets.ipAddress,
      automaticStateCleared: (throttleResult.rowCount ?? throttleResult.rows.length) > 0,
      manualBlocksCleared: manualResult.rowCount ?? manualResult.rows.length,
    };
  }

  return result;
}

/** @param {string[]} [argv] */
export async function main(argv = process.argv.slice(2)) {
  const targets = parseAdminUnblockArgs(argv);
  if (targets.help) {
    console.log(USAGE);
    return;
  }

  const database = createDatabaseClient();
  await database.connect();
  try {
    await database.query('BEGIN');
    const result = await unblockAdminTargets(database, targets);

    if (targets.username && !result.user) {
      throw new Error(`Administrator not found: ${targets.username}`);
    }

    await database.query('COMMIT');
    console.log(`Admin unlock completed in schema ${loadDatabaseSchema()}.`);
    if (result.user) {
      console.log(`Account ${result.user.username} (id=${result.user.id}): unlocked.`);
    }
    if (result.ip) {
      console.log(
        `IP ${result.ip.ipAddress}: automatic state ${result.ip.automaticStateCleared ? 'cleared' : 'was absent'}; ` +
        `manual blocks cleared: ${result.ip.manualBlocksCleared}.`,
      );
    }
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
    console.error(`Admin unlock failed: ${error.message}`);
    process.exitCode = 1;
  });
}
