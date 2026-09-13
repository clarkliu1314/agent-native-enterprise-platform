import {
  createStructuredLogEvent,
  safeEmit,
  type CorrelationContext,
  type ObservabilityLogger,
  type StructuredLogEvent,
} from './index.js';

export async function runObservabilityScenario(
  input: CorrelationContext & {
    toolName?: string;
    toolInput?: unknown;
    failTelemetry?: boolean;
  },
): Promise<{
  events: StructuredLogEvent[];
  serializedTelemetry: string;
  businessResult: { status: string };
  telemetryErrors: number;
}> {
  const events: StructuredLogEvent[] = [];
  let telemetryErrors = 0;
  const logger: ObservabilityLogger = {
    emit: (event) => {
      if (input.failTelemetry) throw new Error('telemetry unavailable');
      events.push(event);
    },
  };

  const emit = (event: StructuredLogEvent) => {
    const before = telemetryErrors;
    try {
      if (input.failTelemetry) telemetryErrors += 1;
      safeEmit(logger, event);
    } catch {
      telemetryErrors = before + 1;
    }
  };

  const context = { ...input };
  delete (context as { toolName?: string }).toolName;
  delete (context as { toolInput?: unknown }).toolInput;
  delete (context as { failTelemetry?: boolean }).failTelemetry;

  emit(createStructuredLogEvent({ context, event: 'api.accepted', level: 'INFO' }));
  emit(createStructuredLogEvent({ context, event: 'run.started', level: 'INFO', outcome: 'STARTED' }));
  if (input.toolName) {
    emit(createStructuredLogEvent({
      context,
      event: 'tool.started',
      level: 'INFO',
      attributes: { toolName: input.toolName, input: input.toolInput },
    }));
    emit(createStructuredLogEvent({
      context,
      event: 'tool.succeeded',
      level: 'INFO',
      outcome: 'SUCCEEDED',
      attributes: { toolName: input.toolName },
    }));
  }
  emit(createStructuredLogEvent({ context, event: 'outbox.published', level: 'INFO', outcome: 'PUBLISHED' }));

  return {
    events,
    serializedTelemetry: JSON.stringify(events),
    businessResult: { status: 'SUCCEEDED' },
    telemetryErrors,
  };
}
