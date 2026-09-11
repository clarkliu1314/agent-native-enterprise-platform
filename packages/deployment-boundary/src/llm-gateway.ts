export interface LlmRequest {
  model: string;
  input: unknown;
}

export interface LlmResponse {
  output: unknown;
}

export interface LlmGateway {
  complete(request: LlmRequest): Promise<LlmResponse>;
}
