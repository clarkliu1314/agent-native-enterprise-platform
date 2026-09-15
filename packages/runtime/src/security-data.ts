export type SecuritySafeScalar = string | number | boolean | null;

const MAX_STRING_LENGTH = 1024;
const FORBIDDEN_KEYS = new Set([
  'prompt', 'completion', 'password', 'token', 'secret', 'apikey', 'authorization',
  'cookie', 'input', 'output', 'body', 'privatekey', 'credentials', 'accesstoken',
  'refreshtoken', 'clientsecret', 'setcookie',
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sanitizeSecurityData(input: Record<string, unknown>): Record<string, SecuritySafeScalar | Record<string, SecuritySafeScalar>> {
  const result: Record<string, SecuritySafeScalar | Record<string, SecuritySafeScalar>> = {};
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_KEYS.has(normalizeKey(key)) || value === undefined) continue;
    if (typeof value === 'string') {
      result[key] = value.slice(0, MAX_STRING_LENGTH);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      result[key] = value;
    } else if (typeof value === 'boolean' || value === null) {
      result[key] = value;
    } else if (isRecord(value)) {
      const nested = sanitizeSecurityData(value);
      if (Object.keys(nested).length > 0) result[key] = nested as Record<string, SecuritySafeScalar>;
    }
  }
  return result;
}
