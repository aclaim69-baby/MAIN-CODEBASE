/**
 * offlineQueue.ts — Durable offline submission queue.
 *
 * PURPOSE:
 *   If a user submits a checklist while offline (or the Supabase insert fails),
 *   the submission is queued in localStorage and retried automatically when the
 *   device comes back online.
 *
 * STORAGE SAFETY:
 *   All writes now go through safeSetItem() — QuotaExceededError is caught,
 *   reported to storageMonitor, and never silently swallowed.
 *
 * FREE TIER SAFETY:
 *   Max 20 queued items (prevents runaway storage). Old items are evicted first.
 */

import { supabase } from './supabase';
import { safeSetItem, safeGetItem, safeRemoveItem } from './safeStorage';
import { useStorageMonitor } from './storageMonitor';
import type { RecordRow } from './sync';

const QUEUE_KEY    = 'dc_submission_queue_v1';
const MAX_QUEUE    = 20;
const MAX_ATTEMPTS = 5;

interface QueuedRecord {
  record:    RecordRow;
  queuedAt:  string;
  attempts:  number;
}

// ─── Read / Write helpers ────────────────────────────────────────────────────

function readQueue(): QueuedRecord[] {
  try {
    const raw = safeGetItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedRecord[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedRecord[]): void {
  const result = safeSetItem(QUEUE_KEY, JSON.stringify(items));

  if (!result.success) {
    useStorageMonitor.getState().handleWriteResult(result);

    if (result.error === 'quota_exceeded') {
      const trimmed = items.slice(-Math.floor(MAX_QUEUE / 2));
      const retryResult = safeSetItem(QUEUE_KEY, JSON.stringify(trimmed));
      if (!retryResult.success) {
        console.error('[queue] Cannot write trimmed queue — storage critically full.');
      }
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function addToQueue(record: RecordRow): void {
  const queue = readQueue();

  // ── Deduplication guard ───────────────────────────────────────────────────
  // If a record with the SAME submission_id is already queued, skip silently.
  // This prevents multiple identical records from stacking up when the user
  // clicks Submit several times while offline (or during network errors).
  // NOTE: We intentionally do NOT deduplicate by equipmentId/date/technician —
  // the same equipment can legitimately be inspected many times.
  if (record.submission_id) {
    const alreadyQueued = queue.some(
      (q) => q.record.submission_id && q.record.submission_id === record.submission_id
    );
    if (alreadyQueued) {
      console.debug('[queue] ⛔ skipped duplicate submission_id:', record.submission_id, '| ref_id:', record.ref_id);
      return;
    }
  }

  const filtered = queue.filter((q) => q.record.id !== record.id);
  filtered.push({ record, queuedAt: new Date().toISOString(), attempts: 0 });
  const trimmed = filtered.length > MAX_QUEUE
    ? filtered.slice(filtered.length - MAX_QUEUE)
    : filtered;
  writeQueue(trimmed);
  console.debug('[queue] queued record:', record.ref_id, '| queue size:', trimmed.length);
}

export function removeFromQueue(id: string): void {
  const queue = readQueue().filter((q) => q.record.id !== id);
  writeQueue(queue);
}

export async function flushQueue(): Promise<void> {
  const queue = readQueue();
  if (queue.length === 0) return;

  console.debug('[queue] flushing', queue.length, 'queued records...');
  const remaining: QueuedRecord[] = [];

  for (const item of queue) {
    if (item.attempts >= MAX_ATTEMPTS) {
      console.error(
        '[queue] ❌ Record permanently dropped after', MAX_ATTEMPTS, 'failed attempts:',
        item.record.ref_id,
        '— This record was not saved to the database. Check connectivity and Supabase status.'
      );
      continue;
    }

    try {
      const { error } = await supabase
        .from('records')
        .upsert(item.record, { onConflict: 'id' });

      if (error) {
        const isUniqueViolation =
          error.code === '23505' ||
          error.message?.toLowerCase().includes('unique') ||
          error.message?.toLowerCase().includes('duplicate');

        if (isUniqueViolation) {
          console.warn('[queue] dropping — unique constraint conflict for', item.record.ref_id);
        } else {
          console.warn('[queue] flush failed for', item.record.ref_id, ':', error.message);
          remaining.push({ ...item, attempts: item.attempts + 1 });
        }
      } else {
        console.debug('[queue] flushed:', item.record.ref_id);
      }
    } catch (err) {
      console.warn('[queue] flush exception for', item.record.ref_id, ':', err);
      remaining.push({ ...item, attempts: item.attempts + 1 });
    }
  }

  writeQueue(remaining);

  if (remaining.length < queue.length) {
    console.debug('[queue] flush complete — removed', queue.length - remaining.length, 'records,', remaining.length, 'still pending');
  }
}

export function getQueueSize(): number {
  return readQueue().length;
}

export function startQueueFlusher(): () => void {
  flushQueue();

  const handleOnline = () => {
    console.debug('[queue] network online — flushing queue');
    flushQueue();
  };
  const handleUnload = () => { flushQueue(); };

  window.addEventListener('online', handleOnline);
  window.addEventListener('beforeunload', handleUnload);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('beforeunload', handleUnload);
  };
}

export function clearQueue(): void {
  safeRemoveItem(QUEUE_KEY);
  console.debug('[queue] queue cleared');
}
