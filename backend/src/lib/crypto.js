// AES-256-GCM encryption keyed off JWT_SECRET (v1.7.0 — used for GL integration tokens).
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

function keyFromSecret(secret) {
  const s = secret || process.env.JWT_SECRET || '';
  if (!s || s.length < 8) {
    throw new Error('crypto: JWT_SECRET is required for encryption');
  }
  return crypto.createHash('sha256').update(s).digest();
}

function encrypt(plaintext, secret) {
  if (plaintext == null) return null;
  const key = keyFromSecret(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(ciphertext, secret) {
  if (ciphertext == null) return null;
  const parts = String(ciphertext).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('crypto: invalid ciphertext format');
  }
  const key = keyFromSecret(secret);
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const enc = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

module.exports = { encrypt, decrypt };
