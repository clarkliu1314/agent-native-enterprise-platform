import { describe, expect, it } from 'vitest';
import {
  createStructuredLogEvent,
  type CorrelationContext,
  type ObservabilityLogger,
  safeEmit,
} from './index.js';

describe('observability contract', () => {
  const context: CorrelationContext = {
    requestId: 'req-1',
    traceId: 'trace-1',
    tenantId: 'fund-1',
    runId: 'run-1',
    workflowId: 'workflow-1',
    agentId: 'agent-1',
    actorId: 'actor-1',
  };

  it('requires request and trace correlation for every lifecycle event', () => {
    const event = createStructuredLogEvent({
      context,
      event: 'run.started',
      level: 'INFO',
      outcome: 'STARTED',
    });

    expect(event.context).toEqual(context);
    expect(event.event).toBe('run.started');
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('accepts only stable lifecycle event names', () => {
    expect(() =>
      createStructuredLogEvent({
        context,
        event: 'run.started',
        level: 'INFO',
      }),
    ).not.toThrow();

    expect(() =>
      createStructuredLogEvent({
        context,
        event: 'arbitrary.user.event',
        level: 'INFO',
      }),
    ).toThrow(/unknown observability event/i);
  });

  it('isolates logger failures from the business path', () => {
    const logger: ObservabilityLogger = {
      emit: () => {
        throw new Error('telemetry unavailable');
      },
    };

    expect(() =>
      safeEmit(logger, createStructuredLogEvent({
        context,
        event: 'run.succeeded',
        level: 'INFO',
        outcome: 'SUCCEEDED',
      })),
    ).not.toThrow();
  });
});
