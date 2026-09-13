import {
  IdempotencyFinalFailureError,
  type ToolExecutionRequest,
  type ToolExecutionResult,
  type ToolExecutionService,
} from '@agent-native/tool-runtime';
import { classifyError, createStructuredLogEvent, safeEmit, type CorrelationContext, type ObservabilityLogger } from '@agent-native/observability';

export type RecoveryState = 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL';
export interface RecoveryCandidate { request: ToolExecutionRequest; state: RecoveryState; output?: unknown; correlation?: CorrelationContext; }
export interface RecoveryObservabilityOptions { logger?: ObservabilityLogger; correlation?: CorrelationContext; }

export class RecoveryCoordinator {
  constructor(private readonly service: ToolExecutionService, private readonly observability: RecoveryObservabilityOptions = {}) {}

  async recover(candidate: RecoveryCandidate): Promise<ToolExecutionResult> {
    const context = candidate.correlation ?? this.observability.correlation;
    if (candidate.state === 'FAILED_FINAL') {
      if (this.observability.logger && context) safeEmit(this.observability.logger, createStructuredLogEvent({
        context, event: 'recovery.failed_final', level: 'ERROR', outcome: 'FAILED', errorCode: 'RECOVERY_FINAL',
        attributes: { toolName: candidate.request.tool.name },
      }));
      throw new IdempotencyFinalFailureError(candidate.request.idempotencyKey);
    }

    if (this.observability.logger && context) safeEmit(this.observability.logger, createStructuredLogEvent({
      context, event: 'recovery.claimed', level: 'INFO', outcome: 'STARTED',
      attributes: { state: candidate.state, toolName: candidate.request.tool.name },
    }));
    try {
      const result = await this.service.execute(candidate.request);
      if (this.observability.logger && context) safeEmit(this.observability.logger, createStructuredLogEvent({
        context, event: 'recovery.completed', level: 'INFO', outcome: 'SUCCEEDED',
        attributes: { toolName: candidate.request.tool.name, replayed: result.replayed },
      }));
      return result;
    } catch (error) {
      if (this.observability.logger && context) safeEmit(this.observability.logger, createStructuredLogEvent({
        context, event: 'recovery.failed_final', level: 'ERROR', outcome: 'FAILED',
        errorCode: classifyError(error), attributes: { toolName: candidate.request.tool.name },
      }));
      throw error;
    }
  }
}
