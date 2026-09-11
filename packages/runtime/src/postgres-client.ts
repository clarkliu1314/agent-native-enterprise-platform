import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { SqlClient, SqlResult, TransactionClient, TransactionRunner } from './ports';

function result<T extends QueryResultRow>(value: { rows: T[]; rowCount: number | null }): SqlResult<T> {
  return { rows: value.rows, rowCount: value.rowCount ?? 0 };
}

export class PostgresDatabase implements TransactionRunner, SqlClient {
  readonly pool: Pool;

  constructor(connectionString = process.env.DATABASE_URL) {
    if (!connectionString) throw new Error('DATABASE_URL is required');
    this.pool = new Pool({ connectionString });
  }

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<SqlResult<T>> {
    return result(await this.pool.query<T>(sql, params as unknown[] | undefined));
  }

  async transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    await client.query('BEGIN');
    try {
      const tx = new PostgresTransactionClient(client);
      const value = await fn(tx);
      await tx.commit();
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

class PostgresTransactionClient implements TransactionClient {
  constructor(private readonly client: PoolClient) {}
  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<SqlResult<T>> {
    return result(await this.client.query<T>(sql, params as unknown[] | undefined));
  }
  commit(): Promise<void> { return this.client.query('COMMIT').then(() => undefined); }
  rollback(): Promise<void> { return this.client.query('ROLLBACK').then(() => undefined); }
}
