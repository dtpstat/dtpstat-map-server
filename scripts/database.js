import pg from 'pg';
import { loadApplicationDatabaseConnection } from '../src/db/database-environment.js';

const { Client } = pg;

export function createDatabaseClient() {
  return new Client({
    ...loadApplicationDatabaseConnection(),
    application_name: 'dtpstat-buslines-maintenance',
    options: '-c search_path=buslanes,public',
  });
}
