export interface LeaseHeartbeatClaim {
  runId: string;
  owner: string;
  fencingToken: bigint;
  leaseMs: number;
}

export interface LeaseHeartbeatHandle { stop(): void; }

export function createLeaseHeartbeat(
  renew: (input: LeaseHeartbeatClaim) => Promise<boolean>,
  options: { intervalMs: number } = { intervalMs: 10_000 },
) {
  return {
    start(claim: LeaseHeartbeatClaim, onLost?: () => void): LeaseHeartbeatHandle {
      let stopped = false;
      let lost = false;
      const tick = async () => {
        if (stopped || lost) return;
        try {
          const renewed = await renew(claim);
          if (!renewed) {
            lost = true;
            onLost?.();
          }
        } catch {
          // A transient heartbeat error does not immediately revoke ownership.
          // PostgreSQL fencing remains authoritative on every durable write.
        }
      };
      const timer = setInterval(() => { void tick(); }, Math.max(1, options.intervalMs));
      timer.unref?.();
      return {
        stop() {
          if (stopped) return;
          stopped = true;
          clearInterval(timer);
        },
      };
    },
  };
}
