/**
 * Masking for anything that leaves the primary record: audit metadata, API views and logs.
 * Secrets are removed entirely; PII keeps just enough to be recognisable to an operator.
 */

const SECRET_KEYS = new Set(['password', 'passwordhash', 'token', 'accesstoken', 'refreshtoken', 'secret', 'authorization']);

/**
 * Reveals the last 4 characters of normal-length values; short values (< 8 chars) reveal at most
 * a third, so a short identifier is never effectively disclosed (e.g. "ABCD" → "****D").
 */
function revealTail(value: string): string {
  const compact = value.replace(/\s|-/g, '');
  const visible = compact.length >= 8 ? 4 : Math.floor(compact.length / 3);
  return `****${visible > 0 ? compact.slice(-visible) : ''}`;
}

export function maskTaxId(value: string): string {
  return revealTail(value);
}

export function maskPhone(value: string): string {
  return revealTail(value);
}

export function maskEmail(value: string): string {
  const [local, domain] = value.split('@');
  if (!domain) return '***';
  return `${local.charAt(0)}***@${domain}`;
}

export function maskName(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0)}.`)
    .join(' ');
}

const PII_MASKERS: Record<string, (v: string) => string> = {
  ownertaxid: maskTaxId,
  ownerphone: maskPhone,
  owneremail: maskEmail,
  ownerfullname: maskName,
};

/** Deep-copies `input`, dropping secrets and masking known PII fields by key name. */
export function redactSensitive<T>(input: T): T {
  return redact(input) as T;
}

function redact(value: unknown, key?: string): unknown {
  const normalisedKey = key?.toLowerCase();
  if (normalisedKey && SECRET_KEYS.has(normalisedKey)) return '[REDACTED]';

  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  const masker = normalisedKey ? PII_MASKERS[normalisedKey] : undefined;
  if (masker && typeof value === 'string') return masker(value);
  return value;
}
