/**
 * faultAnalysis.ts
 *
 * Data fetching and aggregation for the Fault Trend Analysis feature.
 *
 * ARCHITECTURE
 * ─────────────
 * One DB query (fetchRawFaults) fetches all records in the selected time window
 * and expands their JSONB checklist into individual FaultOccurrence objects.
 *
 * Grouping paths:
 *   • groupBySection  → Section → EquipmentType → EquipmentNumber → RecordGroup
 *   • groupByType     → flat list sorted by fault-label count
 *
 * Within the Section view the user can drill all the way down to individual
 * checklist submissions grouped by the physical unit (equipment number) and
 * navigate directly to the originating record.
 */

import { supabase } from './supabase';
import type { EvidenceImage } from '../store';

// ─── Public types ─────────────────────────────────────────────────────────────

export type TimeFrame = 'today' | 'week' | 'month' | 'custom';

/** YYYY-MM-DD strings (local date) used by the custom range picker */
export interface DateRange {
  start: string;
  end:   string;
}

/** One "NOT OK" checklist item extracted from a submitted record */
export interface FaultOccurrence {
  recordId:        string;
  refId:           string;
  sectionName:     string;    // e.g. "Rolling Stock Checklist"
  equipmentType:   string;    // e.g. "Reach Stacker"
  equipmentCode:   string;    // e.g. "RS"
  equipmentNumber: string;    // e.g. "001"
  equipmentLabel:  string;    // type + code + number, e.g. "Reach Stacker RS 001"
  faultType:       string;    // checklist item label, e.g. "Oil Leak"
  comment:         string;
  actionPlan:      string;
  evidenceImage?:  EvidenceImage;
  technician:      string;
  completionTime:  string;
  submittedAt:     string;    // ISO timestamp
  date:            string;    // YYYY-MM-DD date field
}

/**
 * All the faults from a single checklist submission, grouped so the detail
 * panel can show them together with one "View Checklist" button.
 */
export interface RecordGroup {
  recordId:       string;
  refId:          string;
  date:           string;
  technician:     string;
  completionTime: string;
  submittedAt:    string;
  faults:         FaultOccurrence[];   // ≥ 1 fault from this record
}

/** All submissions for a specific physical unit, e.g. "RS 001" */
export interface EquipmentNumberGroup {
  equipmentNumber: string;   // "001" — raw number for display
  equipmentLabel:  string;   // "Reach Stacker RS 001" — full label
  totalFaults:     number;
  records:         RecordGroup[];
}

/** Equipment type child-row within a section group */
export interface EquipmentTypeGroup {
  equipmentType:    string;
  totalFaults:      number;
  /** Faults broken down by physical unit (equipment number) */
  equipmentNumbers: EquipmentNumberGroup[];
  /** Flat list kept for the old "By Fault Type" panel path */
  occurrences:      FaultOccurrence[];
}

/** Section accordion row — parent of EquipmentTypeGroup[] */
export interface SectionGroup {
  sectionName:    string;
  totalFaults:    number;
  equipmentTypes: EquipmentTypeGroup[];
}

/** Return value from fetchFaultsBySection */
export interface SectionFaultResult {
  sections:    SectionGroup[];
  fetchedAt:   string;
  totalFaults: number;
}

/** Row in the flat fault-type view */
export interface TrendItem {
  key:         string;          // fault label used as grouping key
  count:       number;
  occurrences: FaultOccurrence[];
}

/** Return value from fetchFaultsByType */
export interface FaultTrendResult {
  trends:      TrendItem[];
  fetchedAt:   string;
  totalFaults: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Convert TimeFrame + optional custom range into ISO start/end bounds */
function getWindowBounds(
  timeFrame:    TimeFrame,
  customRange?: DateRange,
): { start: string; end: string } {
  const now = new Date();

  if (timeFrame === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  if (timeFrame === 'week') {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: now.toISOString() };
  }

  if (timeFrame === 'month') {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: now.toISOString() };
  }

  // custom — fall back to last 7 days if range not provided
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 7);
  defaultStart.setHours(0, 0, 0, 0);

  const startDate = customRange?.start
    ? new Date(customRange.start + 'T00:00:00')
    : defaultStart;
  const endDate = customRange?.end
    ? new Date(customRange.end + 'T23:59:59')
    : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  return { start: startDate.toISOString(), end: endDate.toISOString() };
}

/** Build human-readable equipment label (type + code + number) */
function buildEquipmentLabel(
  equipmentType:   string | null,
  equipmentCode:   string | null,
  equipmentNumber: string | null,
): string {
  return [equipmentType, equipmentCode, equipmentNumber]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(' ') || 'Unknown Equipment';
}

/** Safely parse the JSONB checklist field (array, string-encoded, or raw object) */
function parseChecklist(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  if (raw && typeof raw === 'object') return raw as Array<Record<string, unknown>>;
  return [];
}

interface EvidenceRow {
  id: string;
  submission_id: string;
  checklist_item_id: string | null;
  image_url: string;
  file_name: string;
  file_size: number;
  uploaded_at: string;
  sync_status: string;
}

async function fetchEvidenceRows(submissionIds: string[]): Promise<Map<string, EvidenceRow>> {
  const ids = Array.from(new Set(submissionIds.filter(Boolean)));
  const map = new Map<string, EvidenceRow>();
  if (ids.length === 0) return map;
  try {
    const { data, error } = await supabase
      .from('inspection_evidence')
      .select('id, submission_id, checklist_item_id, evidence_type, image_url, file_name, file_size, uploaded_at, sync_status')
      .eq('evidence_type', 'CHECKLIST_ITEM')
      .in('submission_id', ids);
    if (error) return map;
    ((data ?? []) as EvidenceRow[]).forEach((row) => {
      if (row.checklist_item_id) map.set(`${row.submission_id}:${row.checklist_item_id}`, row);
    });
  } catch {
    return map;
  }
  return map;
}

// ─── Core DB fetch ────────────────────────────────────────────────────────────

/**
 * Single Supabase query that fetches all records in the time window and
 * expands their checklists into flat FaultOccurrence objects.
 * Returns null on any error.
 */
async function fetchRawFaults(
  timeFrame:    TimeFrame,
  customRange?: DateRange,
): Promise<FaultOccurrence[] | null> {
  try {
    const { start, end } = getWindowBounds(timeFrame, customRange);

    const { data, error } = await supabase
      .from('records')
      .select(
        'id, ref_id, submission_id, section, equipment_type, equipment_code, equipment_number, ' +
        'technician, completion_time, submitted_at, date, checklist',
      )
      .gte('submitted_at', start)
      .lte('submitted_at', end)
      .order('submitted_at', { ascending: false });

    if (error) {
      console.error('[faultAnalysis] fetch error:', error.message);
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data ?? []) as any[];
    const evidenceRows = await fetchEvidenceRows(rows.map((row) => String(row.submission_id ?? '')));
    const occurrences: FaultOccurrence[] = [];

    for (const row of rows) {
      const checklist      = parseChecklist(row.checklist);
      const equipmentType  = String(row.equipment_type  ?? '').trim() || 'Unknown Equipment';
      const equipmentCode  = String(row.equipment_code  ?? '').trim();
      const equipmentNumber = String(row.equipment_number ?? '').trim();
      const equipmentLabel = buildEquipmentLabel(
        row.equipment_type   as string | null,
        row.equipment_code   as string | null,
        row.equipment_number as string | null,
      );
      const sectionName = String(row.section ?? '').trim() || 'Uncategorised';

      for (const item of checklist) {
        const evidenceRow = evidenceRows.get(`${String(row.submission_id ?? '')}:${String(item['itemId'] ?? '')}`);
        if (
          item['status']       === 'NOT OK' &&
          item['isSubheading'] !== true      &&
          item['label']                      &&
          String(item['label']).trim() !== ''
        ) {
          occurrences.push({
            recordId:        String(row.id              ?? ''),
            refId:           String(row.ref_id           ?? ''),
            sectionName,
            equipmentType,
            equipmentCode,
            equipmentNumber,
            equipmentLabel,
            faultType:       String(item['label']       ?? 'Unknown Fault').trim(),
            comment:         String(item['comment']     ?? '').trim(),
            actionPlan:      String(item['actionPlan']  ?? '').trim(),
            evidenceImage:    evidenceRow ? {
              id: evidenceRow.id,
              fileName: evidenceRow.file_name,
              fileSize: evidenceRow.file_size,
              mimeType: 'image/jpeg',
              imageUrl: evidenceRow.image_url,
              storagePath: evidenceRow.image_url,
              syncStatus: evidenceRow.sync_status === 'SYNCED' ? 'synced' : 'pending',
              createdAt: evidenceRow.uploaded_at,
            } : (item['evidenceImage'] as EvidenceImage | undefined),
            technician:      String(row.technician      ?? 'Unknown').trim(),
            completionTime:  String(row.completion_time ?? '').trim(),
            submittedAt:     String(row.submitted_at    ?? '').trim(),
            date:            String(row.date            ?? '').trim(),
          });
        }
      }
    }

    console.debug(
      `[faultAnalysis] ${timeFrame}: ${rows.length} records → ${occurrences.length} faults`,
    );

    return occurrences;
  } catch (err) {
    console.error('[faultAnalysis] exception:', err);
    return null;
  }
}

// ─── Aggregation: Section → Equipment Type → Equipment Number ─────────────────

/**
 * Groups raw faults into Section → EquipmentType → EquipmentNumber → RecordGroup
 * hierarchy. Within each equipment number, faults are grouped by their source
 * record (same refId) so the UI can render one "View Checklist" button per submission.
 */
function groupBySection(occurrences: FaultOccurrence[]): SectionGroup[] {
  // section → equipmentType → equipmentLabel → recordId → FaultOccurrence[]
  type RecordMap = Map<string, FaultOccurrence[]>;
  type LabelMap  = Map<string, RecordMap>;
  type TypeMap   = Map<string, LabelMap>;
  const sectionMap = new Map<string, TypeMap>();

  for (const occ of occurrences) {
    if (!sectionMap.has(occ.sectionName)) {
      sectionMap.set(occ.sectionName, new Map());
    }
    const typeMap = sectionMap.get(occ.sectionName)!;

    if (!typeMap.has(occ.equipmentType)) {
      typeMap.set(occ.equipmentType, new Map());
    }
    const labelMap = typeMap.get(occ.equipmentType)!;

    // Key by full equipment label to group physical units properly
    const unitKey = occ.equipmentLabel;
    if (!labelMap.has(unitKey)) {
      labelMap.set(unitKey, new Map());
    }
    const recordMap = labelMap.get(unitKey)!;

    if (!recordMap.has(occ.recordId)) {
      recordMap.set(occ.recordId, []);
    }
    recordMap.get(occ.recordId)!.push(occ);
  }

  const sections: SectionGroup[] = [];

  for (const [sectionName, typeMap] of sectionMap) {
    const equipmentTypes: EquipmentTypeGroup[] = [];

    for (const [equipmentType, labelMap] of typeMap) {
      const equipmentNumbers: EquipmentNumberGroup[] = [];
      // Also maintain a flat occurrences list for the "By Fault Type" panel
      const flatOccs: FaultOccurrence[] = [];

      for (const [unitLabel, recordMap] of labelMap) {
        const records: RecordGroup[] = [];
        let unitFaults = 0;

        for (const [recordId, faults] of recordMap) {
          // All faults in this record share the same meta
          const first = faults[0];
          records.push({
            recordId,
            refId:          first.refId,
            date:           first.date,
            technician:     first.technician,
            completionTime: first.completionTime,
            submittedAt:    first.submittedAt,
            faults,
          });
          unitFaults += faults.length;
          flatOccs.push(...faults);
        }

        // Sort records newest-first
        records.sort(
          (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
        );

        // Use the first occurrence for number / label
        const sample = Array.from(recordMap.values())[0][0];
        equipmentNumbers.push({
          equipmentNumber: sample.equipmentNumber || sample.equipmentCode || unitLabel,
          equipmentLabel:  unitLabel,
          totalFaults:     unitFaults,
          records,
        });
      }

      // Sort equipment numbers highest-fault-count first
      equipmentNumbers.sort((a, b) => b.totalFaults - a.totalFaults);

      equipmentTypes.push({
        equipmentType,
        totalFaults:     flatOccs.length,
        equipmentNumbers,
        occurrences:     flatOccs,
      });
    }

    equipmentTypes.sort((a, b) => b.totalFaults - a.totalFaults);

    sections.push({
      sectionName,
      totalFaults: equipmentTypes.reduce((s, e) => s + e.totalFaults, 0),
      equipmentTypes,
    });
  }

  sections.sort((a, b) => b.totalFaults - a.totalFaults);
  return sections;
}

/**
 * Groups raw faults by fault-label (flat list for the "By Fault Type" view).
 * Sorted highest-count first.
 */
function groupByType(occurrences: FaultOccurrence[]): TrendItem[] {
  const map = new Map<string, TrendItem>();

  for (const occ of occurrences) {
    if (!map.has(occ.faultType)) {
      map.set(occ.faultType, { key: occ.faultType, count: 0, occurrences: [] });
    }
    const item = map.get(occ.faultType)!;
    item.count++;
    item.occurrences.push(occ);
  }

  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}


// ─── In-memory result cache ───────────────────────────────────────────────────
// Prevents re-fetching when the user switches away and back to the Analysis page.
// Cache is keyed by "timeFrame|start|end" and expires after CACHE_TTL_MS.
//
// "Today" uses a shorter TTL (60 s) because submissions happen throughout the day
// and the store.addRecord() already calls invalidateFaultCache() on each save,
// so the short TTL is only a safety net.  Longer frames (7d / 30d / custom) use a
// 5-minute TTL to minimise Supabase API calls for historical queries.

const CACHE_TTL_TODAY_MS  =  1 * 60 * 1000; // 1 minute
const CACHE_TTL_HIST_MS   =  5 * 60 * 1000; // 5 minutes

interface CachedResult {
  occurrences: FaultOccurrence[];
  cachedAt:    number; // Date.now()
}

const _cache = new Map<string, CachedResult>();

function _cacheKey(timeFrame: TimeFrame, bounds: { start: string; end: string }): string {
  return `${timeFrame}|${bounds.start}|${bounds.end}`;
}

async function fetchRawFaultsCached(
  timeFrame:    TimeFrame,
  customRange?: DateRange,
): Promise<FaultOccurrence[] | null> {
  const bounds = getWindowBounds(timeFrame, customRange);
  const key    = _cacheKey(timeFrame, bounds);
  const hit    = _cache.get(key);

  const ttl = timeFrame === 'today' ? CACHE_TTL_TODAY_MS : CACHE_TTL_HIST_MS;

  if (hit && (Date.now() - hit.cachedAt) < ttl) {
    console.debug('[faultAnalysis] cache HIT', key);
    return hit.occurrences;
  }

  const occurrences = await fetchRawFaults(timeFrame, customRange);
  if (occurrences !== null) {
    _cache.set(key, { occurrences, cachedAt: Date.now() });
  }
  return occurrences;
}

/** Force-invalidate the cache (call after a new record is submitted) */
export function invalidateFaultCache(): void {
  _cache.clear();
}

// ─── Public fetch functions ───────────────────────────────────────────────────

/** Fetch and return faults grouped by Section → Equipment Type → Equipment Number */
export async function fetchFaultsBySection(
  timeFrame:    TimeFrame,
  customRange?: DateRange,
): Promise<SectionFaultResult | null> {
  const occurrences = await fetchRawFaultsCached(timeFrame, customRange);
  if (occurrences === null) return null;

  return {
    sections:    groupBySection(occurrences),
    fetchedAt:   new Date().toISOString(),
    totalFaults: occurrences.length,
  };
}

/** Fetch and return faults grouped by fault type label (flat) */
export async function fetchFaultsByType(
  timeFrame:    TimeFrame,
  customRange?: DateRange,
): Promise<FaultTrendResult | null> {
  const occurrences = await fetchRawFaultsCached(timeFrame, customRange);
  if (occurrences === null) return null;

  return {
    trends:      groupByType(occurrences),
    fetchedAt:   new Date().toISOString(),
    totalFaults: occurrences.length,
  };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function formatTimeFrameLabel(timeFrame: TimeFrame, customRange?: DateRange): string {
  switch (timeFrame) {
    case 'today':  return 'Today';
    case 'week':   return 'Last 7 Days';
    case 'month':  return 'Last 30 Days';
    case 'custom': {
      if (customRange?.start && customRange?.end) {
        if (customRange.start === customRange.end) return customRange.start;
        return `${customRange.start} → ${customRange.end}`;
      }
      return 'Custom Range';
    }
  }
}

/** Default YYYY-MM-DD string for today */
export function todayString(): string {
  return new Date().toISOString().split('T')[0];
}

/** Default YYYY-MM-DD string for N days ago */
export function daysAgoString(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

/** Relative time label, e.g. "2m ago" */
export function formatRelativeTime(isoString: string): string {
  const diff  = Date.now() - new Date(isoString).getTime();
  const secs  = Math.floor(diff / 1000);
  const mins  = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);

  if (secs  <  5)  return 'just now';
  if (secs  < 60)  return `${secs}s ago`;
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  return new Date(isoString).toLocaleDateString();
}

/** Short readable date-time from ISO */
export function formatDateTime(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}
// ─── Analytics integration helpers ────────────────────────────────────────────
//
// The Analytics Overview drives this module with its own global Equipment
// Type / Equipment filters (date range / View By / Refresh continue to be
// handled entirely by the embedded panel's own controls). These two pure
// functions prune an already-fetched result tree so a filter change doesn't
// require a second network round trip — no duplicate query logic, just a
// client-side narrowing of data this module already computed.

/** Prune a Section→EquipmentType→EquipmentNumber tree to a given equipment
 *  type / equipment label, recomputing totals bottom-up. `equipment`, when
 *  not 'all', is matched against `equipmentLabel` (the same "Type Code Number"
 *  string Analytics uses for its own equipment filter values). */
export function filterSections(
  sections:      SectionGroup[],
  equipmentType: string,
  equipment:     string,
): SectionGroup[] {
  if (equipmentType === 'all' && equipment === 'all') return sections;
  const result: SectionGroup[] = [];
  for (const section of sections) {
    const equipmentTypes: EquipmentTypeGroup[] = [];
    for (const type of section.equipmentTypes) {
      if (equipmentType !== 'all' && type.equipmentType !== equipmentType) continue;
      const equipmentNumbers = equipment === 'all'
        ? type.equipmentNumbers
        : type.equipmentNumbers.filter((u) => u.equipmentLabel === equipment);
      if (equipmentNumbers.length === 0) continue;
      equipmentTypes.push({
        ...type,
        equipmentNumbers,
        totalFaults: equipmentNumbers.reduce((s, u) => s + u.totalFaults, 0),
        occurrences: equipmentNumbers.flatMap((u) => u.records.flatMap((r) => r.faults)),
      });
    }
    if (equipmentTypes.length === 0) continue;
    result.push({
      ...section,
      equipmentTypes,
      totalFaults: equipmentTypes.reduce((s, t) => s + t.totalFaults, 0),
    });
  }
  return result;
}

/** Same idea as filterSections, for the flat "By Fault Type" view. */
export function filterTrends(
  trends:        TrendItem[],
  equipmentType: string,
  equipment:     string,
): TrendItem[] {
  if (equipmentType === 'all' && equipment === 'all') return trends;
  return trends
    .map((t) => {
      const occurrences = t.occurrences.filter((o) =>
        (equipmentType === 'all' || o.equipmentType === equipmentType) &&
        (equipment === 'all' || o.equipmentLabel === equipment));
      return { ...t, occurrences, count: occurrences.length };
    })
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);
}
