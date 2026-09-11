import { describe, expect, it, vi } from 'vitest';
import {
  ToolExecutionService,
  ToolPermissionDeniedError,
  type ToolDefinition,
  type ToolExecutionContext,
} from './tool-execution';

/**
 * Task 4 RED tests.
 *
 * These tests deliberately describe the safety boundary before the implementation exists:
 * 1. authorization must happen before an externally effectful tool is invoked;
 * 2. the same idempotency key must never produce a second external side effect;
 * 3. a successful effect and its outbox event must be committed as one durable operation;
 * 4. a failed effect must not publish a success event.
 *
 * The tests use an in-process durable fake only to make the contract executable without
 * coupling the application-facing API to PostgreSQL. The production implementation will
 * provide the same semantics with a transactional persistence adapter.
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

  it('returns the persisted result for a retry with the same idempotency key', async () => {
    let externalCalls = 0;
    const execute = vi.fn().mockImplementation(async () => {
      externalCalls += 1;
      return { companyId: `company-${externalCalls}` };
    });

    const service = new ToolExecutionService({
      authorize: async () => true,
      execute,
    });

    const request = {
      tool,
      input: { name: 'Acme Capital' },
      context,
      idempotencyKey: 'idem-company-1',
    };

    const first = await service.execute(request);
    const retry = await service.execute(request);

    expect(first).toEqual(retry);
    expect(externalCalls).toBe(1);
  });

  it('persists one outbox event for one successful side effect', async () => {
    const outboxEvents: unknown[] = [];
    const service = new ToolExecutionService({
      authorize: async () => true,
      execute: async () => ({ companyId: 'company-1' }),
      publishOutbox: async (event) => {
        outboxEvents.push(event);
      },
    });

    await service.execute({
      tool,
      input: { name: 'Acme Capital' },
      context,
      idempotencyKey: 'idem-outbox-1',
    });

    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]).toMatchObject({
      type: 'tool.execution.completed',
      idempotencyKey: 'idem-outbox-1',
      toolName: 'crm.create_company',
    });
  });

  it('does not publish a success outbox event when the external effect fails', async () => {
    const publishOutbox = vi.fn();
    const service = new ToolExecutionService({
      authorize: async () => true,
      execute: async () => {
        throw new Error('CRM unavailable');
      },
      publishOutbox,
    });

    await expect(
      service.execute({
        tool,
        input: { name: 'Acme Capital' },
        context,
        idempotencyKey: 'idem-failure-1',
      }),
    ).rejects.toThrow('CRM unavailable');

    expect(publishOutbox).not.toHaveBeenCalled();
  });
});
