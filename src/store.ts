

import { create } from 'zustand';
import { hashPassword, verifyPassword } from './lib/crypto';
import { supabase } from './lib/supabase';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import { safeSetItem, safeGetItem, safeRemoveItem } from './lib/safeStorage';
import { flushEvidenceQueue, queueRecordEvidence } from './lib/evidence';
import { useStorageMonitor } from './lib/storageMonitor';
import {
  syncInsertRecord,
  syncDeleteRecord,
  syncUpdateRecord,
  syncMarkRecordEdited,
  syncInsertLog,
  syncDeleteLog,
  syncUpsertTemplate,
  syncUpsertDepartment,
  syncDeleteDepartment,
  syncUpsertSection,
  syncDeleteSection,
  syncUpsertEquipmentType,
  syncDeleteEquipmentType,
  syncUpsertAdmin,
  syncDeleteAdmin,
  syncUpsertSettings,
  syncUpsertFieldConfig,
  syncDeleteFieldConfig,
  debounce,
} from './lib/sync';

const _debouncedSyncUpdate = debounce((record: any) => syncUpdateRecord(record), 500);

export interface Department {
  id: string;
  name: string;
  position: number;
}

export interface Section {
  id: string;
  departmentId: string;
  name: string;
  position: number;
}

export interface EquipmentType {
  id: string;
  code: string; 
  name: string;
  position: number;
}

export interface EquipmentTypeMapping {
  id: string;
  departmentId: string;
  sectionId: string;
  equipmentTypeId: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  order: number;
  
  isSubheading?: boolean;
}

export interface ChecklistTemplate {
  id: string;
  equipmentTypeId: string;
  sectionId: string;
  items: ChecklistItem[];
}

export interface ChecklistResponse {
  itemId: string;
  label: string;
  status: 'OK' | 'NOT OK' | 'N/A' | '';
  comment: string;
  actionPlan: string;
  evidenceImage?: EvidenceImage;
  
  isSubheading?: boolean;
}

export interface EvidenceImage {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  dataUrl?: string;
  imageUrl?: string;
  storagePath?: string;
  syncStatus?: 'pending' | 'synced' | 'failed';
  createdAt: string;
}

export interface Record {
  id: string;
  refId: string;
  submissionId: string;           
  departmentId: string;
  departmentName: string;
  sectionId: string;
  sectionName: string;
  equipmentTypeId: string;
  equipmentTypeName: string;
  equipmentTypeCode: string;
  equipmentNumber: string;
  date: string;
  startTime: string;
  completionTime: string;
  technicianName: string;
  supervisorName: string;
  qcVerifierName: string;
  hourMeterReading: string;
  fuelCanDetermine: 'yes' | 'no' | '';
  fuelLevel: string;            // only valid when fuelCanDetermine = 'yes'
  fuelUndeterminedReason: string;
  checklistResponses: ChecklistResponse[];
  additionalComment?: string;
  additionalEvidenceImage?: EvidenceImage;
  // Urgent Attention Assessment — a record-level urgency decision made by the
  // technician, distinct from individual checklist item fault status.
  // Historical records (created before this feature) will not have this
  // persisted; rowToRecord() safely falls back requiresUrgentAttention to
  // false and urgentAttentionReason to undefined for those — that fallback
  // is a backwards-compatibility default, NOT an actual technician decision.
  requiresUrgentAttention: boolean;
  urgentAttentionReason?: string;
  submittedAt: string;
  editedBy?: string;   // null/undefined = not edited (or edited by super admin — not displayed)
  editedAt?: string;
}

export type AdminRole = 'junior' | 'senior';

export interface AdminUser {
  id: string;
  email: string;
  
  passwordHash: string;
  passwordSet: boolean;
  isSuperAdmin: boolean;
  role: AdminRole;
  canDeleteRecords: boolean;
  canAddAdmins: boolean;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  section: 'submissions' | 'deletions' | 'admin' | 'structure';
  type:
    | 'record_submitted'
    | 'record_deleted'
    | 'record_edited'
    | 'admin_created'
    | 'admin_removed'
    | 'admin_permissions_updated'
    | 'admin_login'
    | 'department_added'
    | 'department_removed'
    | 'section_added'
    | 'section_removed'
    | 'equipment_added'
    | 'equipment_removed';
  description: string;
  actor?: string;
  
  ip?: string;
  timestamp: string;
}

export type RecordsVisibility = 'general' | 'admin_only';
export type ActivityLogVisibility = 'all' | 'admin_only';
export type FuelMonitoringVisibility = 'all' | 'admin_only';

export interface AppSettings {
  
  navLogoUrl: string | null;
  

  navLogoV: number;
  
  homeLogoUrl: string | null;
  
  homeLogoV: number;

  /** URL of the logo that appears in checklist record detail views and PDF reports. */
  checklistLogoUrl: string | null;
  /** Version counter for cache-busting on checklist logo updates. */
  checklistLogoV: number;

  /** URL of the logo shown on the app passcode lock screen. */
  passcodeLogoUrl: string | null;
  /** Version counter for cache-busting on passcode logo updates. */
  passcodeLogoV: number;
  /** 4 digit passcode required to unlock the app when passcodeEnabled is true. */
  appPasscode: string;
  /** Whether the app passcode lock screen is active. Super admin controlled. Default: false */
  passcodeEnabled: boolean;

  qcVerifierRequired: boolean;
  footerText: string;
  
  homeTitle: string;
  

  recordsVisibility: RecordsVisibility;
  

  showFillButton: boolean;

  /** Who can see the Activity Log tab. 'all' = everyone; 'admin_only' = admins only. Default: 'all' */
  activityLogVisibility: ActivityLogVisibility;
  /** Who can see Fuel Monitoring. Super admins can open this to everyone. Default: 'admin_only' */
  fuelMonitoringVisibility: FuelMonitoringVisibility;

  /**
   * Super-admin-editable copy shown on the Urgent Attention Assessment step
   * of the technician checklist flow. Falls back to the original wording
   * whenever empty/missing (new installs, historical settings rows, etc).
   */
  urgentAttentionQuestionText: string;
  urgentAttentionDefinitionText: string;
}

export type FieldType = 'text' | 'numeric' | 'dropdown' | 'fuel_percent';

/** Default Urgent Attention Assessment copy — used as the fallback whenever
 *  settings.urgentAttentionQuestionText / urgentAttentionDefinitionText is
 *  empty (new installs, historical settings rows predating this feature). */
export const DEFAULT_URGENT_ATTENTION_QUESTION_TEXT =
  'Does this equipment require urgent attention?';
export const DEFAULT_URGENT_ATTENTION_DEFINITION_TEXT =
  'Urgent Attention means the issue found during this inspection needs to be checked and fixed QUICKLY. ' +
  'Delaying action may cause a safety risk, affect equipment performance, make the problem worse, or lead to ' +
  'unexpected equipment downtime.';

export const GLOBAL_EQUIPMENT_ID = '__global__';

export interface FieldConfig {
  id: string;              
  key: string;             
  label: string;           
  fieldType: FieldType;
  required: boolean;
  order: number;           
  options: string[];       
  isBuiltIn: boolean;      
  
  
  
  equipmentTypeId: string;
}

export function resolveFieldConfigs(
  allConfigs: FieldConfig[],
  equipmentTypeId: string
): FieldConfig[] {
  const globals    = allConfigs.filter((c) => c.equipmentTypeId === GLOBAL_EQUIPMENT_ID);
  const specific   = allConfigs.filter((c) => c.equipmentTypeId === equipmentTypeId);

  
  const merged = new Map<string, FieldConfig>(globals.map((c) => [c.key, c]));

  
  for (const cfg of specific) {
    merged.set(cfg.key, cfg);
  }

  
  return Array.from(merged.values()).sort((a, b) => a.order - b.order);
}

interface AppState {
  
  
  
  fieldConfigs: FieldConfig[];
  departments: Department[];
  sections: Section[];
  equipmentTypes: EquipmentType[];
  equipmentTypeMappings: EquipmentTypeMapping[];
  checklistTemplates: ChecklistTemplate[];
  settings: AppSettings;

  
  records: Record[];
  activityLogs: ActivityLog[];
  recordsTotalCount: number | null;

  /** Cached today count — invalidated by date change or new submission */
  todayCountCached: number | null;
  todayCountDate: string | null; // YYYY-MM-DD the cache belongs to
  /** Timestamp of the most recent locally-submitted record (null = none yet) */
  lastSubmittedAt: string | null;

  
  adminUsers: AdminUser[];
  currentAdmin: AdminUser | null;

  
  isRealtimeConnected: boolean;
  lastSyncedAt: string | null;
  
  
  fieldConfigsVersion: string | null;
  fieldConfigsCachedAt: string | null;

  
  addDepartment: (name: string) => void;
  renameDepartment: (id: string, newName: string) => void;
  removeDepartment: (id: string) => void;
  moveDepartmentUp: (id: string) => void;
  moveDepartmentDown: (id: string) => void;

  
  addSection: (departmentId: string, name: string) => void;
  renameSection: (id: string, newName: string) => void;
  removeSection: (id: string) => void;
  moveSectionUp: (id: string) => void;
  moveSectionDown: (id: string) => void;

  
  
  setEquipmentTypeMappings: (departmentId: string, sectionId: string, equipmentTypeIds: string[]) => Promise<void>;
  
  _realtimeMappingInsert: (mapping: EquipmentTypeMapping) => void;
  
  _realtimeMappingDelete: (id: string) => void;

  
  addEquipmentType: (name: string, code: string) => void;
  renameEquipmentType: (id: string, newName: string, newCode: string) => void;
  removeEquipmentType: (id: string) => void;
  moveEquipmentTypeUp: (id: string) => void;
  moveEquipmentTypeDown: (id: string) => void;

  
  upsertChecklistTemplate: (
    equipmentTypeId: string,
    sectionId: string,
    items: ChecklistItem[]
  ) => void;
  getChecklistTemplate: (
    equipmentTypeId: string,
    sectionId: string
  ) => ChecklistTemplate | undefined;

  
  upsertFieldConfig: (config: FieldConfig) => void;
  removeFieldConfig: (id: string, bypassBuiltInGuard?: boolean) => void;
  
  reorderFieldConfigs: (orderedIds: string[], equipmentTypeId: string) => void;

  
  setNavLogo: (dataUrl: string | null) => void;
  setHomeLogo: (dataUrl: string | null) => void;
  setChecklistLogo: (dataUrl: string | null) => void;
  setPasscodeLogo: (dataUrl: string | null) => void;
  setAppPasscode: (passcode: string) => void;
  setPasscodeEnabled: (enabled: boolean) => void;
  setQcRequired: (required: boolean) => void;
  setFuelRequired: (required: boolean) => void;
  setHomeTitle: (title: string) => void;
  setUrgentAttentionQuestionText: (text: string) => void;
  setUrgentAttentionDefinitionText: (text: string) => void;
  setRecordsVisibility: (value: RecordsVisibility) => void;
  setFooterText: (text: string) => void;
  setShowFillButton: (show: boolean) => void;
  setActivityLogVisibility: (value: ActivityLogVisibility) => void;
  setFuelMonitoringVisibility: (value: FuelMonitoringVisibility) => void;

  
  addRecord: (record: Omit<Record, 'id' | 'refId' | 'submittedAt'>) => Promise<{ status: 'success' | 'queued' | 'failed' | 'duplicate'; message: string }>;
  deleteRecord: (id: string, adminEmail: string) => void;
  updateChecklistResponse: (
    recordId: string,
    itemId: string,
    field: 'label' | 'status' | 'comment' | 'actionPlan',
    value: string,
    editorEmail?: string,
    isSuperAdmin?: boolean
  ) => void;
  updateRecordField: (
    recordId: string,
    field: keyof Pick<Record, 'equipmentTypeName' | 'equipmentTypeCode' | 'equipmentNumber' | 'date' | 'startTime' | 'completionTime' | 'technicianName' | 'supervisorName' | 'qcVerifierName' | 'hourMeterReading' | 'fuelCanDetermine' | 'fuelLevel' | 'fuelUndeterminedReason' | 'additionalComment'>,
    value: string,
    editorEmail?: string,
    editorIsSuperAdmin?: boolean
  ) => void;

  
  login: (email: string, password: string) => Promise<AdminUser | null>;
  setAdminPassword: (email: string, newPassword: string) => Promise<boolean>;
  getPendingAdmin: (email: string) => AdminUser | null;
  logout: () => void;
  registerAdmin: (email: string, role: AdminRole) => boolean;
  addAdmin: (email: string, password: string, role: AdminRole) => Promise<boolean>;
  addJuniorAdmin: (email: string, password: string) => Promise<boolean>;
  updateAdminRole: (id: string, role: AdminRole) => void;
  removeAdmin: (id: string) => void;
  changeSuperAdminPassword: (adminId: string, currentPw: string, newPw: string) => Promise<boolean>;
  promoteSuperAdmin: (id: string) => 'ok' | 'cap_reached' | 'not_found';

  
  addLog: (log: Omit<ActivityLog, 'id' | 'timestamp'>) => void;
  deleteLog: (id: string) => void;

  
  
  
  setRealtimeConnected: (connected: boolean) => void;
  setLastSyncedAt: (ts: string) => void;
  setFieldConfigsVersion: (v: string) => void;
  _realtimeInsertRecord: (record: Record) => void;
  _realtimeDeleteRecord: (id: string) => void;
  _realtimeUpdateRecord: (record: Record) => void;
  _realtimeInsertLog: (log: ActivityLog) => void;
  _realtimeDeleteLog: (id: string) => void;
  
  mergeRemoteData: (records: Record[] | null, logs: ActivityLog[] | null) => void;
  upsertRecords: (records: Record[]) => void;
  setRecordChecklist: (recordId: string, checklist: ChecklistResponse[], additionalComment?: string, additionalEvidenceImage?: EvidenceImage) => void;
  setRecordsTotalCount: (n: number | null) => void;
  setTodayCountCached: (count: number, date: string) => void;
  incrementTodayCount: () => void;
  mergeRemoteTemplates: (templates: ChecklistTemplate[]) => void;
  mergeRemoteDepartments: (depts: Department[]) => void;
  mergeRemoteSections: (sections: Section[]) => void;
  mergeRemoteEquipmentTypes: (types: EquipmentType[]) => void;
  mergeRemoteMappings: (mappings: EquipmentTypeMapping[]) => void;
  mergeRemoteAdmins: (admins: AdminUser[]) => void;
  mergeRemoteSettings: (settings: AppSettings) => void;
  mergeRemoteFieldConfigs: (configs: FieldConfig[]) => void;
  setFieldConfigsCachedAt: (iso: string) => void;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const now = () => new Date().toISOString();

const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

export function makeRefId(code: string, equipmentNumber: string, dateStr?: string): string {
  const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  const mon = MONTH_ABBR[d.getMonth()];
  const day = String(d.getDate()).padStart(2, '0');
  const numPart = (equipmentNumber || '').replace(/\s+/g, '').toUpperCase();
  return `${code.toUpperCase()}${numPart}-${mon}-${day}`;
}

function logSection(type: ActivityLog['type']): ActivityLog['section'] {
  if (type === 'record_submitted') return 'submissions';
  if (type === 'record_deleted') return 'deletions';
  if (type === 'record_edited') return 'submissions';
  if (
    type === 'admin_created' ||
    type === 'admin_removed' ||
    type === 'admin_permissions_updated' ||
    type === 'admin_login'
  ) return 'admin';
  return 'structure';
}

const DEPT_WS  = 'dept-workshop';
const SEC_ELEC = 'sec-electrical';
const SEC_MECH = 'sec-mechanical';
const EQ_RS    = 'eq-rs';
const EQ_SL    = 'eq-sl';
const EQ_TT    = 'eq-tt';
const EQ_FL    = 'eq-fl';

const defaultDepartments: Department[] = [
  { id: DEPT_WS, name: 'WORKSHOP DEPARTMENT', position: 0 },
];

const defaultSections: Section[] = [
  { id: SEC_ELEC, departmentId: DEPT_WS, name: 'Electrical', position: 0 },
  { id: SEC_MECH, departmentId: DEPT_WS, name: 'Mechanical', position: 1 },
];

const defaultEquipmentTypes: EquipmentType[] = [
  { id: EQ_RS, code: 'RS', name: 'Reach Stacker', position: 0 },
  { id: EQ_SL, code: 'SL', name: 'Side Loader', position: 1 },
  { id: EQ_TT, code: 'TT', name: 'Terminal Truck', position: 2 },
  { id: EQ_FL, code: 'FL', name: 'Fork Lift', position: 3 },
];

const makeItems = (labels: string[]): ChecklistItem[] =>
  labels.map((label, i) => ({ id: uid(), label, order: i, isSubheading: false }));

const defaultTemplates: ChecklistTemplate[] = [
  { id: uid(), equipmentTypeId: EQ_RS, sectionId: SEC_ELEC, items: makeItems(['Battery / Charging System','Lights (Head, Tail, Warning)','Horn & Alarm','Electrical Cables & Connections','Control Panel Indicators','Emergency Stop Button']) },
  { id: uid(), equipmentTypeId: EQ_RS, sectionId: SEC_MECH, items: makeItems(['Engine Oil Level','Hydraulic Oil Level','Coolant Level','Fuel Level','Boom / Spreader Function','Tyres & Wheels','Brakes','Steering System']) },
  { id: uid(), equipmentTypeId: EQ_SL, sectionId: SEC_ELEC, items: makeItems(['Battery / Charging System','Lights (Head, Tail, Warning)','Horn & Alarm','Electrical Cables & Connections','Control Panel Indicators','Emergency Stop Button']) },
  { id: uid(), equipmentTypeId: EQ_SL, sectionId: SEC_MECH, items: makeItems(['Engine Oil Level','Hydraulic Oil Level','Coolant Level','Fuel Level','Lifting Arms & Mechanism','Tyres & Wheels','Brakes','Steering System']) },
  { id: uid(), equipmentTypeId: EQ_TT, sectionId: SEC_ELEC, items: makeItems(['Battery / Charging System','Lights (Head, Tail, Indicator)','Horn','Electrical Wiring','Instrument Panel','Emergency Stop']) },
  { id: uid(), equipmentTypeId: EQ_TT, sectionId: SEC_MECH, items: makeItems(['Engine Oil Level','Coolant Level','Fuel Level','Fifth Wheel Coupling','Air Brake System','Tyres & Wheels','Suspension']) },
  { id: uid(), equipmentTypeId: EQ_FL, sectionId: SEC_ELEC, items: makeItems(['Battery / Charging System','Lights & Warning Beacon','Horn','Electrical Connections','Hour Meter','Emergency Stop']) },
  { id: uid(), equipmentTypeId: EQ_FL, sectionId: SEC_MECH, items: makeItems(['Engine / Motor Oil Level','Hydraulic Oil Level','Coolant Level','Fuel / LPG Level','Forks & Mast','Tyres & Wheels','Brakes','Load Backrest']) },
];

const defaultAdmins: AdminUser[] = [];

const defaultSettings: AppSettings = {
  navLogoUrl: null,
  navLogoV: 1,
  homeLogoUrl: null,
  homeLogoV: 1,
  checklistLogoUrl: null,
  checklistLogoV: 1,
  passcodeLogoUrl: null,
  passcodeLogoV: 1,
  appPasscode: '1234',
  passcodeEnabled: false,
  qcVerifierRequired: false,
  footerText: 'Designed by workshop inventory',
  homeTitle: 'Technical Department Inspection System',
  recordsVisibility: 'general',
  showFillButton: false,
  activityLogVisibility: 'all',
  fuelMonitoringVisibility: 'admin_only',
  urgentAttentionQuestionText: DEFAULT_URGENT_ATTENTION_QUESTION_TEXT,
  urgentAttentionDefinitionText: DEFAULT_URGENT_ATTENTION_DEFINITION_TEXT,
};

const defaultFieldConfigs: FieldConfig[] = [
  {
    id: 'field-equip-num',
    key: 'equipmentNumber',
    label: 'Equipment Number',
    fieldType: 'numeric',
    required: true,
    order: 0,
    options: [],
    isBuiltIn: true,
    equipmentTypeId: GLOBAL_EQUIPMENT_ID,
  },
  {
    id: 'field-tech-name',
    key: 'technicianName',
    label: 'Technician Name',
    fieldType: 'text',
    required: true,
    order: 1,
    options: [],
    isBuiltIn: true,
    equipmentTypeId: GLOBAL_EQUIPMENT_ID,
  },
  {
    id: 'field-sup-name',
    key: 'supervisorName',
    label: 'Supervisor Name',
    fieldType: 'text',
    required: true,
    order: 2,
    options: [],
    isBuiltIn: true,
    equipmentTypeId: GLOBAL_EQUIPMENT_ID,
  },
  {
    id: 'field-hour-meter',
    key: 'hourMeterReading',
    label: 'Hour Meter Reading',
    fieldType: 'numeric',
    required: true,
    order: 3,
    options: [],
    isBuiltIn: true,
    equipmentTypeId: GLOBAL_EQUIPMENT_ID,
  },
  {
    id: 'field-qc-verifier',
    key: 'qcVerifierName',
    label: "QC Verifier's Name",
    fieldType: 'text',
    required: false,
    order: 5,
    options: [],
    isBuiltIn: true,
    equipmentTypeId: GLOBAL_EQUIPMENT_ID,
  },
  {
    id: 'field-fuel-level',
    key: 'fuelLevel',
    label: 'Fuel Level',
    fieldType: 'fuel_percent' as FieldType,
    required: false,
    order: 4,
    options: [],
    isBuiltIn: true,
    equipmentTypeId: GLOBAL_EQUIPMENT_ID,
  },
];

export function canDeleteRecords(admin: AdminUser | null): boolean {
  if (!admin) return false;
  return admin.isSuperAdmin; // Only Super Admin can delete records
}

export function canManageJuniors(admin: AdminUser | null): boolean {
  if (!admin) return false;
  return admin.isSuperAdmin || admin.role === 'senior';
}

export function isSuperAdmin(admin: AdminUser | null): boolean {
  return !!admin?.isSuperAdmin;
}

export function isAdmin(admin: AdminUser | null): boolean {
  if (!admin) return false;
  return admin.isSuperAdmin || admin.role === 'junior' || admin.role === 'senior';
}

export function canViewRecords(admin: AdminUser | null, visibility: RecordsVisibility): boolean {
  if (visibility === 'general') return true;
  
  return isAdmin(admin);
}

export function canViewActivityLog(admin: AdminUser | null, visibility: ActivityLogVisibility): boolean {
  if (visibility === 'all') return true;
  return isAdmin(admin); // 'admin_only'
}

export function canViewFuelMonitoring(admin: AdminUser | null, visibility: FuelMonitoringVisibility): boolean {
  if (visibility === 'all') return true;
  return isAdmin(admin);
}

export function canAccessAdminTab(admin: AdminUser | null): boolean {
  if (!admin) return false;
  return admin.isSuperAdmin || admin.role === 'senior';
}

export function getMappedEquipmentTypeIds(
  mappings: EquipmentTypeMapping[],
  departmentId: string,
  sectionId: string
): string[] | null {
  const relevant = mappings.filter(
    (m) => m.departmentId === departmentId && m.sectionId === sectionId
  );
  if (relevant.length === 0) return null; 
  return relevant.map((m) => m.equipmentTypeId);
}

const _safeLocalStorageAdapter: StateStorage = {
  getItem: (name: string): string | null => safeGetItem(name),

  setItem: (name: string, value: string): void => {
    const result = safeSetItem(name, value);
    
    
    
    useStorageMonitor.getState().handleWriteResult(result);
  },

  removeItem: (name: string): void => safeRemoveItem(name),
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      fieldConfigs: defaultFieldConfigs,
      departments: defaultDepartments,
      sections: defaultSections,
      equipmentTypes: defaultEquipmentTypes,
      checklistTemplates: defaultTemplates,
      equipmentTypeMappings: [],
      settings: defaultSettings,
      records: [],
      activityLogs: [],
      recordsTotalCount: null,
      todayCountCached: null,
      todayCountDate: null,
      lastSubmittedAt: null,
      adminUsers: defaultAdmins,
      currentAdmin: null,
      isRealtimeConnected: false,
      lastSyncedAt: null,
      fieldConfigsVersion: null,
      fieldConfigsCachedAt: null,

      
      setEquipmentTypeMappings: async (departmentId, sectionId, equipmentTypeIds) => {
        
        
        set((s) => {
          const kept = s.equipmentTypeMappings.filter(
            (m) => !(m.departmentId === departmentId && m.sectionId === sectionId)
          );
          const added: EquipmentTypeMapping[] = equipmentTypeIds.map((etId) => ({
            id: `local-${departmentId}-${sectionId}-${etId}`,
            departmentId,
            sectionId,
            equipmentTypeId: etId,
          }));
          return { equipmentTypeMappings: [...kept, ...added] };
        });

        
        const { syncSetEquipmentTypeMappings, fetchRemoteMappings } = await import('./lib/sync');
        await syncSetEquipmentTypeMappings(departmentId, sectionId, equipmentTypeIds);

        
        
        
        
        
        try {
          const fresh = await fetchRemoteMappings();
          if (fresh) set(() => ({ equipmentTypeMappings: fresh }));
        } catch {  }
      },

      _realtimeMappingInsert: (mapping) => {
        set((s) => {
          
          
          
          const hasById = s.equipmentTypeMappings.some((m) => m.id === mapping.id);
          if (hasById) return s;
          
          const withoutOptimistic = s.equipmentTypeMappings.filter(
            (m) => !(
              m.id.startsWith('local-') &&
              m.departmentId    === mapping.departmentId &&
              m.sectionId       === mapping.sectionId &&
              m.equipmentTypeId === mapping.equipmentTypeId
            )
          );
          return { equipmentTypeMappings: [...withoutOptimistic, mapping] };
        });
      },

      _realtimeMappingDelete: (id) => {
        set((s) => ({
          equipmentTypeMappings: s.equipmentTypeMappings.filter((m) => m.id !== id),
        }));
      },

      mergeRemoteMappings: (mappings) => {
        set(() => ({ equipmentTypeMappings: mappings }));
      },

      
      addDepartment: (name) => {
        const maxPos = get().departments.reduce((m, d) => Math.max(m, d.position ?? 0), -1);
        const dept: Department = { id: uid(), name, position: maxPos + 1 };
        
        set((s) => ({ departments: [...s.departments, dept] }));
        get().addLog({ section: 'structure', type: 'department_added', description: `Department added: ${name}`, actor: get().currentAdmin?.email });
        
        syncUpsertDepartment(dept);
      },

      renameDepartment: (id, newName) => {
        const dept = get().departments.find((d) => d.id === id);
        if (!dept || !newName.trim()) return;
        const trimmed = newName.trim();
        
        set((s) => ({
          departments: s.departments.map((d) => d.id === id ? { ...d, name: trimmed } : d),
        }));
        get().addLog({ section: 'structure', type: 'department_added', description: `Department renamed: "${dept.name}" → "${trimmed}"`, actor: get().currentAdmin?.email });
        
        syncUpsertDepartment({ id, name: trimmed, position: dept.position ?? 0 });
      },

      removeDepartment: (id) => {
        const dept = get().departments.find((d) => d.id === id);
        
        const childSectionIds = get().sections
          .filter((s) => s.departmentId === id)
          .map((s) => s.id);
        
        set((s) => ({
          departments: s.departments.filter((d) => d.id !== id),
          sections:    s.sections.filter((sec) => sec.departmentId !== id),
        }));
        if (dept) {
          get().addLog({ section: 'structure', type: 'department_removed', description: `Department removed: ${dept.name}`, actor: get().currentAdmin?.email });
        }
        
        syncDeleteDepartment(id);
        childSectionIds.forEach((sid) => syncDeleteSection(sid));
      },

      moveDepartmentUp: (id) => {
        const depts = [...get().departments].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        const idx = depts.findIndex((d) => d.id === id);
        if (idx <= 0) return;
        const above = depts[idx - 1];
        const curr  = depts[idx];
        const newCurr  = { ...curr,  position: above.position ?? idx - 1 };
        const newAbove = { ...above, position: curr.position  ?? idx     };
        set((s) => ({
          departments: s.departments.map((d) =>
            d.id === curr.id  ? newCurr  :
            d.id === above.id ? newAbove : d
          ),
        }));
        import('./lib/sync').then(({ syncUpsertDepartment: su }) => {
          su(newCurr);
          su(newAbove);
        });
      },

      moveDepartmentDown: (id) => {
        const depts = [...get().departments].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        const idx = depts.findIndex((d) => d.id === id);
        if (idx < 0 || idx >= depts.length - 1) return;
        const below = depts[idx + 1];
        const curr  = depts[idx];
        const newCurr  = { ...curr,  position: below.position ?? idx + 1 };
        const newBelow = { ...below, position: curr.position  ?? idx     };
        set((s) => ({
          departments: s.departments.map((d) =>
            d.id === curr.id  ? newCurr  :
            d.id === below.id ? newBelow : d
          ),
        }));
        import('./lib/sync').then(({ syncUpsertDepartment: su }) => {
          su(newCurr);
          su(newBelow);
        });
      },

      
      addSection: (departmentId, name) => {
        const maxPos = get().sections
          .filter((s) => s.departmentId === departmentId)
          .reduce((m, s) => Math.max(m, s.position ?? 0), -1);
        const sec: Section = { id: uid(), departmentId, name, position: maxPos + 1 };
        
        set((s) => ({ sections: [...s.sections, sec] }));
        get().addLog({ section: 'structure', type: 'section_added', description: `Section added: ${name}`, actor: get().currentAdmin?.email });
        
        syncUpsertSection(sec);
      },

      renameSection: (id, newName) => {
        const sec = get().sections.find((s) => s.id === id);
        if (!sec || !newName.trim()) return;
        const trimmed = newName.trim();
        
        set((s) => ({
          sections: s.sections.map((sec) => sec.id === id ? { ...sec, name: trimmed } : sec),
        }));
        get().addLog({ section: 'structure', type: 'section_added', description: `Section renamed: "${sec.name}" → "${trimmed}"`, actor: get().currentAdmin?.email });
        
        syncUpsertSection({ id, name: trimmed, departmentId: sec.departmentId, position: sec.position ?? 0 });
      },

      removeSection: (id) => {
        const sec = get().sections.find((s) => s.id === id);
        
        set((s) => ({ sections: s.sections.filter((sec) => sec.id !== id) }));
        if (sec) {
          get().addLog({ section: 'structure', type: 'section_removed', description: `Section removed: ${sec.name}`, actor: get().currentAdmin?.email });
        }
        
        syncDeleteSection(id);
      },

      moveSectionUp: (id) => {
        const sec = get().sections.find((s) => s.id === id);
        if (!sec) return;
        const siblings = [...get().sections]
          .filter((s) => s.departmentId === sec.departmentId)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        const idx = siblings.findIndex((s) => s.id === id);
        if (idx <= 0) return;
        const above = siblings[idx - 1];
        const curr  = siblings[idx];
        const newCurr  = { ...curr,  position: above.position ?? idx - 1 };
        const newAbove = { ...above, position: curr.position  ?? idx     };
        set((s) => ({
          sections: s.sections.map((s2) =>
            s2.id === curr.id  ? newCurr  :
            s2.id === above.id ? newAbove : s2
          ),
        }));
        import('./lib/sync').then(({ syncUpsertSection: su }) => {
          su(newCurr);
          su(newAbove);
        });
      },

      moveSectionDown: (id) => {
        const sec = get().sections.find((s) => s.id === id);
        if (!sec) return;
        const siblings = [...get().sections]
          .filter((s) => s.departmentId === sec.departmentId)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        const idx = siblings.findIndex((s) => s.id === id);
        if (idx < 0 || idx >= siblings.length - 1) return;
        const below = siblings[idx + 1];
        const curr  = siblings[idx];
        const newCurr  = { ...curr,  position: below.position ?? idx + 1 };
        const newBelow = { ...below, position: curr.position  ?? idx     };
        set((s) => ({
          sections: s.sections.map((s2) =>
            s2.id === curr.id  ? newCurr  :
            s2.id === below.id ? newBelow : s2
          ),
        }));
        import('./lib/sync').then(({ syncUpsertSection: su }) => {
          su(newCurr);
          su(newBelow);
        });
      },

      
      addEquipmentType: (name, code) => {
        const maxPos = get().equipmentTypes.reduce((m, e) => Math.max(m, e.position ?? 0), -1);
        const eq: EquipmentType = { id: uid(), code: code.toUpperCase(), name, position: maxPos + 1 };
        
        set((s) => ({ equipmentTypes: [...s.equipmentTypes, eq] }));
        get().addLog({ section: 'structure', type: 'equipment_added', description: `Equipment type added: ${name} (${code.toUpperCase()})`, actor: get().currentAdmin?.email });
        
        syncUpsertEquipmentType(eq);
      },

      renameEquipmentType: (id, newName, newCode) => {
        const eq = get().equipmentTypes.find((e) => e.id === id);
        if (!eq || !newName.trim() || !newCode.trim()) return;
        const trimmedName = newName.trim();
        const trimmedCode = newCode.trim().toUpperCase();
        
        set((s) => ({
          equipmentTypes: s.equipmentTypes.map((e) =>
            e.id === id ? { ...e, name: trimmedName, code: trimmedCode } : e
          ),
        }));
        get().addLog({ section: 'structure', type: 'equipment_added', description: `Equipment renamed: "${eq.name} (${eq.code})" → "${trimmedName} (${trimmedCode})"`, actor: get().currentAdmin?.email });
        
        syncUpsertEquipmentType({ id, name: trimmedName, code: trimmedCode, position: eq.position ?? 0 });
      },

      removeEquipmentType: (id) => {
        const eq = get().equipmentTypes.find((e) => e.id === id);
        
        set((s) => ({
          equipmentTypes:     s.equipmentTypes.filter((e) => e.id !== id),
          checklistTemplates: s.checklistTemplates.filter((t) => t.equipmentTypeId !== id),
        }));
        if (eq) {
          get().addLog({ section: 'structure', type: 'equipment_removed', description: `Equipment type removed: ${eq.name}`, actor: get().currentAdmin?.email });
        }
        
        syncDeleteEquipmentType(id);
      },

      moveEquipmentTypeUp: (id) => {
        const eqs = [...get().equipmentTypes].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        const idx = eqs.findIndex((e) => e.id === id);
        if (idx <= 0) return;
        const above = eqs[idx - 1];
        const curr  = eqs[idx];
        const newCurr  = { ...curr,  position: above.position ?? idx - 1 };
        const newAbove = { ...above, position: curr.position  ?? idx     };
        set((s) => ({
          equipmentTypes: s.equipmentTypes.map((e) =>
            e.id === curr.id  ? newCurr  :
            e.id === above.id ? newAbove : e
          ),
        }));
        import('./lib/sync').then(({ syncUpsertEquipmentType: su }) => {
          su(newCurr);
          su(newAbove);
        });
      },

      moveEquipmentTypeDown: (id) => {
        const eqs = [...get().equipmentTypes].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        const idx = eqs.findIndex((e) => e.id === id);
        if (idx < 0 || idx >= eqs.length - 1) return;
        const below = eqs[idx + 1];
        const curr  = eqs[idx];
        const newCurr  = { ...curr,  position: below.position ?? idx + 1 };
        const newBelow = { ...below, position: curr.position  ?? idx     };
        set((s) => ({
          equipmentTypes: s.equipmentTypes.map((e) =>
            e.id === curr.id  ? newCurr  :
            e.id === below.id ? newBelow : e
          ),
        }));
        import('./lib/sync').then(({ syncUpsertEquipmentType: su }) => {
          su(newCurr);
          su(newBelow);
        });
      },

      
      upsertChecklistTemplate: (equipmentTypeId, sectionId, items) => {
        
        let savedTemplate: ChecklistTemplate | undefined;
        set((s) => {
          const idx = s.checklistTemplates.findIndex(
            (t) => t.equipmentTypeId === equipmentTypeId && t.sectionId === sectionId
          );
          if (idx >= 0) {
            const updated = [...s.checklistTemplates];
            updated[idx] = { ...updated[idx], items };
            savedTemplate = updated[idx];
            return { checklistTemplates: updated };
          }
          const newTpl: ChecklistTemplate = { id: uid(), equipmentTypeId, sectionId, items };
          savedTemplate = newTpl;
          return { checklistTemplates: [...s.checklistTemplates, newTpl] };
        });
        
        if (savedTemplate) syncUpsertTemplate(savedTemplate);
      },

      getChecklistTemplate: (equipmentTypeId, sectionId) => {
        return get().checklistTemplates.find(
          (t) => t.equipmentTypeId === equipmentTypeId && t.sectionId === sectionId
        );
      },

      
      setNavLogo: (dataUrl) => {
        if (!dataUrl) {
          
          set((s) => ({ settings: { ...s.settings, navLogoUrl: null } }));
          syncUpsertSettings(get().settings);
          return;
        }

        
        
        
        const newNavV = (get().settings.navLogoV ?? 0) + 1;
        set((s) => ({
          settings: {
            ...s.settings,
            navLogoUrl: dataUrl,
            navLogoV:   newNavV,
          },
        }));

        
        
        
        const settingsSnapshot = get().settings;

        
        
        
        syncUpsertSettings(settingsSnapshot).then((resolved) => {
          if (resolved?.navLogoUrl) {
            set((s) => ({
              settings: {
                ...s.settings,
                navLogoUrl: resolved.navLogoUrl,
                navLogoV:   resolved.navLogoV,
              },
            }));
          }
        });
      },

      setHomeLogo: (dataUrl) => {
        if (!dataUrl) {
          
          set((s) => ({ settings: { ...s.settings, homeLogoUrl: null } }));
          syncUpsertSettings(get().settings);
          return;
        }

        
        const newHomeV = (get().settings.homeLogoV ?? 0) + 1;
        set((s) => ({
          settings: {
            ...s.settings,
            homeLogoUrl: dataUrl,
            homeLogoV:   newHomeV,
          },
        }));

        
        const settingsSnapshot = get().settings;

        
        syncUpsertSettings(settingsSnapshot).then((resolved) => {
          if (resolved?.homeLogoUrl) {
            set((s) => ({
              settings: {
                ...s.settings,
                homeLogoUrl: resolved.homeLogoUrl,
                homeLogoV:   resolved.homeLogoV,
              },
            }));
          }
        });
      },

      setChecklistLogo: (dataUrl) => {
        if (!dataUrl) {
          set((s) => ({ settings: { ...s.settings, checklistLogoUrl: null } }));
          syncUpsertSettings(get().settings);
          return;
        }

        const newChecklistV = (get().settings.checklistLogoV ?? 0) + 1;
        set((s) => ({
          settings: {
            ...s.settings,
            checklistLogoUrl: dataUrl,
            checklistLogoV:   newChecklistV,
          },
        }));

        const settingsSnapshot = get().settings;

        syncUpsertSettings(settingsSnapshot).then((resolved) => {
          if (resolved?.checklistLogoUrl) {
            set((s) => ({
              settings: {
                ...s.settings,
                checklistLogoUrl: resolved.checklistLogoUrl,
                checklistLogoV:   resolved.checklistLogoV,
              },
            }));
          }
        });
      },

      setPasscodeLogo: (dataUrl) => {
        if (!dataUrl) {
          set((s) => ({ settings: { ...s.settings, passcodeLogoUrl: null } }));
          syncUpsertSettings(get().settings);
          return;
        }

        const newPasscodeLogoV = (get().settings.passcodeLogoV ?? 0) + 1;
        set((s) => ({
          settings: {
            ...s.settings,
            passcodeLogoUrl: dataUrl,
            passcodeLogoV:   newPasscodeLogoV,
          },
        }));

        const settingsSnapshot = get().settings;

        syncUpsertSettings(settingsSnapshot).then((resolved) => {
          if (resolved?.passcodeLogoUrl) {
            set((s) => ({
              settings: {
                ...s.settings,
                passcodeLogoUrl: resolved.passcodeLogoUrl,
                passcodeLogoV:   resolved.passcodeLogoV,
              },
            }));
          }
        });
      },

      setAppPasscode: (passcode) => {
        const normalized = passcode.replace(/\D/g, '').slice(0, 4) || '1234';
        const next = { ...get().settings, appPasscode: normalized };
        set(() => ({ settings: next }));
        syncUpsertSettings(next);
      },

      setPasscodeEnabled: (enabled) => {
        const next = { ...get().settings, passcodeEnabled: enabled };
        set(() => ({ settings: next }));
        syncUpsertSettings(next);
      },

      setHomeTitle: (title: string) => {
        const next = { ...get().settings, homeTitle: title };
        set(() => ({ settings: next }));
        syncUpsertSettings(next);
      },

      setUrgentAttentionQuestionText: (text: string) => {
        const next = {
          ...get().settings,
          urgentAttentionQuestionText: text.trim() || DEFAULT_URGENT_ATTENTION_QUESTION_TEXT,
        };
        set(() => ({ settings: next }));
        syncUpsertSettings(next);
      },

      setUrgentAttentionDefinitionText: (text: string) => {
        const next = {
          ...get().settings,
          urgentAttentionDefinitionText: text.trim() || DEFAULT_URGENT_ATTENTION_DEFINITION_TEXT,
        };
        set(() => ({ settings: next }));
        syncUpsertSettings(next);
      },

      setQcRequired: (required) => {
        // Update the settings flag (kept for backward compat)
        set((s) => ({ settings: { ...s.settings, qcVerifierRequired: required } }));
        // Also update the built-in qcVerifierName fieldConfig so the field renders correctly
        set((s) => {
          const idx = s.fieldConfigs.findIndex((f) => f.key === 'qcVerifierName' && f.isBuiltIn);
          if (idx < 0) return {};
          const updated = [...s.fieldConfigs];
          updated[idx] = { ...updated[idx], required };
          return { fieldConfigs: updated };
        });
        // Sync the updated fieldConfig to Supabase
        const qcCfg = get().fieldConfigs.find((f) => f.key === 'qcVerifierName' && f.isBuiltIn);
        if (qcCfg) syncUpsertFieldConfig({ ...qcCfg, required });
        syncUpsertSettings(get().settings);
      },

      setFuelRequired: (required) => {
        set((s) => {
          const idx = s.fieldConfigs.findIndex((f) => f.key === 'fuelLevel' && f.isBuiltIn);
          if (idx < 0) return {};
          const updated = [...s.fieldConfigs];
          updated[idx] = { ...updated[idx], required };
          return { fieldConfigs: updated };
        });
        const fuelCfg = get().fieldConfigs.find((f) => f.key === 'fuelLevel' && f.isBuiltIn);
        if (fuelCfg) syncUpsertFieldConfig({ ...fuelCfg, required });
      },

      setRecordsVisibility: (value) => {
        
        const next = { ...get().settings, recordsVisibility: value };
        set(() => ({ settings: next }));
        
        syncUpsertSettings(next);
      },

      setFooterText: (text) => {
        const next = { ...get().settings, footerText: text };
        set(() => ({ settings: next }));
        syncUpsertSettings(next);
      },

      setShowFillButton: (show) => {
        const next = { ...get().settings, showFillButton: show };
        set(() => ({ settings: next }));
        syncUpsertSettings(next);
      },

      setActivityLogVisibility: (value) => {
        const next = { ...get().settings, activityLogVisibility: value };
        set(() => ({ settings: next }));
        syncUpsertSettings(next);
      },

      setFuelMonitoringVisibility: (value) => {
        const next = { ...get().settings, fuelMonitoringVisibility: value };
        set(() => ({ settings: next }));
        syncUpsertSettings(next);
      },
      
      upsertFieldConfig: (config) => {
        
        set((s) => {
          const idx = s.fieldConfigs.findIndex((f) => f.id === config.id);
          if (idx >= 0) {
            const updated = [...s.fieldConfigs];
            updated[idx] = config;
            return { fieldConfigs: updated };
          }
          return { fieldConfigs: [...s.fieldConfigs, config] };
        });
        
        syncUpsertFieldConfig(config);
      },

      removeFieldConfig: (id, bypassBuiltInGuard = false) => {
        const cfg = get().fieldConfigs.find((f) => f.id === id);
        if (!cfg) return;
        // Built-in fields can only be deleted when explicitly unlocked
        // (bypassBuiltInGuard=true), which the UI sets only for super admins.
        if (cfg.isBuiltIn && !bypassBuiltInGuard) return;

        set((s) => ({ fieldConfigs: s.fieldConfigs.filter((f) => f.id !== id) }));
        syncDeleteFieldConfig(id);
      },

      reorderFieldConfigs: (orderedIds, equipmentTypeId) => {
        // Reorder only the configs matching orderedIds; untouched configs keep existing order.
        set((s) => {
          const map = new Map(s.fieldConfigs.map((f) => [f.id, f]));
          
          const reordered = orderedIds
            .map((id, i) => {
              const f = map.get(id);
              return f ? { ...f, order: i } : null;
            })
            .filter(Boolean) as FieldConfig[];
          
          const others = s.fieldConfigs.filter(
            (f) => !orderedIds.includes(f.id)
          );
          return { fieldConfigs: [...others, ...reordered] };
        });
        
        // Sync only the configs that actually belong to this equipmentTypeId scope.
        const updated = get().fieldConfigs.filter(
          (f) => orderedIds.includes(f.id) && f.equipmentTypeId === equipmentTypeId
        );
        updated.forEach((cfg) => syncUpsertFieldConfig(cfg));
      },

      mergeRemoteFieldConfigs: (configs) => {
        if (configs.length === 0) return;
        set(() => ({ fieldConfigs: configs }));
      },

      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      

      addRecord: async (record) => {
        const id = uid();
        const refId = makeRefId(record.equipmentTypeCode, record.equipmentNumber, record.date);
        const submittedAt = now();
        const full: Record = { ...record, id, refId, submittedAt }; 

        
        
        
        set((s) => ({ records: [full, ...s.records] }));

        
        
        
        
        const result = await syncInsertRecord(full);

        if (result.ok) {
          queueRecordEvidence(full, record.technicianName);
          void flushEvidenceQueue();
          console.debug('[store] record confirmed by server:', refId);
          // Increment today's count without a DB round-trip
          get().incrementTodayCount();
          // Invalidate analysis cache so next Analysis view is fresh
          import('./lib/faultAnalysis').then(({ invalidateFaultCache }) => invalidateFaultCache());
          import('./lib/fuelAnalysis').then(({ invalidateFuelCache }) => invalidateFuelCache());
          return { status: 'success', message: 'Record saved successfully' };
        } else if (result.queued) {
          queueRecordEvidence(full, record.technicianName);
          void flushEvidenceQueue();
          console.warn('[store] record queued for retry (offline/transient error):', refId);
          // Still increment locally — the record is saved and will sync when back online
          get().incrementTodayCount();
          return { status: 'queued', message: 'No internet. Record saved and will sync automatically' };
        } else if (result.error === 'unique_conflict') {
          // Expected, non-exceptional outcome: a checklist for this equipment
          // number already exists for this date (one checklist per equipment
          // per day is intentional — see ref_id UNIQUE constraint). Remove the
          // optimistically-added record so it doesn't appear as a ghost entry,
          // and tell the user clearly rather than showing a generic failure.
          set((s) => ({ records: s.records.filter((r) => r.id !== id) }));
          console.warn('[store] record not saved — already submitted today:', refId);
          return {
            status: 'duplicate',
            message: `A checklist for equipment ${record.equipmentNumber} has already been submitted today. Only one checklist per equipment per day is allowed.`,
          };
        } else {
          // Genuine failure (network/server error unrelated to duplication).
          // Remove the optimistically-added record from the local store so it
          // doesn't appear in the UI as a ghost entry after a failed submit.
          set((s) => ({ records: s.records.filter((r) => r.id !== id) }));
          console.error('[store] record rejected by server:', refId, result.error);
          return { status: 'failed', message: 'Failed to save record. Please try again' };
        }
        
      },

      deleteRecord: (id, adminEmail) => {
        // Find the record before removing it so we can reference it in the activity log.
        const record = get().records.find((r) => r.id === id);
        
        set((s) => ({ records: s.records.filter((r) => r.id !== id) }));

        // Log the deletion with the actor's email for the Activity Log.
        if (record) {
          get().addLog({
            section: 'deletions',
            type: 'record_deleted',
            description: `Record ${record.refId} deleted by ${adminEmail}`,
            actor: adminEmail,
          });
        }
        
        syncDeleteRecord(id);
      },

      updateChecklistResponse: (recordId, itemId, field, value, editorEmail, editorIsSuperAdmin) => {
        // Only attribute the edit to non-super-admin users
        const editedBy = (editorIsSuperAdmin || !editorEmail) ? undefined : editorEmail;
        const editedAt = new Date().toISOString();

        // Capture item label BEFORE the state update (while old state is intact)
        const prevRecord = get().records.find((r) => r.id === recordId);
        const itemLabel = prevRecord?.checklistResponses.find((r) => r.itemId === itemId)?.label ?? itemId;

        set((s) => ({
          records: s.records.map((rec) => {
            if (rec.id !== recordId) return rec;
            return {
              ...rec,
              checklistResponses: rec.checklistResponses.map((r) =>
                r.itemId === itemId ? { ...r, [field]: value } : r
              ),
              // Only update editedBy/editedAt when it's a non-super-admin edit.
              // Super admin edits are intentionally silent — don't advance timestamp
              // while keeping a previous admin's name, which would be misleading.
              editedBy: editedBy !== undefined ? editedBy : rec.editedBy,
              editedAt: editedBy !== undefined ? editedAt : rec.editedAt,
            };
          }),
        }));

        const updatedRecord = get().records.find((r) => r.id === recordId);
        if (updatedRecord) {
          // ── Immediate attribution sync ────────────────────────────────────
          // Save edited_by / edited_at to Supabase right now so the badge
          // survives a page navigation even if the debounced full sync hasn't
          // fired yet. The debounce handles the heavier checklist-content sync.
          if (editedBy && editedAt) {
            void syncMarkRecordEdited(recordId, editedBy, editedAt);
          }
          // Full record sync (checklist content) — debounced to batch rapid edits
          _debouncedSyncUpdate(updatedRecord);

          // Log the checklist edit to the Activity Log (non-super-admin only)
          if (!editorIsSuperAdmin && editorEmail) {
            get().addLog({
              section: 'submissions',
              type: 'record_edited',
              description: `Record ${updatedRecord.refId} checklist edited — "${itemLabel}" (${String(field)}) updated by ${editorEmail}`,
              actor: editorEmail,
            });
          }
        }
      },

      updateRecordField: (recordId, field, value, editorEmail, editorIsSuperAdmin) => {
        // Only attribute the edit to non-super-admin users
        const editedBy = (editorIsSuperAdmin || !editorEmail) ? undefined : editorEmail;
        const editedAt = new Date().toISOString();
        set((s) => ({
          records: s.records.map((rec) => {
            if (rec.id !== recordId) return rec;
            return {
              ...rec,
              [field]: value,
              // Only update editedBy/editedAt when it's a non-super-admin edit.
              // Super admin edits are intentionally silent — don't advance timestamp
              // while keeping a previous admin's name, which would be misleading.
              editedBy: editedBy !== undefined ? editedBy : rec.editedBy,
              editedAt: editedBy !== undefined ? editedAt : rec.editedAt,
            };
          }),
        }));

        const updatedRecord = get().records.find((r) => r.id === recordId);
        if (updatedRecord) {
          // ── Immediate attribution sync ────────────────────────────────────
          // Save edited_by / edited_at to Supabase right now so the badge
          // survives a page navigation even if the debounced full sync hasn't
          // fired yet.
          if (editedBy && editedAt) {
            void syncMarkRecordEdited(recordId, editedBy, editedAt);
          }
          // Full record sync — debounced to batch rapid edits
          _debouncedSyncUpdate(updatedRecord);
          // Log the edit (only for non-super-admin to keep logs clean)
          if (!editorIsSuperAdmin && editorEmail) {
            get().addLog({
              section: 'submissions',
              type: 'record_edited',
              description: `Record ${updatedRecord.refId} was edited (field: ${String(field)}) by ${editorEmail}`,
              actor: editorEmail,
            });
          }
        }
      },

      
      getPendingAdmin: (email) => {
        return get().adminUsers.find(
          (u) =>
            u.email.toLowerCase() === email.toLowerCase() &&
            !u.isSuperAdmin &&
            !u.passwordSet
        ) ?? null;
      },

      login: async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error || !data.user) return null;
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, email, role, active, created_at')
          .eq('id', data.user.id)
          .single();
        if (profileError || !profile?.active || !['junior', 'senior', 'super_admin'].includes(profile.role)) {
          await supabase.auth.signOut();
          return null;
        }
        const user: AdminUser = {
          id: profile.id, email: profile.email, passwordHash: '', passwordSet: true,
          isSuperAdmin: profile.role === 'super_admin',
          role: profile.role === 'senior' ? 'senior' : 'junior',
          canDeleteRecords: profile.role === 'senior' || profile.role === 'super_admin',
          canAddAdmins: profile.role === 'senior' || profile.role === 'super_admin',
          createdAt: profile.created_at,
        };
        set({ currentAdmin: user });
        return user;
      },

      setAdminPassword: async (email, newPassword) => {
        const user = get().adminUsers.find(
          (u) => u.email.toLowerCase() === email.toLowerCase() && !u.passwordSet
        );
        if (!user) return false;
        const passwordHash = await hashPassword(newPassword);
        set((s) => ({
          adminUsers: s.adminUsers.map((u) =>
            u.id === user.id ? { ...u, passwordHash, passwordSet: true } : u
          ),
        }));
        const updated = get().adminUsers.find((u) => u.id === user.id)!;
        set({ currentAdmin: updated });
        
        syncUpsertAdmin(updated);
        return true;
      },

      logout: () => { void supabase.auth.signOut(); set({ currentAdmin: null }); },

      registerAdmin: (email, role) => {
        const exists = get().adminUsers.some(
          (u) => u.email.toLowerCase() === email.toLowerCase()
        );
        if (exists) return false;
        const newAdmin: AdminUser = {
          id: uid(),
          email,
          passwordHash: '',
          passwordSet: false,
          isSuperAdmin: false,
          role,
          canDeleteRecords: true,
          canAddAdmins: role === 'senior',
          createdAt: now(),
        };
        set((s) => ({ adminUsers: [...s.adminUsers, newAdmin] }));
        get().addLog({
          section: 'admin',
          type: 'admin_created',
          description: `${role === 'senior' ? 'Senior' : 'Junior'} Admin registered (pending password): ${email}`,
          actor: get().currentAdmin?.email,
        });
        
        syncUpsertAdmin(newAdmin);
        return true;
      },

      addAdmin: async (email, password, role) => {
        const exists = get().adminUsers.some(
          (u) => u.email.toLowerCase() === email.toLowerCase()
        );
        if (exists) return false;
        const passwordHash = await hashPassword(password);
        const newAdmin: AdminUser = {
          id: uid(),
          email,
          passwordHash,
          passwordSet: true,
          isSuperAdmin: false,
          role,
          canDeleteRecords: true,
          canAddAdmins: role === 'senior',
          createdAt: now(),
        };
        set((s) => ({ adminUsers: [...s.adminUsers, newAdmin] }));
        get().addLog({
          section: 'admin',
          type: 'admin_created',
          description: `${role === 'senior' ? 'Senior' : 'Junior'} Admin account created: ${email}`,
          actor: get().currentAdmin?.email,
        });
        
        syncUpsertAdmin(newAdmin);
        return true;
      },

      addJuniorAdmin: async (email, password) => {
        const exists = get().adminUsers.some(
          (u) => u.email.toLowerCase() === email.toLowerCase()
        );
        if (exists) return false;
        const hasPw = password.length > 0;
        const passwordHash = hasPw ? await hashPassword(password) : '';
        const newAdmin: AdminUser = {
          id: uid(),
          email,
          passwordHash,
          passwordSet: hasPw,
          isSuperAdmin: false,
          role: 'junior',
          canDeleteRecords: true,
          canAddAdmins: false,
          createdAt: now(),
        };
        set((s) => ({ adminUsers: [...s.adminUsers, newAdmin] }));
        get().addLog({
          section: 'admin',
          type: 'admin_created',
          description: `Junior Admin account created: ${email}`,
          actor: get().currentAdmin?.email,
        });
        
        syncUpsertAdmin(newAdmin);
        return true;
      },

      updateAdminRole: (id, role) => {
        set((s) => ({
          adminUsers: s.adminUsers.map((u) =>
            u.id === id
              ? { ...u, role, canDeleteRecords: true, canAddAdmins: role === 'senior' }
              : u
          ),
        }));
        const target = get().adminUsers.find((u) => u.id === id);
        get().addLog({
          section: 'admin',
          type: 'admin_permissions_updated',
          description: `Role updated to ${role} for ${target?.email}`,
          actor: get().currentAdmin?.email,
        });
        
        
        if (target) syncUpsertAdmin(target);
      },

      removeAdmin: (id) => {
        const target = get().adminUsers.find((u) => u.id === id);
        set((s) => ({ adminUsers: s.adminUsers.filter((u) => u.id !== id) }));
        if (target) {
          get().addLog({
            section: 'admin',
            type: 'admin_removed',
            description: `Admin account removed: ${target.email}`,
            actor: get().currentAdmin?.email,
          });
        }
        
        syncDeleteAdmin(id);
      },

      changeSuperAdminPassword: async (adminId, currentPw, newPw) => {
        const user = get().adminUsers.find((u) => u.id === adminId);
        if (!user) return false;
        const match = await verifyPassword(currentPw, user.passwordHash);
        if (!match) return false;
        const passwordHash = await hashPassword(newPw);
        set((s) => ({
          adminUsers: s.adminUsers.map((u) =>
            u.id === adminId ? { ...u, passwordHash } : u
          ),
        }));
        const updated = get().adminUsers.find((u) => u.id === adminId)!;
        set({ currentAdmin: updated });
        
        syncUpsertAdmin(updated);
        return true;
      },

      promoteSuperAdmin: (id) => {
        const user = get().adminUsers.find((u) => u.id === id);
        if (!user) return 'not_found';
        const superCount = get().adminUsers.filter((u) => u.isSuperAdmin).length;
        if (superCount >= 3) return 'cap_reached';
        set((s) => ({
          adminUsers: s.adminUsers.map((u) =>
            u.id === id ? { ...u, isSuperAdmin: true } : u
          ),
          // If the promoted user is the currently logged-in admin, reflect the
          // change immediately so the UI (Admin tab, permission checks) updates
          // without requiring a logout/login cycle.
          currentAdmin: s.currentAdmin?.id === id
            ? { ...s.currentAdmin, isSuperAdmin: true }
            : s.currentAdmin,
        }));
        get().addLog({
          section: 'admin',
          type: 'admin_permissions_updated',
          description: `${user.email} promoted to Super Admin`,
          actor: get().currentAdmin?.email,
        });
        
        
        const promoted = get().adminUsers.find((u) => u.id === id)!;
        syncUpsertAdmin(promoted);
        return 'ok';
      },

      
      addLog: (log) => {
        const entry: ActivityLog = {
          ...log,
          section: log.section ?? logSection(log.type),
          id: uid(),
          timestamp: now(),
        };

        
        set((s) => ({ activityLogs: [entry, ...s.activityLogs] }));

        
        syncInsertLog(entry);
      },

      deleteLog: (id) => {
        
        
        
        
        const actor = get().currentAdmin;
        if (!actor?.isSuperAdmin) {
          console.warn(
            '[deleteLog] Blocked — only Super Admin can delete log entries.',
            'currentAdmin:', actor
          );
          return; 
        }

        
        set((s) => ({ activityLogs: s.activityLogs.filter((l) => l.id !== id) }));

        
        syncDeleteLog(id);
      },

      
      
      
      

      setRealtimeConnected: (connected) => set({ isRealtimeConnected: connected }),

      _realtimeInsertRecord: (record) => {
        set((s) => {
          if (s.records.some((r) => r.id === record.id)) return s;
          // If this record was submitted today, bump the cached today-count
          const recordDate = (record.date || record.submittedAt || '').slice(0, 10);
          const todayStr   = new Date().toISOString().split('T')[0];
          const isToday    = recordDate === todayStr;
          return {
            records: [record, ...s.records],
            lastSyncedAt: now(),
            ...(isToday ? {
              todayCountCached: (s.todayCountCached ?? 0) + 1,
              todayCountDate: todayStr,
            } : {}),
          };
        });
      },

      _realtimeDeleteRecord: (id) => {
        set((s) => ({ records: s.records.filter((r) => r.id !== id), lastSyncedAt: now() }));
      },

      _realtimeUpdateRecord: (record) => {
        set((s) => ({
          records: s.records.map((r) => {
            if (r.id !== record.id) return r;
            
            
            
            
            const incomingHasChecklist =
              Array.isArray(record.checklistResponses) && record.checklistResponses.length > 0;
            const localHasChecklist =
              Array.isArray(r.checklistResponses) && r.checklistResponses.length > 0;
            return {
              ...record,
              checklistResponses: incomingHasChecklist
                ? record.checklistResponses  
                : localHasChecklist
                  ? r.checklistResponses     
                  : [],                      
            };
          }),
          lastSyncedAt: now(),
        }));
      },

      _realtimeInsertLog: (log) => {
        set((s) => {
          if (s.activityLogs.some((l) => l.id === log.id)) return s;
          return { activityLogs: [log, ...s.activityLogs], lastSyncedAt: now() };
        });
      },

      _realtimeDeleteLog: (id) => {
        set((s) => ({
          activityLogs: s.activityLogs.filter((l) => l.id !== id),
          lastSyncedAt: now(),
        }));
      },

      setLastSyncedAt: (ts) => set({ lastSyncedAt: ts }),
      setFieldConfigsVersion: (v) => set({ fieldConfigsVersion: v }),

      
      
      
      mergeRemoteTemplates: (remoteTemplates) => {
        if (remoteTemplates.length === 0) return;
        set((s) => {
          
          const remoteMap = new Map(
            remoteTemplates.map((t) => [`${t.equipmentTypeId}::${t.sectionId}`, t])
          );
          
          const merged = s.checklistTemplates.map((local) => {
            const key = `${local.equipmentTypeId}::${local.sectionId}`;
            return remoteMap.has(key) ? remoteMap.get(key)! : local;
          });
          
          for (const remote of remoteTemplates) {
            const key = `${remote.equipmentTypeId}::${remote.sectionId}`;
            const exists = s.checklistTemplates.some(
              (t) => `${t.equipmentTypeId}::${t.sectionId}` === key
            );
            if (!exists) merged.push(remote);
          }
          return { checklistTemplates: merged };
        });
      },

      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      mergeRemoteData: (remoteRecords, remoteLogs) => {
        
        if (remoteRecords === null || remoteLogs === null) {
          console.warn('[store] mergeRemoteData: fetch returned null (RLS or network error) — keeping local state.');
          return;
        }
        const sortedRecords = [...remoteRecords].sort(
          (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
        );
        const sortedLogs = [...remoteLogs].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        set(() => ({ records: sortedRecords, activityLogs: sortedLogs, lastSyncedAt: now() }));
      },

      upsertRecords: (incoming) => {
        if (!incoming || incoming.length === 0) return;
        set((s) => {
          const map = new Map<string, Record>(s.records.map((r) => [r.id, r]));
          for (const r of incoming) {
            const prev = map.get(r.id);

            const incomingHasChecklist = Array.isArray(r.checklistResponses) && r.checklistResponses.length > 0;
            const prevHasChecklist = !!prev && Array.isArray(prev.checklistResponses) && prev.checklistResponses.length > 0;

            // ── Edit-attribution guard ────────────────────────────────────────
            // Protect local editedBy / editedAt from being overwritten by stale
            // Supabase data. fetchRecordsPage runs whenever the user navigates to
            // the Records page; if that fetch completes BEFORE syncMarkRecordEdited
            // has committed (network latency), the Supabase row still has
            // edited_by = null, so we'd lose the badge. We keep the local values
            // whenever they are strictly newer than what Supabase returned.
            const localTs    = prev?.editedAt ? new Date(prev.editedAt).getTime() : 0;
            const incomingTs = r.editedAt      ? new Date(r.editedAt).getTime()   : 0;
            const keepLocalEdits = !!(prev?.editedBy && localTs > incomingTs);

            const base = keepLocalEdits
              ? { ...r, editedBy: prev!.editedBy, editedAt: prev!.editedAt }
              : r;

            if (prev && prevHasChecklist && !incomingHasChecklist) {
              // Preserve the in-memory checklist while merging other fields
              map.set(r.id, { ...base, checklistResponses: prev.checklistResponses });
            } else {
              map.set(r.id, base);
            }
          }
          const merged = Array.from(map.values()).sort(
            (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
          );
          return { records: merged };
        });
      },

      setRecordChecklist: (recordId, checklist, additionalComment?, additionalEvidenceImage?) => {
        set((s) => ({
          records: s.records.map((r) =>
            r.id === recordId
              ? {
                  ...r,
                  checklistResponses: checklist,
                  ...(additionalComment !== undefined ? { additionalComment } : {}),
                  ...(additionalEvidenceImage !== undefined ? { additionalEvidenceImage } : {}),
                }
              : r
          ),
        }));
      },

      setRecordsTotalCount: (n) => set({ recordsTotalCount: n }),

      setTodayCountCached: (count, date) => set({ todayCountCached: count, todayCountDate: date }),

      incrementTodayCount: () => set((s) => ({
        todayCountCached: (s.todayCountCached ?? 0) + 1,
        todayCountDate: new Date().toISOString().split('T')[0],
        lastSubmittedAt: new Date().toISOString(),
      })),

      
      
      
      

      mergeRemoteDepartments: (remoteDepts) => {
        if (remoteDepts.length === 0) return; 
        const sorted = [...remoteDepts].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        set(() => ({ departments: sorted }));
      },

      mergeRemoteSections: (remoteSections) => {
        if (remoteSections.length === 0) return; 
        const sorted = [...remoteSections].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        set(() => ({ sections: sorted }));
      },

      mergeRemoteEquipmentTypes: (remoteTypes) => {
        if (remoteTypes.length === 0) return;
        const sorted = [...remoteTypes].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        set(() => ({ equipmentTypes: sorted }));
      },

      
      
      
      
      mergeRemoteAdmins: (remoteAdmins) => {
        if (remoteAdmins.length === 0) return; 
        set((s) => {
          const current = s.currentAdmin;
          const updatedCurrent = current
            ? remoteAdmins.find((a) => a.id === current.id) ?? current
            : null;
          return { adminUsers: remoteAdmins, currentAdmin: updatedCurrent };
        });
      },

      
      
      
      mergeRemoteSettings: (remoteSettings) => {
        const currentSettings = get().settings;
        const safeSettings: AppSettings = {
          ...remoteSettings,
          navLogoV:              remoteSettings.navLogoV  ?? 1,
          homeLogoV:             remoteSettings.homeLogoV ?? 1,
          checklistLogoV:        remoteSettings.checklistLogoV ?? 1,
          passcodeLogoV:         remoteSettings.passcodeLogoV ?? 1,
          appPasscode:           /^\d{4}$/.test(remoteSettings.appPasscode ?? '') ? remoteSettings.appPasscode : '1234',
          passcodeEnabled:       remoteSettings.passcodeEnabled ?? false,
          recordsVisibility:     remoteSettings.recordsVisibility ?? 'general',
          activityLogVisibility: remoteSettings.activityLogVisibility ?? 'all',
          fuelMonitoringVisibility: remoteSettings.fuelMonitoringVisibility ?? 'admin_only',
          homeTitle: remoteSettings.homeTitle?.trim()
            || 'Technical Department Inspection System',
          urgentAttentionQuestionText: remoteSettings.urgentAttentionQuestionText?.trim()
            || DEFAULT_URGENT_ATTENTION_QUESTION_TEXT,
          urgentAttentionDefinitionText: remoteSettings.urgentAttentionDefinitionText?.trim()
            || DEFAULT_URGENT_ATTENTION_DEFINITION_TEXT,
          showFillButton: remoteSettings.showFillButton ?? false,
          
          
          
          
          
          
          
          
          navLogoUrl:       remoteSettings.navLogoUrl       ?? currentSettings.navLogoUrl       ?? null,
          homeLogoUrl:      remoteSettings.homeLogoUrl      ?? currentSettings.homeLogoUrl      ?? null,
          checklistLogoUrl: remoteSettings.checklistLogoUrl ?? currentSettings.checklistLogoUrl ?? null,
          passcodeLogoUrl:  remoteSettings.passcodeLogoUrl  ?? currentSettings.passcodeLogoUrl  ?? null,
        };
        set(() => ({ settings: safeSettings }));
      },

      setFieldConfigsCachedAt: (iso) => set({ fieldConfigsCachedAt: iso }),
    }),
    {
      name: 'daily-checking-store',
      
      
      storage: createJSONStorage(() => _safeLocalStorageAdapter),
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      

      partialize: (state) => ({
        fieldConfigs:          state.fieldConfigs,
        departments:           state.departments,
        sections:              state.sections,
        equipmentTypes:        state.equipmentTypes,
        checklistTemplates:    state.checklistTemplates,
        equipmentTypeMappings: state.equipmentTypeMappings,
        settings:              state.settings,
        adminUsers:            state.adminUsers,
        lastSyncedAt:          state.lastSyncedAt,
        fieldConfigsVersion:   state.fieldConfigsVersion,
        fieldConfigsCachedAt:  state.fieldConfigsCachedAt,
        recordsTotalCount:     state.recordsTotalCount,
        todayCountCached:      state.todayCountCached,
        todayCountDate:        state.todayCountDate,
        lastSubmittedAt:       state.lastSubmittedAt,
        
        
        
        
      }),
      
      version: 21,
      migrate: (persistedState: unknown, version: number) => {
        
        const state = persistedState as any;

        if (version < 2) {
          
          if (state.settings?.logoDataUrl !== undefined) {
            state.settings.navLogoDataUrl = state.settings.logoDataUrl;
            state.settings.homeLogoDataUrl = state.settings.logoDataUrl;
            delete state.settings.logoDataUrl;
          }
          
          if (Array.isArray(state.adminUsers)) {
            state.adminUsers = state.adminUsers.map((a: AdminUser) => ({
              ...a,
              role: a.role ?? 'junior',
              passwordSet: a.passwordSet ?? true,
            }));
          }
          
          if (Array.isArray(state.activityLogs)) {
            state.activityLogs = state.activityLogs.map((l: ActivityLog) => ({
              ...l,
              section: l.section ?? 'submissions',
            }));
          }
        }

        if (version < 3) {
          if (state.settings && !state.settings.footerText) {
            state.settings.footerText = 'Designed by workshop inventory';
          }
        }

        if (version < 8) {
          
          if (state.settings && !state.settings.homeTitle) {
            state.settings.homeTitle = 'Technical Department Inspection System';
          }
        }

        if (version < 4) {
          
          if (Array.isArray(state.adminUsers)) {
            state.adminUsers = state.adminUsers.map((a: AdminUser) => ({
              ...a,
              passwordSet: a.passwordSet ?? true,
            }));
          }
          
          if (Array.isArray(state.records)) {
            state.records = state.records.map((r: Record) => ({
              ...r,
              checklistResponses: (r.checklistResponses ?? []).map((cr: ChecklistResponse) => ({
                ...cr,
                actionPlan: cr.actionPlan ?? '',
              })),
            }));
          }
        }

        if (version < 5) {
          
          if (Array.isArray(state.checklistTemplates)) {
            state.checklistTemplates = state.checklistTemplates.map(
              (t: ChecklistTemplate) => ({
                ...t,
                items: (t.items ?? []).map((item: ChecklistItem) => ({
                  ...item,
                  isSubheading: item.isSubheading ?? false,
                })),
              })
            );
          }
        }

        if (version < 6) {
          
          if (Array.isArray(state.records)) {
            state.records = state.records.map((r: Record) => ({
              ...r,
              checklistResponses: (r.checklistResponses ?? []).map((cr: ChecklistResponse) => ({
                ...cr,
                isSubheading: cr.isSubheading ?? false,
              })),
            }));
          }
        }

        if (version < 7) {
          
          if (!Array.isArray(state.fieldConfigs) || state.fieldConfigs.length === 0) {
            state.fieldConfigs = [
              { id: 'field-equip-num',  key: 'equipmentNumber',  label: 'Equipment Number',   fieldType: 'numeric', required: true, order: 0, options: [], isBuiltIn: true },
              { id: 'field-tech-name',  key: 'technicianName',   label: 'Technician Name',    fieldType: 'text',    required: true, order: 1, options: [], isBuiltIn: true },
              { id: 'field-sup-name',   key: 'supervisorName',   label: 'Supervisor Name',    fieldType: 'text',    required: true, order: 2, options: [], isBuiltIn: true },
              { id: 'field-hour-meter', key: 'hourMeterReading', label: 'Hour Meter Reading', fieldType: 'numeric', required: true, order: 3, options: [], isBuiltIn: true },
              { id: 'field-qc-verifier', key: 'qcVerifierName',  label: "QC Verifier's Name", fieldType: 'text',    required: false, order: 4, options: [], isBuiltIn: true },
            ];
          }
          
          if (Array.isArray(state.fieldConfigs)) {
            state.fieldConfigs = state.fieldConfigs.map((f: FieldConfig) => ({
              id: f.id ?? (Math.random().toString(36).slice(2)),
              key: f.key ?? f.id ?? '',
              label: f.label ?? '',
              fieldType: f.fieldType ?? 'text',
              required: f.required ?? false,
              order: f.order ?? 0,
              options: Array.isArray(f.options) ? f.options : [],
              isBuiltIn: f.isBuiltIn ?? false,
            }));
          }
        }

        if (version < 8) {
          
          if (Array.isArray(state.fieldConfigs)) {
            state.fieldConfigs = state.fieldConfigs.map((f: FieldConfig) => ({
              ...f,
              equipmentTypeId: (f as FieldConfig & { equipmentTypeId?: string }).equipmentTypeId ?? GLOBAL_EQUIPMENT_ID,
            }));
          }
          
          const hasBuiltIns = Array.isArray(state.fieldConfigs) &&
            state.fieldConfigs.some((f: FieldConfig) => f.isBuiltIn);
          if (!hasBuiltIns) {
            state.fieldConfigs = [
              { id: 'field-equip-num',  key: 'equipmentNumber',  label: 'Equipment Number',   fieldType: 'numeric', required: true, order: 0, options: [], isBuiltIn: true, equipmentTypeId: '__global__' },
              { id: 'field-tech-name',  key: 'technicianName',   label: 'Technician Name',    fieldType: 'text',    required: true, order: 1, options: [], isBuiltIn: true, equipmentTypeId: '__global__' },
              { id: 'field-sup-name',   key: 'supervisorName',   label: 'Supervisor Name',    fieldType: 'text',    required: true, order: 2, options: [], isBuiltIn: true, equipmentTypeId: '__global__' },
              { id: 'field-hour-meter', key: 'hourMeterReading', label: 'Hour Meter Reading', fieldType: 'numeric', required: true, order: 3, options: [], isBuiltIn: true, equipmentTypeId: '__global__' },
              { id: 'field-qc-verifier', key: 'qcVerifierName',  label: "QC Verifier's Name", fieldType: 'text',    required: false, order: 4, options: [], isBuiltIn: true, equipmentTypeId: '__global__' },
            ];
          }
        }

        if (version < 9) {
          
          if (state.settings && state.settings.recordsVisibility === undefined) {
            state.settings.recordsVisibility = 'general';
          }
        }

        if (version < 10) {
          
          
          if (!Array.isArray(state.equipmentTypeMappings)) {
            state.equipmentTypeMappings = [];
          }
        }

        if (version < 11) {
          
          
          if (Array.isArray(state.departments)) {
            state.departments = state.departments.map((d: Department, i: number) => ({
              ...d, position: d.position ?? i,
            }));
          }
          if (Array.isArray(state.sections)) {
            state.sections = state.sections.map((s: Section, i: number) => ({
              ...s, position: s.position ?? i,
            }));
          }
          if (Array.isArray(state.equipmentTypes)) {
            state.equipmentTypes = state.equipmentTypes.map((e: EquipmentType, i: number) => ({
              ...e, position: e.position ?? i,
            }));
          }
        }

        
        if (state.settings) {
          if (state.settings.navLogoDataUrl !== undefined && state.settings.navLogoUrl === undefined) {
            state.settings.navLogoUrl = state.settings.navLogoDataUrl;
            delete state.settings.navLogoDataUrl;
          }
          if (state.settings.homeLogoDataUrl !== undefined && state.settings.homeLogoUrl === undefined) {
            state.settings.homeLogoUrl = state.settings.homeLogoDataUrl;
            delete state.settings.homeLogoDataUrl;
          }
          
          if (state.settings.navLogoV === undefined)  state.settings.navLogoV  = 1;
          if (state.settings.homeLogoV === undefined) state.settings.homeLogoV = 1;
        }

        if (version < 14) {
          
          if (state.settings && state.settings.showFillButton === undefined) {
            state.settings.showFillButton = false;
          }
        }

        if (version < 15) {
          
          
          
          
          
          if (Array.isArray(state.adminUsers)) {
            
            state.adminUsers = state.adminUsers.map((a: any) => {
              if (a.passwordHash === undefined && a.password !== undefined) {
                
                
                return { ...a, passwordHash: a.password, password: undefined };
              }
              return a;
            });
          }
        }

        if (version < 16) {
          // Add activityLogVisibility setting (default: 'all' — visible to everyone)
          if (state.settings && state.settings.activityLogVisibility === undefined) {
            state.settings.activityLogVisibility = 'all';
          }
        }

        if (version < 17) {
          // Add qcVerifierName as a built-in fieldConfig if it doesn't exist yet.
          // Preserve the existing qcVerifierRequired setting for the required flag.
          const hasQcField = Array.isArray(state.fieldConfigs) &&
            state.fieldConfigs.some((f: FieldConfig) => f.key === 'qcVerifierName' && f.isBuiltIn);
          if (!hasQcField) {
            const qcRequired: boolean = state.settings?.qcVerifierRequired ?? false;
            // Remove any non-built-in custom field that may have been created with the same label
            if (Array.isArray(state.fieldConfigs)) {
              state.fieldConfigs = state.fieldConfigs.filter(
                (f: FieldConfig) => !(f.key === 'qcVerifierName' && !f.isBuiltIn)
              );
              state.fieldConfigs = [
                ...state.fieldConfigs,
                {
                  id: 'field-qc-verifier',
                  key: 'qcVerifierName',
                  label: "QC Verifier's Name",
                  fieldType: 'text',
                  required: qcRequired,
                  order: 4,
                  options: [],
                  isBuiltIn: true,
                  equipmentTypeId: GLOBAL_EQUIPMENT_ID,
                },
              ];
            }
          }
        }

        if (version < 18) {
          // Inject the built-in fuel-level fieldConfig if it is missing.
          const hasFuelField = Array.isArray(state.fieldConfigs) &&
            state.fieldConfigs.some((f: FieldConfig) => f.key === 'fuelLevel' && f.isBuiltIn);

          if (!hasFuelField && Array.isArray(state.fieldConfigs)) {
            // Bump qcVerifierName order from 4 → 5
            state.fieldConfigs = state.fieldConfigs.map((f: FieldConfig) =>
              f.key === 'qcVerifierName' && f.isBuiltIn ? { ...f, order: 5 } : f
            );
            // Bump any custom fields that were at order >= 4
            state.fieldConfigs = state.fieldConfigs.map((f: FieldConfig) =>
              !f.isBuiltIn && f.order >= 4 ? { ...f, order: f.order + 1 } : f
            );
            // Insert the fuel field at order 4
            state.fieldConfigs = [
              ...state.fieldConfigs,
              {
                id: 'field-fuel-level',
                key: 'fuelLevel',
                label: 'Fuel Level',
                fieldType: 'fuel_percent' as FieldType,
                required: false,
                order: 4,
                options: [],
                isBuiltIn: true,
                equipmentTypeId: GLOBAL_EQUIPMENT_ID,
              },
            ];
          }
        }

        if (version < 19) {
          if (Array.isArray(state.records)) {
            state.records = state.records.map((r: Record) => ({
              ...r,
              fuelCanDetermine:       (r as any).fuelCanDetermine       ?? '',
              fuelLevel:              (r as any).fuelLevel              ?? '',
              fuelUndeterminedReason: (r as any).fuelUndeterminedReason ?? '',
            }));
          }
          if (state.settings && state.settings.fuelMonitoringVisibility === undefined) {
            state.settings.fuelMonitoringVisibility = 'admin_only';
          }
        }

        if (version < 20) {
          // Add checklistLogoUrl / checklistLogoV for the dedicated report branding logo,
          // and passcodeLogoUrl / appPasscode / passcodeEnabled for the app lock screen.
          if (state.settings) {
            if (state.settings.checklistLogoUrl === undefined) {
              state.settings.checklistLogoUrl = null;
            }
            if (state.settings.checklistLogoV === undefined) {
              state.settings.checklistLogoV = 1;
            }
            if (state.settings.passcodeLogoUrl === undefined) {
              state.settings.passcodeLogoUrl = null;
            }
            if (state.settings.passcodeLogoV === undefined) {
              state.settings.passcodeLogoV = 1;
            }
            if (!/^\d{4}$/.test(state.settings.appPasscode ?? '')) {
              state.settings.appPasscode = '1234';
            }
            if (state.settings.passcodeEnabled === undefined) {
              // Default OFF so existing deployments are not suddenly locked out;
              // a super admin must opt in from Admin > Settings.
              state.settings.passcodeEnabled = false;
            }
          }
        }

        if (version < 21) {
          // Add urgentAttentionQuestionText / urgentAttentionDefinitionText —
          // super-admin-editable copy for the Urgent Attention Assessment step.
          if (state.settings) {
            if (!state.settings.urgentAttentionQuestionText) {
              state.settings.urgentAttentionQuestionText = DEFAULT_URGENT_ATTENTION_QUESTION_TEXT;
            }
            if (!state.settings.urgentAttentionDefinitionText) {
              state.settings.urgentAttentionDefinitionText = DEFAULT_URGENT_ATTENTION_DEFINITION_TEXT;
            }
          }
        }

        return state;
      },
    }
  )
);
