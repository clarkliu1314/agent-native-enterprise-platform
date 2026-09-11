import { describe, expect, it, vi } from 'vitest';
import { OutboxPublisher, type OutboxMessage, type OutboxRepository } from './publisher';

const message = (id: string): OutboxMessage => ({
  eventId: id,
  eventType: 'tool.execution.completed',
  payload: { id },
});

describe('OutboxPublisher', () => {
  it('publishes claimed messages and acknowledges only after broker success', async () => {
    const repository: OutboxRepository = {
      claim: vi.fn().mockResolvedValue([message('1')]),
      markPublished: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const publish = vi.fn().mockResolvedValue(undefined);

    const count = await new OutboxPublisher(repository, publish).publishBatch(10, 'worker-a');

    expect(count).toBe(1);
    expect(publish).toHaveBeenCalledWith(message('1'));
    expect(repository.markPublished).toHaveBeenCalledWith('1', 'worker-a');
    expect(repository.release).not.toHaveBeenCalled();
  });

  it('leaves a failed message retryable instead of acknowledging it', async () => {
    const error = new Error('broker unavailable');
    const repository: OutboxRepository = {
      claim: vi.fn().mockResolvedValue([message('2')]),
      markPublished: vi.fn(),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const publish = vi.fn().mockRejectedValue(error);

    await expect(new OutboxPublisher(repository, publish).publishBatch(10, 'worker-a')).resolves.toBe(0);
    expect(repository.markPublished).not.toHaveBeenCalled();
    expect(repository.release).toHaveBeenCalledWith('2', 'worker-a', error);
  });

  it('releases after transport succeeds when acknowledgement fails, allowing duplicate delivery', async () => {
    const error = new Error('db unavailable');
    const repository: OutboxRepository = {
      claim: vi.fn().mockResolvedValue([message('3')]),
      markPublished: vi.fn().mockRejectedValue(error),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const publish = vi.fn().mockResolvedValue(undefined);

    await expect(new OutboxPublisher(repository, publish).publishBatch(10, 'worker-a')).resolves.toBe(0);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(repository.release).toHaveBeenCalledWith('3', 'worker-a', error);
  });
});
