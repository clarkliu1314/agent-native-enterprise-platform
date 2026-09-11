import { describe, expect, it, vi } from 'vitest';
import { createLeaseHeartbeat } from './lease-heartbeat';

describe('lease heartbeat', () => {
  it('renews the claimed fencing token and stops cleanly', async () => {
    vi.useFakeTimers();
    const renew = vi.fn(async () => true);
    const heartbeat = createLeaseHeartbeat(renew, { intervalMs: 100 });
    const handle = heartbeat.start({ runId: 'run-1', owner: 'worker-1', fencingToken: 7n, leaseMs: 3000 });

    await vi.advanceTimersByTimeAsync(100);
    expect(renew).toHaveBeenCalledWith({ runId: 'run-1', owner: 'worker-1', fencingToken: 7n, leaseMs: 3000 });

    handle.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(renew).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does not surface a heartbeat renewal failure into the worker loop', async () => {
    vi.useFakeTimers();
    const renew = vi.fn(async () => { throw new Error('db unavailable'); });
    const heartbeat = createLeaseHeartbeat(renew, { intervalMs: 100 });
    const handle = heartbeat.start({ runId: 'run-1', owner: 'worker-1', fencingToken: 7n, leaseMs: 3000 });

    await expect(vi.advanceTimersByTimeAsync(100)).resolves.toBeUndefined();
    handle.stop();
    vi.useRealTimers();
  });
});
