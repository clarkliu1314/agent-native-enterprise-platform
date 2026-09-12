import type { DurableRunState } from '@agent-native/runtime-contract/durable';

const transitions: Readonly<Record<DurableRunState, readonly DurableRunState[]>> = {
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'CANCELLED'],
  WAITING: ['QUEUED', 'CANCELLED'],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
};

export function assertValidDurableTransition(from: DurableRunState, to: DurableRunState): void {
  if (!transitions[from].includes(to)) throw new Error(`Invalid durable run transition: ${from} -> ${to}`);
}
