export type SafeScalar = string | number | boolean | null;

const MAX_STRING_LENGTH = 1024;

const DENY_KEYS = new Set([
  'prompt',
  'completion',
  'password',
  'token',
  'secret',
  'apikey',
  'authorization',
  'cookie',
  'input',
  'output',
  'body',
  'privatekey',
  'credentials',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'setcookie',
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function sanitizeAttributes(input: Record<string, unknown>): Record<string, SafeScalar> {
  const result: Record<string, SafeScalar> = {};
  for (const [key, value] of Object.entries(input)) {
    if (DENY_KEYS.has(normalizeKey(key)) || value === undefined) continue;
    if (typeof value === 'string') {
      result[key] = value.slice(0, MAX_STRING_LENGTH);
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[key] = value;
      continue;
    }
    if (typeof value === 'boolean' || value === null) {
      result[key] = value;
    }
  }
  return result;
}
