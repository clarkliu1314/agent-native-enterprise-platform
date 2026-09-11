import { describe, expect, it } from 'vitest';
import { parseDeploymentConfig } from './config';

describe('deployment configuration', () => {
  it('requires DATABASE_URL and fails closed when it is absent', () => {
    expect(() => parseDeploymentConfig({})).toThrow('DATABASE_URL');
  });

  it('preserves optional coordination and gateway configuration', () => {
    expect(parseDeploymentConfig({
      DATABASE_URL: 'postgres://db',
      REDIS_URL: 'redis://redis',
      LLM_GATEWAY_URL: 'https://llm-gateway',
      LLM_PROVIDER_API_KEY: 'secret',
      WORKER_ENDPOINT: 'http://worker:8080',
    })).toEqual({
      databaseUrl: 'postgres://db',
      redisUrl: 'redis://redis',
      llmGatewayUrl: 'https://llm-gateway',
      llmProviderApiKey: 'secret',
      workerEndpoint: 'http://worker:8080',
    });
  });
});
