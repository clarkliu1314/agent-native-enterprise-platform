function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and non-negative`);
}

export function calculateRatio(successes: number, total: number): number {
  assertFiniteNonNegative(successes, 'successes');
  assertFiniteNonNegative(total, 'total');
  if (successes > total) throw new RangeError('successes cannot exceed total');
  return total === 0 ? 1 : successes / total;
}

export function calculateBurnRate(observedErrorRate: number, errorBudget: number): number {
  assertFiniteNonNegative(observedErrorRate, 'observedErrorRate');
  if (!Number.isFinite(errorBudget) || errorBudget <= 0) {
    throw new RangeError('errorBudget must be finite and positive');
  }
  return observedErrorRate / errorBudget;
}

export function calculateErrorBudgetRemaining(observedErrorRate: number, errorBudget: number): number {
  const burnRate = calculateBurnRate(observedErrorRate, errorBudget);
  return Math.max(0, 1 - burnRate);
}
