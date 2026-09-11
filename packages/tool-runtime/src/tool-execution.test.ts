import { describe, expect, it, vi } from 'vitest';
import {
  ToolExecutionService,
  ToolPermissionDeniedError,
  type ToolDefinition,
  type ToolExecutionContext,
} from './tool-execution';

/**
 * Task 4 contract tests.
 *
 * These tests define the safety boundary before framework adapters are introduced:
 * 1. authorization happens before an externally effectful tool is invoked;
 * 2. the same idempotency key never causes a second external effect;
 * 3. the result and outbox event are handed to one atomic persistence boundary;
 * 4. a failed external operation cannot publish a success event.
 *
 * The implementation currently uses an in-process reference store. A PostgreSQL adapter
 * implements the same persistence callback with one database transaction, allowing the
 * application-facing runtime contract to remain framework-neutral.
 */

describe('ToolExecutionService', () => {
  const tool: ToolDefinition = {
    name: 'crm.create_company',
    description: 'Create a company record in the CRM.',
    sideEffect: true,
  };

  const context: ToolExecutionContext = {
    actorId: 'user-1',
    tenantId: 'fund-1',
    permissions: ['crm.company:create'],
  };

  it('denies an unauthorized side-effect before invoking the tool', async () => {
    const execute = vi.fn().mockResolvedValue({ companyId: 'company-1' });
    const service = new ToolExecutionService({
      authorize: async () => false,
      execute,
    });

    await expect(
      service.execute({
        tool,
        input: { name: 'Acme Capital' },
        context: { ...context, permissions: [] },
        idempotencyKey: 'idem-denied-1',
      }),
    ).rejects.toBeInstanceOf(ToolPermissionDeniedError);

    expect(execute).not.toHaveBeenCalled();
  });

  it('returns the same logical result for a retry with the same idempotency key', async () => {
    let externalCalls = 0;
    const execute = vi.fn().mockImplementation(async () => {
      externalCalls += 1;
      return { companyId: `company-${externalCalls}` };
    });

    const service = new ToolExecutionService({
      authorize: async () => true,
      execute,
      persistResultAndPublishOutbox: async () => undefined,
    });

    const request = {
      tool,
      input: { name: 'Acme Capital' },
      context,
      idempotencyKey: 'idem-company-1',
    };

    const first = await service.execute(request);
    const retry = await service.execute(request);

    expect(first.output).toEqual(retry.output);
    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(externalCalls).toBe(1);
  });

  it('persists one result and one outbox event for one successful side effect', async () => {
    const commits: unknown[] = [];
    const service = new ToolExecutionService({
      authorize: async () => true,
      execute: async () => ({ companyId: 'company-1' }),
      persistResultAndPublishOutbox: async (commit) => {
        commits.push(commit);
      },
    });

    await service.execute({
      tool,
      input: { name: 'Acme Capital' },
      context,
      idempotencyKey: 'idem-outbox-1',
    });

    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      idempotencyKey: 'idem-outbox-1',
      toolName: 'crm.create_company',
      outboxEvent: {
        type: 'tool.execution.completed',
      },
    });
  });

  it('does not persist a success result or publish an outbox event when the external effect fails', async () => {
    const persistResultAndPublishOutbox = vi.fn();
    const service = new ToolExecutionService({
      authorize: async () => true,
      execute: async () => {
        throw new Error('CRM unavailable');
      },
      persistResultAndPublishOutbox,
    });

    await expect(
      service.execute({
        tool,
        input: { name: 'Acme Capital' },
        context,
        idempotencyKey: 'idem-failure-1',
      }),
    ).rejects.toThrow('CRM unavailable');

    expect(persistResultAndPublishOutbox).not.toHaveBeenCalled();
  });
});
