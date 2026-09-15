import { describe, expect, it } from 'vitest';
import { MemoryObservabilityMetrics } from '../packages/observability/src/testing';
import { SLO_TARGETS } from '../packages/observability/src/slo-policy';
import { emitSloSnapshot, type SloSnapshot } from '../packages/observability/src/slo-metrics';

describe('SLO metric emission contract', () => {
  const snapshot: SloSnapshot = {
    apiHandoffSuccess: { complianceRatio: 0.999, burnRate: 1, errorBudgetRemaining: 1 },
    durableCommandCompletion: { complianceRatio: 0.99, burnRate: 1, errorBudgetRemaining: 1 },
    workerRecoveryWithin60s: { complianceRatio: 0.995, burnRate: 0.5, errorBudgetRemaining: 0.5 },
    outboxDeliveryWithin60s: { complianceRatio: 0.98, burnRate: 2, errorBudgetRemaining: 0 },
    auditCompleteness: { complianceRatio: 1 },
  };

  it('emits compliance, burn rate, and remaining budget for availability SLOs', () => {
    const metrics = new MemoryObservabilityMetrics();
    emitSloSnapshot(metrics, snapshot);

    const entries = metrics.entries();
    expect(entries).toHaveLength(13);
    expect(entries.filter((entry) => entry.name === 'agent_slo_compliance_ratio')).toHaveLength(5);
    expect(entries.filter((entry) => entry.name === 'agent_slo_burn_rate')).toHaveLength(4);
    expect(entries.filter((entry) => entry.name === 'agent_error_budget_remaining_ratio')).toHaveLength(4);
  });

  it('uses only the bounded SLO label and emits every baseline SLO', () => {
    const metrics = new MemoryObservabilityMetrics();
    emitSloSnapshot(metrics, snapshot);

    const labels = metrics.entries().map((entry) => entry.labels);
    expect(labels.every((value) => Object.keys(value).length === 1 && typeof value.slo === 'string')).toBe(true);
    expect(new Set(labels.map((value) => value.slo))).toEqual(new Set(Object.keys(SLO_TARGETS)));
  });

  it('treats audit completeness as a correctness invariant without an error budget metric', () => {
    const metrics = new MemoryObservabilityMetrics();
    emitSloSnapshot(metrics, snapshot);

    const auditEntries = metrics.entries().filter((entry) => entry.labels.slo === 'auditCompleteness');
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].name).toBe('agent_slo_compliance_ratio');
    expect(auditEntries[0].value).toBe(1);
  });

  it('rejects incomplete audit completeness snapshots', () => {
    const metrics = new MemoryObservabilityMetrics();
    expect(() => emitSloSnapshot(metrics, {
      ...snapshot,
      auditCompleteness: { complianceRatio: 0.999 },
    })).toThrow(/audit completeness/i);
  });

  it('isolates telemetry failures from the business path', () => {
    const metrics = {
      increment: () => { throw new Error('metric backend down'); },
      observe: () => { throw new Error('metric backend down'); },
      gauge: () => { throw new Error('metric backend down'); },
    };
    expect(() => emitSloSnapshot(metrics, snapshot)).not.toThrow();
  });
});
