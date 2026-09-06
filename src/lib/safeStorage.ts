/**
 * safeStorage.ts — Safe localStorage wrapper with quota detection.
 *
 * WHY THIS EXISTS:
 *   localStorage has a browser-enforced ~5–10 MB limit. When it is exceeded,
 *   the browser throws a QuotaExceededError. Without this wrapper, that error
 *   is silently swallowed by Zustand's persist middleware — the user believes
 *   their data was saved when it was not.
 *
 *   This module is the SINGLE point of contact for all localStorage writes in
 *   the application. Nothing else writes to localStorage directly.
 *
 * USAGE:
 *   import { safeSetItem, safeRemoveItem, getStorageUsageMB } from './safeStorage';
 *   const result = safeSetItem('key', 'value');
 *   if (!result.success) console.error(result.message);
 *
 * QUOTA CONSTANTS:
 *   WARN_THRESHOLD_MB  — non-blocking warning shown to user
 *   BLOCK_THRESHOLD_MB — submission blocked; critical warning shown
 *   These are conservative estimates. Actual browser quota varies (5–10 MB).
 */

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** Show non-blocking warning banner at this usage level. */
export const WARN_THRESHOLD_MB = 4.0;

/** Block new submissions and show critical banner at this usage level. */
export const BLOCK_THRESHOLD_MB = 5.0;

/**
 * Conservative estimate of the typical browser localStorage quota.
 * Used for percentage-of-capacity calculations in the UI.
 * Most browsers allow 5–10 MB; we use 5 MB as the safe lower bound.
 */
export const ESTIMATED_QUOTA_MB = 5.0;

// ─── Result types ─────────────────────────────────────────────────────────────

export type StorageErrorType = 'quota_exceeded' | 'security_error' | 'unknown';

export interface StorageWriteResult {
  success: boolean;
  error?: StorageErrorType;
  message?: string;
}

// ─── Detection helpers ────────────────────────────────────────────────────────

/**
 * Returns true for any error that signals localStorage quota was exceeded.
 * Browser naming varies:
 *   Chrome/Safari  → DOMException, name = 'QuotaExceededError',  code = 22
 *   Firefox        → DOMException, name = 'NS_ERROR_DOM_QUOTA_REACHED', code = 1014
 *   IE/Edge legacy → DOMException, name = 'QUOTA_EXCEEDED_ERR'
 */
function isQuotaError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.name === 'QUOTA_EXCEEDED_ERR' ||
    err.code === 22 ||    // Chrome/Safari legacy numeric code
    err.code === 1014     // Firefox numeric code
  );
}

// ─── Core write wrapper ───────────────────────────────────────────────────────

/**
 * Attempt to write a key-value pair to localStorage.
 * Returns a structured result — never throws.
 *
 * FAIL-SAFE GUARANTEE:
 *   On quota error: the previous value at `key` is left intact (browser does
 *   not partial-write; the attempted new value is simply rejected).
 *   On unknown error: same behaviour.
 *   Existing data is NEVER destroyed by a failed write.
 */
export function safeSetItem(key: string, value: string): StorageWriteResult {
  try {
    localStorage.setItem(key, value);
    return { success: true };
  } catch (err: unknown) {
    if (isQuotaError(err)) {
      return {
        success: false,
        error: 'quota_exceeded',
        message:
          'Storage limit reached. New inspections cannot be saved. ' +
          'Please sync or clear old data.',
      };
    }
    if (err instanceof DOMException && err.name === 'SecurityError') {
      return {
        success: false,
        error: 'security_error',
        message: 'Storage access was denied. This may occur in private browsing mode.',
      };
    }
    return {
      success: false,
      error: 'unknown',
      message: 'Failed to save data due to an unexpected error.',
    };
  }
}

/**
 * Safe localStorage.getItem — returns null on any error rather than throwing.
 */
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Safe localStorage.removeItem — silently absorbs errors.
 */
export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Non-critical — removal failures are silent.
  }
}

// ─── Usage measurement ────────────────────────────────────────────────────────

/**
 * Calculate total localStorage usage across ALL stored keys, in megabytes.
 *
 * MEASUREMENT METHOD:
 *   Each JS string character is stored as UTF-16 (2 bytes) internally, but
 *   localStorage typically encodes as UTF-16LE. Key + value lengths × 2 gives
 *   a close upper-bound approximation. For ASCII-heavy JSON this may over-count
 *   by ~0% (all chars < 128) and under-count slightly for multi-byte Unicode.
 *   Good enough for threshold warnings.
 *
 * Returns 0 if localStorage is inaccessible.
 */
export function getStorageUsageMB(): number {
  let totalBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null) {
        const value = localStorage.getItem(key) ?? '';
        totalBytes += (key.length + value.length) * 2; // UTF-16 encoding
      }
    }
  } catch {
    // localStorage unavailable (private mode, security policy).
  }
  return totalBytes / (1024 * 1024);
}

/**
 * Usage broken down by key — useful for the warning banner and dev tools.
 * Returns an array sorted by size descending.
 */
export function getStorageUsageByKey(): Array<{ key: string; sizeMB: number }> {
  const entries: Array<{ key: string; sizeMB: number }> = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null) {
        const value = localStorage.getItem(key) ?? '';
        const sizeMB = ((key.length + value.length) * 2) / (1024 * 1024);
        entries.push({ key, sizeMB });
      }
    }
  } catch {
    // ignore
  }
  return entries.sort((a, b) => b.sizeMB - a.sizeMB);
}

/**
 * Current storage usage as a 0–100 percentage of ESTIMATED_QUOTA_MB.
 */
export function getStorageUsagePercent(): number {
  return Math.min((getStorageUsageMB() / ESTIMATED_QUOTA_MB) * 100, 100);
}

/**
 * Returns a DOMException that looks like a QuotaExceededError.
 * Used exclusively by storageTest.ts to simulate a full quota.
 */
export function _makeQuotaError(): DOMException {
  return new DOMException('The quota has been exceeded.', 'QuotaExceededError');
}
