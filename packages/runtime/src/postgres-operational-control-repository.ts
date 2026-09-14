import { createHash } from 'node:crypto';
import type { CorrelationContext } from '@agent-native/observability';
import type { SqlClient, TransactionRunner } from './ports';
import { type OperationalControlCommand, type OperationalControlEvent, type OperationalControlRepository, type OperationalControlResult, type OperationalControlState } from './operational-control';

const json = (value: unknown) => JSON.stringify(value ?? null, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
const hash = (value: unknown) => createHash('sha256').update(json(value)).digest('hex');

export class PostgresOperationalControlRepository implements OperationalControlRepository {
  constructor(private readonly db: TransactionRunner & SqlClient) {}
  async get(tenantId: string, runId: string): Promise<OperationalControlState | null> { const result = await this.db.query<Record<string, unknown>>('SELECT run_id,state,version,metadata,fencing_token FROM agent_runs WHERE run_id=$1 AND metadata->>\'tenantId\'=$2', [runId, tenantId]); return result.rows[0] ? toState(result.rows[0], tenantId) : null; }
  async findByIdempotency(tenantId: string, key: string): Promise<OperationalControlResult | null> { const result = await this.db.query<Record<string, unknown>>('SELECT response FROM idempotency_keys WHERE idempotency_key=$1', [controlKey(tenantId, key)]); return result.rows[0]?.response ? deserializeResult(result.rows[0].response) : null; }
  async apply(command: OperationalControlCommand, next: OperationalControlState, event: OperationalControlEvent): Promise<OperationalControlResult> {
    return this.db.transaction(async (tx) => {
      const locked = await tx.query<Record<string, unknown>>('SELECT run_id,state,version,metadata,fencing_token FROM agent_runs WHERE run_id=$1 FOR UPDATE', [command.runId]);
      const row = locked.rows[0]; if (!row || String((row.metadata as Record<string, unknown> | undefined)?.tenantId ?? '') !== command.tenantId) throw new Error('Operational control target not found');
      const current = toState(row, command.tenantId); if (command.expectedVersion !== undefined && current.version !== command.expectedVersion) throw new Error('Operational control version is stale');
      const updatedMetadata = { ...(currentMetadata(row)), operationalControl: { paused: next.paused, cancelled: next.cancelled } };
      const updated = await tx.query<Record<string, unknown>>('UPDATE agent_runs SET metadata=$2::jsonb,version=$3,fencing_token=$4,state=$5 WHERE run_id=$1 AND version=$6 RETURNING run_id,state,version,metadata,fencing_token', [command.runId, json(updatedMetadata), next.version, next.fencingToken.toString(), next.runState, current.version]);
      if (!updated.rows[0]) throw new Error('Operational control concurrent write rejected');
      const seq = await nextSequence(tx, command.runId); const eventId = event.eventId;
      const inserted = await tx.query('INSERT INTO agent_events (event_id,run_id,sequence,type,payload) VALUES ($1,$2,$3,$4,$5::jsonb)', [eventId, command.runId, seq.toString(), event.type, json(event.payload)]); if (inserted.rowCount !== 1) throw new Error('Operational control event write rejected');
      await tx.query('INSERT INTO outbox_events (outbox_id,event_id,topic,payload,idempotency_key,tenant_id,actor_id,event_type) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8)', [`outbox:${eventId}`, eventId, 'agent.run', json({ eventId, runId: command.runId, sequence: seq.toString(), type: event.type, payload: event.payload }), command.idempotencyKey, command.tenantId, command.actorId, event.type]);
      const result: OperationalControlResult = { outcome: 'SUCCEEDED', replayed: false, control: toState(updated.rows[0], command.tenantId), eventsCreated: 1, delegatedToRecovery: command.action === 'RETRY' || command.action === 'RECOVER', runStateMutation: command.action === 'CANCEL', executedInHttp: false };
      await tx.query('INSERT INTO idempotency_keys (idempotency_key,command_hash,run_id,response) VALUES ($1,$2,$3,$4::jsonb)', [controlKey(command.tenantId, command.idempotencyKey), hash(command), command.runId, json(result)]);
      return result;
    });
  }
  async listEvents(runId: string): Promise<OperationalControlEvent[]> { const result = await this.db.query<Record<string, unknown>>('SELECT event_id,run_id,type,payload FROM agent_events WHERE run_id=$1 AND type=\'OPERATIONAL_CONTROL_APPLIED\' ORDER BY sequence', [runId]); return result.rows.map((row) => ({ eventId: String(row.event_id), runId: String(row.run_id), type: 'OPERATIONAL_CONTROL_APPLIED', payload: row.payload as OperationalControlEvent['payload'] })); }
}
function controlKey(tenantId: string, key: string) { return `control:${tenantId}:${key}`; }
function currentMetadata(row: Record<string, unknown>) { return (row.metadata ?? {}) as Record<string, unknown>; }
function toState(row: Record<string, unknown>, tenantId: string): OperationalControlState { const control = currentMetadata(row).operationalControl as Record<string, unknown> | undefined; return { tenantId, runId: String(row.run_id), version: Number(row.version), paused: control?.paused === true, cancelled: control?.cancelled === true, runState: row.state as OperationalControlState['runState'], fencingToken: BigInt(String(row.fencing_token)) }; }
function deserializeResult(value: unknown): OperationalControlResult { const result = value as OperationalControlResult; return { ...result, control: { ...result.control, fencingToken: BigInt(String(result.control.fencingToken)) } }; }
async function nextSequence(tx: SqlClient, runId: string) { const result = await tx.query<{ next_sequence: string }>('SELECT COALESCE(MAX(sequence),0)+1 AS next_sequence FROM agent_events WHERE run_id=$1', [runId]); return BigInt(String(result.rows[0].next_sequence)); }
export type OperationalControlCorrelation = Pick<CorrelationContext, 'requestId' | 'traceId' | 'tenantId' | 'runId' | 'workflowId' | 'agentId' | 'actorId'>;
