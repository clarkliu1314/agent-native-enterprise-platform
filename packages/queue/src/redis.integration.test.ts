import { afterAll, describe, expect, it } from 'vitest';
import { RedisStreamConsumer, RedisStreamPublisher } from './index';

const redisUrl = process.env.REDIS_URL;
const describeIfRedis = redisUrl ? describe : describe.skip;

describeIfRedis('RedisStreamConsumer integration', () => {
  const prefix = `integration:${Date.now()}:`;
  const group = `group-${Date.now()}`;
  const publisher = new RedisStreamPublisher({ url: redisUrl!, prefix });
  const firstConsumer = new RedisStreamConsumer({ url: redisUrl!, prefix, group, consumer: 'consumer-a', blockMs: 1, pendingIdleMs: 0 });
  const secondConsumer = new RedisStreamConsumer({ url: redisUrl!, prefix, group, consumer: 'consumer-b', blockMs: 1, pendingIdleMs: 0 });

  afterAll(async () => {
    await firstConsumer.close();
    await secondConsumer.close();
    await publisher.close();
  });

  it('acks successful deliveries and reclaims failed pending deliveries', async () => {
    await publisher.publish('agent.run', { runId: 'redis-integration-run', value: 1 });

    const firstAttempt: unknown[] = [];
    await expect(firstConsumer.consumeOnce(async (message) => {
      firstAttempt.push(message.payload);
      throw new Error('simulated worker crash');
    })).resolves.toBe(0);
    expect(firstAttempt).toHaveLength(2);

    const secondAttempt: unknown[] = [];
    await expect(secondConsumer.consumeOnce(async (message) => {
      secondAttempt.push(message.payload);
    })).resolves.toBe(1);
    expect(secondAttempt).toEqual([{ runId: 'redis-integration-run', value: 1 }]);

    const thirdAttempt: unknown[] = [];
    await expect(secondConsumer.consumeOnce(async (message) => {
      thirdAttempt.push(message.payload);
    })).resolves.toBe(0);
    expect(thirdAttempt).toEqual([]);
  });
});
