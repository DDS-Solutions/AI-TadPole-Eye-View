import crypto from 'node:crypto';
import {
  type AuditIntent,
  AuditIntent as AuditIntentSchema,
  type AuditOutcome,
  AuditOutcome as AuditOutcomeSchema,
} from '@gev/contracts';
import { type CanonicalJson, canonicalizeJson } from './canonicalJson.js';

export const AUDIT_REDACTED = '[REDACTED]';
export const AUDIT_MAX_DEPTH = 6;
export const AUDIT_MAX_OBJECT_KEYS = 64;
export const AUDIT_MAX_ARRAY_ITEMS = 64;
export const AUDIT_MAX_STRING_BYTES = 2_048;
export const AUDIT_MAX_PAYLOAD_BYTES = 16_384;

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const SENSITIVE_KEY_TOKENS = new Set([
  'authorization',
  'apikey',
  'credential',
  'credentials',
  'password',
  'passwd',
  'secret',
  'token',
  'cookie',
  'session',
  'jwt',
  'bearer',
  'privatekey',
  'signature',
  'taxid',
  'ssn',
]);

const SENSITIVE_KEY_PHRASES = new Set([
  'businesscontext',
  'businessname',
  'tenantdata',
  'tenantprivate',
  'customerdata',
  'contactemail',
  'contactphone',
  'contactaddress',
  'ownername',
  'socialsecurity',
]);

interface SanitizeContext {
  activePath: Set<object>;
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (SENSITIVE_KEY_TOKENS.has(normalized) || SENSITIVE_KEY_PHRASES.has(normalized)) {
    return true;
  }

  // Tokenize on non-alphanumeric delimiters and camelCase word boundaries
  const words = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  for (const word of words) {
    if (word === 'api') continue; // don't flag generic 'api' alone, e.g. 'api_url' or 'api_endpoint'
    if (SENSITIVE_KEY_TOKENS.has(word) || SENSITIVE_KEY_PHRASES.has(word)) {
      return true;
    }
  }

  for (const phrase of SENSITIVE_KEY_PHRASES) {
    if (normalized.startsWith(phrase) || normalized.endsWith(phrase)) {
      return true;
    }
  }

  return false;
}

export function redactAuditText(value: string, maxBytes = AUDIT_MAX_STRING_BYTES): string {
  let redacted = value
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi,
      AUDIT_REDACTED
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${AUDIT_REDACTED}`)
    .replace(/:\/\/[^\s/:@]+:[^\s/@]+@/g, `://${AUDIT_REDACTED}@`)
    .replace(
      /\b(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|cookie|session|jwt|bearer)\s*[:=]\s*[^\s,;]+/gi,
      (_match, label: string) => `${label}=${AUDIT_REDACTED}`
    );

  const bytes = utf8Bytes(redacted);
  if (bytes > maxBytes) {
    redacted = `[OMITTED:oversized-text:${bytes}-bytes]`;
  }
  return redacted;
}

function sanitizeValue(value: unknown, depth: number, context: SanitizeContext): CanonicalJson {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactAuditText(value);
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : '[OMITTED:non-finite-number]';
  }
  if (typeof value !== 'object') return `[OMITTED:${typeof value}]`;
  if (depth >= AUDIT_MAX_DEPTH) return '[OMITTED:depth-limit]';
  if (context.activePath.has(value)) return '[OMITTED:cyclic-reference]';

  context.activePath.add(value);
  try {
    if (Array.isArray(value)) {
      const retained = value
        .slice(0, AUDIT_MAX_ARRAY_ITEMS)
        .map((item) => sanitizeValue(item, depth + 1, context));
      if (value.length > retained.length) {
        retained.push({ _audit_omitted_items: value.length - retained.length });
      }
      return retained;
    }

    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const result: Record<string, CanonicalJson> = Object.create(null);
    for (const [rawKey, rawValue] of entries.slice(0, AUDIT_MAX_OBJECT_KEYS)) {
      if (FORBIDDEN_OBJECT_KEYS.has(rawKey)) continue;
      const key = redactAuditText(rawKey, 256);
      if (FORBIDDEN_OBJECT_KEYS.has(key)) continue;
      result[key] = isSensitiveKey(rawKey)
        ? AUDIT_REDACTED
        : sanitizeValue(rawValue, depth + 1, context);
    }
    if (entries.length > AUDIT_MAX_OBJECT_KEYS) {
      result._audit_omitted_keys = entries.length - AUDIT_MAX_OBJECT_KEYS;
    }
    return result;
  } finally {
    context.activePath.delete(value);
  }
}

export function sanitizeAuditValue(value: unknown): CanonicalJson {
  const sanitized = sanitizeValue(value, 0, { activePath: new Set() });
  const canonical = canonicalizeJson(sanitized);
  if (utf8Bytes(canonical) <= AUDIT_MAX_PAYLOAD_BYTES) return sanitized;
  return {
    _audit_omitted: 'payload-limit',
    sanitized_bytes: utf8Bytes(canonical),
    sanitized_sha256: crypto.createHash('sha256').update(canonical, 'utf8').digest('hex'),
  };
}

export function sanitizeAuditIntent(input: AuditIntent): AuditIntent {
  const intent = AuditIntentSchema.parse(input);
  return AuditIntentSchema.parse({
    ...intent,
    action: redactAuditText(intent.action, 128),
    target: redactAuditText(intent.target, 512),
    task_ref: redactAuditText(intent.task_ref, 256),
    ...(intent.params === undefined ? {} : { params: sanitizeAuditValue(intent.params) }),
  });
}

export function sanitizeAuditOutcome(input: AuditOutcome): AuditOutcome {
  const outcome = AuditOutcomeSchema.parse(input);
  return AuditOutcomeSchema.parse({
    ...outcome,
    ...(outcome.result === undefined ? {} : { result: sanitizeAuditValue(outcome.result) }),
    ...(outcome.error === undefined
      ? {}
      : { error: redactAuditText(outcome.error, AUDIT_MAX_STRING_BYTES) }),
  });
}

export function serializeSanitizedAuditValue(value: unknown): string {
  return canonicalizeJson(value as CanonicalJson);
}
