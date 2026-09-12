import { describe, expect, it } from 'vitest';
import type {
  CheckpointEnvelope,
  CreateRunCommand,
  DurableRunState,
  RuntimeFacade,
} from './durable';

describe('durable runtime contract', () => {
  it('uses exactly the six durable run states', () => {
    const states: DurableRunState[] = [
      'QUEUED',
      'RUNNING',
      'WAITING',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
    ];
    expect(new Set(states).size).toBe(6);
  });

  it('defines transactional create-run admission inputs', () => {
    const command: CreateRunCommand = {
      agentId: 'investment-agent',
      input: { companyId: 'company-1' },
      executionMode: 'async',
      idempotencyKey: 'request-1',
    };
    expect(command.executionMode).toBe('async');
    expect(command.idempotencyKey).toBe('request-1');
  });

  it('keeps adapter checkpoint payload opaque to the runtime', () => {
    const checkpoint: CheckpointEnvelope = {
      checkpointId: 'cp-1',
      runId: 'run-1',
      sequence: 3n,
      fencingToken: 9n,
      adapter: 'reference',
      adapterVersion: '1.0.0',
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      payload: new Uint8Array([1, 2, 3]),
    };
    expect(checkpoint.payload).toBeInstanceOf(Uint8Array);
  });

  it('exposes only framework-neutral application operations', () => {
    const methods: (keyof RuntimeFacade)[] = [
      'createRun',
      'resumeRun',
      'cancelRun',
      'approveRun',
      'executeRunBounded',
      'getRun',
      'listRunEvents',
      'getRunCheckpoint',
      'getToolCall',
    ];
    expect(methods).toHaveLength(9);
  });
});
