import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useStore, ChecklistItem, ChecklistResponse, EvidenceImage, resolveFieldConfigs, getMappedEquipmentTypeIds, isSuperAdmin, DEFAULT_URGENT_ATTENTION_QUESTION_TEXT, DEFAULT_URGENT_ATTENTION_DEFINITION_TEXT } from '../store';
import { generatePDF } from '../pdfUtils';
import BasicInformationForm from '../components/BasicInformationForm';
import { useStorageMonitor } from '../lib/storageMonitor';
import { useGlobalToast } from '../lib/toastContext';
import {
  ActiveDraft,
  getOrCreateDeviceId,
  loadLocalDraft,
  loadRemoteDraft,
  debouncedSaveDraft,
  clearAllDrafts,
  relativeTime,
} from '../lib/draftManager';
import { fuelReasonLabel } from '../lib/fuelAnalysis';
import { compressEvidenceImage } from '../lib/evidence';

type Step = 'dept' | 'section' | 'equipment' | 'details' | 'checklist' | 'preview' | 'done';

interface FormDetails {
  date: string;
  startTime: string;
  completionTime: string;
  technicianName: string;
  supervisorName: string;
  qcVerifierName: string;
  hourMeterReading: string;
  fuelCanDetermine: 'yes' | 'no' | '';
  fuelLevel: string;
  fuelUndeterminedReason: string;
  equipmentNumber: string;
  [key: string]: string;
}

interface Selection {
  deptId: string;
  deptName: string;
  sectionId: string;
  sectionName: string;
  equipmentTypeId: string;
  equipmentTypeName: string;
  equipmentTypeCode: string;
}

const todayStr = () => new Date().toISOString().split('T')[0];
const nowTimeStr = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const STEPS: { key: Step; label: string }[] = [
  { key: 'dept', label: 'Department' },
  { key: 'section', label: 'Section' },
  { key: 'equipment', label: 'Equipment' },
  { key: 'details', label: 'Details' },
  { key: 'checklist', label: 'Checklist' },
  { key: 'preview', label: 'Preview' },
];

const StepProgress = React.memo(function StepProgress({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="step-indicator">
      {STEPS.map((s, i) => (
        <React.Fragment key={s.key}>
          <div
            className={`step-dot ${i < idx ? 'done' : i === idx ? 'active' : ''}`}
            title={s.label}
          />
          {i < STEPS.length - 1 && <div className="step-line" />}
        </React.Fragment>
      ))}
      <span style={{ fontSize: 11, color: '#9C9A92', marginLeft: 6 }}>
        Step {idx + 1} of {STEPS.length}: {STEPS[idx]?.label}
      </span>
    </div>
  );
});

interface DraftBannerProps {
  draft: ActiveDraft;
  onResume: () => void;
  onDiscard: () => void;
}

const DraftBanner = React.memo(function DraftBanner({ draft, onResume, onDiscard }: DraftBannerProps) {
  const stepLabel = STEPS.find((s) => s.key === draft.step)?.label ?? draft.step;
  const deptName  = draft.sel.deptName    ?? 'Unknown Dept';
  const secName   = draft.sel.sectionName ?? 'Unknown Section';
  const savedAgo  = relativeTime(draft.savedAt);

  return (
    <div
      role="alert"
      style={{
        background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
        border: '1.5px solid #93C5FD',
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flexShrink: 0, marginTop: 1 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#1E40AF', marginBottom: 2 }}>
            Resume where you left off?
          </p>
          <p style={{ fontSize: 12, color: '#3B82F6', lineHeight: 1.5 }}>
            <strong>{deptName}</strong> &rsaquo; <strong>{secName}</strong>
            {draft.sel.equipmentTypeName && (
              <> &rsaquo; <strong>{draft.sel.equipmentTypeName}</strong></>
            )}
            <br />
            <span style={{ color: '#6B7280' }}>
              Step: {stepLabel}&nbsp;&middot;&nbsp;Saved {savedAgo}
            </span>
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onResume}
          style={{
            flex: 1,
            padding: '8px 0',
            background: '#2563EB',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          &#9654; Continue Draft
        </button>
        <button
          onClick={onDiscard}
          style={{
            flex: 1,
            padding: '8px 0',
            background: '#fff',
            color: '#6B7280',
            border: '1px solid #D1D5DB',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Start Fresh
        </button>
      </div>
    </div>
  );
});

function EvidenceImagePicker({
  image,
  onChange,
  onRemove,
  compact = false,
}: {
  image?: EvidenceImage;
  onChange: (image: EvidenceImage) => void;
  onRemove: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputId = useMemo(() => `evidence-${crypto.randomUUID()}`, []);

  const handleFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      onChange(await compressEvidenceImage(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare this image.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: compact ? 'column' : 'row', gap: 8, alignItems: compact ? 'stretch' : 'center' }}>
      {image?.dataUrl && (
        <button
          type="button"
          onClick={() => window.open(image.dataUrl, '_blank', 'noopener,noreferrer')}
          style={{ border: '1px solid #D7D2C4', background: '#fff', borderRadius: 8, padding: 4, cursor: 'pointer', alignSelf: 'flex-start' }}
          title="View evidence image"
        >
          <img src={image.dataUrl} alt="Evidence preview" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
        </button>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
        <input
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => { void handleFile(e.target.files?.[0]); e.currentTarget.value = ''; }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <label
            htmlFor={inputId}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 11px', background: '#fff', color: '#1A1A18', border: '1px solid #D7D2C4', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
            {busy ? 'Preparing...' : image ? 'Replace Image' : 'Upload Image'}
          </label>
          {image && (
            <button type="button" onClick={onRemove} style={{ padding: '8px 10px', background: '#FFF1F1', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Remove
            </button>
          )}
        </div>
        {error && <span style={{ fontSize: 11, color: '#B91C1C' }}>{error}</span>}
      </div>
    </div>
  );
}

interface TechnicianFlowProps {
  onNavigate?: (page: string) => void;
}

export default function TechnicianFlow({ onNavigate }: TechnicianFlowProps = {}) {
  const departments            = useStore((s) => s.departments);
  const sections               = useStore((s) => s.sections);
  const equipmentTypes         = useStore((s) => s.equipmentTypes);
  const equipmentTypeMappings  = useStore((s) => s.equipmentTypeMappings);
  const checklistTemplates     = useStore((s) => s.checklistTemplates);
  const settings               = useStore((s) => s.settings);
  const allFieldConfigs        = useStore((s) => s.fieldConfigs);
  const addRecord              = useStore((s) => s.addRecord);
  const currentAdmin           = useStore((s) => s.currentAdmin);
  const setUrgentAttentionQuestionText   = useStore((s) => s.setUrgentAttentionQuestionText);
  const setUrgentAttentionDefinitionText = useStore((s) => s.setUrgentAttentionDefinitionText);

  const isSubmissionBlocked = useStorageMonitor((s) => s.isSubmissionBlocked);
  const storageWarningLevel = useStorageMonitor((s) => s.warningLevel);

  const [step, setStep]                   = useState<Step>('dept');
  const [sel, setSel]                     = useState<Partial<Selection>>({});
  const [details, setDetails]             = useState<FormDetails>({
    date: todayStr(),
    startTime: '',
    completionTime: '',
    technicianName: '',
    supervisorName: '',
    qcVerifierName: '',
    hourMeterReading: '',
    fuelCanDetermine: '',
    fuelLevel: '',
    fuelUndeterminedReason: '',
    equipmentNumber: '',
  });
  const [responses, setResponses]         = useState<ChecklistResponse[]>([]);
  const [requiresUrgentAttention, setRequiresUrgentAttention] = useState<boolean | ''>('');
  const [urgentAttentionReason, setUrgentAttentionReason]     = useState('');
  const [editingUrgentCopy, setEditingUrgentCopy]   = useState(false);
  const [urgentQuestionDraft, setUrgentQuestionDraft] = useState('');
  const [urgentDefinitionDraft, setUrgentDefinitionDraft] = useState('');
  const [urgentCopySaved, setUrgentCopySaved] = useState(false);
  const [additionalComment, setAdditionalComment] = useState('');
  const [additionalEvidenceImage, setAdditionalEvidenceImage] = useState<EvidenceImage | undefined>(undefined);
  const [errors, setErrors]               = useState<Record<string, string>>({});
  const [previewTime, setPreviewTime]     = useState('');
  const [isSubmitting, setIsSubmitting]   = useState(false);
  const [isSubmitted, setIsSubmitted]     = useState(false);

  
  const [pendingDraft, setPendingDraft]         = useState<ActiveDraft | null>(null);
  const [checkingRemoteDraft, setCheckingRemoteDraft] = useState(false);
  const draftCheckComplete = useRef(false);
  const draftId   = useRef<string>(crypto.randomUUID());
  const deviceId  = useRef<string>(getOrCreateDeviceId());

  const submissionId = useRef<string>(crypto.randomUUID());

  const { showToast } = useGlobalToast();

  
  useEffect(() => {
    let cancelled = false;

    async function checkForDraft() {
      
      const localDraft = loadLocalDraft();
      if (localDraft) {
        if (!cancelled) {
          setPendingDraft(localDraft);
          draftCheckComplete.current = true;
        }
        return;
      }

      
      setCheckingRemoteDraft(true);
      try {
        const remoteDraft = await loadRemoteDraft(deviceId.current);
        if (!cancelled && remoteDraft) {
          setPendingDraft(remoteDraft);
        }
      } catch {
        
      } finally {
        if (!cancelled) {
          setCheckingRemoteDraft(false);
          draftCheckComplete.current = true;
        }
      }
    }

    void checkForDraft();
    return () => { cancelled = true; };
  }, []);

  
  useEffect(() => {
    
    
    if (!draftCheckComplete.current) return;

    
    if (!sel.deptId) return;

    
    if (step === 'done') return;

    const draft: ActiveDraft = {
      draftId:           draftId.current,
      deviceId:          deviceId.current,
      savedAt:           new Date().toISOString(),
      step,
      sel,
      details,
      responses,
      requiresUrgentAttention,
      urgentAttentionReason,
      additionalComment,
      additionalEvidenceImage,
    };

    debouncedSaveDraft(draft);
  
  }, [step, sel, details, responses, requiresUrgentAttention, urgentAttentionReason, additionalComment, additionalEvidenceImage]);

  
  const handleResumeDraft = useCallback(() => {
    if (!pendingDraft) return;

    setStep(pendingDraft.step as Step);
    setSel(pendingDraft.sel as Partial<Selection>);
    setDetails({
      date:             todayStr(), 
      startTime:        pendingDraft.details.startTime        ?? '',
      completionTime:   pendingDraft.details.completionTime   ?? '',
      technicianName:   pendingDraft.details.technicianName   ?? '',
      supervisorName:   pendingDraft.details.supervisorName   ?? '',
      qcVerifierName:   pendingDraft.details.qcVerifierName   ?? '',
      hourMeterReading: pendingDraft.details.hourMeterReading ?? '',
      // DraftDetails stores this as a plain string (index signature), so
      // validate it against the actual union rather than trusting it blindly —
      // guards against corrupted/older localStorage drafts.
      fuelCanDetermine: (['yes', 'no'] as const).includes(pendingDraft.details.fuelCanDetermine as 'yes' | 'no')
        ? (pendingDraft.details.fuelCanDetermine as 'yes' | 'no')
        : '',
      fuelLevel:        pendingDraft.details.fuelLevel        ?? '',
      fuelUndeterminedReason: pendingDraft.details.fuelUndeterminedReason ?? '',
      equipmentNumber:  pendingDraft.details.equipmentNumber  ?? '',
      
      ...Object.fromEntries(
        Object.entries(pendingDraft.details).filter(([k]) =>
          !['date','startTime','completionTime','technicianName',
            'supervisorName','qcVerifierName','hourMeterReading','fuelCanDetermine',
            'fuelLevel','fuelUndeterminedReason','equipmentNumber'].includes(k)
        )
      ),
    });
    setResponses((pendingDraft.responses ?? []) as ChecklistResponse[]);
    setRequiresUrgentAttention(pendingDraft.requiresUrgentAttention ?? '');
    setUrgentAttentionReason(pendingDraft.urgentAttentionReason ?? '');
    setAdditionalComment(pendingDraft.additionalComment ?? '');
    setAdditionalEvidenceImage(pendingDraft.additionalEvidenceImage);
    setErrors({});

    
    draftId.current = pendingDraft.draftId;

    setPendingDraft(null);
  }, [pendingDraft]);

  
  const handleDiscardDraft = useCallback(() => {
    clearAllDrafts(deviceId.current);
    setPendingDraft(null);
  }, []);

  const filteredSections = useMemo(
    () => sections.filter((s) => s.departmentId === sel.deptId),
    [sections, sel.deptId]
  );

  const filteredEquipmentTypes = useMemo(() => {
    if (!sel.deptId || !sel.sectionId) return equipmentTypes;
    const mappedIds = getMappedEquipmentTypeIds(equipmentTypeMappings, sel.deptId, sel.sectionId);
    if (mappedIds === null) return equipmentTypes;
    return equipmentTypes.filter((eq) => mappedIds.includes(eq.id));
  }, [equipmentTypes, equipmentTypeMappings, sel.deptId, sel.sectionId]);

  const template = useMemo(
    () => checklistTemplates.find(
      (t) => t.equipmentTypeId === sel.equipmentTypeId && t.sectionId === sel.sectionId
    ),
    [checklistTemplates, sel.equipmentTypeId, sel.sectionId]
  );

  const initResponses = useCallback((items: ChecklistItem[]) => {
    setResponses(
      items.map((item) => ({
        itemId: item.id,
        label: item.label,
        isSubheading: item.isSubheading ?? false,
        status: '' as 'OK' | 'NOT OK' | 'N/A' | '',
        comment: '',
        actionPlan: '',
      }))
    );
  }, []);

  const validateDetails = useCallback((): boolean => {
    const e: Record<string, string> = {};
    if (!details.startTime) e.startTime = 'Start time is required';
    if (settings.qcVerifierRequired && !details.qcVerifierName.trim())
      e.qcVerifierName = 'QC Verifier name is required';
    const equipId = sel.equipmentTypeId ?? '';
    const effectiveConfigs = resolveFieldConfigs(allFieldConfigs, equipId);
    effectiveConfigs.forEach((cfg) => {
      if (cfg.key === 'qcVerifierName') return;
      if (cfg.fieldType === 'fuel_percent') {
        const canDet = (details.fuelCanDetermine as string) ?? '';
        const level = (details.fuelLevel as string) ?? '';
        const rsn = (details.fuelUndeterminedReason as string) ?? '';

        if (cfg.required && canDet === '') {
          e.fuelCanDetermine = 'Please indicate whether fuel level can be determined';
          return;
        }

        if (canDet === 'yes') {
          if (cfg.required && level === '') {
            e.fuelLevel = 'Fuel level reading is required';
          } else if (level !== '') {
            const num = parseInt(level, 10);
            if (isNaN(num) || num < 0 || num > 100) {
              e.fuelLevel = 'Fuel level must be a number between 0 and 100';
            }
          }
        }

        if (canDet === 'no' && rsn === '') {
          e.fuelUndeterminedReason = 'Please select a reason';
        }
        return;
      }

      const val = ((details[cfg.key] as string) ?? '').trim();
      if (cfg.required && !val) {
        e[cfg.key] = `${cfg.label} is required`;
        return;
      }
      if (cfg.fieldType === 'numeric' && val && !/^\d+$/.test(val)) {
        e[cfg.key] = `${cfg.label} must contain digits only`;
      }
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  }, [details, settings, allFieldConfigs, sel.equipmentTypeId]);

  const validateChecklist = useCallback((): boolean => {
    const e: Record<string, string> = {};
    responses.forEach((r) => {
      if (r.isSubheading) return;
      const status = r.status as string;
      if (!status) {
        e[`${r.itemId}-status`] = 'Status is required — select OK, NOT OK or N/A';
      } else if (status === 'NOT OK') {
        if (!r.comment.trim())    e[`${r.itemId}-comment`]    = 'Comment is required when status is NOT OK';
        if (!r.actionPlan.trim()) e[`${r.itemId}-actionPlan`] = 'Action Plan is required when status is NOT OK';
      }
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  }, [responses]);

  // ── Super-Admin inline editing of Urgent Attention copy ────────────────
  const startEditUrgentCopy = useCallback(() => {
    setUrgentQuestionDraft(settings.urgentAttentionQuestionText || DEFAULT_URGENT_ATTENTION_QUESTION_TEXT);
    setUrgentDefinitionDraft(settings.urgentAttentionDefinitionText || DEFAULT_URGENT_ATTENTION_DEFINITION_TEXT);
    setEditingUrgentCopy(true);
    setUrgentCopySaved(false);
  }, [settings.urgentAttentionQuestionText, settings.urgentAttentionDefinitionText]);

  const saveUrgentCopy = useCallback(() => {
    setUrgentAttentionQuestionText(urgentQuestionDraft);
    setUrgentAttentionDefinitionText(urgentDefinitionDraft);
    setEditingUrgentCopy(false);
    setUrgentCopySaved(true);
    setTimeout(() => setUrgentCopySaved(false), 2500);
  }, [urgentQuestionDraft, urgentDefinitionDraft, setUrgentAttentionQuestionText, setUrgentAttentionDefinitionText]);

  const cancelEditUrgentCopy = useCallback(() => {
    setEditingUrgentCopy(false);
  }, []);

  const validateUrgentAttention = useCallback((): boolean => {
    const e: Record<string, string> = {};
    if (requiresUrgentAttention === '') {
      e.urgentAttention = 'Please indicate whether this equipment requires urgent attention.';
    } else if (requiresUrgentAttention === true && !urgentAttentionReason.trim()) {
      e.urgentAttentionReason = 'Please provide the reason for urgent attention.';
    }
    setErrors((prev) => ({ ...prev, ...e }));
    return Object.keys(e).length === 0;
  }, [requiresUrgentAttention, urgentAttentionReason]);

  const handlePreview = useCallback(() => {
    if (!validateChecklist()) return;
    if (!validateUrgentAttention()) return;
    const ct = nowTimeStr();
    setPreviewTime(ct);
    setDetails((d) => ({ ...d, completionTime: ct }));
    setStep('preview');
  }, [validateChecklist, validateUrgentAttention]);

  const handleSubmit = useCallback(async () => {
    if (isSubmitted) {
      showToast('duplicate', 'This checklist has already been submitted. Start a new inspection to submit again.');
      return;
    }
    if (isSubmitting) return;
    if (!sel.deptId || !sel.sectionId || !sel.equipmentTypeId) return;
    if (isSubmissionBlocked) {
      console.warn('[TechnicianFlow] Submission blocked — storage full or critical.');
      return;
    }
    setIsSubmitted(true);
    setIsSubmitting(true);
    try {
      const result = await addRecord({
        submissionId:      submissionId.current,
        departmentId:      sel.deptId!,
        departmentName:    sel.deptName!,
        sectionId:         sel.sectionId!,
        sectionName:       sel.sectionName!,
        equipmentTypeId:   sel.equipmentTypeId!,
        equipmentTypeName: sel.equipmentTypeName!,
        equipmentTypeCode: sel.equipmentTypeCode!,
        equipmentNumber:   details.equipmentNumber,
        date:              details.date,
        startTime:         details.startTime,
        completionTime:    details.completionTime || previewTime,
        technicianName:    details.technicianName,
        supervisorName:    details.supervisorName,
        qcVerifierName:    details.qcVerifierName,
        hourMeterReading:  details.hourMeterReading,
        fuelCanDetermine:  details.fuelCanDetermine,
        fuelLevel:         details.fuelLevel,
        fuelUndeterminedReason: details.fuelUndeterminedReason,
        checklistResponses: responses,
        requiresUrgentAttention: requiresUrgentAttention === true,
        urgentAttentionReason: requiresUrgentAttention === true ? urgentAttentionReason.trim() : undefined,
        additionalComment:  additionalComment.trim() || undefined,
        additionalEvidenceImage,
      });

      showToast(result.status, result.message);

      // 'duplicate' means the server already has a checklist for this
      // equipment/date — there's nothing left to save, so clear drafts the
      // same as a real success. Unlike 'failed', we deliberately do NOT
      // re-enable the Submit button: retrying would just hit the same
      // conflict again, so isSubmitted stays true (button shows
      // "✓ Already Submitted").
      if (result.status === 'success' || result.status === 'queued' || result.status === 'duplicate') {
        clearAllDrafts(deviceId.current);
      }

      if (result.status === 'success') {
        setTimeout(() => setStep('done'), 1200);
      }
      if (result.status === 'failed') {
        setIsSubmitted(false);
      }
    } catch (unexpectedError) {
      console.error('[TechnicianFlow] Unexpected error during submission:', unexpectedError);
      showToast('error', 'An unexpected error occurred. Please try again.');
      setIsSubmitted(false);
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitted, isSubmitting, isSubmissionBlocked, sel, details, previewTime, responses, requiresUrgentAttention, urgentAttentionReason, additionalComment, additionalEvidenceImage, addRecord, showToast]);

  const reset = useCallback(() => {
    
    clearAllDrafts(deviceId.current);

    setStep('dept');
    setSel({});
    setDetails({
      date: todayStr(),
      startTime: '',
      completionTime: '',
      technicianName: '',
      supervisorName: '',
      qcVerifierName: '',
      hourMeterReading: '',
      fuelCanDetermine: '',
      fuelLevel: '',
      fuelUndeterminedReason: '',
      equipmentNumber: '',
    });
    setResponses([]);
    setRequiresUrgentAttention('');
    setUrgentAttentionReason('');
    setAdditionalComment('');
    setAdditionalEvidenceImage(undefined);
    setErrors({});
    setPreviewTime('');
    setIsSubmitting(false);
    setPendingDraft(null);
    submissionId.current = crypto.randomUUID();
    draftId.current      = crypto.randomUUID();
    setIsSubmitted(false);
  }, []);

  
  if (step === 'done') {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 16px', textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 8 }}>Submitted!</h2>
        <p style={{ color: '#6B6963', fontSize: 14, marginBottom: 24 }}>
          Your daily checking record has been saved successfully.
        </p>
        <button className="btn-primary" onClick={reset} style={{ width: '100%', marginBottom: 12 }}>
          Start New Check
        </button>
        {onNavigate && (
          <button
            className="btn-secondary"
            onClick={() => onNavigate('home')}
            style={{ width: '100%' }}
          >
            ← Back to Home
          </button>
        )}
      </div>
    );
  }

  
  if (step === 'preview') {
    const previewRecord = {
      id: '', refId: 'PREVIEW', submissionId: '',
      departmentId: sel.deptId!, departmentName: sel.deptName!,
      sectionId: sel.sectionId!, sectionName: sel.sectionName!,
      equipmentTypeId: sel.equipmentTypeId!, equipmentTypeName: sel.equipmentTypeName!, equipmentTypeCode: sel.equipmentTypeCode!,
      date: details.date, startTime: details.startTime, completionTime: previewTime,
      technicianName: details.technicianName, supervisorName: details.supervisorName,
      qcVerifierName: details.qcVerifierName, hourMeterReading: details.hourMeterReading,
      fuelCanDetermine: details.fuelCanDetermine,
      fuelLevel: details.fuelLevel,
      fuelUndeterminedReason: details.fuelUndeterminedReason,
      equipmentNumber: details.equipmentNumber,
      checklistResponses: responses,
      requiresUrgentAttention: requiresUrgentAttention === true,
      urgentAttentionReason: requiresUrgentAttention === true ? urgentAttentionReason.trim() : undefined,
      additionalComment: additionalComment.trim() || undefined,
      additionalEvidenceImage,
      submittedAt: new Date().toISOString(),
    };

    return (
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '20px 16px' }}>
        <button className="back-btn" onClick={() => setStep('checklist')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
          Back to Checklist
        </button>

        <div className="card">
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            {settings.navLogoUrl && <img src={settings.navLogoUrl} alt="logo" style={{ maxHeight: 50, marginBottom: 10 }} />}
            <h1 style={{ fontSize: 20, fontWeight: 500, color: '#2563EB' }}>DAILY CHECKING REPORT</h1>
            <div style={{ display: 'inline-block', fontSize: 12, background: '#EFF6FF', color: '#1D4ED8', padding: '4px 12px', borderRadius: 20, fontWeight: 500, fontFamily: 'monospace', marginTop: 4 }}>
              Preview — Not Yet Submitted
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px 16px', marginBottom: 20 }} id="preview-details-grid">
            {[
              ['Department', sel.deptName], ['Section', sel.sectionName],
              ['Equipment', `${sel.equipmentTypeName} (${sel.equipmentTypeCode})`],
              ['Equipment No.', details.equipmentNumber], ['Date', details.date],
              ['Start Time', details.startTime], ['Completion Time', previewTime],
              ['Hour Meter', details.hourMeterReading],
              ...(details.fuelCanDetermine === 'yes' && details.fuelLevel !== ''
                ? [['Fuel Level', `${details.fuelLevel}%`]]
                : details.fuelCanDetermine === 'no' && details.fuelUndeterminedReason !== ''
                ? [['Fuel Level', `Cannot determine - ${fuelReasonLabel(details.fuelUndeterminedReason)}`]]
                : []),
              ['Technician', details.technicianName],
              ['Supervisor', details.supervisorName], ['QC Verifier', details.qcVerifierName || '—'],
            ].map(([label, value]) => (
              <div key={label} className="review-row">
                <span style={{ fontSize: 13, color: '#6B6963', flexShrink: 0 }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 500, textAlign: 'right' }}>{value}</span>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>Checklist</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto', minWidth: 500 }}>
                <thead>
                  <tr style={{ background: '#F1EFE8', borderBottom: '0.5px solid rgba(0,0,0,0.15)' }}>
                    {['Check','Status','Comment','Action Plan','Evidence'].map((h) => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: '#6B6963', textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {responses.map((r) => {
                    if (r.isSubheading) return (
                      <tr key={r.itemId}>
                        <td colSpan={5} style={{ padding: '8px 12px', background: '#DBEAFE', fontSize: 12, fontWeight: 500, color: '#1E40AF', borderBottom: '0.5px solid #BFDBFE' }}>{r.label}</td>
                      </tr>
                    );
                    return (
                      <tr key={r.itemId} style={{ borderBottom: '0.5px solid rgba(0,0,0,0.08)' }}>
                        <td style={{ padding: '10px 12px', fontSize: 13 }}>{r.label}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span className={`pill ${r.status === 'OK' ? 'pill-green' : r.status === 'N/A' ? 'pill-gray' : 'pill-red'}`}>{r.status || '—'}</span>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#6B6963', fontSize: 13 }}>{r.comment || '—'}</td>
                        <td style={{ padding: '10px 12px', color: '#6B6963', fontSize: 13 }}>{r.actionPlan || '—'}</td>
                        <td style={{ padding: '10px 12px', color: '#6B6963', fontSize: 13 }}>
                          {r.evidenceImage?.dataUrl ? (
                            <img src={r.evidenceImage.dataUrl} alt="Evidence" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, border: '1px solid #D7D2C4' }} />
                          ) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{
            marginBottom: 20,
            borderRadius: 10,
            padding: '12px 16px',
            border: `0.5px solid ${requiresUrgentAttention === true ? '#FCA5A5' : 'rgba(0,0,0,0.10)'}`,
            background: requiresUrgentAttention === true ? '#FFF1F1' : '#F1EFE8',
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 8, color: requiresUrgentAttention === true ? '#7F1D1D' : '#1A1A18' }}>Urgent Attention Assessment</h3>
            <p style={{ fontSize: 13, fontWeight: 500, color: requiresUrgentAttention === true ? '#B91C1C' : '#166534' }}>
              {requiresUrgentAttention === true ? 'YES — Urgent Attention Required' : 'NO — No Urgent Attention Required'}
            </p>
            {requiresUrgentAttention === true && urgentAttentionReason.trim() && (
              <>
                <p style={{ fontSize: 12, fontWeight: 500, color: '#6B6963', marginTop: 8, marginBottom: 2 }}>Reason</p>
                <p style={{ fontSize: 13, color: '#3A3935', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{urgentAttentionReason.trim()}</p>
              </>
            )}
          </div>

          {(additionalComment.trim() || additionalEvidenceImage?.dataUrl) && (
            <div style={{ marginBottom: 20, background: '#F1EFE8', borderRadius: 10, padding: '12px 16px', border: '0.5px solid rgba(0,0,0,0.10)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 8, color: '#1A1A18' }}>Additional Comments</h3>
              {additionalComment.trim() && <p style={{ fontSize: 13, color: '#3A3935', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{additionalComment.trim()}</p>}
              {additionalEvidenceImage?.dataUrl && (
                <img src={additionalEvidenceImage.dataUrl} alt="Additional evidence" style={{ marginTop: 10, width: 92, height: 92, objectFit: 'cover', borderRadius: 8, border: '1px solid #D7D2C4' }} />
              )}
            </div>
          )}

          {isSubmissionBlocked && (
            <div role="alert" style={{ background: '#FFF1F1', border: '1.5px solid #FCA5A5', borderRadius: 10, padding: '12px 16px', marginBottom: 12, fontSize: 13, color: '#7F1D1D', lineHeight: 1.5 }}>
              <strong>{storageWarningLevel === 'exceeded' ? '🚨 Storage limit reached' : '🔴 Storage almost full'}</strong>
              {' — '}
              {storageWarningLevel === 'exceeded' ? 'This record cannot be saved locally. Clear old inspection records from the Admin Panel, then reload.' : 'Storage is critically full. Free up space before submitting.'}
            </div>
          )}

          <div className="btn-row">
            <button className="btn-secondary" style={{ flex: 1 }} onClick={() => { void generatePDF(previewRecord, settings.navLogoUrl); }}>
              Download PDF
            </button>
            <button
              className="btn-primary"
              style={{ flex: 1, ...(isSubmissionBlocked ? { background: '#9CA3AF', cursor: 'not-allowed', opacity: 0.7 } : isSubmitted ? { background: '#6B7280', cursor: 'not-allowed', opacity: 0.75 } : {}) }}
              onClick={handleSubmit}
              disabled={isSubmitting || isSubmitted || isSubmissionBlocked}
              title={isSubmissionBlocked ? 'Submission blocked — storage is full.' : isSubmitted ? 'Already submitted. Start a new inspection.' : undefined}
            >
              {isSubmitting ? 'Saving…' : isSubmitted ? '✓ Already Submitted' : isSubmissionBlocked ? '⚠ Storage Full — Cannot Submit' : 'Submit Record'}
            </button>
          </div>
        </div>

        <style>{`@media(max-width:480px){#preview-details-grid{grid-template-columns:1fr !important;}}`}</style>
      </div>
    );
  }

  
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px' }}>
      <StepProgress current={step} />

      {}
      {pendingDraft && step === 'dept' && !checkingRemoteDraft && (
        <DraftBanner
          draft={pendingDraft}
          onResume={handleResumeDraft}
          onDiscard={handleDiscardDraft}
        />
      )}

      {checkingRemoteDraft && (
        <div style={{ fontSize: 12, color: '#9C9A92', textAlign: 'center', padding: '6px 0 4px', marginBottom: 8 }}>
          Checking for saved draft…
        </div>
      )}

      {}
      {step === 'dept' && (
        <div className="card">
          <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 6 }}>Select Department</h2>
          <p style={{ fontSize: 13, color: '#6B6963', marginBottom: 16 }}>Choose the department this inspection belongs to.</p>
          {departments.length === 0 && (
            <div className="empty-state"><p style={{ color: '#6B6963', fontSize: 14 }}>No departments configured. Contact admin.</p></div>
          )}
          {departments.map((d) => (
            <label key={d.id} className="radio-card">
              <input type="radio" name="dept" checked={sel.deptId === d.id} onChange={() => setSel({ deptId: d.id, deptName: d.name })} />
              <span style={{ fontSize: 14, fontWeight: 500 }}>{d.name}</span>
            </label>
          ))}
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button className="btn-primary" style={{ width: '100%' }} disabled={!sel.deptId} onClick={() => setStep('section')}>Continue</button>
          </div>
        </div>
      )}

      {}
      {step === 'section' && (
        <div className="card">
          <button className="back-btn" onClick={() => setStep('dept')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
            Back
          </button>
          <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 6 }}>Select Section</h2>
          <p style={{ fontSize: 13, color: '#6B6963', marginBottom: 16 }}>Department: <strong>{sel.deptName}</strong></p>
          {filteredSections.length === 0 && (
            <div className="empty-state"><p style={{ color: '#6B6963', fontSize: 14 }}>No sections for this department. Contact admin.</p></div>
          )}
          {filteredSections.map((s) => (
            <label key={s.id} className="radio-card">
              <input type="radio" name="section" checked={sel.sectionId === s.id} onChange={() => setSel((prev) => ({ ...prev, sectionId: s.id, sectionName: s.name }))} />
              <span style={{ fontSize: 14, fontWeight: 500 }}>{s.name}</span>
            </label>
          ))}
          <div className="btn-row">
            <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setStep('dept')}>Back</button>
            <button className="btn-primary" style={{ flex: 1 }} disabled={!sel.sectionId} onClick={() => setStep('equipment')}>Continue</button>
          </div>
        </div>
      )}

      {}
      {step === 'equipment' && (
        <div className="card">
          <button className="back-btn" onClick={() => setStep('section')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
            Back
          </button>
          <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 6 }}>Select Equipment Type</h2>
          <p style={{ fontSize: 13, color: '#6B6963', marginBottom: 16 }}>Section: <strong>{sel.sectionName}</strong></p>
          {filteredEquipmentTypes.length === 0 && (
            <div className="empty-state"><p style={{ color: '#6B6963', fontSize: 14 }}>No equipment types available for this section. Contact your admin to set up equipment mappings.</p></div>
          )}
          {filteredEquipmentTypes.map((eq) => (
            <label key={eq.id} className="radio-card">
              <input type="radio" name="equipment" checked={sel.equipmentTypeId === eq.id}
                onChange={() => setSel((prev) => ({ ...prev, equipmentTypeId: eq.id, equipmentTypeName: eq.name, equipmentTypeCode: eq.code }))} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="pill pill-blue" style={{ fontSize: 11, fontWeight: 500 }}>{eq.code}</span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{eq.name}</span>
              </div>
            </label>
          ))}
          <div className="btn-row">
            <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setStep('section')}>Back</button>
            <button className="btn-primary" style={{ flex: 1 }} disabled={!sel.equipmentTypeId} onClick={() => setStep('details')}>Continue</button>
          </div>
        </div>
      )}

      {}
      {step === 'details' && (
        <div className="card">
          <button className="back-btn" onClick={() => setStep('equipment')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
            Back
          </button>
          <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 4 }}>Basic Details</h2>
          <p style={{ fontSize: 13, color: '#6B6963', marginBottom: 20 }}>{sel.equipmentTypeName} ({sel.equipmentTypeCode}) — {sel.sectionName}</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label className="form-label">Date</label>
              <input type="date" className="form-input" value={details.date} readOnly style={{ background: '#F1EFE8', cursor: 'not-allowed' }} />
            </div>
            <div>
              <label className="form-label">Start Time <span style={{ color: '#EF4444' }}>*</span></label>
              <input type="time" className={`form-input ${errors.startTime ? 'error-field' : ''}`} value={details.startTime}
                onChange={(e) => { setDetails((d) => ({ ...d, startTime: e.target.value })); setErrors((err) => ({ ...err, startTime: '' })); }} />
              {errors.startTime && <p className="field-error">{errors.startTime}</p>}
            </div>
            <div>
              <label className="form-label">Completion Time <span style={{ fontSize: 11, color: '#9C9A92' }}>(auto-filled at preview)</span></label>
              <input type="time" className="form-input" value={details.completionTime} readOnly style={{ background: '#F1EFE8', cursor: 'not-allowed' }} />
            </div>
            <BasicInformationForm
              equipmentTypeId={sel.equipmentTypeId ?? ''}
              values={details as unknown as Record<string, string>}
              errors={errors}
              onChange={(key, value) => setDetails((d) => ({ ...d, [key]: value }))}
              onClearError={(key) => setErrors((e) => ({ ...e, [key]: '' }))}
              qcVerifierRequired={settings.qcVerifierRequired}
            />
          </div>

          <div className="btn-row">
            <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setStep('equipment')}>Back</button>
            <button
              className="btn-primary"
              style={{ flex: 1 }}
              onClick={() => {
                if (validateDetails()) {
                  if (template) {
                    const templateItems = [...template.items].sort((a, b) => a.order - b.order);
                    
                    
                    
                    
                    
                    const templateIdSet = new Set(templateItems.map((i) => i.id));
                    const responsesMatchTemplate =
                      responses.length > 0 &&
                      responses.length === templateItems.length &&
                      responses.every((r) => templateIdSet.has(r.itemId));
                    if (!responsesMatchTemplate) {
                      initResponses(templateItems);
                    }
                  } else {
                    if (responses.length > 0) setResponses([]);
                  }
                  setStep('checklist');
                }
              }}
            >
              Continue to Checklist
            </button>
          </div>
        </div>
      )}

      {}
      {step === 'checklist' && (
        <div className="card">
          <button className="back-btn" onClick={() => setStep('details')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
            Back
          </button>
          <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 4 }}>Checklist</h2>
          <p style={{ fontSize: 13, color: '#6B6963', marginBottom: 16 }}>
            {sel.equipmentTypeName} ({sel.equipmentTypeCode}) #{details.equipmentNumber} — {sel.sectionName}
          </p>

          {(isSuperAdmin(currentAdmin) || settings.showFillButton) && responses.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <button type="button"
                onClick={() => {
                  setResponses((prev) => prev.map((r) => r.isSubheading ? r : { ...r, status: 'OK', comment: '', actionPlan: '', evidenceImage: undefined }));
                  setErrors((prev) => {
                    const next = { ...prev };
                    responses.forEach((r) => { if (!r.isSubheading) { delete next[`${r.itemId}-status`]; delete next[`${r.itemId}-comment`]; delete next[`${r.itemId}-actionPlan`]; } });
                    return next;
                  });
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#16A34A', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                Fill All OK
              </button>
            </div>
          )}

          {responses.length === 0 ? (
            <div style={{ background: '#FEF3C7', color: '#92400E', padding: '12px 14px', borderRadius: 10, fontSize: 13, marginBottom: 16 }}>
              No checklist items configured for this equipment + section combination. Contact admin.
            </div>
          ) : (
            <>
              {}
              <div id="checklist-mobile">
                {(() => {
                  let itemNum = 0;
                  return responses.map((r, i) => {
                    if (r.isSubheading) return (
                      <div key={r.itemId} style={{ background: '#DBEAFE', borderRadius: 10, padding: '8px 14px', marginBottom: 6, marginTop: 10, border: '0.5px solid #BFDBFE' }}>
                        <p style={{ fontSize: 13, fontWeight: 500, color: '#1E40AF' }}>{r.label}</p>
                      </div>
                    );
                    itemNum += 1;
                    const num = itemNum;
                    const isNotDone = (r.status as string) === 'NOT OK';
                    return (
                      <div key={r.itemId} style={{ background: '#F1EFE8', borderRadius: 12, padding: '12px 14px', marginBottom: 10, border: '0.5px solid rgba(0,0,0,0.10)' }}>
                        <p style={{ fontSize: 13, fontWeight: 500, color: '#1A1A18', marginBottom: 10 }}>{num}. {r.label}</p>
                        <div style={{ marginBottom: isNotDone ? 10 : 0 }}>
                          <label className="form-label" style={{ fontSize: 11 }}>Status <span style={{ color: '#EF4444' }}>*</span></label>
                          <select className={`form-input ${errors[`${r.itemId}-status`] ? 'error-field' : ''}`} value={r.status}
                            onChange={(e) => {
                              const status = e.target.value as 'OK' | 'NOT OK' | 'N/A';
                              setResponses((prev) => prev.map((x, j) => j === i ? { ...x, status, comment: (status === 'OK' || status === 'N/A') ? '' : x.comment, actionPlan: (status === 'OK' || status === 'N/A') ? '' : x.actionPlan, evidenceImage: (status === 'OK' || status === 'N/A') ? undefined : x.evidenceImage } : x));
                              if (status === 'OK' || status === 'N/A') { setErrors((err) => { const ne = { ...err }; delete ne[`${r.itemId}-status`]; delete ne[`${r.itemId}-comment`]; delete ne[`${r.itemId}-actionPlan`]; return ne; }); }
                              else { setErrors((err) => ({ ...err, [`${r.itemId}-status`]: '' })); }
                            }}>
                            <option value="" disabled>Select...</option>
                            <option value="OK">OK</option>
                            <option value="NOT OK">NOT OK</option>
                            <option value="N/A">N/A</option>
                          </select>
                          {errors[`${r.itemId}-status`] && <p className="field-error">{errors[`${r.itemId}-status`]}</p>}
                        </div>
                        {isNotDone && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div>
                              <label className="form-label" style={{ fontSize: 11 }}>Comment <span style={{ color: '#EF4444' }}>*</span></label>
                              <input type="text" className={`form-input ${errors[`${r.itemId}-comment`] ? 'error-field' : ''}`} placeholder="Describe the issue..." value={r.comment}
                                onChange={(e) => { const val = e.target.value; setResponses((prev) => prev.map((x, j) => j === i ? { ...x, comment: val } : x)); if (val.trim()) setErrors((err) => { const ne = { ...err }; delete ne[`${r.itemId}-comment`]; return ne; }); }} />
                              {errors[`${r.itemId}-comment`] && <p className="field-error">{errors[`${r.itemId}-comment`]}</p>}
                            </div>
                            <div>
                              <label className="form-label" style={{ fontSize: 11 }}>Action Plan <span style={{ color: '#EF4444' }}>*</span></label>
                              <input type="text" className={`form-input ${errors[`${r.itemId}-actionPlan`] ? 'error-field' : ''}`} placeholder="Describe the corrective action..." value={r.actionPlan}
                                onChange={(e) => { const val = e.target.value; setResponses((prev) => prev.map((x, j) => j === i ? { ...x, actionPlan: val } : x)); if (val.trim()) setErrors((err) => { const ne = { ...err }; delete ne[`${r.itemId}-actionPlan`]; return ne; }); }} />
                              {errors[`${r.itemId}-actionPlan`] && <p className="field-error">{errors[`${r.itemId}-actionPlan`]}</p>}
                            </div>
                            <div>
                              <label className="form-label" style={{ fontSize: 11 }}>Evidence Photo <span style={{ color: '#9C9A92' }}>(Optional)</span></label>
                              <EvidenceImagePicker
                                image={r.evidenceImage}
                                compact
                                onChange={(image) => setResponses((prev) => prev.map((x, j) => j === i ? { ...x, evidenceImage: image } : x))}
                                onRemove={() => setResponses((prev) => prev.map((x, j) => j === i ? { ...x, evidenceImage: undefined } : x))}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>

              {}
              <div id="checklist-desktop" style={{ display: 'none', overflowX: 'auto', marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto', minWidth: 760 }}>
                  <thead>
                    <tr style={{ background: '#F1EFE8', borderBottom: '0.5px solid rgba(0,0,0,0.15)' }}>
                      <th style={thStyle}>{sel.sectionName}</th>
                      <th style={{ ...thStyle, width: 140 }}>Status</th>
                      <th style={thStyle}>Comment</th>
                      <th style={thStyle}>Action Plan</th>
                      <th style={thStyle}>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      let itemNum = 0;
                      return responses.map((r, i) => {
                        if (r.isSubheading) return (
                          <tr key={r.itemId}><td colSpan={5} style={{ padding: '8px 12px', background: '#DBEAFE', fontSize: 12, fontWeight: 500, color: '#1E40AF', borderBottom: '0.5px solid #BFDBFE' }}>{r.label}</td></tr>
                        );
                        itemNum += 1;
                        const isNotDone = (r.status as string) === 'NOT OK';
                        return (
                          <tr key={r.itemId} style={{ borderBottom: '0.5px solid rgba(0,0,0,0.08)' }}>
                            <td style={{ padding: '10px 12px', fontSize: 13 }}>
                              <span style={{ color: '#9C9A92', fontSize: 11, marginRight: 6 }}>{itemNum}.</span>{r.label}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <select className={`form-input ${errors[`${r.itemId}-status`] ? 'error-field' : ''}`} style={{ minWidth: 120 }} value={r.status}
                                onChange={(e) => {
                                  const status = e.target.value as 'OK' | 'NOT OK' | 'N/A';
                                  setResponses((prev) => prev.map((x, j) => j === i ? { ...x, status, comment: (status === 'OK' || status === 'N/A') ? '' : x.comment, actionPlan: (status === 'OK' || status === 'N/A') ? '' : x.actionPlan, evidenceImage: (status === 'OK' || status === 'N/A') ? undefined : x.evidenceImage } : x));
                                  if (status === 'OK' || status === 'N/A') setErrors((err) => { const ne = { ...err }; delete ne[`${r.itemId}-status`]; delete ne[`${r.itemId}-comment`]; delete ne[`${r.itemId}-actionPlan`]; return ne; });
                                }}>
                                <option value="" disabled>Select...</option>
                                <option value="OK">OK</option>
                                <option value="NOT OK">NOT OK</option>
                                <option value="N/A">N/A</option>
                              </select>
                              {errors[`${r.itemId}-status`] && <p className="field-error" style={{ fontSize: 10, marginTop: 2 }}>{errors[`${r.itemId}-status`]}</p>}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              {isNotDone ? (
                                <div>
                                  <input type="text" className={`form-input ${errors[`${r.itemId}-comment`] ? 'error-field' : ''}`} placeholder="Describe the issue..." value={r.comment} style={{ minWidth: 140 }}
                                    onChange={(e) => { const val = e.target.value; setResponses((prev) => prev.map((x, j) => j === i ? { ...x, comment: val } : x)); if (val.trim()) setErrors((err) => { const ne = { ...err }; delete ne[`${r.itemId}-comment`]; return ne; }); }} />
                                  {errors[`${r.itemId}-comment`] && <p className="field-error" style={{ fontSize: 10, marginTop: 2 }}>{errors[`${r.itemId}-comment`]}</p>}
                                </div>
                              ) : <span style={{ fontSize: 13, color: '#9C9A92' }}>—</span>}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              {isNotDone ? (
                                <div>
                                  <input type="text" className={`form-input ${errors[`${r.itemId}-actionPlan`] ? 'error-field' : ''}`} placeholder="Corrective action..." value={r.actionPlan} style={{ minWidth: 140 }}
                                    onChange={(e) => { const val = e.target.value; setResponses((prev) => prev.map((x, j) => j === i ? { ...x, actionPlan: val } : x)); if (val.trim()) setErrors((err) => { const ne = { ...err }; delete ne[`${r.itemId}-actionPlan`]; return ne; }); }} />
                                  {errors[`${r.itemId}-actionPlan`] && <p className="field-error" style={{ fontSize: 10, marginTop: 2 }}>{errors[`${r.itemId}-actionPlan`]}</p>}
                                </div>
                              ) : <span style={{ fontSize: 13, color: '#9C9A92' }}>—</span>}
                            </td>
                            <td style={{ padding: '10px 12px', minWidth: 190 }}>
                              {isNotDone ? (
                                <EvidenceImagePicker
                                  image={r.evidenceImage}
                                  compact
                                  onChange={(image) => setResponses((prev) => prev.map((x, j) => j === i ? { ...x, evidenceImage: image } : x))}
                                  onRemove={() => setResponses((prev) => prev.map((x, j) => j === i ? { ...x, evidenceImage: undefined } : x))}
                                />
                              ) : <span style={{ fontSize: 13, color: '#9C9A92' }}>—</span>}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {}
          <div style={{
            marginTop: 20,
            marginBottom: 16,
            borderRadius: 12,
            padding: '14px 16px',
            border: `0.5px solid ${errors.urgentAttention ? '#FCA5A5' : 'rgba(0,0,0,0.10)'}`,
            background: '#F1EFE8',
          }}>
            {editingUrgentCopy ? (
              <div style={{ marginBottom: 12 }}>
                <label className="form-label" style={{ fontSize: 12 }}>Question</label>
                <input
                  type="text"
                  className="form-input"
                  style={{ fontSize: 13, marginBottom: 10 }}
                  value={urgentQuestionDraft}
                  onChange={(e) => setUrgentQuestionDraft(e.target.value)}
                  placeholder={DEFAULT_URGENT_ATTENTION_QUESTION_TEXT}
                />
                <label className="form-label" style={{ fontSize: 12 }}>Definition / explanatory text</label>
                <textarea
                  rows={4}
                  className="form-input"
                  style={{ fontSize: 13, resize: 'vertical', minHeight: 80, fontFamily: 'inherit', lineHeight: 1.5, marginBottom: 10 }}
                  value={urgentDefinitionDraft}
                  onChange={(e) => setUrgentDefinitionDraft(e.target.value)}
                  placeholder={DEFAULT_URGENT_ATTENTION_DEFINITION_TEXT}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={saveUrgentCopy}
                    style={{ padding: '6px 14px', fontSize: 12, background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditUrgentCopy}
                    style={{ padding: '6px 14px', fontSize: 12, background: '#fff', color: '#1A1A18', border: '0.5px solid rgba(0,0,0,0.15)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1A1A18', flex: 1 }}>
                    {settings.urgentAttentionQuestionText || DEFAULT_URGENT_ATTENTION_QUESTION_TEXT}{' '}
                    <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  {isSuperAdmin(currentAdmin) && (
                    <button
                      type="button"
                      onClick={startEditUrgentCopy}
                      title="Edit Urgent Attention wording (Super Admin)"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: '#9C9A92', fontSize: 12, lineHeight: 1, borderRadius: 4, flexShrink: 0 }}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#2563EB')}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#9C9A92')}
                    >
                      ✏️
                    </button>
                  )}
                </div>
                <p style={{ fontSize: 12, color: '#6B6963', lineHeight: 1.5, marginBottom: 10, whiteSpace: 'pre-wrap' }}>
                  {settings.urgentAttentionDefinitionText || DEFAULT_URGENT_ATTENTION_DEFINITION_TEXT}
                </p>
                {urgentCopySaved && <p style={{ fontSize: 11, color: '#166534', marginTop: -6, marginBottom: 10 }}>✅ Wording updated on all devices</p>}
              </>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  setRequiresUrgentAttention(true);
                  setErrors((err) => { const ne = { ...err }; delete ne.urgentAttention; return ne; });
                }}
                style={{
                  flex: '1 1 180px',
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  border: requiresUrgentAttention === true ? '1.5px solid #DC2626' : '1px solid #D7D2C4',
                  background: requiresUrgentAttention === true ? '#FEE2E2' : '#fff',
                  color: requiresUrgentAttention === true ? '#B91C1C' : '#3A3935',
                }}
              >
                Yes — Urgent Attention Required
              </button>
              <button
                type="button"
                onClick={() => {
                  setRequiresUrgentAttention(false);
                  setUrgentAttentionReason('');
                  setErrors((err) => { const ne = { ...err }; delete ne.urgentAttention; delete ne.urgentAttentionReason; return ne; });
                }}
                style={{
                  flex: '1 1 180px',
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  border: requiresUrgentAttention === false ? '1.5px solid #16A34A' : '1px solid #D7D2C4',
                  background: requiresUrgentAttention === false ? '#DCFCE7' : '#fff',
                  color: requiresUrgentAttention === false ? '#166534' : '#3A3935',
                }}
              >
                No — No Urgent Attention Required
              </button>
            </div>
            {errors.urgentAttention && <p className="field-error" style={{ marginTop: 8 }}>{errors.urgentAttention}</p>}

            {requiresUrgentAttention === true && (
              <div style={{ marginTop: 12 }}>
                <label htmlFor="urgent-attention-reason" className="form-label" style={{ fontSize: 12 }}>
                  Reason for Urgent Attention <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <textarea
                  id="urgent-attention-reason"
                  rows={3}
                  className={`form-input ${errors.urgentAttentionReason ? 'error-field' : ''}`}
                  placeholder="Describe the condition requiring urgent attention..."
                  value={urgentAttentionReason}
                  onChange={(e) => {
                    const val = e.target.value;
                    setUrgentAttentionReason(val);
                    if (val.trim()) setErrors((err) => { const ne = { ...err }; delete ne.urgentAttentionReason; return ne; });
                  }}
                  style={{ resize: 'vertical', minHeight: 72, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }}
                />
                {errors.urgentAttentionReason && <p className="field-error">{errors.urgentAttentionReason}</p>}
              </div>
            )}
          </div>

          {}
          <div style={{ marginTop: 20, marginBottom: 16, background: '#F1EFE8', borderRadius: 12, padding: '14px 16px', border: '0.5px solid rgba(0,0,0,0.10)' }}>
            <label htmlFor="additional-comment" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1A1A18', marginBottom: 8 }}>
              Additional Comments
              <span style={{ fontWeight: 400, color: '#6B6963', marginLeft: 6, fontSize: 12 }}>(optional)</span>
            </label>
            <textarea id="additional-comment" rows={3} className="form-input" placeholder="Enter any additional remarks or observations..."
              value={additionalComment} onChange={(e) => setAdditionalComment(e.target.value)}
              style={{ resize: 'vertical', minHeight: 72, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }} />
            <div style={{ marginTop: 12 }}>
              <label className="form-label" style={{ fontSize: 11 }}>Evidence Image <span style={{ color: '#9C9A92' }}>(Optional)</span></label>
              <EvidenceImagePicker
                image={additionalEvidenceImage}
                onChange={setAdditionalEvidenceImage}
                onRemove={() => setAdditionalEvidenceImage(undefined)}
              />
            </div>
          </div>

          <div className="btn-row">
            <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setStep('details')}>Back</button>
            <button className="btn-primary" style={{ flex: 1 }} onClick={handlePreview}>Preview & Submit</button>
          </div>
        </div>
      )}

      <style>{`
        @media(min-width:640px){
          #checklist-mobile { display: none !important; }
          #checklist-desktop { display: block !important; }
        }
      `}</style>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 500,
  color: '#6B6963',
  textTransform: 'uppercase',
  letterSpacing: '0.4px',
  whiteSpace: 'nowrap',
};
