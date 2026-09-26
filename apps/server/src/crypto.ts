import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

function key(): Buffer {
  const secret = process.env.ENCRYPTION_KEY ?? '';
  if (secret.length < 16) {
    throw new Error('Set ENCRYPTION_KEY (16+ characters) before saving LLM keys.');
  }
  return scryptSync(secret, 'agents-llm-keys', 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptSecret(payload: string): string {
  const [iv, tag, data] = payload.split('.');
  if (!iv || !tag || !data) throw new Error('Stored key is unreadable.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
