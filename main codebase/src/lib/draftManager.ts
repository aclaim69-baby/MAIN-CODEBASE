/**
 * draftManager.ts — Persists in-progress checklist drafts so users can
 * recover their work after an accidental page reload.
 *
 * STORAGE STRATEGY
 * ─────────────────
 *   PRIMARY:   localStorage  → instant, synchronous, survives page reload
 *   SECONDARY: Supabase       → async background sync for cross-device recovery
 *
 * DRAFT LIFECYCLE
 * ─────────────────
 *   1. User selects a department → draft starts being saved on every state change
 *   2. User reloads / navigates away → draft persists in localStorage + Supabase
 *   3. User returns to the form → resume banner appears
 *   4. User resumes or discards → draft is restored or deleted
 *   5. Form is submitted or reset → draft is cleared from both stores
 *
 * DRAFT EXPIRY
 * ─────────────
 *   Drafts older than 24 hours are automatically discarded on load.
 *   The SQL cleanup function handles server-side expiry.
 */

import { supabase } from './supabase';

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEVICE_ID_KEY    = 'dc_device_id';
export const DRAFT_LOCAL_KEY  = 'dc_active_draft_v2';
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DraftSelection {
  deptId?:            string;
  deptName?:          string;
  sectionId?:         string;
  sectionName?:       string;
  equipmentTypeId?:   string;
  equipmentTypeName?: string;
  equipmentTypeCode?: string;
}

export interface DraftDetails {
  date:              string;
  startTime:         string;
  completionTime:    string;
  technicianName:    string;
  supervisorName:    string;
  qcVerifierName:    string;
  hourMeterReading:  string;
  equipmentNumber:   string;
  [key: string]:     string;
}

export interface DraftResponse {
  itemId:        string;
  label:         string;
  status:        'OK' | 'NOT OK' | 'N/A' | '';
  comment:       string;
  actionPlan:    string;
  evidenceImage?: import('../store').EvidenceImage;
  isSubheading?: boolean;
}

export interface ActiveDraft {
  /** Unique ID for this draft session (crypto.randomUUID). */
  draftId:           string;
  /** Anonymous device identifier stored in localStorage. */
  deviceId:          string;
  /** ISO timestamp of last save. */
  savedAt:           string;
  /** Which step the user was on when the draft was last saved. */
  step:              string;
  /** Dept / section / equipment selections. */
  sel:               DraftSelection;
  /** Basic details form values. */
  details:           DraftDetails;
  /** Checklist responses collected so far. */
  responses:         DraftResponse[];
  /** Urgent Attention Assessment — YES/NO decision (empty string = not yet selected). */
  requiresUrgentAttention?: boolean | '';
  /** Reason text, only meaningful when requiresUrgentAttention is true. */
  urgentAttentionReason?: string;
  /** Optional free-text comment. */
  additionalComment: string;
  /** Optional image attached to the free-text comment. */
  additionalEvidenceImage?: import('../store').EvidenceImage;
}

// ── Device ID ─────────────────────────────────────────────────────────────────

/**
 * Returns a stable anonymous device identifier.
 * Generated on first call and persisted to localStorage.
 * Used as the primary key for the remote draft row so each device
 * keeps exactly one draft at a time.
 */
export function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id || id.length < 10) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    // localStorage blocked (e.g. private browsing with strict settings)
    return 'unknown-device';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isExpired(savedAt: string): boolean {
  try {
    return Date.now() - new Date(savedAt).getTime() > DRAFT_MAX_AGE_MS;
  } catch {
    return true;
  }
}

/** Human-readable relative time for the resume banner. */
export function relativeTime(savedAt: string): string {
  try {
    const diff = Date.now() - new Date(savedAt).getTime();
    const mins  = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    if (mins < 1)    return 'just now';
    if (mins < 60)   return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    if (hours < 24)  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    return 'yesterday';
  } catch {
    return 'earlier';
  }
}

// ── localStorage layer ────────────────────────────────────────────────────────

/** Save draft synchronously to localStorage. Fast, survives page reload. */
export function saveLocalDraft(draft: ActiveDraft): void {
  try {
    localStorage.setItem(DRAFT_LOCAL_KEY, JSON.stringify(draft));
  } catch (e) {
    console.warn('[draftManager] localStorage save failed:', e);
  }
}

/**
 * Load draft from localStorage.
 * Returns null if no draft exists, if it's expired, or if it can't be parsed.
 */
export function loadLocalDraft(): ActiveDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_LOCAL_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as ActiveDraft;

    // Validate minimum required shape
    if (!parsed || typeof parsed !== 'object' || !parsed.draftId || !parsed.savedAt) {
      clearLocalDraft();
      return null;
    }

    // Discard expired drafts
    if (isExpired(parsed.savedAt)) {
      clearLocalDraft();
      return null;
    }

    return parsed;
  } catch {
    clearLocalDraft();
    return null;
  }
}

/** Remove the local draft. */
export function clearLocalDraft(): void {
  try {
    localStorage.removeItem(DRAFT_LOCAL_KEY);
  } catch {
    // ignore — best effort
  }
}

// ── Supabase layer ────────────────────────────────────────────────────────────

/**
 * Upsert draft to Supabase `checklist_drafts` table.
 * Fire-and-forget — failures are logged but never thrown.
 * The local draft is the source of truth; Supabase is the cross-device backup.
 */
export async function saveRemoteDraft(draft: ActiveDraft): Promise<void> {
  try {
    const { error } = await supabase
      .from('checklist_drafts')
      .upsert(
        {
          device_id:  draft.deviceId,
          draft_data: draft,
          saved_at:   draft.savedAt,
        },
        { onConflict: 'device_id' }
      );

    if (error) {
      // Table may not exist yet (user hasn't run the SQL).
      // Silently ignore — localStorage is always the fallback.
      console.debug('[draftManager] Supabase save skipped:', error.message);
    }
  } catch (e) {
    console.debug('[draftManager] Supabase save exception:', e);
  }
}

/**
 * Load the most recent draft for this device from Supabase.
 * Called on mount as a fallback when localStorage has no draft
 * (e.g. user opened the app in a new browser tab or cleared local data).
 */
export async function loadRemoteDraft(deviceId: string): Promise<ActiveDraft | null> {
  try {
    const { data, error } = await supabase
      .from('checklist_drafts')
      .select('draft_data, saved_at')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (error || !data) return null;

    const draft = data.draft_data as ActiveDraft;
    if (!draft || !draft.draftId) return null;

    // Discard expired remote drafts
    if (isExpired(data.saved_at as string)) {
      void clearRemoteDraft(deviceId);
      return null;
    }

    return draft;
  } catch {
    return null;
  }
}

/** Delete the remote draft row for this device. */
export async function clearRemoteDraft(deviceId: string): Promise<void> {
  try {
    await supabase
      .from('checklist_drafts')
      .delete()
      .eq('device_id', deviceId);
  } catch {
    // ignore — best effort
  }
}

// ── Combined save (debounced) ─────────────────────────────────────────────────

let _remoteTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Save draft to BOTH localStorage (immediate) and Supabase (debounced).
 *
 * localStorage is synchronous — the draft is safe against page reload
 * as soon as this function returns.
 *
 * The Supabase push is delayed by `remoteDelay` ms so rapid keystrokes
 * don't flood the database (same pattern as the checklist response debounce).
 */
export function debouncedSaveDraft(draft: ActiveDraft, remoteDelay = 2000): void {
  // ① Instant local save — page-reload safe
  saveLocalDraft(draft);

  // ② Debounced remote save — cross-device sync
  if (_remoteTimer) clearTimeout(_remoteTimer);
  _remoteTimer = setTimeout(() => {
    void saveRemoteDraft(draft);
  }, remoteDelay);
}

/**
 * Clear draft from BOTH localStorage and Supabase.
 * Called on successful form submission and on explicit user reset.
 */
export function clearAllDrafts(deviceId: string): void {
  clearLocalDraft();
  void clearRemoteDraft(deviceId);
}
