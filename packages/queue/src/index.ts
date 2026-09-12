import { createClient } from 'redis';
import type { QueueConsumer, QueuePublisher } from '@agent-native/runtime';

const DEFAULT_PREFIX = 'agent-native:queue:';

export interface RedisCommandClient {
  connect(): Promise<void>;
  quit(): Promise<unknown>;
  sendCommand(command: string[]): Promise<unknown>;
}

export interface RedisStreamQueueOptions {
  url: string;
  prefix?: string;
  group?: string;
  consumer?: string;
  blockMs?: number;
  pendingIdleMs?: number;
}

export class RedisStreamPublisher implements QueuePublisher {
  private readonly client: RedisCommandClient;
  private connected = false;
  private readonly prefix: string;

  constructor(
    private readonly options: RedisStreamQueueOptions,
    client: RedisCommandClient = createClient({ url: options.url }),
  ) {
    this.client = client;
    this.prefix = options.prefix ?? DEFAULT_PREFIX;
  }

  async connect(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
  }

  async publish(topic: string, payload: unknown): Promise<void> {
    await this.connect();
    await this.client.sendCommand(['XADD', this.stream(topic), '*', 'payload', JSON.stringify(payload)]);
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.quit();
      this.connected = false;
    }
  }

  private stream(topic: string): string {
    return `${this.prefix}${topic}`;
  }
}

export class RedisStreamConsumer implements QueueConsumer {
  private readonly client: RedisCommandClient;
  private connected = false;
  private readonly prefix: string;
  private readonly group: string;
  private readonly consumer: string;
  private readonly blockMs: number;
  private readonly pendingIdleMs: number;

  constructor(
    private readonly options: RedisStreamQueueOptions,
    client: RedisCommandClient = createClient({ url: options.url }),
  ) {
    this.client = client;
    this.prefix = options.prefix ?? DEFAULT_PREFIX;
    this.group = options.group ?? 'runtime-workers';
    this.consumer = options.consumer ?? `consumer-${process.pid}`;
    this.blockMs = options.blockMs ?? 5_000;
    this.pendingIdleMs = options.pendingIdleMs ?? 60_000;
  }

  async connect(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
  }

  async consume(handler: (message: { topic: string; payload: unknown }) => Promise<void>): Promise<void> {
    await this.connect();
    for (;;) {
      await this.consumeOnce(handler);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async consumeOnce(handler: (message: { topic: string; payload: unknown }) => Promise<void>): Promise<number> {
    await this.connect();
    let processed = 0;
    const streams = await this.discoverStreams();
    for (const stream of streams) {
      await this.ensureGroup(stream);
      for (const message of await this.read(stream)) {
        const topic = stream.slice(this.prefix.length);
        try {
          await handler({ topic, payload: JSON.parse(message.payload) });
          await this.client.sendCommand(['XACK', stream, this.group, message.id]);
          processed += 1;
        } catch {
          // Leave failed deliveries pending for XAUTOCLAIM.
        }
      }
      processed += await this.reclaimPending(stream, handler);
    }
    return processed;
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.quit();
      this.connected = false;
    }
  }

  private async discoverStreams(): Promise<string[]> {
    const result = await this.client.sendCommand(['SCAN', '0', 'MATCH', `${this.prefix}*`, 'COUNT', '100']) as [string, string[]];
    return result[1] ?? [];
  }

  private async ensureGroup(stream: string): Promise<void> {
    try {
      await this.client.sendCommand(['XGROUP', 'CREATE', stream, this.group, '0', 'MKSTREAM']);
    } catch (error) {
      if (!String(error).includes('BUSYGROUP')) throw error;
    }
  }

  private async read(stream: string): Promise<Array<{ id: string; payload: string }>> {
    const result = await this.client.sendCommand([
      'XREADGROUP', 'GROUP', this.group, this.consumer,
      'COUNT', '10', 'BLOCK', String(this.blockMs), 'STREAMS', stream, '>',
    ]) as unknown[] | null;
    return parseStreamMessages(result);
  }

  private async reclaimPending(
    stream: string,
    handler: (message: { topic: string; payload: unknown }) => Promise<void>,
  ): Promise<number> {
    const result = await this.client.sendCommand([
      'XAUTOCLAIM', stream, this.group, this.consumer, String(this.pendingIdleMs), '0-0', 'COUNT', '10',
    ]) as unknown[];
    const entries = Array.isArray(result) && Array.isArray(result[1]) ? result[1] : [];
    const topic = stream.slice(this.prefix.length);
    let processed = 0;
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2 || !Array.isArray(entry[1])) continue;
      const fields = entry[1] as unknown[];
      const payloadIndex = fields.findIndex((value) => value === 'payload');
      if (payloadIndex < 0 || typeof fields[payloadIndex + 1] !== 'string') continue;
      const id = String(entry[0]);
      try {
        await handler({ topic, payload: JSON.parse(fields[payloadIndex + 1] as string) });
        await this.client.sendCommand(['XACK', stream, this.group, id]);
        processed += 1;
      } catch {
        // Keep pending for the next claim cycle.
      }
    }
    return processed;
  }
}

function parseStreamMessages(result: unknown[] | null): Array<{ id: string; payload: string }> {
  if (!Array.isArray(result) || result.length === 0 || !Array.isArray(result[0])) return [];
  const messages = result[0] as unknown[];
  if (!Array.isArray(messages[1])) return [];
  return (messages[1] as unknown[]).flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length < 2 || !Array.isArray(entry[1])) return [];
    const fields = entry[1] as unknown[];
    const payloadIndex = fields.findIndex((value) => value === 'payload');
    if (payloadIndex < 0 || typeof fields[payloadIndex + 1] !== 'string') return [];
    return [{ id: String(entry[0]), payload: fields[payloadIndex + 1] as string }];
  });
}

export function createRedisPublisher(url = process.env.REDIS_URL ?? 'redis://localhost:6379'): RedisStreamPublisher {
  return new RedisStreamPublisher({ url });
}

export function createRedisConsumer(url = process.env.REDIS_URL ?? 'redis://localhost:6379'): RedisStreamConsumer {
  return new RedisStreamConsumer({ url });
}
