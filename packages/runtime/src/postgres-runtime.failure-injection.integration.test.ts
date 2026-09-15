import { describe, expect, it } from 'vitest';
import { PostgresRuntimeRepository } from './postgres-runtime-repository';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('Stage 12.4 PostgreSQL failure injection', () => {
  it('rolls back command transaction when a post-write failure is injected before commit', async () => {
    const repository = await PostgresRuntimeRepository.create(databaseUrl!);
    const runId = `run:failure-injection:${Date.now()}`;

    await expect(
      repository.transaction(async (tx) => {
        await tx.createRun({ runId, status: 'QUEUED' });
        await tx.appendEvent({ runId, eventType: 'RUN_ACCEPTED', payload: { runId } });
        throw new Error('injected postgres failure before commit');
      }),
    ).rejects.toThrow('injected postgres failure before commit');

    const run = await repository.findRun(runId);
    const events = await repository.findEvents(runId);
    expect(run).toBeNull();
    expect(events).toHaveLength(0);

    await repository.close();
  });
});
