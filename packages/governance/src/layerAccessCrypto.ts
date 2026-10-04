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

let hasWarnedDevFallback = false;

export function resetDevFallbackWarning(): void {
  hasWarnedDevFallback = false;
}

export function resolveCredentialKey(customKey?: Buffer): Buffer {
  if (customKey) {
    if (customKey.length === 32) {
      return customKey;
    }
    throw new Error(
      `Invalid custom credential key: expected 32 bytes, received ${customKey.length}`
    );
  }
  const envKey = process.env.GEV_CREDENTIAL_KEY?.trim();
  if (envKey) {
    if (envKey.length === 64 && /^[0-9a-fA-F]+$/.test(envKey)) {
      return Buffer.from(envKey, 'hex');
    }
    throw new Error(
      `Invalid GEV_CREDENTIAL_KEY: expected a 64-character hexadecimal string (32 bytes), received length ${envKey.length}`
    );
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('GEV_CREDENTIAL_KEY is required in production; refusing dev fallback key');
  }
  if (!hasWarnedDevFallback) {
    hasWarnedDevFallback = true;
    console.warn(
      '⚠ [SECURITY] GEV_CREDENTIAL_KEY is unset; using DEV_FALLBACK_KEY. All tenant layer secrets are decryptable by anyone with repository access.'
    );
  }
  return DEV_FALLBACK_KEY;
}

export interface EncryptSecretOptions {
  key?: Buffer;
  keyId?: string;
  aad?: string | Buffer;
}

export interface DecryptSecretOptions {
  key?: Buffer;
  aad?: string | Buffer;
}

export function encryptSecret(
  plainText: string,
  optionsOrKey?: Buffer | EncryptSecretOptions
): string {
  const options: EncryptSecretOptions = Buffer.isBuffer(optionsOrKey)
    ? { key: optionsOrKey }
    : (optionsOrKey ?? {});
  const key = resolveCredentialKey(options.key);
  const keyId = options.keyId ?? 'default';
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  if (options.aad) {
    cipher.setAAD(Buffer.isBuffer(options.aad) ? options.aad : Buffer.from(options.aad, 'utf8'));
  }
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${keyId}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(
  encryptedPayload: string,
  optionsOrKey?: Buffer | DecryptSecretOptions
): string {
  const options: DecryptSecretOptions = Buffer.isBuffer(optionsOrKey)
    ? { key: optionsOrKey }
    : (optionsOrKey ?? {});
  const parts = encryptedPayload.split(':');
  let ivHex: string | undefined;
  let tagHex: string | undefined;
  let cipherHex: string | undefined;

  if (parts.length === 5 && parts[0] === 'v1') {
    // parts[1] is keyId
    ivHex = parts[2];
    tagHex = parts[3];
    cipherHex = parts[4];
  } else if (parts.length === 3) {
    // Legacy 3-part format: iv:authTag:ciphertext
    ivHex = parts[0];
    tagHex = parts[1];
    cipherHex = parts[2];
  } else {
    throw new Error('Malformed encrypted secret payload');
  }

  if (!ivHex || !tagHex || !cipherHex) {
    throw new Error('Malformed encrypted secret payload');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(cipherHex, 'hex');

  if (iv.length !== IV_LENGTH_BYTES || tag.length !== TAG_LENGTH_BYTES) {
    throw new Error('Invalid initialization vector or authentication tag length');
  }

  const key = resolveCredentialKey(options.key);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  if (options.aad) {
    decipher.setAAD(Buffer.isBuffer(options.aad) ? options.aad : Buffer.from(options.aad, 'utf8'));
  }
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Derives the standardized masked fingerprint for a credential secret.
 * Adheres to ADR 0049 format: '•••••••• [A-Z0-9]{4}'.
 * Non-reversible display masking. Note: deliberately reveals the final 4 alphanumeric
 * characters of the credential secret for operator identification.
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
