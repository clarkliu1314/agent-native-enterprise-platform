import {
  IdempotencyFinalFailureError,
  type ToolExecutionRequest,
  type ToolExecutionResult,
  type ToolExecutionService,
} from '@agent-native/tool-runtime';
import { classifyError, createStructuredLogEvent, safeEmit, safeMetric, type ObservabilityLogger, type ObservabilityMetrics } from '@agent-native/observability';
import type { AuditRepository } from '@agent-native/runtime';
import type { CorrelationContext } from '@agent-native/observability';

export type RecoveryState = 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL';
export interface RecoveryCandidate { request: ToolExecutionRequest; state: RecoveryState; output?: unknown; correlation?: CorrelationContext; }
export interface RecoveryObservabilityOptions { logger?: ObservabilityLogger; metrics?: ObservabilityMetrics; correlation?: CorrelationContext; audit?: AuditRepository; }

export class RecoveryCoordinator {
  constructor(private readonly service: ToolExecutionService, private readonly observability: RecoveryObservabilityOptions = {}) {}

  async recover(candidate: RecoveryCandidate): Promise<ToolExecutionResult> {
    const context = candidate.correlation ?? this.observability.correlation;
    safeMetric(() => this.observability.metrics?.increment('agent_recovery_attempt_total', 1, { outcome: candidate.state === 'FAILED_RETRYABLE' ? 'RETRYING' : 'STARTED' }));
    if (candidate.state === 'FAILED_RETRYABLE') {
      safeMetric(() => this.observability.metrics?.increment('agent_recovery_retry_total', 1, { outcome: 'RETRYING' }));
    }
    if (candidate.state === 'FAILED_FINAL') {
      safeMetric(() => this.observability.metrics?.increment('agent_recovery_terminal_failure_total', 1, { outcome: 'FAILED' }));
      await this.appendAudit(candidate, 'RECOVERY_FAILED_FINAL', 'FAILED');
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
      await this.appendAudit(candidate, 'RECOVERY_SUCCEEDED', 'SUCCEEDED', { replayed: result.replayed });
      if (this.observability.logger && context) safeEmit(this.observability.logger, createStructuredLogEvent({
        context, event: 'recovery.completed', level: 'INFO', outcome: 'SUCCEEDED',
        attributes: { toolName: candidate.request.tool.name, replayed: result.replayed },
      }));
      return result;
    } catch (error) {
      await this.appendAudit(candidate, 'RECOVERY_FAILED', 'FAILED', { errorCode: classifyError(error) });
      if (this.observability.logger && context) safeEmit(this.observability.logger, createStructuredLogEvent({
        context, event: 'recovery.failed_final', level: 'ERROR', outcome: 'FAILED',
        errorCode: classifyError(error), attributes: { toolName: candidate.request.tool.name },
      }));
      safeMetric(() => this.observability.metrics?.increment('agent_recovery_terminal_failure_total', 1, { outcome: 'FAILED' }));
      throw error;
    }
  }

  private async appendAudit(candidate: RecoveryCandidate, action: string, outcome: 'SUCCEEDED' | 'FAILED', metadata: Record<string, string | number | boolean | null> = {}): Promise<void> {
    const audit = this.observability.audit;
    const context = candidate.correlation ?? this.observability.correlation;
    if (!audit || !context) return;
    await audit.append({
      auditId: `audit:${context.runId ?? candidate.request.idempotencyKey}:${action}:${candidate.state}`,
      tenantId: context.tenantId,
      occurredAt: new Date().toISOString(),
      actorId: 'system',
      actorType: 'SYSTEM',
      action,
      resourceType: 'RUN',
      resourceId: context.runId ?? candidate.request.idempotencyKey,
      outcome,
      reasonClass: 'SYSTEM',
      correlation: {
        requestId: context.requestId,
        traceId: context.traceId,
        ...(context.runId ? { runId: context.runId } : {}),
        ...(context.workflowId ? { workflowId: context.workflowId } : {}),
        ...(context.agentId ? { agentId: context.agentId } : {}),
      },
      metadata: { recoveryState: candidate.state, ...metadata },
    });
  }
}
