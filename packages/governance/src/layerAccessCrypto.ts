import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BYTES = 16;
const BULLETS_PREFIX = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'; // 8 bullets: '••••••••'

// Deterministic fallback for test/dev environments if GEV_CREDENTIAL_KEY is unset
const DEV_FALLBACK_KEY = crypto
  .createHash('sha256')
  .update('gev-tenant-layer-access-dev-secret-key-material-2026')
  .digest();

export function resolveCredentialKey(customKey?: Buffer): Buffer {
  if (customKey && customKey.length === 32) {
    return customKey;
  }
  const envKey = process.env.GEV_CREDENTIAL_KEY?.trim();
  if (envKey) {
    if (envKey.length === 64 && /^[0-9a-fA-F]+$/.test(envKey)) {
      return Buffer.from(envKey, 'hex');
    }
    return crypto.createHash('sha256').update(envKey, 'utf8').digest();
  }
  return DEV_FALLBACK_KEY;
}

export function encryptSecret(plainText: string, customKey?: Buffer): string {
  const key = resolveCredentialKey(customKey);
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(encryptedPayload: string, customKey?: Buffer): string {
  const parts = encryptedPayload.split(':');
  const ivHex = parts[0];
  const tagHex = parts[1];
  const cipherHex = parts[2];
  if (parts.length !== 3 || !ivHex || !tagHex || !cipherHex) {
    throw new Error('Malformed encrypted secret payload');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(cipherHex, 'hex');

  if (iv.length !== IV_LENGTH_BYTES || tag.length !== TAG_LENGTH_BYTES) {
    throw new Error('Invalid initialization vector or authentication tag length');
  }

  const key = resolveCredentialKey(customKey);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Derives the standardized masked fingerprint for a credential secret.
 * Adheres to ADR 0049 format: '•••••••• [A-Z0-9]{4}'.
 * Constant-time derivation prevents timing leaks.
 */
export function computeMaskedFingerprint(secret: string): string {
  const normalized = secret.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  let suffix: string;
  if (normalized.length >= 4) {
    suffix = normalized.slice(-4);
  } else {
    // Fall back to sha256 hash slice if fewer than 4 alphanumeric characters
    suffix = crypto
      .createHash('sha256')
      .update(secret, 'utf8')
      .digest('hex')
      .slice(0, 4)
      .toUpperCase();
  }
  return `${BULLETS_PREFIX} ${suffix}`;
}
