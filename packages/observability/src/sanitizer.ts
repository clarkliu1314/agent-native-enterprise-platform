export type SafeScalar = string | number | boolean | null;

const DENY_KEYS = new Set([
  'prompt',
  'completion',
  'password',
  'apikey',
  'authorization',
  'input',
  'output',
]);

export function sanitizeAttributes(input: Record<string, unknown>): Record<string, SafeScalar> {
  const result: Record<string, SafeScalar> = {};
  for (const [key, value] of Object.entries(input)) {
    if (DENY_KEYS.has(key.toLowerCase()) || value === undefined) continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      result[key] = value;
    }
  }
  return result;
}
