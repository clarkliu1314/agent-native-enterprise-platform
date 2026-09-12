import { describe, expect, it } from 'vitest';
import { RedisStreamPublisher, type RedisCommandClient } from './index';

class FakeRedisClient implements RedisCommandClient {
  connected = false;
  commands: string[][] = [];

  async connect(): Promise<void> {
    this.connected = true;
  }

  async quit(): Promise<void> {
    this.connected = false;
  }

  async sendCommand(command: string[]): Promise<unknown> {
    this.commands.push(command);
    return '1-0';
  }
}

describe('RedisStreamPublisher', () => {
  it('connects lazily and publishes JSON payloads to a topic stream', async () => {
    const client = new FakeRedisClient();
    const publisher = new RedisStreamPublisher({ url: 'redis://test', prefix: 'test:' }, client);

    await publisher.publish('agent.run', { runId: 'run-1', fencingToken: '2' });

    expect(client.connected).toBe(true);
    expect(client.commands).toEqual([
      ['XADD', 'test:agent.run', '*', 'payload', '{"runId":"run-1","fencingToken":"2"}'],
    ]);
  });

  it('closes an established connection idempotently', async () => {
    const client = new FakeRedisClient();
    const publisher = new RedisStreamPublisher({ url: 'redis://test' }, client);

    await publisher.connect();
    await publisher.close();
    await publisher.close();

    expect(client.connected).toBe(false);
  });
});
