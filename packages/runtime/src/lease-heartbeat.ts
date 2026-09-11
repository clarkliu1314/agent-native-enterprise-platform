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
    start(claim: LeaseHeartbeatClaim): LeaseHeartbeatHandle {
      let stopped = false;
      const tick = () => {
        if (stopped) return;
        void renew(claim).catch(() => undefined);
      };
      const timer = setInterval(tick, Math.max(1, options.intervalMs));
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
