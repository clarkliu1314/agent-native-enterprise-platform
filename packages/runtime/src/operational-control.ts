import type { CorrelationContext } from '@agent-native/observability';

export type OperationalControlAction = 'PAUSE' | 'RESUME' | 'RETRY' | 'CANCEL' | 'RECOVER';
export type OperationalControlOutcome = 'SUCCEEDED' | 'REJECTED';
export interface OperationalControlCommand { commandId: string; tenantId: string; runId: string; actorId: string; action: OperationalControlAction; reason?: string; idempotencyKey: string; expectedVersion?: number; correlation: CorrelationContext; }
export interface OperationalControlState { tenantId: string; runId: string; version: number; paused: boolean; cancelled: boolean; runState: 'QUEUED' | 'RUNNING' | 'WAITING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; fencingToken: bigint; }
export interface OperationalControlEvent { eventId: string; runId: string; type: 'OPERATIONAL_CONTROL_APPLIED'; payload: { commandId: string; tenantId: string; runId: string; actorId: string; action: OperationalControlAction; outcome: OperationalControlOutcome; reason?: string; correlation: Pick<CorrelationContext, 'requestId' | 'traceId' | 'tenantId' | 'runId' | 'workflowId' | 'agentId' | 'actorId'>; resultingState: Pick<OperationalControlState, 'paused' | 'cancelled' | 'runState' | 'version'>; }; }
export interface OperationalControlRepository { get(tenantId: string, runId: string): Promise<OperationalControlState | null>; findByIdempotency(tenantId: string, key: string): Promise<OperationalControlResult | null>; apply(command: OperationalControlCommand, next: OperationalControlState, event: OperationalControlEvent): Promise<OperationalControlResult>; listEvents(runId: string): Promise<OperationalControlEvent[]>; }
export interface RecoveryDelegator { retry(runId: string): Promise<unknown>; recover(runId: string): Promise<unknown>; }
export interface TelemetrySink { emit(event: OperationalControlEvent): Promise<void> | void; }
export interface AuthorizationPolicy { authorize(actorId: string, action: OperationalControlAction, tenantId: string, runId: string): Promise<boolean> | boolean; }
export interface OperationalControlResult { outcome: OperationalControlOutcome; replayed: boolean; control: OperationalControlState; eventsCreated: number; delegatedToRecovery: boolean; runStateMutation: boolean; executedInHttp: boolean; }
export class OperationalControlError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = 'OperationalControlError'; } }

export class InMemoryOperationalControlRepository implements OperationalControlRepository {
  private readonly controls = new Map<string, OperationalControlState>(); private readonly commands = new Map<string, OperationalControlResult>(); private readonly events = new Map<string, OperationalControlEvent[]>();
  constructor(initial?: OperationalControlState) { const state = initial ?? { tenantId: 'tenant-a', runId: 'run-1', version: 7, paused: false, cancelled: false, runState: 'QUEUED', fencingToken: 7n }; this.controls.set(this.key(state.tenantId, state.runId), { ...state }); }
  async get(tenantId: string, runId: string) { return this.controls.get(this.key(tenantId, runId)) ?? null; }
  async findByIdempotency(tenantId: string, key: string) { return this.commands.get(`${tenantId}:${key}`) ?? null; }
  async apply(command: OperationalControlCommand, next: OperationalControlState, event: OperationalControlEvent) { this.controls.set(this.key(command.tenantId, command.runId), { ...next }); const result: OperationalControlResult = { outcome: 'SUCCEEDED', replayed: false, control: { ...next }, eventsCreated: 1, delegatedToRecovery: command.action === 'RETRY' || command.action === 'RECOVER', runStateMutation: command.action === 'CANCEL', executedInHttp: false }; this.commands.set(`${command.tenantId}:${command.idempotencyKey}`, result); this.events.set(command.runId, [...(this.events.get(command.runId) ?? []), event]); return result; }
  async listEvents(runId: string) { return [...(this.events.get(runId) ?? [])]; }
  private key(tenantId: string, runId: string) { return `${tenantId}:${runId}`; }
}

export interface OperationalControlServiceOptions { repository?: OperationalControlRepository; recovery?: RecoveryDelegator; telemetry?: TelemetrySink; authorization?: AuthorizationPolicy; }
export class OperationalControlService {
  private readonly repository: OperationalControlRepository; private readonly recovery?: RecoveryDelegator; private readonly telemetry?: TelemetrySink; private readonly authorization: AuthorizationPolicy;
  constructor(options: OperationalControlServiceOptions = {}) { this.repository = options.repository ?? new InMemoryOperationalControlRepository(); this.recovery = options.recovery; this.telemetry = options.telemetry; this.authorization = options.authorization ?? { authorize: (actorId) => actorId !== 'unauthorized' }; }
  async execute(command: OperationalControlCommand): Promise<OperationalControlResult> {
    const existing = await this.repository.findByIdempotency(command.tenantId, command.idempotencyKey); if (existing) return { ...existing, replayed: true, eventsCreated: 0 };
    if (command.correlation.tenantId !== command.tenantId) throw new OperationalControlError('AUTHORIZATION_DENIED', 'Correlation tenant mismatch');
    if (!(await this.authorization.authorize(command.actorId, command.action, command.tenantId, command.runId))) throw new OperationalControlError('AUTHORIZATION_DENIED', 'Operational control is not authorized');
    const current = await this.repository.get(command.tenantId, command.runId); if (!current) throw new OperationalControlError('RUN_NOT_FOUND', 'Run not found');
    if (command.expectedVersion !== undefined && command.expectedVersion !== current.version) throw new OperationalControlError('CONCURRENCY_CONFLICT', 'Operational control version is stale');
    const next = this.nextState(command, current);
    if ((command.action === 'RETRY' || command.action === 'RECOVER') && !this.recovery) throw new OperationalControlError('RECOVERY_REJECTED', 'Recovery delegation is not configured');
    const event: OperationalControlEvent = { eventId: `${command.runId}:control:${command.commandId}`, runId: command.runId, type: 'OPERATIONAL_CONTROL_APPLIED', payload: { commandId: command.commandId, tenantId: command.tenantId, runId: command.runId, actorId: command.actorId, action: command.action, outcome: 'SUCCEEDED', reason: command.reason, correlation: command.correlation, resultingState: { paused: next.paused, cancelled: next.cancelled, runState: next.runState, version: next.version } } };
    const result = await this.repository.apply(command, next, event);
    if (command.action === 'RETRY') await this.recovery!.retry(command.runId);
    if (command.action === 'RECOVER') await this.recovery!.recover(command.runId);
    try { await this.telemetry?.emit(event); } catch { /* telemetry is non-authoritative */ }
    return result;
  }
  async getControl(tenantId: string, runId: string) { const control = await this.repository.get(tenantId, runId); if (!control) throw new OperationalControlError('RUN_NOT_FOUND', 'Run not found'); return control; }
  async listEvents(runId: string) { return this.repository.listEvents(runId); }
  async authorizeContinuation(input: { tenantId: string; runId: string; fencingToken: bigint }) { const control = await this.repository.get(input.tenantId, input.runId); if (!control) throw new OperationalControlError('RUN_NOT_FOUND', 'Run not found'); if (control.cancelled || control.fencingToken !== input.fencingToken) throw new OperationalControlError('STALE_FENCING_TOKEN', 'Effectful continuation is fenced'); return true; }
  private nextState(command: OperationalControlCommand, current: OperationalControlState): OperationalControlState {
    if (command.action === 'PAUSE') return { ...current, paused: true, version: current.version + 1 };
    if (command.action === 'RESUME') { if (current.cancelled || current.runState === 'CANCELLED' || current.runState === 'SUCCEEDED' || current.runState === 'FAILED') throw new OperationalControlError('INVALID_STATE_TRANSITION', 'Run cannot be resumed'); return { ...current, paused: false, version: current.version + 1 }; }
    if (command.action === 'CANCEL') return { ...current, cancelled: true, paused: false, runState: 'CANCELLED', version: current.version + 1, fencingToken: current.fencingToken + 1n };
    return current;
  }
}
