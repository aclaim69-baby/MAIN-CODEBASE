import { supabase } from './supabase';
import { businessDate } from './businessDate';

export type AnalyticsPeriod = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'thisMonth' | 'lastMonth' | 'custom';
export interface AnalyticsFilters { period: AnalyticsPeriod; start?: string; end?: string; equipmentType: string; equipment: string; result: 'all' | 'OK' | 'NOT OK'; }
export interface AnalyticsRecord { id: string; date: string; submittedAt: string; equipmentType: string; equipmentCode: string; equipmentNumber: string; equipment: string; checklist: Array<{ label?: string; status?: string; isSubheading?: boolean }>; }
export interface AnalyticsData { records: AnalyticsRecord[]; equipmentTypes: string[]; equipment: string[]; }
export interface EquipmentFaultMetric {
  equipment: string;
  inspections: number;
  faultyInspections: number;
  faultOccurrences: number;
  faultRate: number;
}

const localDate = (d: Date) => businessDate(d);
export function bounds(filters: AnalyticsFilters) {
  const now = new Date(); const end = localDate(now); const start = new Date(now);
  if (filters.period === 'today') return { start: end, end };
  if (filters.period === 'yesterday') { start.setDate(start.getDate() - 1); const day = localDate(start); return { start: day, end: day }; }
  if (filters.period === '7d') start.setDate(start.getDate() - 6);
  if (filters.period === '30d') start.setDate(start.getDate() - 29);
  if (filters.period === '90d') start.setDate(start.getDate() - 89);
  if (filters.period === 'thisMonth') start.setDate(1);
  if (filters.period === 'lastMonth') { start.setMonth(start.getMonth() - 1, 1); const last = new Date(now.getFullYear(), now.getMonth(), 0); return { start: localDate(start), end: localDate(last) }; }
  if (filters.period === 'custom') return { start: filters.start || end, end: filters.end || end };
  return { start: localDate(start), end };
}
function checklist(value: unknown): AnalyticsRecord['checklist'] { if (Array.isArray(value)) return value as AnalyticsRecord['checklist']; if (typeof value === 'string') try { return JSON.parse(value); } catch { return []; } return []; }
export async function fetchAnalytics(filters: AnalyticsFilters): Promise<AnalyticsData> {
  const range = bounds(filters); const all: any[] = []; let from = 0;
  while (true) { const { data, error } = await supabase.from('records').select('id,date,submitted_at,equipment_type,equipment_code,equipment_number,checklist').gte('date', range.start).lte('date', range.end).order('date', { ascending: true }).range(from, from + 999); if (error) throw error; all.push(...(data || [])); if (!data || data.length < 1000) break; from += 1000; }
  const records = all.map((r) => { const equipmentType = String(r.equipment_type || 'Unknown Equipment').trim(); const equipmentCode = String(r.equipment_code || '').trim(); const equipmentNumber = String(r.equipment_number || '').trim(); return { id: String(r.id), date: String(r.date || String(r.submitted_at || '').slice(0, 10)), submittedAt: String(r.submitted_at || ''), equipmentType, equipmentCode, equipmentNumber, equipment: [equipmentType, equipmentCode, equipmentNumber].filter(Boolean).join(' '), checklist: checklist(r.checklist) }; }).filter((r) => (filters.equipmentType === 'all' || r.equipmentType === filters.equipmentType) && (filters.equipment === 'all' || r.equipment === filters.equipment));
  const filtered = filters.result === 'all' ? records : records.filter((r) => inspectionStatus(r) === filters.result);
  return { records: filtered, equipmentTypes: [...new Set(all.map(r => String(r.equipment_type || 'Unknown Equipment').trim()))].sort(), equipment: [...new Set(all.map(r => [String(r.equipment_type || 'Unknown Equipment').trim(), String(r.equipment_code || '').trim(), String(r.equipment_number || '').trim()].filter(Boolean).join(' ')))].sort() };
}
/**
 * Number of calendar days covered by the current filter's date range,
 * inclusive of both endpoints. Reuses `bounds()` so every period type
 * (including the "elapsed days only" behavior of `thisMonth`, and the
 * exact-length-of-month behavior of `lastMonth`) stays consistent with
 * however the rest of Analytics already interprets date ranges.
 */
export function daysInRange(filters: AnalyticsFilters): number {
  const { start, end } = bounds(filters);
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const diff = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  return Math.max(1, diff);
}

/**
 * Centralized Average Inspections calculation. Takes a count of already
 * globally-filtered records (equipment type / equipment / checklist result
 * all applied upstream — see fetchAnalytics) and divides by the number of
 * applicable calendar days in the selected period. Generic across every
 * equipment type — no per-type branching.
 */
export function averageInspectionsPerDay(recordCount: number, filters: AnalyticsFilters): number {
  const days = daysInRange(filters);
  return days > 0 ? recordCount / days : 0;
}

/** Readable one-decimal formatting; drops the decimal when it's a whole number. */
export function formatAveragePerDay(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function faults(r: AnalyticsRecord) { return r.checklist.filter((x) => x.status === 'NOT OK' && !x.isSubheading && x.label?.trim()); }
export function inspectionStatus(r: AnalyticsRecord): 'OK' | 'NOT OK' { return faults(r).length ? 'NOT OK' : 'OK'; }
export function group(values: Array<{ key: string; value?: number }>) { const m = new Map<string, number>(); values.forEach(({ key, value = 1 }) => m.set(key, (m.get(key) || 0) + value)); return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a,b) => b.value - a.value); }

/**
 * Authoritative equipment-level metrics. The records table primary-key is the
 * inspection identity, so one inspection can contribute once to each
 * inspection metric regardless of its number of NOT OK checklist responses.
 */
export function equipmentFaultMetrics(records: AnalyticsRecord[]): EquipmentFaultMetric[] {
  const equipment = new Map<string, Map<string, AnalyticsRecord>>();
  for (const record of records) {
    if (!equipment.has(record.equipment)) equipment.set(record.equipment, new Map());
    equipment.get(record.equipment)!.set(record.id, record);
  }
  return [...equipment.entries()].map(([label, uniqueRecords]) => {
    const inspections = [...uniqueRecords.values()];
    const faultyInspections = inspections.filter((record) => faults(record).length > 0).length;
    const faultOccurrences = inspections.reduce((total, record) => total + faults(record).length, 0);
    return {
      equipment: label,
      inspections: inspections.length,
      faultyInspections,
      faultOccurrences,
      faultRate: inspections.length ? (faultyInspections / inspections.length) * 100 : 0,
    };
  }).sort((a, b) => b.faultRate - a.faultRate || a.equipment.localeCompare(b.equipment));
}
