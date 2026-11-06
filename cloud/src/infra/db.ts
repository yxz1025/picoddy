import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";

export interface Database {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
  transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_SIZE || 20),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values?: readonly unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(sql, values ? [...values] : undefined);
}

export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const database: Database = { query, transaction };

export function schemaFingerprint(sql: string): string {
  return createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex');
}

async function schemaDefinition() {
  const sql = await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8');
  return { sql, hash: schemaFingerprint(sql) };
}

async function installationExists(client: Pool | PoolClient): Promise<boolean> {
  const result = await client.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname='schema_installation' AND c.relkind='r'`);
  return result.rows.length > 0;
}

async function verifyInstallation(client: Pool | PoolClient, hash: string): Promise<void> {
  const result = await client.query('SELECT definition_hash FROM schema_installation');
  if (result.rows.length !== 1 || result.rows[0].definition_hash !== hash) {
    throw new Error('Cloud database definition does not match this build; no automatic upgrade is supported.');
  }
}

/** Read-only startup check. Never modifies an existing database. */
export async function assertDatabaseInitialized(target: Pool = pool): Promise<void> {
  const { hash } = await schemaDefinition();
  if (!await installationExists(target)) throw new Error('Cloud database is not initialized; run npm run db:init on an empty, independent cloud database.');
  await verifyInstallation(target, hash);
}

/** Installs only into an empty schema. Repeating the identical installation is safe. */
export async function initializeDatabase(target: Pool = pool): Promise<void> {
  const { sql, hash } = await schemaDefinition();
  const client = await target.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [0x4a4e4259]);
    if (await installationExists(client)) {
      await verifyInstallation(client, hash);
    } else {
      const existing = await client.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema()
        UNION ALL SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=current_schema()
        UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() LIMIT 1`);
      if (existing.rows.length) throw new Error('Cloud database schema is not empty; refusing to modify existing data. Use an empty, independent cloud database.');
      await client.query(sql);
      await client.query(`CREATE TABLE schema_installation (
        singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
        definition_hash text NOT NULL,
        initialized_at timestamptz NOT NULL DEFAULT now()
      )`);
      await client.query('INSERT INTO schema_installation (definition_hash) VALUES ($1)', [hash]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
