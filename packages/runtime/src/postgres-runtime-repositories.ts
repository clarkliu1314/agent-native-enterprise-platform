import type { CheckpointEnvelope, CreateRunCommand, RunView, RuntimeEventView } from '@agent-native/runtime-contract/durable';
import type { TransactionRunner, SqlClient } from './ports';
import type { DurableRepositories, IdempotencyRecord, RunClaim } from './repositories';

const asBigInt = (value: unknown): bigint => typeof value === 'bigint' ? value : BigInt(String(value));
const asOptionalIso = (value: unknown): string | undefined => value == null ? undefined : new Date(String(value)).toISOString();
const json = (value: unknown): string => JSON.stringify(value ?? null);

function toRunView(row: Record<string, unknown>): RunView {
  return { runId: String(row.run_id), agentId: String(row.agent_id), state: row.state as RunView['state'], input: row.input, metadata: (row.metadata ?? {}) as Record<string, unknown>, fencingToken: asBigInt(row.fencing_token), attempt: Number(row.attempt), createdAt: new Date(String(row.created_at)).toISOString(), startedAt: asOptionalIso(row.started_at), heartbeatAt: asOptionalIso(row.heartbeat_at), finishedAt: asOptionalIso(row.finished_at) };
}
function toEventView(row: Record<string, unknown>): RuntimeEventView {
  return { eventId: String(row.event_id), runId: String(row.run_id), sequence: asBigInt(row.sequence), type: String(row.type), payload: row.payload, createdAt: new Date(String(row.created_at)).toISOString() };
}
function outboxPayload(event: RuntimeEventView): unknown {
  return { eventId: event.eventId, runId: event.runId, sequence: event.sequence.toString(), type: event.type, payload: event.payload };
}

export class PostgresRuntimeRepositories implements DurableRepositories {
  constructor(protected readonly db: TransactionRunner & SqlClient) {}

  async admitRun(input: { command: CreateRunCommand; commandHash: string; runId: string; eventId: string }): Promise<RunView> {
    return this.db.transaction(async (tx) => {
      await tx.query(`INSERT INTO idempotency_keys (idempotency_key, command_hash, run_id) VALUES ($1, $2, $3)`, [input.command.idempotencyKey ?? `run:${input.runId}`, input.commandHash, input.runId]);
      const inserted = await tx.query<Record<string, unknown>>(`INSERT INTO agent_runs (run_id, agent_id, state, input, metadata) VALUES ($1, $2, 'QUEUED', $3::jsonb, $4::jsonb) RETURNING *`, [input.runId, input.command.agentId, json(input.command.input), json(input.command.metadata ?? {})]);
      const event = await tx.query<Record<string, unknown>>(`INSERT INTO agent_events (event_id, run_id, sequence, type, payload) VALUES ($1, $2, 1, 'RUN_CREATED', $3::jsonb) RETURNING *`, [input.eventId, input.runId, json({ executionMode: input.command.executionMode ?? 'async' })]);
      const eventView = toEventView(event.rows[0]);
      await tx.query(`INSERT INTO outbox_events (outbox_id, event_id, topic, payload) VALUES ($1, $2, 'agent.run', $3::jsonb)`, [`outbox:${input.eventId}`, input.eventId, json(outboxPayload(eventView))]);
      return toRunView(inserted.rows[0]);
    });
  }
  async getRun(runId: string): Promise<RunView | null> { const result = await this.db.query<Record<string, unknown>>('SELECT * FROM agent_runs WHERE run_id = $1', [runId]); return result.rows[0] ? toRunView(result.rows[0]) : null; }
  async getIdempotency(key: string): Promise<IdempotencyRecord | null> { const result = await this.db.query<Record<string, unknown>>('SELECT idempotency_key, command_hash, run_id, response FROM idempotency_keys WHERE idempotency_key = $1', [key]); const row = result.rows[0]; return row ? { key: String(row.idempotency_key), commandHash: String(row.command_hash), runId: row.run_id ? String(row.run_id) : undefined, response: row.response } : null; }
  async insertIdempotency(record: IdempotencyRecord): Promise<void> { await this.db.query(`INSERT INTO idempotency_keys (idempotency_key, command_hash, run_id, response) VALUES ($1, $2, $3, $4::jsonb)`, [record.key, record.commandHash, record.runId ?? null, json(record.response)]); }
  async claimRun(runId: string, owner: string, leaseMs: number): Promise<RunClaim | null> { const result = await this.db.query<Record<string, unknown>>(`UPDATE agent_runs SET state='RUNNING', lease_owner=$2, lease_expires_at=now()+($3*interval '1 millisecond'), fencing_token=fencing_token+1, attempt=attempt+1, started_at=COALESCE(started_at,now()), heartbeat_at=now() WHERE run_id=$1 AND state='QUEUED' RETURNING *`, [runId, owner, leaseMs]); if (!result.rows[0]) return null; const run = toRunView(result.rows[0]); return { run, fencingToken: run.fencingToken }; }
  async renewLease(runId: string, owner: string, fencingToken: bigint, leaseMs: number): Promise<boolean> { const result = await this.db.query(`UPDATE agent_runs SET lease_expires_at=now()+($4*interval '1 millisecond'), heartbeat_at=now() WHERE run_id=$1 AND lease_owner=$2 AND fencing_token=$3 AND state='RUNNING'`, [runId, owner, fencingToken.toString(), leaseMs]); return result.rowCount === 1; }
  async transitionRun(input: { runId: string; fencingToken?: bigint; from: RunView['state']; to: RunView['state']; owner?: string; error?: string }): Promise<RunView> { const result = await this.db.query<Record<string, unknown>>(`UPDATE agent_runs SET state=$2, lease_owner=CASE WHEN $2='RUNNING' THEN lease_owner ELSE NULL END, lease_expires_at=CASE WHEN $2='RUNNING' THEN lease_expires_at ELSE NULL END, heartbeat_at=CASE WHEN $2='RUNNING' THEN now() ELSE heartbeat_at END, finished_at=CASE WHEN $2 IN ('SUCCEEDED','FAILED','CANCELLED') THEN now() ELSE finished_at END, metadata=CASE WHEN $5::text IS NULL THEN metadata ELSE jsonb_set(metadata,'{lastError}',to_jsonb($5::text),true) END WHERE run_id=$1 AND state=$3 AND ($4::bigint IS NULL OR fencing_token=$4::bigint) AND ($6::text IS NULL OR lease_owner=$6::text) RETURNING *`, [input.runId, input.to, input.from, input.fencingToken?.toString() ?? null, input.error ?? null, input.owner ?? null]); if (!result.rows[0]) throw new Error(`Durable run write rejected for ${input.runId}`); return toRunView(result.rows[0]); }
  async transitionRunAndEmit(input: { runId: string; fencingToken?: bigint; from: RunView['state']; to: RunView['state']; owner?: string; error?: string; eventType: string; eventPayload: unknown; topic: string }): Promise<RunView> {
    return this.db.transaction(async (tx) => {
      const result = await tx.query<Record<string, unknown>>(`UPDATE agent_runs SET state=$2, lease_owner=CASE WHEN $2='RUNNING' THEN lease_owner ELSE NULL END, lease_expires_at=CASE WHEN $2='RUNNING' THEN lease_expires_at ELSE NULL END, heartbeat_at=CASE WHEN $2='RUNNING' THEN now() ELSE heartbeat_at END, finished_at=CASE WHEN $2 IN ('SUCCEEDED','FAILED','CANCELLED') THEN now() ELSE finished_at END, metadata=CASE WHEN $5::text IS NULL THEN metadata ELSE jsonb_set(metadata,'{lastError}',to_jsonb($5::text),true) END WHERE run_id=$1 AND state=$3 AND ($4::bigint IS NULL OR fencing_token=$4::bigint) AND ($6::text IS NULL OR lease_owner=$6::text) RETURNING *`, [input.runId, input.to, input.from, input.fencingToken?.toString() ?? null, input.error ?? null, input.owner ?? null]);
      if (!result.rows[0]) throw new Error(`Durable run write rejected for ${input.runId}`);
      const event = await this.appendEventInTx(tx, { runId: input.runId, type: input.eventType, payload: input.eventPayload, fencingToken: input.fencingToken });
      await tx.query(`INSERT INTO outbox_events (outbox_id,event_id,topic,payload) VALUES ($1,$2,$3,$4::jsonb)`, [`outbox:${event.eventId}`, event.eventId, input.topic, json(outboxPayload(event))]);
      return toRunView(result.rows[0]);
    });
  }

  private async appendEventInTx(tx: SqlClient, input: { runId: string; type: string; payload: unknown; fencingToken?: bigint }): Promise<RuntimeEventView> {
    await tx.query('SELECT run_id FROM agent_runs WHERE run_id=$1 FOR UPDATE', [input.runId]);
    const next = await tx.query<{ next_sequence: string }>('SELECT COALESCE(MAX(sequence),0)+1 AS next_sequence FROM agent_events WHERE run_id=$1', [input.runId]);
    const sequence = BigInt(String(next.rows[0].next_sequence));
    const eventId = `${input.runId}:event:${sequence}`;
    const event = await tx.query<Record<string, unknown>>(`INSERT INTO agent_events (event_id,run_id,sequence,type,payload) SELECT $1,run_id,$3,$4,$5::jsonb FROM agent_runs WHERE run_id=$2 AND ($6::bigint IS NULL OR fencing_token=$6::bigint) RETURNING *`, [eventId, input.runId, sequence.toString(), input.type, json(input.payload), input.fencingToken?.toString() ?? null]);
    if (!event.rows[0]) throw new Error(`Fenced event write rejected for ${input.runId}`);
    return toEventView(event.rows[0]);
  }
  async appendEvent(input: { runId: string; type: string; payload: unknown; fencingToken?: bigint }): Promise<RuntimeEventView> { return this.db.transaction((tx) => this.appendEventInTx(tx, input)); }
  async appendEventAndOutbox(input: { runId: string; type: string; payload: unknown; topic: string; fencingToken?: bigint }): Promise<RuntimeEventView> { return this.db.transaction(async (tx) => { const event = await this.appendEventInTx(tx, input); await tx.query(`INSERT INTO outbox_events (outbox_id,event_id,topic,payload) VALUES ($1,$2,$3,$4::jsonb)`, [`outbox:${event.eventId}`, event.eventId, input.topic, json(outboxPayload(event))]); return event; }); }
  async listEvents(runId: string, afterSequence?: bigint): Promise<RuntimeEventView[]> { const result = await this.db.query<Record<string, unknown>>('SELECT * FROM agent_events WHERE run_id=$1 AND sequence>COALESCE($2::bigint,0) ORDER BY sequence ASC', [runId, afterSequence?.toString() ?? null]); return result.rows.map(toEventView); }
  async createOutbox(input: { eventId: string; topic: string; payload: unknown }): Promise<void> { await this.db.query(`INSERT INTO outbox_events (outbox_id,event_id,topic,payload) VALUES ($1,$2,$3,$4::jsonb)`, [`outbox:${input.eventId}`, input.eventId, input.topic, json(input.payload)]); }
  async saveCheckpoint(checkpoint: CheckpointEnvelope): Promise<void> { await this.db.query(`INSERT INTO checkpoints (checkpoint_id,run_id,turn_id,sequence,fencing_token,adapter,adapter_version,schema_version,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [checkpoint.checkpointId,checkpoint.runId,checkpoint.turnId??null,checkpoint.sequence.toString(),checkpoint.fencingToken.toString(),checkpoint.adapter,checkpoint.adapterVersion,checkpoint.schemaVersion,checkpoint.payload]); }
  async getLatestCheckpoint(runId: string): Promise<CheckpointEnvelope | null> { const result = await this.db.query<Record<string, unknown>>('SELECT * FROM checkpoints WHERE run_id=$1 ORDER BY sequence DESC LIMIT 1',[runId]); const row=result.rows[0]; if(!row)return null; const payload=row.payload instanceof Uint8Array?row.payload:new Uint8Array(row.payload as ArrayBuffer); return { checkpointId:String(row.checkpoint_id),runId:String(row.run_id),turnId:row.turn_id?String(row.turn_id):undefined,sequence:asBigInt(row.sequence),fencingToken:asBigInt(row.fencing_token),adapter:String(row.adapter),adapterVersion:String(row.adapter_version),schemaVersion:Number(row.schema_version),createdAt:new Date(String(row.created_at)).toISOString(),payload }; }
  async findExpiredRuns(limit: number): Promise<RunView[]> { const result = await this.db.query<Record<string,unknown>>(`SELECT * FROM agent_runs WHERE state='RUNNING' AND lease_expires_at<now() ORDER BY lease_expires_at ASC LIMIT $1`,[limit]); return result.rows.map(toRunView); }
  async reclaimExpiredRun(runId: string, owner: string, leaseMs: number): Promise<RunClaim | null> { const result = await this.db.query<Record<string,unknown>>(`UPDATE agent_runs SET lease_owner=$2,lease_expires_at=now()+($3*interval '1 millisecond'),fencing_token=fencing_token+1,attempt=attempt+1,heartbeat_at=now() WHERE run_id=$1 AND state='RUNNING' AND lease_expires_at<now() RETURNING *`,[runId,owner,leaseMs]); if(!result.rows[0])return null; const run=toRunView(result.rows[0]); return {run,fencingToken:run.fencingToken}; }
  async saveIdempotencyResponse(key:string,response:unknown):Promise<void>{await this.db.query('UPDATE idempotency_keys SET response=$2::jsonb WHERE idempotency_key=$1',[key,json(response)]);}
}
