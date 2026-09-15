export enum AdmissionDecision {
  ACCEPT = 'ACCEPT',
  DEFER = 'DEFER',
}

export interface WorkerAdmissionInput {
  activeCount: number;
  maxConcurrency: number;
}

export function decideWorkerAdmission(input: WorkerAdmissionInput): AdmissionDecision {
  const { activeCount, maxConcurrency } = input;
  if (!Number.isInteger(activeCount) || activeCount < 0) {
    throw new RangeError('activeCount must be a non-negative integer');
  }
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new RangeError('maxConcurrency must be a positive integer');
  }
  return activeCount < maxConcurrency ? AdmissionDecision.ACCEPT : AdmissionDecision.DEFER;
}
