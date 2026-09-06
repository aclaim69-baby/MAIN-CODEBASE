/**
 * crypto.ts — Password hashing utilities using bcryptjs
 *
 * Passwords are NEVER stored in plaintext.
 * - hashPassword()   → produces a bcrypt hash (cost factor 10)
 * - verifyPassword() → compares a plaintext attempt against a stored hash
 *
 * The hash is a one-way operation. Super Admins can no longer "reveal"
 * passwords — instead they can reset them.
 */

import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

/**
 * Hash a plaintext password.
 * Returns a bcrypt hash string (≈60 chars) safe to store in the database.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

/**
 * Verify a plaintext attempt against a stored bcrypt hash.
 * Returns true if they match, false otherwise.
 */
export async function verifyPassword(
  plaintext: string,
  hash: string
): Promise<boolean> {
  // Guard: if the stored value is not a bcrypt hash (legacy plaintext during
  // migration), do a plain comparison as a one-time fallback so existing
  // admins aren't locked out. On next successful login the hash will be
  // upgraded automatically by the store.
  if (!hash.startsWith('$2a$') && !hash.startsWith('$2b$')) {
    return plaintext === hash; // legacy plaintext fallback
  }
  return bcrypt.compare(plaintext, hash);
}

/**
 * Returns true if the value is already a bcrypt hash (not legacy plaintext).
 */
export function isBcryptHash(value: string): boolean {
  return value.startsWith('$2a$') || value.startsWith('$2b$');
}
