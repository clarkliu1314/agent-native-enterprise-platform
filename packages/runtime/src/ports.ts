import type { RuntimeEventView, RunView } from '@agent-native/runtime-contract/durable';

export interface SqlResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface SqlClient {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<SqlResult<T>>;
}

export interface TransactionClient extends SqlClient {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface TransactionRunner {
  transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>;
}

export interface QueuePublisher {
  publish(topic: string, payload: unknown): Promise<void>;
}

export interface QueueConsumer {
  consume(handler: (message: { topic: string; payload: unknown }) => Promise<void>): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export interface RuntimeAdapter {
  readonly name: string;
  readonly version: string;
  run(input: { run: RunView; signal?: AbortSignal }): Promise<AdapterRunResult>;
  serializeCheckpoint(state: unknown): Uint8Array;
  deserializeCheckpoint(payload: Uint8Array): unknown;
}

export interface AdapterRunResult {
  kind: 'SUCCEEDED' | 'WAITING' | 'FAILED';
  output?: unknown;
  error?: string;
  waitCondition?: {
    kind: 'HUMAN_APPROVAL' | 'TOOL_CALLBACK' | 'WEBHOOK' | 'SCHEDULE';
    condition: Record<string, unknown>;
  };
  checkpoint?: {
    turnId?: string;
    sequence: bigint;
    payload: Uint8Array;
  };
}

export interface ToolPermission {
  authorize(input: { runId: string; agentId: string; toolName: string; input: unknown }): Promise<boolean>;
}

export interface ToolInvoker {
  invoke(input: { toolName: string; input: unknown; idempotencyKey: string }): Promise<unknown>;
}

export interface ModelProvider {
  invoke(input: {
    model: string;
    request: unknown;
    requestHash: string;
    providerRequestId?: string;
  }): Promise<{ providerRequestId?: string; response: unknown }>;
  reconcile?(providerRequestId: string): Promise<{ status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'; response?: unknown; error?: string }>;
}

export interface RuntimeEventPage {
  events: RuntimeEventView[];
  nextSequence?: bigint;
}
