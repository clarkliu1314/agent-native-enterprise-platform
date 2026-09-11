import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const compose = readFileSync(new URL('../../../docker-compose.yml', import.meta.url), 'utf8');

describe('local Docker Compose environment', () => {
  it('defines the deterministic infrastructure services and health gates', () => {
    expect(compose).toContain('  postgres:');
    expect(compose).toContain('  redis:');
    expect(compose).toContain('  benchmark:');
    expect(compose).toContain('  worker:');
    expect(compose).toContain('healthcheck:');
    expect(compose).toContain('depends_on:');
    expect(compose).toContain('condition: service_healthy');
    expect(compose).toContain('DATABASE_URL: postgres://postgres:postgres@postgres:5432/agent_native');
    expect(compose).toContain('REDIS_URL: redis://redis:6379');
  });
});
