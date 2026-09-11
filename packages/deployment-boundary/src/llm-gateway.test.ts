import { describe, expect, it, vi } from 'vitest';
import type { LlmGateway } from './llm-gateway';

describe('LLM gateway contract', () => {
  it('delegates model invocation through a provider-neutral interface', async () => {
    const gateway: LlmGateway = {
      complete: vi.fn().mockResolvedValue({ output: 'ok' }),
    };

    const result = await gateway.complete({ model: 'test-model', input: 'hello' });

    expect(result.output).toBe('ok');
    expect(gateway.complete).toHaveBeenCalledWith({ model: 'test-model', input: 'hello' });
  });
});
