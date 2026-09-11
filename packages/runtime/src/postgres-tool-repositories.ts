import { PostgresRuntimeRepositories } from './postgres-runtime-repositories';
import type { ToolCallRecord } from './repositories';

const json = (value: unknown): string => JSON.stringify(value ?? null);
const bigintValue = (value: unknown): bigint => typeof value === 'bigint' ? value : BigInt(String(value));

export class PostgresToolRepositories extends PostgresRuntimeRepositories {
  async createToolCall(input: ToolCallRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO tool_calls (tool_call_id, run_id, fencing_token, idempotency_key, tool_name, kind, status, input)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (tool_call_id) DO NOTHING`,
      [input.toolCallId, input.runId, input.fencingToken.toString(), input.idempotencyKey, input.toolName, input.kind, input.status, json(input.input)],
    );
  }

  async getToolCall(toolCallId: string): Promise<ToolCallRecord | null> {
    const result = await this.db.query<Record<string, unknown>>('SELECT * FROM tool_calls WHERE tool_call_id=$1', [toolCallId]);
    const row = result.rows[0];
    if (!row) return null;
    return { toolCallId: String(row.tool_call_id), runId: String(row.run_id), fencingToken: bigintValue(row.fencing_token), idempotencyKey: String(row.idempotency_key), toolName: String(row.tool_name), kind: row.kind as ToolCallRecord['kind'], status: row.status as ToolCallRecord['status'], input: row.input, output: row.output, error: row.error ? String(row.error) : undefined };
  }

  async completeToolCall(input: { toolCallId: string; runId: string; fencingToken: bigint; status: 'SUCCEEDED' | 'FAILED'; output?: unknown; error?: string }): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE tool_calls SET status=$4, output=$5::jsonb, error=$6, completed_at=now()
       WHERE tool_call_id=$1 AND run_id=$2 AND fencing_token=$3`,
      [input.toolCallId, input.runId, input.fencingToken.toString(), input.status, json(input.output), input.error ?? null],
    );
    return result.rowCount === 1;
  }
}
