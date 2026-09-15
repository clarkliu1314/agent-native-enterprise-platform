import type { ObservabilityMetrics } from './index.js';
import { safeMetric } from './index.js';
import { SLO_TARGETS, calculateErrorBudget } from './slo-policy.js';
import { calculateBurnRate, calculateErrorBudgetRemaining } from './slo-measurements.js';

export type SloName = keyof typeof SLO_TARGETS;

export type SloMeasurement = {
  complianceRatio: number;
};

export type SloSnapshot = Record<SloName, SloMeasurement>;

const AVAILABILITY_SLOS: ReadonlySet<SloName> = new Set([
  'apiHandoffSuccess',
  'durableCommandCompletion',
  'workerRecoveryWithin60s',
  'outboxDeliveryWithin60s',
]);

function assertRatio(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
}

export function emitSloSnapshot(metrics: ObservabilityMetrics, snapshot: SloSnapshot): void {
  for (const [name, target] of Object.entries(SLO_TARGETS) as [SloName, number][]) {
    const measurement = snapshot[name];
    if (!measurement) throw new Error(`Missing SLO measurement: ${name}`);
    assertRatio(measurement.complianceRatio, `${name} complianceRatio`);

    if (name === 'auditCompleteness' && measurement.complianceRatio !== 1) {
      throw new Error('Audit completeness is a correctness invariant and must remain 100%');
    }

    const labels = { slo: name };
    safeMetric(() => metrics.gauge('agent_slo_compliance_ratio', measurement.complianceRatio, labels));

    if (!AVAILABILITY_SLOS.has(name)) continue;

    const errorBudget = calculateErrorBudget(target);
    const observedErrorRate = 1 - measurement.complianceRatio;
    const burnRate = calculateBurnRate(observedErrorRate, errorBudget);
    const remaining = calculateErrorBudgetRemaining(observedErrorRate, errorBudget);

    safeMetric(() => metrics.gauge('agent_slo_burn_rate', burnRate, labels));
    safeMetric(() => metrics.gauge('agent_error_budget_remaining_ratio', remaining, labels));
  }
}
