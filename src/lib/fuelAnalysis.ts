import { supabase } from './supabase';

export const FUEL_UNDETERMINED_REASONS = [
  { value: 'gauge_faulty', label: 'Gauge faulty' },
  { value: 'display_fault', label: 'Display fault' },
  { value: 'other', label: 'Other' },
] as const;

export function fuelReasonLabel(value: string): string {
  return FUEL_UNDETERMINED_REASONS.find((r) => r.value === value)?.label ?? value;
}

export type TimeFrame = 'today' | 'week' | 'month' | 'custom';

export interface DateRange {
  start: string;
  end: string;
}

export interface FuelRecord {
  recordId: string;
  refId: string;
  sectionName: string;
  equipmentType: string;
  equipmentCode: string;
  equipmentNumber: string;
  technician: string;
  date: string;
  submittedAt: string;
  fuelLevel?: number;
  reason?: string;
  reasonLabel?: string;
}

export interface FuelEquipmentNumberGroup {
  equipmentNumber: string;
  records: FuelRecord[];
  lowestFuel?: number;
}

export interface FuelEquipmentTypeGroup {
  equipmentType: string;
  equipmentNumbers: FuelEquipmentNumberGroup[];
  totalCount: number;
}

export interface FuelSectionGroup {
  sectionName: string;
  equipmentTypes: FuelEquipmentTypeGroup[];
  totalCount: number;
}

export interface FuelGroupResult {
  sections: FuelSectionGroup[];
  totalCount: number;
}

export interface FuelMonitoringResult {
  lowFuelAlerts: FuelGroupResult;
  undetermined: FuelGroupResult;
  fetchedAt: string;
}

interface FuelRow {
  id: string;
  ref_id: string | null;
  section: string | null;
  equipment_type: string | null;
  equipment_code: string | null;
  equipment_number: string | null;
  technician: string | null;
  fuel_level: string | null;
  fuel_can_determine: string | null;
  fuel_undetermined_reason: string | null;
  submitted_at: string | null;
  date: string | null;
}

const _cache = new Map<string, { result: FuelMonitoringResult; expiresAt: number }>();

export function invalidateFuelCache(): void {
  _cache.clear();
}

function todayBounds(): DateRange {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function daysAgoBounds(days: number): DateRange {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

function customBounds(range?: DateRange): DateRange {
  if (!range?.start || !range?.end) return daysAgoBounds(7);
  return {
    start: new Date(`${range.start}T00:00:00`).toISOString(),
    end: new Date(`${range.end}T23:59:59.999`).toISOString(),
  };
}

function boundsFor(timeFrame: TimeFrame, customRange?: DateRange): DateRange {
  if (timeFrame === 'today') return todayBounds();
  if (timeFrame === 'week') return daysAgoBounds(7);
  if (timeFrame === 'month') return daysAgoBounds(30);
  return customBounds(customRange);
}

async function fetchRawFuelRows(timeFrame: TimeFrame, customRange?: DateRange): Promise<FuelRow[] | null> {
  const { start, end } = boundsFor(timeFrame, customRange);
  const { data, error } = await supabase
    .from('records')
    .select(
      'id, ref_id, section, equipment_type, equipment_code, equipment_number, technician, fuel_level, fuel_can_determine, fuel_undetermined_reason, submitted_at, date'
    )
    .gte('submitted_at', start)
    .lte('submitted_at', end)
    .not('fuel_can_determine', 'is', null)
    .neq('fuel_can_determine', '')
    .order('submitted_at', { ascending: false });

  if (error) {
    console.error('[fuelAnalysis] fetchRawFuelRows error:', error.message);
    return null;
  }

  return (data ?? []) as FuelRow[];
}

function rowToRecord(row: FuelRow, type: 'lowFuel' | 'undetermined'): FuelRecord {
  const fuelLevel = parseFloat(row.fuel_level ?? '');
  const reason = row.fuel_undetermined_reason ?? '';
  return {
    recordId: row.id,
    refId: row.ref_id ?? '',
    sectionName: row.section ?? 'Unassigned Section',
    equipmentType: row.equipment_type ?? 'Unknown Equipment',
    equipmentCode: row.equipment_code ?? '',
    equipmentNumber: row.equipment_number ?? 'Unnumbered',
    technician: row.technician ?? '',
    date: row.date ?? '',
    submittedAt: row.submitted_at ?? '',
    ...(type === 'lowFuel' ? { fuelLevel } : { reason, reasonLabel: fuelReasonLabel(reason) }),
  };
}

function groupRows(rows: FuelRow[], type: 'lowFuel' | 'undetermined'): FuelGroupResult {
  const sectionMap = new Map<string, Map<string, Map<string, FuelRecord[]>>>();

  rows.forEach((row) => {
    const rec = rowToRecord(row, type);
    if (!sectionMap.has(rec.sectionName)) sectionMap.set(rec.sectionName, new Map());
    const typeMap = sectionMap.get(rec.sectionName)!;
    if (!typeMap.has(rec.equipmentType)) typeMap.set(rec.equipmentType, new Map());
    const numberMap = typeMap.get(rec.equipmentType)!;
    if (!numberMap.has(rec.equipmentNumber)) numberMap.set(rec.equipmentNumber, []);
    numberMap.get(rec.equipmentNumber)!.push(rec);
  });

  const sections: FuelSectionGroup[] = Array.from(sectionMap.entries())
    .map(([sectionName, typeMap]) => {
      const equipmentTypes: FuelEquipmentTypeGroup[] = Array.from(typeMap.entries())
        .map(([equipmentType, numberMap]) => {
          const equipmentNumbers: FuelEquipmentNumberGroup[] = Array.from(numberMap.entries())
            .map(([equipmentNumber, records]) => {
              records.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
              const levels = records
                .map((r) => r.fuelLevel)
                .filter((n): n is number => typeof n === 'number' && !Number.isNaN(n));
              return {
                equipmentNumber,
                records,
                ...(type === 'lowFuel' && levels.length > 0 ? { lowestFuel: Math.min(...levels) } : {}),
              };
            });

          if (type === 'lowFuel') {
            equipmentNumbers.sort((a, b) => (a.lowestFuel ?? 999) - (b.lowestFuel ?? 999));
          } else {
            equipmentNumbers.sort((a, b) => a.equipmentNumber.localeCompare(b.equipmentNumber));
          }

          return {
            equipmentType,
            equipmentNumbers,
            totalCount: equipmentNumbers.reduce((sum, g) => sum + g.records.length, 0),
          };
        })
        .sort((a, b) => a.equipmentType.localeCompare(b.equipmentType));

      return {
        sectionName,
        equipmentTypes,
        totalCount: equipmentTypes.reduce((sum, g) => sum + g.totalCount, 0),
      };
    })
    .sort((a, b) => a.sectionName.localeCompare(b.sectionName));

  return {
    sections,
    totalCount: sections.reduce((sum, g) => sum + g.totalCount, 0),
  };
}

/** Fuel level (%) below which a record is classified as a Low Fuel Alert. */
export const LOW_FUEL_THRESHOLD_PCT = 20;

function buildFuelMonitoringResult(rows: FuelRow[]): FuelMonitoringResult {
  const lowFuelRows = rows.filter((row) =>
    row.fuel_can_determine === 'yes' &&
    row.fuel_level !== null &&
    row.fuel_level !== '' &&
    !Number.isNaN(parseFloat(row.fuel_level)) &&
    parseFloat(row.fuel_level) < LOW_FUEL_THRESHOLD_PCT
  );

  const undeterminedRows = rows.filter((row) => row.fuel_can_determine === 'no');

  return {
    lowFuelAlerts: groupRows(lowFuelRows, 'lowFuel'),
    undetermined: groupRows(undeterminedRows, 'undetermined'),
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchFuelMonitoringData(
  timeFrame: TimeFrame,
  customRange?: DateRange,
): Promise<FuelMonitoringResult | null> {
  const key = `fuel:${timeFrame}${customRange ? `:${customRange.start}:${customRange.end}` : ''}`;
  const cached = _cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.result;

  const rows = await fetchRawFuelRows(timeFrame, customRange);
  if (rows === null) return null;

  const result = buildFuelMonitoringResult(rows);
  _cache.set(key, { result, expiresAt: Date.now() + 60_000 });
  return result;
}
