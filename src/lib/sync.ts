

import { supabase } from './supabase';
import { addToQueue, removeFromQueue } from './offlineQueue';
import { metrics } from './metrics';
import { stripEvidenceDataUrls } from './evidence';
import type { Record, ActivityLog, ChecklistTemplate, AdminUser, AppSettings, EquipmentTypeMapping } from '../store';

export const ACTIVE_TABLES  = ['records', 'activity_logs', 'departments', 'sections', 'equipment_types'] as const;
export const ADMIN_TABLES   = ['admins', 'settings', 'checklist_templates'] as const;

export const SAFETY_NET_INTERVAL_MS = 5 * 60_000; 

export interface RecordRow {
  id:               string;
  ref_id:           string;
  submission_id:    string;         
  department:       string;
  section:          string;
  equipment_type:   string;
  equipment_code:   string;
  equipment_number: string;
  date:             string;
  start_time:       string;
  completion_time:  string;
  hour_meter:       string;
  fuel_level?:      string | null;
  fuel_can_determine?:       string | null;
  fuel_undetermined_reason?: string | null;
  technician:       string;
  supervisor:       string;
  qc_verifier:      string;
  checklist:           unknown;
  additional_comment?: string;
  requires_urgent_attention?: boolean;
  urgent_attention_reason?:   string | null;
  submitted_at:        string;
  created_at?:         string;
  edited_by?:          string | null;
  edited_at?:          string | null;
}

export interface LogRow {
  id:          string;
  type:        string;
  description: string;
  actor:       string | null;
  section:     string;
  ip?:         string | null;
  created_at?: string;
}

export interface DepartmentRow {
  id:          string;
  name:        string;
  position:    number;
  created_at?: string;
}

export interface SectionRow {
  id:            string;
  name:          string;
  department_id: string;
  position:      number;
  created_at?:   string;
}

export interface FieldConfigRow {
  id:                string;
  key:               string;
  label:             string;
  field_type:        'text' | 'numeric' | 'dropdown' | 'fuel_percent';
  required:          boolean;
  options:           unknown;  
  sort_order:        number;
  is_built_in:       boolean;
  is_active:         boolean;
  updated_at:        string;
  created_at?:       string;
  
  
  equipment_type_id: string | null;
}

export interface MappingRow {
  id:                string;
  department_id:     string;
  section_id:        string;
  equipment_type_id: string;
  created_at?:       string;
}

export interface EquipmentTypeRow {
  id:          string;
  name:        string;
  code:        string;
  position:    number;
  created_at?: string;
}

interface EvidenceRow {
  id: string;
  submission_id: string;
  checklist_item_id: string | null;
  evidence_type: 'CHECKLIST_ITEM' | 'ADDITIONAL_COMMENT';
  image_url: string;
  file_name: string;
  file_size: number;
  uploaded_at: string;
  sync_status: string;
}

function _estimateJsonBytes(value: unknown): number {
  
  
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return 0;
  }
}

function _trackPayload(label: string, data: unknown): void {
  metrics.payload(label, _estimateJsonBytes(data));
}

const ASSETS_BUCKET = 'app-assets';

function _dataUrlToBlob(dataUrl: string): { blob: Blob; contentType: string } | null {
  if (!dataUrl.startsWith('data:')) return null;
  const [meta, b64] = dataUrl.split(',', 2);
  if (!meta || !b64) return null;
  const m = /^data:(.+?);base64$/.exec(meta);
  const contentType = m?.[1] ?? 'application/octet-stream';
  try {
    const binStr = atob(b64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    return { blob: new Blob([bytes], { type: contentType }), contentType };
  } catch {
    return null;
  }
}

async function _uploadPublicAssetFromDataUrl(path: string, dataUrl: string): Promise<string | null> {
  const parsed = _dataUrlToBlob(dataUrl);
  if (!parsed) return null;
  const { blob, contentType } = parsed;
  const { error } = await supabase.storage
    .from(ASSETS_BUCKET)
    .upload(path, blob, { upsert: true, contentType, cacheControl: '0' });
  if (error) {
    console.error('[sync] storage upload error:', error.message);
    return null;
  }
  const { data } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(path);
  return data.publicUrl ?? null;
}

export function recordToRow(r: Record): RecordRow {
  const record = stripEvidenceDataUrls(r);
  return {
    id:               record.id,
    ref_id:           record.refId,
    submission_id:    record.submissionId,
    department:       record.departmentName,
    section:          record.sectionName,
    equipment_type:   record.equipmentTypeName,
    equipment_code:   record.equipmentTypeCode,
    equipment_number: record.equipmentNumber,
    date:             record.date,
    start_time:       record.startTime,
    completion_time:  record.completionTime,
    hour_meter:       record.hourMeterReading,
    fuel_level:       record.fuelLevel ?? null,
    fuel_can_determine:       record.fuelCanDetermine || null,
    fuel_undetermined_reason: record.fuelUndeterminedReason || null,
    technician:       record.technicianName,
    supervisor:       record.supervisorName,
    qc_verifier:      record.qcVerifierName ?? '',
    checklist:        record.checklistResponses,
    additional_comment: record.additionalComment ?? '',
    requires_urgent_attention: record.requiresUrgentAttention ?? false,
    urgent_attention_reason:   record.urgentAttentionReason ?? null,
    submitted_at:     record.submittedAt || new Date().toISOString(),
    edited_by:        record.editedBy ?? null,
    edited_at:        record.editedAt ?? null,
  };
}

export function rowToRecord(row: RecordRow): Record {
  let checklist: Record['checklistResponses'] = [];
  const raw = row.checklist;
  if (Array.isArray(raw)) {
    checklist = raw as Record['checklistResponses'];
  } else if (typeof raw === 'string') {
    try { checklist = JSON.parse(raw); } catch { checklist = []; }
  } else if (raw && typeof raw === 'object') {
    checklist = raw as Record['checklistResponses'];
  }
  return {
    id:                 row.id,
    refId:              row.ref_id         ?? '',
    submissionId:       row.submission_id  ?? '',
    departmentId:       row.department     ?? '',
    departmentName:     row.department     ?? '',
    sectionId:          row.section        ?? '',
    sectionName:        row.section        ?? '',
    equipmentTypeId:    row.equipment_code ?? '',
    equipmentTypeName:  row.equipment_type ?? '',
    equipmentTypeCode:  row.equipment_code ?? '',
    equipmentNumber:    row.equipment_number ?? '',
    date:               row.date           ?? '',
    startTime:          row.start_time     ?? '',
    completionTime:     row.completion_time ?? '',
    technicianName:     row.technician     ?? '',
    supervisorName:     row.supervisor     ?? '',
    qcVerifierName:     row.qc_verifier    ?? '',
    hourMeterReading:   row.hour_meter     ?? '',
    fuelCanDetermine:   (row.fuel_can_determine as 'yes' | 'no' | '') ?? '',
    fuelLevel:          row.fuel_level     ?? '',
    fuelUndeterminedReason: row.fuel_undetermined_reason ?? '',
    checklistResponses: checklist,
    additionalComment:  row.additional_comment ?? '',
    // Backwards-compatibility fallback for historical records that predate
    // this feature — NOT an actual technician "No" decision.
    requiresUrgentAttention: row.requires_urgent_attention ?? false,
    urgentAttentionReason:   row.urgent_attention_reason ?? undefined,
    submittedAt:        row.submitted_at ?? row.created_at ?? new Date().toISOString(),
    editedBy:           row.edited_by ?? undefined,
    editedAt:           row.edited_at ?? undefined,
  };
}

export function rowToLog(row: LogRow): ActivityLog {
  return {
    id:          row.id,
    
    type:        row.type as any,
    description: row.description,
    actor:       row.actor ?? undefined,
    ip:          row.ip ?? undefined,
    
    section:     (row.section as any) ?? 'submissions',
    timestamp:   row.created_at ?? new Date().toISOString(),
  };
}

async function fetchEvidenceRows(submissionIds: string[]): Promise<EvidenceRow[]> {
  const ids = Array.from(new Set(submissionIds.filter(Boolean)));
  if (ids.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from('inspection_evidence')
      .select('id, submission_id, checklist_item_id, evidence_type, image_url, file_name, file_size, uploaded_at, sync_status')
      .in('submission_id', ids);
    if (error) {
      if (error.code !== '42P01') console.warn('[sync] fetch evidence error:', error.message);
      return [];
    }
    return (data ?? []) as EvidenceRow[];
  } catch (err) {
    console.warn('[sync] fetch evidence exception:', err);
    return [];
  }
}

function attachEvidence(records: Record[], rows: EvidenceRow[]): Record[] {
  if (rows.length === 0) return records;
  const bySubmission = new Map<string, EvidenceRow[]>();
  rows.forEach((row) => {
    const list = bySubmission.get(row.submission_id) ?? [];
    list.push(row);
    bySubmission.set(row.submission_id, list);
  });

  return records.map((record) => {
    const evidenceRows = bySubmission.get(record.submissionId) ?? [];
    if (evidenceRows.length === 0) return record;
    const checklistRows = new Map(
      evidenceRows
        .filter((row) => row.evidence_type === 'CHECKLIST_ITEM' && row.checklist_item_id)
        .map((row) => [row.checklist_item_id!, row])
    );
    const commentRow = evidenceRows.find((row) => row.evidence_type === 'ADDITIONAL_COMMENT');
    return {
      ...record,
      checklistResponses: record.checklistResponses.map((response) => {
        const row = checklistRows.get(response.itemId);
        if (!row) return response;
        return {
          ...response,
          evidenceImage: {
            id: row.id,
            fileName: row.file_name,
            fileSize: row.file_size,
            mimeType: 'image/jpeg',
            imageUrl: row.image_url,
            storagePath: row.image_url,
            syncStatus: row.sync_status === 'SYNCED' ? 'synced' : 'pending' as const,
            createdAt: row.uploaded_at,
          },
        };
      }),
      additionalEvidenceImage: commentRow ? {
        id: commentRow.id,
        fileName: commentRow.file_name,
        fileSize: commentRow.file_size,
        mimeType: 'image/jpeg',
        imageUrl: commentRow.image_url,
        storagePath: commentRow.image_url,
        syncStatus: commentRow.sync_status === 'SYNCED' ? 'synced' : 'pending' as const,
        createdAt: commentRow.uploaded_at,
      } : record.additionalEvidenceImage,
    };
  });
}

function rowToMapping(row: MappingRow): EquipmentTypeMapping {
  return {
    id:              row.id,
    departmentId:    row.department_id,
    sectionId:       row.section_id,
    equipmentTypeId: row.equipment_type_id,
  };
}

export async function syncInsertRecord(
  record: Record
): Promise<{ ok: boolean; queued: boolean; error?: string }> {
  const row = recordToRow(record);
  try {
    const { error } = await supabase
      .from('records')
      .upsert(row, { onConflict: 'id' });

    if (error) {
      _logHint(error.code, error.message);

      const isUniqueViolation =
        error.code === '23505' ||
        error.message?.toLowerCase().includes('unique') ||
        error.message?.toLowerCase().includes('duplicate');

      if (isUniqueViolation) {
        // Expected, not a bug: one checklist per equipment per day is
        // enforced by the records_ref_id_unique constraint (intentional —
        // see SETUP.sql). Do NOT run FIX_REFID_CONSTRAINT.sql to "fix" this;
        // that script drops the constraint and removes the one-per-day rule.
        console.warn(
          '[sync] insertRecord — duplicate checklist for this equipment/date (expected, ref_id already exists):',
          record.refId
        );
        return { ok: false, queued: false, error: 'unique_conflict' };
      }

      console.error('[sync] insertRecord error — queuing for retry:', error.message);
      addToQueue(row);
      return { ok: false, queued: true, error: error.message };
    }

    console.debug('[sync] ✅ record inserted:', record.refId);
    removeFromQueue(record.id);
    _broadcastRefresh('records');
    return { ok: true, queued: false };

  } catch (err) {
    console.error('[sync] insertRecord network exception — queuing for retry:', err);
    addToQueue(row);
    return { ok: false, queued: true, error: String(err) };
  }
}

export async function syncUpdateRecord(record: Record): Promise<void> {
  try {
    const { error } = await supabase
      .from('records')
      .upsert(recordToRow(record), { onConflict: 'id' });
    if (error) { console.error('[sync] updateRecord error:', error.message); _logHint(error.code, error.message); }
    else { console.debug('[sync] ✅ record updated:', record.refId); _broadcastRefresh('records'); }
  } catch (err) { console.error('[sync] updateRecord exception:', err); }
}

/**
 * Immediately persists ONLY the edited_by + edited_at columns for a record.
 *
 * WHY THIS EXISTS:
 *   The full-record sync (_debouncedSyncUpdate) waits 500 ms to batch rapid
 *   checklist changes. If the user navigates away before that timer fires, the
 *   edit-attribution data (edited_by / edited_at) never reaches Supabase, so
 *   the "Edited by …" badge disappears on the next page load.
 *
 *   This function uses a targeted UPDATE that fires immediately — no debounce,
 *   no full-record payload — guaranteeing the attribution is persisted as soon
 *   as the admin makes any change.
 */
export async function syncMarkRecordEdited(
  id: string,
  editedBy: string,
  editedAt: string,
): Promise<void> {
  try {
    const { error } = await supabase
      .from('records')
      .update({ edited_by: editedBy, edited_at: editedAt })
      .eq('id', id);
    if (error) {
      console.error('[sync] markRecordEdited error:', error.message);
      _logHint(error.code, error.message);
    } else {
      console.debug('[sync] ✅ record edit-attribution saved:', id, editedBy);
      // Broadcast so other devices pick up the updated edited_by/edited_at
      // via their realtime subscription without waiting for the full sync.
      _broadcastRefresh('records');
    }
  } catch (err) {
    console.error('[sync] markRecordEdited exception:', err);
  }
}

export async function syncDeleteRecord(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('records').delete().eq('id', id);
    if (error) { console.error('[sync] deleteRecord error:', error.message); }
    else { console.debug('[sync] ✅ record deleted:', id); _broadcastRefresh('records'); }
  } catch (err) { console.error('[sync] deleteRecord exception:', err); }
}

export async function fetchRemoteRecords(): Promise<Record[] | null> {
  try {
    metrics.apiCall();
    const { data, error } = await supabase
      .from('records')
      .select('id, ref_id, submission_id, department, section, equipment_type, equipment_code, equipment_number, date, start_time, completion_time, hour_meter, fuel_level, fuel_can_determine, fuel_undetermined_reason, technician, supervisor, qc_verifier, checklist, additional_comment, requires_urgent_attention, urgent_attention_reason, submitted_at, created_at, edited_by, edited_at')
      .order('submitted_at', { ascending: false });
    if (error) { console.error('[sync] fetchRecords error:', error.message); _logHint(error.code, error.message); return null; }
    _trackPayload('records:full', data);
    const rows = (data ?? []) as RecordRow[];
    console.debug('[sync] fetched', rows.length, 'records from Supabase');
    const mapped = rows.map(rowToRecord);
    return attachEvidence(mapped, await fetchEvidenceRows(mapped.map((r) => r.submissionId)));
  } catch (err) { console.error('[sync] fetchRecords exception:', err); return null; }
}

// Filter values are already resolved to DB column values (names/codes, not UUIDs)
export interface RecordsFilter {
  department?:    string; // exact department name as stored in DB
  section?:       string; // exact section name as stored in DB
  equipmentCode?: string; // exact equipment_code as stored in DB
  technician?:    string; // partial technician name match
  date?:          string; // exact date string YYYY-MM-DD
  refId?:         string; // partial ref_id match
}

export async function fetchRecordsPage(
  page: number,
  pageSize = 15,
  filters?: RecordsFilter,
): Promise<{ records: Record[]; total: number } | null> {
  try {
    metrics.apiCall();
    const safePage = Math.max(1, Math.floor(page));
    const safeSize = Math.max(1, Math.min(50, Math.floor(pageSize)));
    const from = (safePage - 1) * safeSize;
    const to = from + safeSize - 1;

    let query = supabase
      .from('records')
      .select(
        'id, ref_id, department, section, equipment_type, equipment_code, equipment_number, date, start_time, completion_time, hour_meter, fuel_level, fuel_can_determine, fuel_undetermined_reason, technician, supervisor, qc_verifier, additional_comment, requires_urgent_attention, urgent_attention_reason, submitted_at, created_at, edited_by, edited_at',
        { count: 'exact' }
      )
      .order('submitted_at', { ascending: false })
      .range(from, to);

    // Apply server-side filters so ALL matching records are counted/returned,
    // not just the 15 currently loaded on the client.
    if (filters?.department)    query = (query as any).eq('department', filters.department);
    if (filters?.section)       query = (query as any).eq('section', filters.section);
    if (filters?.equipmentCode) query = (query as any).eq('equipment_code', filters.equipmentCode);
    if (filters?.technician)    query = (query as any).ilike('technician', `%${filters.technician}%`);
    if (filters?.date)          query = (query as any).eq('date', filters.date);
    if (filters?.refId)         query = (query as any).ilike('ref_id', `%${filters.refId}%`);

    const { data, error, count } = await query;

    if (error) {
      console.error('[sync] fetchRecordsPage error:', error.message);
      return null;
    }
    _trackPayload(`records:page:${safePage}`, data);
    const rows = (data ?? []) as (Omit<RecordRow, 'checklist'> & { checklist?: unknown })[];
    const mapped = rows.map((r) => rowToRecord({ ...(r as unknown as RecordRow), checklist: [] }));
    return { records: mapped, total: count ?? 0 };
  } catch (err) {
    console.error('[sync] fetchRecordsPage exception:', err);
    return null;
  }
}

/** Fetch the real count of records submitted today from the database. */
export async function fetchTodayCount(): Promise<number> {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const { count, error } = await supabase
      .from('records')
      .select('id', { count: 'exact', head: true })
      .eq('date', todayStr);
    if (error) { console.error('[sync] fetchTodayCount error:', error.message); return 0; }
    return count ?? 0;
  } catch (err) {
    console.error('[sync] fetchTodayCount exception:', err);
    return 0;
  }
}

export async function fetchRecordChecklist(recordId: string): Promise<{ checklist: Record['checklistResponses']; additionalComment: string; additionalEvidenceImage?: Record['additionalEvidenceImage'] } | null> {
  try {
    metrics.apiCall();
    const { data, error } = await supabase
      .from('records')
      .select('id, ref_id, submission_id, department, section, equipment_type, equipment_code, equipment_number, date, start_time, completion_time, hour_meter, fuel_level, fuel_can_determine, fuel_undetermined_reason, technician, supervisor, qc_verifier, checklist, additional_comment, requires_urgent_attention, urgent_attention_reason, submitted_at, created_at, edited_by, edited_at')
      .eq('id', recordId)
      .single();
    if (error) {
      console.error('[sync] fetchRecordChecklist error:', error.message);
      return null;
    }
    _trackPayload('records:checklist', data);
    const mapped = rowToRecord(data as RecordRow);
    const [withEvidence] = attachEvidence([mapped], await fetchEvidenceRows([mapped.submissionId]));
    return {
      checklist: withEvidence.checklistResponses,
      additionalComment: withEvidence.additionalComment ?? '',
      additionalEvidenceImage: withEvidence.additionalEvidenceImage,
    };
  } catch (err) {
    console.error('[sync] fetchRecordChecklist exception:', err);
    return null;
  }
}

export async function fetchRecordsSince(since: string): Promise<Record[] | null> {
  try {
    metrics.apiCall();
    const { data, error } = await supabase
      .from('records')
      .select('id, ref_id, submission_id, department, section, equipment_type, equipment_code, equipment_number, date, start_time, completion_time, hour_meter, fuel_level, fuel_can_determine, fuel_undetermined_reason, technician, supervisor, qc_verifier, additional_comment, requires_urgent_attention, urgent_attention_reason, submitted_at, created_at, edited_by, edited_at')
      .gt('submitted_at', since)
      .order('submitted_at', { ascending: false });
    if (error) { console.error('[sync] fetchRecordsSince error:', error.message); return null; }
    _trackPayload('records:delta', data);
    const rows = (data ?? []) as RecordRow[];
    if (rows.length > 0) console.debug('[sync] delta: fetched', rows.length, 'new records since', since);
    
    return rows.map((r) => rowToRecord({ ...r, checklist: [] }));
  } catch (err) { console.error('[sync] fetchRecordsSince exception:', err); return null; }
}

export async function syncInsertLog(log: ActivityLog): Promise<void> {
  try {
    const row: LogRow = { id: log.id, type: log.type, description: log.description, actor: log.actor ?? null, section: log.section, ip: log.ip ?? null, created_at: log.timestamp };
    const { error } = await supabase.from('activity_logs').upsert(row, { onConflict: 'id' });
    if (error) { console.error('[sync] insertLog error:', error.message); }
    else { console.debug('[sync] ✅ log synced:', log.type); _broadcastRefresh('logs'); }
  } catch (err) { console.error('[sync] insertLog exception:', err); }
}

export async function syncDeleteLog(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('activity_logs').delete().eq('id', id);
    if (error) { console.error('[sync] deleteLog error:', error.message); }
    else { console.debug('[sync] ✅ log deleted:', id); _broadcastRefresh('logs'); }
  } catch (err) { console.error('[sync] deleteLog exception:', err); }
}

export async function fetchRemoteLogs(): Promise<ActivityLog[] | null> {
  try {
    metrics.apiCall();
    const { data, error } = await supabase
      .from('activity_logs')
      .select('id, type, description, actor, section, ip, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) { console.error('[sync] fetchLogs error:', error.message); _logHint(error.code, error.message); return null; }
    const rows = (data ?? []) as LogRow[];
    _trackPayload('logs:latest100', data);
    console.debug('[sync] fetched', rows.length, 'logs from Supabase');
    return rows.map(rowToLog);
  } catch (err) { console.error('[sync] fetchLogs exception:', err); return null; }
}

export async function fetchLogsSince(since: string): Promise<ActivityLog[] | null> {
  try {
    metrics.apiCall();
    const { data, error } = await supabase
      .from('activity_logs')
      .select('id, type, description, actor, section, ip, created_at')
      .gt('created_at', since)
      .order('created_at', { ascending: false });
    if (error) { console.error('[sync] fetchLogsSince error:', error.message); return null; }
    _trackPayload('logs:delta', data);
    return (data ?? []).map((row: LogRow) => rowToLog(row));
  } catch (err) { console.error('[sync] fetchLogsSince exception:', err); return null; }
}

export async function syncUpsertAdmin(admin: AdminUser): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('admin-management', { body: { action: 'upsert', admin } });
    if (error) { console.error('[sync] upsertAdmin error:', error.message); }
    else { console.debug('[sync] ✅ admin synced:', admin.email); _broadcastRefresh('all'); }
  } catch (err) { console.error('[sync] upsertAdmin exception:', err); }
}

export async function syncDeleteAdmin(id: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('admin-management', { body: { action: 'deactivate', id } });
    if (error) { console.error('[sync] deleteAdmin error:', error.message); }
    else { console.debug('[sync] ✅ admin deleted:', id); _broadcastRefresh('all'); }
  } catch (err) { console.error('[sync] deleteAdmin exception:', err); }
}

export async function fetchRemoteAdmins(): Promise<AdminUser[] | null> {
  try {
    metrics.targetedRefresh();
    
    
    
    
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, role, active, created_at')
      .order('created_at', { ascending: true });
    if (error) { console.error('[sync] fetchAdmins error:', error.message); return null; }
    _trackPayload('admins:list', data);
    return (data ?? []).map((row) => ({
      id: row.id, email: row.email, passwordHash: '', passwordSet: true,
      isSuperAdmin: row.role === 'super_admin', role: row.role === 'senior' ? 'senior' : 'junior',
      canDeleteRecords: row.role === 'senior' || row.role === 'super_admin',
      canAddAdmins: row.role === 'senior' || row.role === 'super_admin', createdAt: row.created_at,
    }));
  } catch (err) { console.error('[sync] fetchAdmins exception:', err); return null; }
}

export async function syncUpsertDepartment(dept: { id: string; name: string; position?: number }): Promise<void> {
  try {
    const { error } = await supabase.from('departments').upsert({ id: dept.id, name: dept.name, position: dept.position ?? 0 }, { onConflict: 'id' });
    if (error) { console.error('[sync] upsertDepartment error:', error.message); }
    else { console.debug('[sync] ✅ department synced:', dept.name); _broadcastRefresh('all'); }
  } catch (err) { console.error('[sync] upsertDepartment exception:', err); }
}

export async function syncDeleteDepartment(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('departments').delete().eq('id', id);
    if (error) { console.error('[sync] deleteDepartment error:', error.message); }
    else { console.debug('[sync] ✅ department deleted:', id); _broadcastRefresh('all'); }
  } catch (err) { console.error('[sync] deleteDepartment exception:', err); }
}

export async function fetchRemoteDepartments(): Promise<{ id: string; name: string; position: number }[] | null> {
  try {
    metrics.apiCall();
    const { data, error } = await supabase
      .from('departments')
      .select('id, name, position')
      .order('position', { ascending: true });
    if (error) { console.error('[sync] fetchDepartments error:', error.message); return null; }
    _trackPayload('departments:list', data);
    return (data ?? []).map((row: DepartmentRow) => ({ id: row.id, name: row.name, position: row.position ?? 0 }));
  } catch (err) { console.error('[sync] fetchDepartments exception:', err); return null; }
}

export async function syncUpsertSection(sec: { id: string; name: string; departmentId: string; position?: number }): Promise<void> {
  try {
    const { error } = await supabase.from('sections').upsert({ id: sec.id, name: sec.name, department_id: sec.departmentId, position: sec.position ?? 0 }, { onConflict: 'id' });
    if (error) { console.error('[sync] upsertSection error:', error.message); }
    else { console.debug('[sync] ✅ section synced:', sec.name); _broadcastRefresh('all'); }
  } catch (err) { console.error('[sync] upsertSection exception:', err); }
}

export async function syncDeleteSection(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('sections').delete().eq('id', id);
    if (error) { console.error('[sync] deleteSection error:', error.message); }
    else { console.debug('[sync] ✅ section deleted:', id); _broadcastRefresh('all'); }
  } catch (err) { console.error('[sync] deleteSection exception:', err); }
}

export async function fetchRemoteSections(): Promise<{ id: string; name: string; departmentId: string; position: number }[] | null> {
  try {
    metrics.apiCall();
    const { data, error } = await supabase
      .from('sections')
      .select('id, name, department_id, position')
      .order('position', { ascending: true });
    if (error) { console.error('[sync] fetchSections error:', error.message); return null; }
    _trackPayload('sections:list', data);
    return (data ?? []).map((row: SectionRow) => ({ id: row.id, name: row.name, departmentId: row.department_id, position: row.position ?? 0 }));
  } catch (err) { console.error('[sync] fetchSections exception:', err); return null; }
}

export async function syncUpsertEquipmentType(eq: { id: string; name: string; code: string; position?: number }): Promise<void> {
  try {
    const { error } = await supabase.from('equipment_types').upsert({ id: eq.id, name: eq.name, code: eq.code, position: eq.position ?? 0 }, { onConflict: 'id' });
    if (error) { console.error('[sync] upsertEquipmentType error:', error.message); }
    else { console.debug('[sync] ✅ equipment type synced:', eq.name); _broadcastRefresh('all'); }
  } catch (err) { console.error('[sync] upsertEquipmentType exception:', err); }
}

export async function syncDeleteEquipmentType(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('equipment_types').delete().eq('id', id);
    if (error) { console.error('[sync] deleteEquipmentType error:', error.message); }
    else { console.debug('[sync] ✅ equipment type deleted:', id); _broadcastRefresh('all'); }
  } catch (err) { console.error('[sync] deleteEquipmentType exception:', err); }
}

export async function fetchRemoteEquipmentTypes(): Promise<{ id: string; name: string; code: string; position: number }[] | null> {
  try {
    metrics.apiCall();
    const { data, error } = await supabase
      .from('equipment_types')
      .select('id, name, code, position')
      .order('position', { ascending: true });
    if (error) { console.error('[sync] fetchEquipmentTypes error:', error.message); return null; }
    _trackPayload('equipment_types:list', data);
    return (data ?? []).map((row: EquipmentTypeRow) => ({ id: row.id, name: row.name, code: row.code, position: row.position ?? 0 }));
  } catch (err) { console.error('[sync] fetchEquipmentTypes exception:', err); return null; }
}

export async function syncUpsertTemplate(template: ChecklistTemplate): Promise<void> {
  try {
    const { error } = await supabase
      .from('checklist_templates')
      .upsert({ id: template.id, equipment_type_id: template.equipmentTypeId, section_id: template.sectionId, items: template.items, updated_at: new Date().toISOString() }, { onConflict: 'equipment_type_id,section_id' });
    if (error) { console.error('[sync] upsertTemplate error:', error.message); }
    else { console.debug('[sync] ✅ template synced'); _broadcastRefresh('all'); }
  } catch (err) { console.error('[sync] upsertTemplate exception:', err); }
}

export async function fetchRemoteTemplates(): Promise<ChecklistTemplate[]> {
  try {
    metrics.targetedRefresh();
    const { data, error } = await supabase
      .from('checklist_templates')
      .select('id, equipment_type_id, section_id, items, updated_at');
    if (error) { console.error('[sync] fetchTemplates error:', error.message); return []; }
    _trackPayload('checklist_templates:list', data);
    return (data ?? []).map((row: { id: string; equipment_type_id: string; section_id: string; items: unknown }) => ({
      id: row.id, equipmentTypeId: row.equipment_type_id, sectionId: row.section_id,
      items: Array.isArray(row.items) ? row.items : [],
    }));
  } catch (err) { console.error('[sync] fetchTemplates exception:', err); return []; }
}

export async function syncUpsertSettings(settings: AppSettings): Promise<{
  navLogoUrl: string | null;
  homeLogoUrl: string | null;
  checklistLogoUrl: string | null;
  passcodeLogoUrl: string | null;
  navLogoV: number;
  homeLogoV: number;
  checklistLogoV: number;
  passcodeLogoV: number;
} | null> {
  
  
  const navIsNew       = !!(settings.navLogoUrl       && settings.navLogoUrl.startsWith('data:'));
  const homeIsNew      = !!(settings.homeLogoUrl      && settings.homeLogoUrl.startsWith('data:'));
  const checklistIsNew = !!(settings.checklistLogoUrl && settings.checklistLogoUrl.startsWith('data:'));
  const passcodeIsNew  = !!(settings.passcodeLogoUrl  && settings.passcodeLogoUrl.startsWith('data:'));
  const anyLogoUpload  = navIsNew || homeIsNew || checklistIsNew || passcodeIsNew;

  
  
  
  if (anyLogoUpload) _logoUploadInProgress++;

  try {


    const rawNavUrl = navIsNew
      ? await _uploadPublicAssetFromDataUrl('logos/nav-logo', settings.navLogoUrl!)
      : settings.navLogoUrl;
    const rawHomeUrl = homeIsNew
      ? await _uploadPublicAssetFromDataUrl('logos/home-logo', settings.homeLogoUrl!)
      : settings.homeLogoUrl;
    const rawChecklistUrl = checklistIsNew
      ? await _uploadPublicAssetFromDataUrl('logos/checklist-logo', settings.checklistLogoUrl!)
      : settings.checklistLogoUrl;
    const rawPasscodeUrl = passcodeIsNew
      ? await _uploadPublicAssetFromDataUrl('logos/passcode-logo', settings.passcodeLogoUrl!)
      : settings.passcodeLogoUrl;

    
    
    
    const nextNavV       = navIsNew       ? (settings.navLogoV       ?? 0) + 1 : (settings.navLogoV       ?? 1);
    const nextHomeV      = homeIsNew      ? (settings.homeLogoV      ?? 0) + 1 : (settings.homeLogoV      ?? 1);
    const nextChecklistV = checklistIsNew ? (settings.checklistLogoV ?? 0) + 1 : (settings.checklistLogoV ?? 1);
    const nextPasscodeV  = passcodeIsNew  ? (settings.passcodeLogoV  ?? 0) + 1 : (settings.passcodeLogoV  ?? 1);

    
    
    const stripV = (url: string | null) => url ? url.split('?')[0] : url;
    const navLogoUrlVersioned       = rawNavUrl       ? `${stripV(rawNavUrl)}?v=${nextNavV}`             : null;
    const homeLogoUrlVersioned      = rawHomeUrl      ? `${stripV(rawHomeUrl)}?v=${nextHomeV}`           : null;
    const checklistLogoUrlVersioned = rawChecklistUrl ? `${stripV(rawChecklistUrl)}?v=${nextChecklistV}` : null;
    const passcodeLogoUrlVersioned  = rawPasscodeUrl  ? `${stripV(rawPasscodeUrl)}?v=${nextPasscodeV}`   : null;

    const { error } = await supabase
      .from('settings')
      .upsert(
        {
          id:                 1,
          nav_logo:           stripV(rawNavUrl)       ?? null,
          home_logo:          stripV(rawHomeUrl)      ?? null,
          checklist_logo:     stripV(rawChecklistUrl) ?? null,
          passcode_logo:      stripV(rawPasscodeUrl)  ?? null,
          nav_logo_v:               nextNavV,
          home_logo_v:              nextHomeV,
          checklist_logo_v:         nextChecklistV,
          passcode_logo_v:          nextPasscodeV,
          qc_required:              settings.qcVerifierRequired,
          footer_text:              settings.footerText ?? 'Designed by workshop inventory',
          home_title:               settings.homeTitle ?? 'Technical Department Inspection System',
          app_passcode:             settings.appPasscode ?? '1234',
          passcode_enabled:         settings.passcodeEnabled ?? false,
          records_visibility:       settings.recordsVisibility ?? 'general',
          show_fill_button:         settings.showFillButton   ?? false,
          activity_log_visibility:  settings.activityLogVisibility ?? 'all',
          fuel_monitoring_visibility: settings.fuelMonitoringVisibility ?? 'admin_only',
          urgent_attention_question_text:   settings.urgentAttentionQuestionText   ?? '',
          urgent_attention_definition_text: settings.urgentAttentionDefinitionText ?? '',
        },
        { onConflict: 'id' }
      );
    if (error) {
      console.error('[sync] upsertSettings error:', error.message);
      if (anyLogoUpload) _logoUploadInProgress = Math.max(0, _logoUploadInProgress - 1);
      return null;
    }
    console.debug('[sync] ✅ settings synced');

    
    const result = {
      navLogoUrl:       navLogoUrlVersioned,
      homeLogoUrl:      homeLogoUrlVersioned,
      checklistLogoUrl: checklistLogoUrlVersioned,
      passcodeLogoUrl:  passcodeLogoUrlVersioned,
      navLogoV:         nextNavV,
      homeLogoV:        nextHomeV,
      checklistLogoV:   nextChecklistV,
      passcodeLogoV:    nextPasscodeV,
    };

    if (anyLogoUpload) {






      _logoUploadInProgress = Math.max(0, _logoUploadInProgress - 1);
      setTimeout(() => {
        _broadcastRefresh('all');
      }, 1500);
    } else {
      
      _broadcastRefresh('all');
    }

    
    
    return result;
  } catch (err) {
    console.error('[sync] upsertSettings exception:', err);
    if (anyLogoUpload) _logoUploadInProgress = Math.max(0, _logoUploadInProgress - 1);
    return null;
  }
}

export async function fetchRemoteSettings(): Promise<AppSettings | null> {
  try {
    metrics.targetedRefresh();
    const { data, error } = await supabase
      .from('settings')
      .select('nav_logo, home_logo, checklist_logo, passcode_logo, nav_logo_v, home_logo_v, checklist_logo_v, passcode_logo_v, qc_required, footer_text, home_title, app_passcode, passcode_enabled, records_visibility, show_fill_button, activity_log_visibility, fuel_monitoring_visibility, urgent_attention_question_text, urgent_attention_definition_text')
      .eq('id', 1)
      .single();
    if (error) { console.error('[sync] fetchSettings error:', error.message); return null; }
    if (!data) return null;
    _trackPayload('settings:row', data);

    
    
    
    
    const navV       = (data.nav_logo_v       as number | null) ?? 1;
    const homeV      = (data.home_logo_v      as number | null) ?? 1;
    const checklistV = ((data as any).checklist_logo_v as number | null) ?? 1;
    const passcodeV  = ((data as any).passcode_logo_v  as number | null) ?? 1;
    const navLogoUrl       = data.nav_logo  ? `${data.nav_logo}?v=${navV}`   : null;
    const homeLogoUrl      = data.home_logo ? `${data.home_logo}?v=${homeV}` : null;
    const checklistLogoUrl = (data as any).checklist_logo ? `${(data as any).checklist_logo}?v=${checklistV}` : null;
    const passcodeLogoUrl  = (data as any).passcode_logo  ? `${(data as any).passcode_logo}?v=${passcodeV}`   : null;

    return {
      navLogoUrl,
      homeLogoUrl,
      checklistLogoUrl,
      passcodeLogoUrl,
      navLogoV:           navV,
      homeLogoV:          homeV,
      checklistLogoV:     checklistV,
      passcodeLogoV:      passcodeV,
      qcVerifierRequired: data.qc_required       ?? false,
      footerText:         data.footer_text       ?? 'Designed by workshop inventory',
      homeTitle:          data.home_title        ?? 'Technical Department Inspection System',
      appPasscode:        /^\d{4}$/.test((data as any).app_passcode ?? '') ? (data as any).app_passcode : '1234',
      passcodeEnabled:    (data as any).passcode_enabled ?? false,
      recordsVisibility: (data.records_visibility === 'admin_only' ? 'admin_only' : 'general') as import('../store').RecordsVisibility,
      showFillButton:     data.show_fill_button  ?? false,
      activityLogVisibility: (data.activity_log_visibility === 'admin_only' ? 'admin_only' : 'all') as import('../store').ActivityLogVisibility,
      fuelMonitoringVisibility: (data.fuel_monitoring_visibility === 'all' ? 'all' : 'admin_only') as import('../store').FuelMonitoringVisibility,
      urgentAttentionQuestionText:   (data as any).urgent_attention_question_text   ?? '',
      urgentAttentionDefinitionText: (data as any).urgent_attention_definition_text ?? '',
    };
  } catch (err) { console.error('[sync] fetchSettings exception:', err); return null; }
}

export async function fetchRemoteFieldConfigs(): Promise<import('../store').FieldConfig[] | null> {
  try {
    metrics.targetedRefresh();
    const { data, error } = await supabase
      .from('field_configs')
      .select('id, key, label, field_type, required, options, sort_order, is_built_in, is_active, updated_at, equipment_type_id')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[sync] fetchFieldConfigs error:', error.message);
      _logHint(error.code, error.message);
      return null;
    }
    _trackPayload('field_configs:list', data);
    const rows = (data ?? []) as FieldConfigRow[];
    return rows.map((row) => ({
      id:              row.id,
      key:             row.key,
      label:           row.label,
      fieldType:       row.field_type,
      required:        row.required,
      order:           row.sort_order,
      options:         Array.isArray(row.options) ? (row.options as string[]) : [],
      isBuiltIn:       row.is_built_in,
      
      equipmentTypeId: row.equipment_type_id ?? '__global__',
    }));
  } catch (err) {
    console.error('[sync] fetchFieldConfigs exception:', err);
    return null;
  }
}

export async function syncUpsertFieldConfig(cfg: import('../store').FieldConfig): Promise<void> {
  try {
    const row = {
      id:                cfg.id,
      key:               cfg.key,
      label:             cfg.label,
      field_type:        cfg.fieldType,
      required:          cfg.required,
      options:           cfg.options,
      sort_order:        cfg.order,
      is_built_in:       cfg.isBuiltIn,
      is_active:         true,
      
      equipment_type_id: cfg.equipmentTypeId === '__global__' ? null : cfg.equipmentTypeId,
    };
    const { error } = await supabase
      .from('field_configs')
      .upsert(row, { onConflict: 'id' });
    if (error) { console.error('[sync] syncUpsertFieldConfig error:', error.message); }
    else { console.debug('[sync] ✅ field config synced:', cfg.key, 'for equip:', cfg.equipmentTypeId); _broadcastRefresh('all'); }
  } catch (err) { console.error('[sync] syncUpsertFieldConfig exception:', err); }
}

export async function syncDeleteFieldConfig(id: string): Promise<void> {
  try {
    
    
    
    const { error } = await supabase
      .from('field_configs')
      .update({ is_active: false })
      .eq('id', id);
    if (error) { console.error('[sync] syncDeleteFieldConfig error:', error.message); }
    else { console.debug('[sync] ✅ field config deactivated:', id); _broadcastRefresh('all'); }
  } catch (err) { console.error('[sync] syncDeleteFieldConfig exception:', err); }
}

export async function getFieldConfigsVersion(): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('field_configs')
      .select('updated_at')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();
    if (error) return null;
    _trackPayload('field_configs:version', data);
    return data?.updated_at ?? null;
  } catch { return null; }
}

export async function migrateLocalToSupabase(localRecords: Record[], localLogs: ActivityLog[]): Promise<void> {
  if (localRecords.length === 0 && localLogs.length === 0) return;
  try {
    for (let i = 0; i < localRecords.length; i += 50) {
      const { error } = await supabase.from('records').upsert(localRecords.slice(i, i + 50).map(recordToRow), { onConflict: 'id', ignoreDuplicates: true });
      if (error) console.error('[sync] migrate records error:', error.message);
    }
    for (let i = 0; i < localLogs.length; i += 50) {
      const batch: LogRow[] = localLogs.slice(i, i + 50).map((l) => ({ id: l.id, type: l.type, description: l.description, actor: l.actor ?? null, section: l.section, ip: l.ip ?? null, created_at: l.timestamp }));
      const { error } = await supabase.from('activity_logs').upsert(batch, { onConflict: 'id', ignoreDuplicates: true });
      if (error) console.error('[sync] migrate logs error:', error.message);
    }
    console.debug('[sync] ✅ migration complete');
  } catch (err) { console.error('[sync] migration exception:', err); }
}

export async function fetchRemoteMappings(): Promise<EquipmentTypeMapping[] | null> {
  try {
    metrics.apiCall();
    const { data, error } = await supabase
      .from('equipment_type_mappings')
      .select('id, department_id, section_id, equipment_type_id');
    if (error) { console.error('[sync] fetchMappings error:', error.message); return null; }
    _trackPayload('mappings:list', data);
    return (data ?? []).map((row: MappingRow) => rowToMapping(row));
  } catch (err) { console.error('[sync] fetchMappings exception:', err); return null; }
}

export async function syncSetEquipmentTypeMappings(
  departmentId: string,
  sectionId: string,
  equipmentTypeIds: string[]
): Promise<void> {
  try {
    
    const { error: delError } = await supabase
      .from('equipment_type_mappings')
      .delete()
      .eq('department_id', departmentId)
      .eq('section_id', sectionId);

    if (delError) {
      console.error('[sync] deleteMapping error:', delError.message);
      return;
    }

    
    if (equipmentTypeIds.length === 0) {
      console.debug('[sync] ✅ mappings cleared for dept/section');
      _broadcastRefresh('all');
      return;
    }

    const rows = equipmentTypeIds.map((etId) => ({
      department_id:     departmentId,
      section_id:        sectionId,
      equipment_type_id: etId,
    }));

    const { error: insError } = await supabase
      .from('equipment_type_mappings')
      .insert(rows);

    if (insError) {
      console.error('[sync] insertMappings error:', insError.message);
    } else {
      console.debug('[sync] ✅ mappings saved:', rows.length, 'entries');
      _broadcastRefresh('all');
    }
  } catch (err) {
    console.error('[sync] syncSetEquipmentTypeMappings exception:', err);
  }
}

let _broadcastChannel: ReturnType<typeof supabase.channel> | null = null;
let _onRefreshCallback: ((table: 'records' | 'logs' | 'all') => void) | null = null;
let _broadcastReady = false;

// Reference counter for concurrent logo uploads (nav, home, checklist, passcode can all
// upload at the same time). A plain boolean would be cleared by the first upload to finish,
// incorrectly allowing settings-change events to fire while others are still in-flight.
let _logoUploadInProgress = 0;

export function setLogoUploadInProgress(val: boolean): void {
  _logoUploadInProgress = val
    ? _logoUploadInProgress + 1
    : Math.max(0, _logoUploadInProgress - 1);
}
export function isLogoUploadInProgress(): boolean {
  return _logoUploadInProgress > 0;
}

const _deviceId = `dev-${Math.random().toString(36).slice(2)}`;

function _broadcastRefresh(table: 'records' | 'logs' | 'all'): void {
  if (!_broadcastChannel || !_broadcastReady) return;
  metrics.broadcastSent();
  _broadcastChannel
    .send({ type: 'broadcast', event: 'refresh', payload: { table, ts: Date.now(), from: _deviceId } })
    .then(() => console.debug('[sync] 📡 broadcast sent:', table))
    .catch((err) => console.warn('[sync] broadcast send failed:', err));
}

function _startBroadcastChannel(onRefresh: (table: 'records' | 'logs' | 'all') => void): void {
  _onRefreshCallback = onRefresh;
  _broadcastReady    = false;
  _broadcastChannel  = supabase.channel('daily-checking-room');
  _broadcastChannel
    .on('broadcast', { event: 'refresh' }, (payload) => {
      
      
      
      if (payload.payload?.from === _deviceId) {
        console.debug('[sync] 📡 broadcast self-echo suppressed');
        return;
      }
      const table = (payload.payload?.table ?? 'all') as 'records' | 'logs' | 'all';
      console.debug('[sync] 📡 broadcast RECEIVED — refreshing:', table);
      metrics.broadcastReceived();
      if (_onRefreshCallback) _onRefreshCallback(table);
    })
    .subscribe((status) => {
      console.debug('[sync] broadcast channel:', status);
      if (status === 'SUBSCRIBED') {
        _broadcastReady = true;
        console.debug('[sync] ✅ Broadcast channel ready');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        _broadcastReady = false;
        
        setTimeout(() => {
          if (_broadcastChannel) { supabase.removeChannel(_broadcastChannel).catch(() => {}); _broadcastChannel = null; }
          if (_onRefreshCallback) _startBroadcastChannel(_onRefreshCallback);
        }, 3_000);
      }
    });
}

let _pgChannel:      ReturnType<typeof supabase.channel> | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null       = null;
let _channelVersion: number                                      = 0;

export interface RealtimeCallbacks {
  onRecordInsert:  (record: Record)                     => void;
  onRecordDelete:  (id: string)                         => void;
  onRecordUpdate:  (record: Record)                     => void;
  onLogInsert:     (log: ActivityLog)                   => void;
  onLogDelete:     (id: string)                         => void;
  onStatusChange:  (connected: boolean)                 => void;
  onRefreshNeeded: (table: 'records' | 'logs' | 'all') => void;
  onMappingInsert: (mapping: EquipmentTypeMapping)      => void;
  onMappingDelete: (id: string)                         => void;
  onSettingsChange: () => void;
}

export function startRealtimeSync(callbacks: RealtimeCallbacks): () => void {
  _startBroadcastChannel(callbacks.onRefreshNeeded);
  _startPgChannel(callbacks);
  return _makeCleanup();
}

function _startPgChannel(callbacks: RealtimeCallbacks): void {
  _channelVersion += 1;
  const myVersion = _channelVersion;
  _pgChannel = supabase.channel(`dc-pg-v${myVersion}`);

  
  
  
  _pgChannel.on('postgres_changes' as any, { event: '*', schema: 'public', table: 'records' }, (payload: any) => {
    if (myVersion !== _channelVersion) return;
    metrics.realtimeEvent('records');
    try {
      if (payload.eventType === 'INSERT')      callbacks.onRecordInsert(rowToRecord(payload.new as RecordRow));
      else if (payload.eventType === 'UPDATE') callbacks.onRecordUpdate(rowToRecord(payload.new as RecordRow));
      else if (payload.eventType === 'DELETE') { const id = (payload.old as { id?: string }).id; if (id) callbacks.onRecordDelete(id); }
    } catch (err) { console.error('[sync] pg records handler error:', err); }
  });

  
  
  _pgChannel.on('postgres_changes' as any, { event: '*', schema: 'public', table: 'activity_logs' }, (payload: any) => {
    if (myVersion !== _channelVersion) return;
    metrics.realtimeEvent('activity_logs');
    try {
      if (payload.eventType === 'INSERT')      callbacks.onLogInsert(rowToLog(payload.new as LogRow));
      else if (payload.eventType === 'DELETE') { const id = (payload.old as { id?: string }).id; if (id) callbacks.onLogDelete(id); }
    } catch (err) { console.error('[sync] pg logs handler error:', err); }
  });

  
  
  
  const triggerStructureRefresh = (table: string) => (myVer: number) => {
    if (myVer !== _channelVersion) return;
    metrics.realtimeEvent(table);
    if (_onRefreshCallback) _onRefreshCallback('all');
  };

  
  _pgChannel.on('postgres_changes' as any, { event: '*', schema: 'public', table: 'departments' },
    () => triggerStructureRefresh('departments')(myVersion));
  
  _pgChannel.on('postgres_changes' as any, { event: '*', schema: 'public', table: 'sections' },
    () => triggerStructureRefresh('sections')(myVersion));
  
  _pgChannel.on('postgres_changes' as any, { event: '*', schema: 'public', table: 'equipment_types' },
    () => triggerStructureRefresh('equipment_types')(myVersion));

  
  
  
  
  
  
  
  
  

  
  
  
  
  _pgChannel.on('postgres_changes' as any, { event: 'INSERT', schema: 'public', table: 'equipment_type_mappings' }, (payload: any) => {
    if (myVersion !== _channelVersion) return;
    metrics.realtimeEvent('equipment_type_mappings');
    try {
      const row = payload.new as MappingRow;
      if (row) callbacks.onMappingInsert(rowToMapping(row));
    } catch (err) { console.error('[sync] pg mapping insert handler error:', err); }
  });
  
  _pgChannel.on('postgres_changes' as any, { event: 'DELETE', schema: 'public', table: 'equipment_type_mappings' }, (payload: any) => {
    if (myVersion !== _channelVersion) return;
    metrics.realtimeEvent('equipment_type_mappings');
    try {
      const id = (payload.old as { id?: string }).id;
      if (id) callbacks.onMappingDelete(id);
    } catch (err) { console.error('[sync] pg mapping delete handler error:', err); }
  });

  
  
  
  _pgChannel.on('postgres_changes' as any, { event: '*', schema: 'public', table: 'settings' }, () => {
    if (myVersion !== _channelVersion) return;
    metrics.realtimeEvent('settings');
    callbacks.onSettingsChange();
  });

  
  
  
  
  
  
  _pgChannel.on('postgres_changes' as any, { event: '*', schema: 'public', table: 'field_configs' },
    () => triggerStructureRefresh('field_configs')(myVersion));

  _pgChannel.subscribe((status, err) => {
    if (myVersion !== _channelVersion) return;
    console.debug('[sync] pg channel status:', status, err ?? '');
    if (status === 'SUBSCRIBED') {
      callbacks.onStatusChange(true);
      if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
      console.debug('[sync] ✅ Realtime active — 9 tables subscribed (incl. settings + equipment_type_mappings)');
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      callbacks.onStatusChange(false);
      _scheduleReconnect(callbacks, myVersion);
    }
  });
}

function _scheduleReconnect(callbacks: RealtimeCallbacks, fromVersion: number): void {
  if (_reconnectTimer) return;
  
  let attempt = 0;
  const retry = () => {
    attempt += 1;
    const delay = Math.min(5_000 * attempt, 30_000);
    _reconnectTimer = setTimeout(() => {
      _reconnectTimer = null;
      if (fromVersion !== _channelVersion) return;
      if (_pgChannel) { supabase.removeChannel(_pgChannel).catch(() => {}); _pgChannel = null; }
      _startPgChannel(callbacks);
    }, delay);
  };
  retry();
}

function _makeCleanup(): () => void {
  return () => {
    console.debug('[sync] cleaning up realtime channels');
    _channelVersion += 1;  
    _broadcastReady  = false;
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    if (_pgChannel)        { supabase.removeChannel(_pgChannel).catch(() => {});        _pgChannel = null; }
    if (_broadcastChannel) { supabase.removeChannel(_broadcastChannel).catch(() => {}); _broadcastChannel = null; }
    _onRefreshCallback = null;
    console.debug('[sync] ✅ channels removed, memory clean');
  };
}

let _presenceChannel: ReturnType<typeof supabase.channel> | null = null;
let _onPresenceChange: ((count: number) => void) | null = null;

function _getSessionId(): string {
  let id = sessionStorage.getItem('dc_session_id');
  if (!id) {
    id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem('dc_session_id', id);
  }
  return id;
}

export function startPresenceTracking(onChange: (count: number) => void): () => void {
  _onPresenceChange = onChange;
  const sessionId = _getSessionId();

  if (_presenceChannel) {
    supabase.removeChannel(_presenceChannel).catch(() => {});
    _presenceChannel = null;
  }

  _presenceChannel = supabase.channel('dc-presence', {
    config: { presence: { key: sessionId } },
  });

  _presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const state = _presenceChannel!.presenceState();
      const count = Object.keys(state).length;
      if (_onPresenceChange) _onPresenceChange(count);
    })
    .on('presence', { event: 'join' }, () => {
      const state = _presenceChannel!.presenceState();
      const count = Object.keys(state).length;
      if (_onPresenceChange) _onPresenceChange(count);
    })
    .on('presence', { event: 'leave' }, () => {
      const state = _presenceChannel!.presenceState();
      const count = Object.keys(state).length;
      if (_onPresenceChange) _onPresenceChange(count);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await _presenceChannel!.track({ joinedAt: Date.now() });
      }
    });

  return () => {
    _onPresenceChange = null;
    if (_presenceChannel) {
      supabase.removeChannel(_presenceChannel).catch(() => {});
      _presenceChannel = null;
    }
  };
}

export function getActiveUsersToday(activityLogs: import('../store').ActivityLog[]): number {
  const today = new Date().toISOString().slice(0, 10);
  const sessions = new Set<string>();
  for (const log of activityLogs) {
    if (log.timestamp.slice(0, 10) === today && log.actor) {
      sessions.add(log.actor);
    }
  }
  return sessions.size;
}

export function getActiveUsersByDay(
  activityLogs: import('../store').ActivityLog[],
  days = 7
): { date: string; count: number }[] {
  const result: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const sessions = new Set<string>();
    for (const log of activityLogs) {
      if (log.timestamp.slice(0, 10) === dateStr && log.actor) {
        sessions.add(log.actor);
      }
    }
    result.push({ date: dateStr, count: sessions.size });
  }
  return result;
}

export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  }) as T;
}

function _logHint(code: string | undefined, message: string): void {
  if (code === '42P01') { console.error('[sync] ❌ Table missing — run the SQL setup script'); return; }
  if (code === 'PGRST301' || message?.toLowerCase().includes('rls')) {
    console.error('[sync] ❌ RLS blocking — run: ALTER TABLE records DISABLE ROW LEVEL SECURITY;'); return;
  }
  if (message?.toLowerCase().includes('jwt') || message?.toLowerCase().includes('apikey')) {
    console.error('[sync] ❌ API key issue — check Supabase Dashboard → Settings → API');
  }
}
