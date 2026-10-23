import { describe, it, expect, beforeAll } from 'vitest';
import { encrypt, decrypt } from './crypto';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = '0'.repeat(64);
});

describe('crypto', () => {
  it('round-trips a plaintext string', () => {
    const ciphertext = encrypt('a-refresh-token-value');
    expect(ciphertext).not.toBe('a-refresh-token-value');
    expect(decrypt(ciphertext)).toBe('a-refresh-token-value');
  });

  it('produces different ciphertext for the same plaintext on repeated calls', () => {
    const a = encrypt('same-input');
    const b = encrypt('same-input');
    expect(a).not.toBe(b);
  });

  it('throws a clear error on a malformed payload', () => {
    expect(() => decrypt('not-a-valid-payload')).toThrow('Invalid ciphertext payload format');
  });
});
