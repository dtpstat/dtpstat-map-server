import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from './database.js';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const migrationsDirectory = path.join(projectRoot, 'db', 'migrations');

async function main() {
  const client = createDatabaseClient();
  await client.connect();

  try {
    await client.query(
      `SELECT pg_advisory_lock(hashtext('dtpstat-buslines:migrations'))`,
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await fs.readdir(migrationsDirectory))
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort();
    const appliedResult = await client.query(
      'SELECT filename, checksum FROM public.schema_migrations',
    );
    const applied = new Map(
      appliedResult.rows.map((row) => [row.filename, row.checksum]),
    );

    for (const fileName of files) {
      const sql = await fs.readFile(path.join(migrationsDirectory, fileName), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const previousChecksum = applied.get(fileName);

      if (previousChecksum) {
        if (previousChecksum !== checksum) {
          throw new Error(`Applied migration was modified: ${fileName}`);
        }
        console.log(`Already applied: ${fileName}`);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)',
          [fileName, checksum],
        );
        await client.query('COMMIT');
        console.log(`Applied: ${fileName}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query(
      `SELECT pg_advisory_unlock(hashtext('dtpstat-buslines:migrations'))`,
    ).catch(() => {});
    await client.end();
  }
}

main().catch((error) => {
  console.error('Migration failed', error);
  process.exitCode = 1;
});
