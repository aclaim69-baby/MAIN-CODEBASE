/**
 * storageMonitor.ts — Global (non-persisted) Zustand store for storage state.
 *
 * WHY A SEPARATE STORE:
 *   The main app store (store.ts) is persisted to localStorage via Zustand
 *   persist. The storage monitor must NOT be persisted — it tracks the health
 *   of the storage layer itself and needs to reset on each page load.
 *
 * REDUCED RISK POST SERVER-FIRST REFACTOR:
 *   Records and activity logs are no longer persisted to localStorage.
 *   Only config/structure data is stored (departments, sections, equipment
 *   types, templates, field configs, settings, admin users).
 *   Typical localStorage usage is now < 200 KB regardless of record count.
 *   The warning thresholds are kept as a defence-in-depth safety net.
 *
 * HOW IT FITS IN:
 *   1. The Zustand persist custom storage adapter (in store.ts) calls
 *      storageMonitor.getState().handleWriteResult() after every persist write.
 *   2. App.tsx schedules periodic calls to checkUsage() to proactively detect
 *      any unexpected growth.
 *   3. StorageWarningBanner subscribes to this store and renders accordingly.
 *   4. TechnicianFlow checks isSubmissionBlocked before calling addRecord()
 *      (guards config data, not record data — records bypass localStorage).
 *
 * WARNING LEVELS:
 *   'none'     — usage < 4 MB   → no banner
 *   'warning'  — usage ≥ 4 MB   → yellow dismissible banner
 *   'critical' — usage ≥ 5 MB   → red non-dismissible banner
 *   'exceeded' — QuotaExceededError was thrown → red non-dismissible
 */

import { create } from 'zustand';
import {
  getStorageUsageMB,
  WARN_THRESHOLD_MB,
  BLOCK_THRESHOLD_MB,
  StorageWriteResult,
} from './safeStorage';

export type StorageWarningLevel = 'none' | 'warning' | 'critical' | 'exceeded';

interface StorageMonitorState {
  /** Current measured usage in MB. Updated by checkUsage() and handleWriteResult(). */
  usageMB: number;

  /** Computed warning level based on usage and any write errors. */
  warningLevel: StorageWarningLevel;

  /**
   * When truthy, submission should be blocked.
   * True when warningLevel is 'critical' or 'exceeded'.
   */
  isSubmissionBlocked: boolean;

  /**
   * The human-readable error or warning message to display.
   * Null when warningLevel is 'none'.
   */
  displayMessage: string | null;

  /**
   * Whether the user has explicitly dismissed the warning banner.
   * Only applies at the 'warning' level — critical/exceeded cannot be dismissed.
   */
  isDismissed: boolean;

  // ── Actions ──

  /**
   * Measure current localStorage usage and update warningLevel accordingly.
   * Should be called:
   *   - On app mount
   *   - Periodically (every 60s)
   *   - After any large write (record submission, settings change)
   */
  checkUsage: () => void;

  /**
   * Called by the safe Zustand persist adapter after every write attempt.
   * If the write failed with quota_exceeded, escalates warningLevel to 'exceeded'.
   * If the write succeeded, re-checks usage to catch incremental growth.
   */
  handleWriteResult: (result: StorageWriteResult) => void;

  /**
   * Dismiss the warning banner. Only works at 'warning' level.
   * Critical and exceeded banners cannot be dismissed.
   */
  dismissWarning: () => void;

  /**
   * Reset the dismissed state — called when usage drops back below WARN_THRESHOLD_MB.
   */
  _resetDismissed: () => void;
}

// ─── Level derivation ─────────────────────────────────────────────────────────

function deriveLevel(usageMB: number, currentLevel: StorageWarningLevel): StorageWarningLevel {
  // Once 'exceeded' (an actual QuotaExceededError), stay at 'exceeded'.
  // The user must clear data and reload — we don't auto-recover.
  if (currentLevel === 'exceeded') return 'exceeded';

  if (usageMB >= BLOCK_THRESHOLD_MB) return 'critical';
  if (usageMB >= WARN_THRESHOLD_MB)  return 'warning';
  return 'none';
}

function isBlocked(level: StorageWarningLevel): boolean {
  return level === 'critical' || level === 'exceeded';
}

function buildMessage(level: StorageWarningLevel, usageMB: number): string | null {
  switch (level) {
    case 'none':
      return null;
    case 'warning':
      return `Storage is ${usageMB.toFixed(1)} MB of ~5 MB used (${Math.round((usageMB / 5) * 100)}%). ` +
             'Consider syncing data to free up space before it fills.';
    case 'critical':
      return `Storage is almost full (${usageMB.toFixed(1)} MB of ~5 MB). ` +
             'New inspections are blocked until space is freed. Reload after clearing old data.';
    case 'exceeded':
      return 'Storage limit reached. New inspections are not being saved. ' +
             'Please sync or clear old data, then reload the page.';
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useStorageMonitor = create<StorageMonitorState>()((set, get) => ({
  usageMB: 0,
  warningLevel: 'none',
  isSubmissionBlocked: false,
  displayMessage: null,
  isDismissed: false,

  checkUsage: () => {
    const usageMB = getStorageUsageMB();
    const prev = get();
    const level = deriveLevel(usageMB, prev.warningLevel);
    // If usage dropped back below warning threshold, allow banner to show again
    const isDismissed = level === 'none' ? false : prev.isDismissed;

    set({
      usageMB,
      warningLevel: level,
      isSubmissionBlocked: isBlocked(level),
      displayMessage: buildMessage(level, usageMB),
      isDismissed,
    });
  },

  handleWriteResult: (result) => {
    if (!result.success && result.error === 'quota_exceeded') {
      // Escalate immediately — a real QuotaExceededError occurred.
      const usageMB = getStorageUsageMB();
      set({
        usageMB,
        warningLevel: 'exceeded',
        isSubmissionBlocked: true,
        displayMessage: result.message ??
          'Storage limit reached. New inspections are not being saved. ' +
          'Please sync or clear old data.',
        isDismissed: false, // force banner to show
      });
      console.error('[storageMonitor] 🚨 QuotaExceededError — storage full.', {
        usageMB: usageMB.toFixed(2),
      });
    } else if (result.success) {
      // Successful write — re-measure to catch incremental growth.
      get().checkUsage();
    } else {
      // Other write failure (security error, unknown) — log but don't block.
      console.warn('[storageMonitor] ⚠️ localStorage write failed:', result.message);
    }
  },

  dismissWarning: () => {
    const { warningLevel } = get();
    // Only 'warning' level is dismissible. Critical and exceeded are persistent.
    if (warningLevel === 'warning') {
      set({ isDismissed: true });
    }
  },

  _resetDismissed: () => set({ isDismissed: false }),
}));

// Expose on window for console inspection (dev convenience only)
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__storageMonitor = useStorageMonitor;
}
