export interface DeploymentConfig {
  databaseUrl: string;
  redisUrl?: string;
  llmGatewayUrl?: string;
  llmProviderApiKey?: string;
  workerEndpoint?: string;
}

export function parseDeploymentConfig(
  env: Record<string, string | undefined>,
): DeploymentConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  return {
    databaseUrl,
    redisUrl: env.REDIS_URL,
    llmGatewayUrl: env.LLM_GATEWAY_URL,
    llmProviderApiKey: env.LLM_PROVIDER_API_KEY,
    workerEndpoint: env.WORKER_ENDPOINT,
  };
}
