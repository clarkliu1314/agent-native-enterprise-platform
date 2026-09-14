import { safeMetric, type ObservabilityMetrics } from '@agent-native/observability';
import type { RuntimeAdapter, QueuePublisher } from './ports';
import type { DurableRepositories } from './repositories';
import type { AuditRepository } from './auditability';

export interface RecoveryOutcome {
  runId: string;
  recovered: boolean;
  action: 'RECLAIMED' | 'SKIPPED' | 'FAILED';
}

export interface RecoveryObservabilityOptions { metrics?: ObservabilityMetrics; }

export class RecoveryCoordinator {
  constructor(
    private readonly repos: DurableRepositories,
    private readonly adapter: RuntimeAdapter,
    private readonly leaseMs = 30_000,
    private readonly queue?: QueuePublisher,
    private readonly observability: RecoveryObservabilityOptions = {},
    private readonly audit?: AuditRepository,
  ) {}

  async recoverExpired(limit = 25): Promise<RecoveryOutcome[]> {
    const candidates = await this.repos.findExpiredRuns(limit);
    const outcomes: RecoveryOutcome[] = [];
    for (const candidate of candidates) {
      safeMetric(() => this.observability.metrics?.increment('agent_recovery_attempt_total', 1, { outcome: 'RETRYING' }));
      safeMetric(() => this.observability.metrics?.increment('agent_recovery_retry_total', 1, { outcome: 'RETRYING' }));
      try {
        if (this.queue) {
          await this.queue.publish('agent.run', { runId: candidate.runId, recovered: true });
        }
        const outcome: RecoveryOutcome = { runId: candidate.runId, recovered: true, action: 'RECLAIMED' };
        outcomes.push(outcome);
        await this.appendAudit(candidate, outcome);
      } catch (error) {
        void error;
        safeMetric(() => this.observability.metrics?.increment('agent_recovery_terminal_failure_total', 1, { outcome: 'FAILED' }));
        const outcome: RecoveryOutcome = { runId: candidate.runId, recovered: false, action: 'FAILED' };
        outcomes.push(outcome);
        await this.appendAudit(candidate, outcome);
      }
    }
    void this.adapter;
    void this.leaseMs;
    void this.repos;
    return outcomes;
  }

  private async appendAudit(candidate: Awaited<ReturnType<DurableRepositories['findExpiredRuns']>>[number], outcome: RecoveryOutcome): Promise<void> {
    if (!this.audit) return;
    const tenantId = typeof candidate.metadata?.tenantId === 'string' ? candidate.metadata.tenantId : 'unknown';
    const requestId = typeof candidate.metadata?.requestId === 'string' ? candidate.metadata.requestId : `req-${candidate.runId}`;
    const traceId = typeof candidate.metadata?.traceId === 'string' ? candidate.metadata.traceId : `trace-${candidate.runId}`;
    await this.audit.append({
      auditId: `audit:${candidate.runId}:RECOVERY_${outcome.action}:${candidate.attempt}`,
      tenantId,
      occurredAt: new Date().toISOString(),
      actorId: 'system',
      actorType: 'SYSTEM',
      action: `RECOVERY_${outcome.action}`,
      resourceType: 'RUN',
      resourceId: candidate.runId,
      outcome: outcome.action === 'FAILED' ? 'FAILED' : 'SUCCEEDED',
      reasonClass: 'SYSTEM',
      correlation: { requestId, traceId, runId: candidate.runId, ...(candidate.agentId ? { agentId: candidate.agentId } : {}) },
      metadata: { attempt: candidate.attempt },
    });
  }

  private async loadDurableCorrelation(runId: string): Promise<unknown> {
    const durableRun = await this.repos.getRun(runId);
    return durableRun?.metadata;
  }
}
