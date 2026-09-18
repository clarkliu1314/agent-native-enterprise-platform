import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSecurityContext, SecurityContextError, requireSecurityContext } from '../../../runtime/src/security-context';
import { assertTenantOwnership } from '../../../runtime/src/tenant-scope';
import { authorizeComponent, createSecuredToolPermission } from '../../../runtime/src/least-privilege';
import { sanitizeSecurityData } from '../../../runtime/src/security-data';
import { sanitizeSecurityError } from '../../../runtime/src/security-errors';
import { InMemoryRetentionRepository, RetentionPurgeService } from '../../../runtime/src/retention-policy';

interface SecurityCaseResult {
  id: string;
  passed: boolean;
}

function context(permissions: string[] = []): ReturnType<typeof createSecurityContext> {
  return createSecurityContext({ tenantId: 'tenant-a', actorId: 'actor-a', permissions });
}

async function runCase(id: string, fn: () => void | Promise<void>): Promise<SecurityCaseResult> {
  try {
    await fn();
    return { id, passed: true };
  } catch {
    return { id, passed: false };
  }
}

describe('stage 12.5 security regression benchmark', () => {
  it('executes deterministic S01-S16 security cases and emits a safe report', async () => {
    const results: SecurityCaseResult[] = [];

    results.push(await runCase('S01', () => {
      expect(() => requireSecurityContext(null, 'run:write')).toThrow(SecurityContextError);
    }));
    results.push(await runCase('S02', () => {
      expect(() => createSecurityContext({ tenantId: ' ', actorId: 'actor-a', permissions: [] })).toThrow(SecurityContextError);
    }));
    results.push(await runCase('S03', () => {
      expect(() => createSecurityContext({ tenantId: 'tenant-a', actorId: '', permissions: [] })).toThrow(SecurityContextError);
    }));
    results.push(await runCase('S04', () => {
      expect(() => requireSecurityContext(context(), 'run:write')).toThrow(SecurityContextError);
    }));
    results.push(await runCase('S05', () => {
      expect(assertTenantOwnership(context(), 'tenant-a')).toBeUndefined();
    }));
    results.push(await runCase('S06', () => {
      expect(() => assertTenantOwnership(context(), 'tenant-b')).toThrow();
    }));
    results.push(await runCase('S07', () => {
      expect(authorizeComponent(context(['run:write']), 'api').tenantId).toBe('tenant-a');
    }));
    results.push(await runCase('S08', () => {
      expect(() => authorizeComponent(context(['run:write']), 'worker')).toThrow(SecurityContextError);
    }));
    results.push(await runCase('S09', async () => {
      let delegated = false;
      const secured = createSecuredToolPermission({
        context: context(['tool:invoke']),
        delegate: {
          async authorize(input) {
            expect(input.runId).toBe('run-s09');
            expect(input.agentId).toBe('agent-s09');
            expect(input.toolName).toBe('safe-tool');
            expect(input.input).toEqual({ value: 'safe' });
            delegated = true;
            return true;
          },
        },
      });
      await expect(secured.authorize({
        runId: 'run-s09',
        agentId: 'agent-s09',
        toolName: 'safe-tool',
        input: { value: 'safe' },
      })).resolves.toBe(true);
      expect(delegated).toBe(true);
    }));
    results.push(await runCase('S10', () => {
      expect(sanitizeSecurityData({ prompt: 'secret', tenantId: 'tenant-a', safe: 'ok' })).toEqual({ tenantId: 'tenant-a', safe: 'ok' });
    }));
    results.push(await runCase('S11', () => {
      expect(sanitizeSecurityData({ nested: { apiKey: 'secret', completion: 'secret', safe: 'ok' } })).toEqual({ nested: { safe: 'ok' } });
    }));
    results.push(await runCase('S12', () => {
      const result = sanitizeSecurityError(new Error('provider secret token=abc123'));
      expect(result.message).not.toContain('abc123');
      expect(result.message).not.toContain('provider secret');
    }));
    results.push(await runCase('S13', async () => {
      const service = new RetentionPurgeService(new InMemoryRetentionRepository(), { auditDays: 30 });
      await expect(service.purge({ context: null, category: 'AUDIT', now: '2026-09-15T00:00:00.000Z', idempotencyKey: 's13' })).rejects.toThrow('RETENTION_AUTHORIZATION_DENIED');
    }));
    results.push(await runCase('S14', async () => {
      const service = new RetentionPurgeService(new InMemoryRetentionRepository(), { auditDays: 30 });
      await expect(service.purge({ context: context(['retention:purge:audit']), tenantId: 'tenant-b', category: 'AUDIT', now: '2026-09-15T00:00:00.000Z', idempotencyKey: 's14' })).rejects.toThrow('RETENTION_TENANT_MISMATCH');
    }));
    results.push(await runCase('S15', async () => {
      const service = new RetentionPurgeService(new InMemoryRetentionRepository(), { correctnessDays: 365 });
      await expect(service.purge({ context: context(['retention:purge:audit']), category: 'CORRECTNESS', now: '2026-09-15T00:00:00.000Z', idempotencyKey: 's15' })).rejects.toThrow('RETENTION_PROTECTED_DATA');
    }));
    results.push(await runCase('S16', async () => {
      const repository = new InMemoryRetentionRepository([
        { id: 'old-1', tenantId: 'tenant-a', category: 'AUDIT', occurredAt: '2026-07-01T00:00:00.000Z' },
      ]);
      const service = new RetentionPurgeService(repository, { auditDays: 30 });
      const request = { context: context(['retention:purge:audit']), category: 'AUDIT' as const, now: '2026-09-15T00:00:00.000Z', idempotencyKey: 's16' };
      const first = await service.purge(request);
      const replay = await service.purge(request);
      expect(first.deletedIds).toEqual(['old-1']);
      expect(replay.replayed).toBe(true);
      expect(replay.deletedIds).toEqual(first.deletedIds);
      expect(replay.deletedCount).toBe(first.deletedCount);
    }));

    const artifact = {
      schemaVersion: 1,
      cases: results,
      summary: {
        total: results.length,
        passed: results.filter((result) => result.passed).length,
        failed: results.filter((result) => !result.passed).length,
      },
    };
    const artifactPath = resolve(process.cwd(), 'artifacts', 'security-regression-results.json');
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

    expect(artifact.summary).toEqual({ total: 16, passed: 16, failed: 0 });
  }, 30_000);
});
