export const SLO_TARGETS = {
  apiHandoffSuccess: 0.999,
  durableCommandCompletion: 0.99,
  workerRecoveryWithin60s: 0.99,
  outboxDeliveryWithin60s: 0.99,
  auditCompleteness: 1,
} as const;

export type BurnRateClass = 'NORMAL' | 'SLOW_BURN' | 'FAST_BURN';

export function calculateErrorBudget(target: number): number {
  if (!Number.isFinite(target) || target < 0 || target > 1) {
    throw new RangeError('SLO target must be between 0 and 1');
  }
  return 1 - target;
}

export function classifyBurnRate(rate: number): BurnRateClass {
  if (!Number.isFinite(rate) || rate < 0) {
    throw new RangeError('burn rate must be a finite non-negative number');
  }
  if (rate <= 1) return 'NORMAL';
  if (rate < 14.5) return 'SLOW_BURN';
  return 'FAST_BURN';
}
