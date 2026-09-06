import { useState, useMemo, useEffect, useRef } from 'react';
import { useIdMaps } from '../lib/idMaps';
import { useStore, Record, ChecklistResponse, isAdmin } from '../store';
import { generatePDF, formatDateTime } from '../pdfUtils';
import { fetchRecordsPage, fetchRecordChecklist, RecordsFilter } from '../lib/sync';
import { fuelReasonLabel } from '../lib/fuelAnalysis';
import { createEvidenceSignedUrl } from '../lib/evidence';

const ITEMS_PER_PAGE = 15;

function EvidenceThumbnail({ image }: { image?: ChecklistResponse['evidenceImage'] }) {
  const [src, setSrc] = useState<string | null>(image?.dataUrl ?? image?.imageUrl ?? image?.storagePath ?? null);

  useEffect(() => {
    let cancelled = false;
    const raw = image?.dataUrl ?? image?.imageUrl ?? image?.storagePath ?? null;
    setSrc(raw);
    if (raw && !raw.startsWith('data:') && !raw.startsWith('http')) {
      createEvidenceSignedUrl(raw).then((url) => {
        if (!cancelled) setSrc(url ?? null);
      });
    }
    return () => { cancelled = true; };
  }, [image]);

  if (!image || !src) {
    return <span style={{ fontSize: 12, color: '#9C9A92' }}>—</span>;
  }

  return (
    <button
      type="button"
      onClick={() => window.open(src, '_blank', 'noopener,noreferrer')}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid #D7D2C4', background: '#fff', borderRadius: 8, padding: 4, cursor: 'pointer' }}
      title="View full evidence image"
    >
      <img src={src} alt="Evidence" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6 }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: '#2563EB', whiteSpace: 'nowrap' }}>Evidence Available</span>
    </button>
  );
}

// ──────────────────────────────────────────────────
// Editable cell — works for any admin role
// ──────────────────────────────────────────────────
function EditableCell({
  value,
  canEdit,
  onSave,
  isStatus,
  isSuperAdmin,
}: {
  value: string;
  canEdit: boolean;
  onSave: (v: string) => void;
  isStatus?: boolean;
  isSuperAdmin?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!canEdit) {
    if (isStatus) {
      return (
        <span className={`pill ${value === 'OK' ? 'pill-green' : value === 'N/A' ? 'pill-gray' : 'pill-red'}`}>
          {value}
        </span>
      );
    }
    return <span style={{ color: '#6B6963' }}>{value || '—'}</span>;
  }

  if (isStatus) {
    return (
      <select
        className="form-input"
        style={{ minWidth: 110, fontSize: 12, padding: '6px 10px' }}
        value={value}
        onChange={(e) => onSave(e.target.value)}
      >
        <option value="OK">OK</option>
        <option value="NOT OK">NOT OK</option>
        <option value="N/A">N/A</option>
      </select>
    );
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input
          autoFocus
          type="text"
          className="form-input"
          style={{ fontSize: 12, padding: '5px 8px', minWidth: 120 }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { onSave(draft); setEditing(false); }
            if (e.key === 'Escape') { setDraft(value); setEditing(false); }
          }}
        />
        <button
          onClick={() => { onSave(draft); setEditing(false); }}
          style={{
            padding: '4px 8px', fontSize: 11, background: '#2563EB', color: '#fff',
            border: 'none', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
          }}
        >Save</button>
        <button
          onClick={() => { setDraft(value); setEditing(false); }}
          style={{
            padding: '4px 8px', fontSize: 11, background: '#F1EFE8', color: '#1A1A18',
            border: '0.5px solid rgba(0,0,0,0.15)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >✕</button>
      </div>
    );
  }

  const borderColor = isSuperAdmin ? 'rgba(37,99,235,0.4)' : 'rgba(16,185,129,0.4)';
  const hoverBg = isSuperAdmin ? '#EFF6FF' : '#ECFDF5';
  const hoverBorder = isSuperAdmin ? '#2563EB' : '#10B981';

  return (
    <button
      onClick={() => { setDraft(value); setEditing(true); }}
      title={isSuperAdmin ? 'Click to edit (Super Admin)' : 'Click to edit (Admin)'}
      style={{
        background: 'none', border: `0.5px dashed ${borderColor}`, borderRadius: 6,
        padding: '3px 8px', fontSize: 13, color: value ? '#1A1A18' : '#9C9A92',
        cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = hoverBg;
        (e.currentTarget as HTMLButtonElement).style.borderColor = hoverBorder;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'none';
        (e.currentTarget as HTMLButtonElement).style.borderColor = borderColor;
      }}
    >
      {value || '—'}
    </button>
  );
}

// ──────────────────────────────────────────────────
// Basic info editable row — for non-dept/section fields
// ──────────────────────────────────────────────────
function BasicInfoRow({
  label,
  value,
  canEdit,
  onSave,
  inputType = 'text',
}: {
  label: string;
  value: string;
  canEdit: boolean;
  // Only required when canEdit is true — read-only rows (canEdit={false})
  // never enter the editing branch below, so onSave is never invoked for them.
  onSave?: (v: string) => void;
  inputType?: 'text' | 'date' | 'time';
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  return (
    <div className="review-row">
      <span style={{ fontSize: 13, color: '#6B6963', flexShrink: 0 }}>{label}</span>
      {canEdit && editing ? (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
          <input
            autoFocus
            type={inputType}
            className="form-input"
            style={{ fontSize: 12, padding: '4px 8px', maxWidth: 180, textAlign: 'right' }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { onSave?.(draft); setEditing(false); }
              if (e.key === 'Escape') { setDraft(value); setEditing(false); }
            }}
          />
          <button
            onClick={() => { onSave?.(draft); setEditing(false); }}
            style={{
              padding: '4px 8px', fontSize: 11, background: '#2563EB', color: '#fff',
              border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >✓</button>
          <button
            onClick={() => { setDraft(value); setEditing(false); }}
            style={{
              padding: '4px 8px', fontSize: 11, background: '#F1EFE8', color: '#1A1A18',
              border: '0.5px solid rgba(0,0,0,0.15)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >✕</button>
        </div>
      ) : (
        <span
          style={{
            fontSize: 13, fontWeight: 500, textAlign: 'right',
            cursor: canEdit ? 'pointer' : 'default',
            borderBottom: canEdit ? '0.5px dashed rgba(16,185,129,0.5)' : 'none',
            padding: canEdit ? '1px 2px' : undefined,
          }}
          title={canEdit ? 'Click to edit' : undefined}
          onClick={() => { if (canEdit) { setDraft(value); setEditing(true); } }}
        >
          {value || '—'}
        </span>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────
// Checklist table — editable by all admins
// ──────────────────────────────────────────────────
function ChecklistTable({
  record,
  canEdit,
  isSuperAdmin,
  editorEmail,
}: {
  record: Record;
  canEdit: boolean;
  isSuperAdmin: boolean;
  editorEmail?: string;
}) {
  const updateChecklistResponse = useStore((s) => s.updateChecklistResponse);

  function save(itemId: string, field: keyof ChecklistResponse, val: string) {
    if (
      field === 'label' ||
      field === 'status' ||
      field === 'comment' ||
      field === 'actionPlan'
    ) {
      updateChecklistResponse(record.id, itemId, field, val, editorEmail, isSuperAdmin);
    }
  }

  const responses = record.checklistResponses ?? [];

  if (responses.length === 0) {
    return (
      <p style={{ fontSize: 13, color: '#9C9A92', fontStyle: 'italic' }}>
        No checklist data for this record.
      </p>
    );
  }

  return (
    <>
      {/* ── Mobile cards ── */}
      <div id="rec-detail-mobile">
        {(() => {
          let itemNum = 0;
          return responses.map((r) => {
            if (r.isSubheading) {
              return (
                <div
                  key={r.itemId}
                  style={{
                    background: '#DBEAFE', borderRadius: 10, padding: '8px 14px',
                    marginBottom: 6, marginTop: 10, border: '0.5px solid #BFDBFE',
                  }}
                >
                  <p style={{ fontSize: 13, fontWeight: 500, color: '#1E40AF' }}>{r.label}</p>
                </div>
              );
            }
            itemNum += 1;
            const num = itemNum;
            return (
              <div
                key={r.itemId}
                style={{
                  background: '#F1EFE8', borderRadius: 12, padding: '12px 14px',
                  marginBottom: 10, border: '0.5px solid rgba(0,0,0,0.10)',
                }}
              >
                <p style={{ fontSize: 13, fontWeight: 500, color: '#1A1A18', marginBottom: 8 }}>
                  {num}. {r.label}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div>
                    <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 3 }}>Status</p>
                    <EditableCell
                      value={r.status}
                      canEdit={canEdit}
                      isStatus
                      isSuperAdmin={isSuperAdmin}
                      onSave={(v) => save(r.itemId, 'status', v)}
                    />
                  </div>
                  {(r.status === 'NOT OK' || r.comment) && (
                    <div>
                      <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 3 }}>Comment</p>
                      <EditableCell
                        value={r.comment}
                        canEdit={canEdit}
                        isSuperAdmin={isSuperAdmin}
                        onSave={(v) => save(r.itemId, 'comment', v)}
                      />
                    </div>
                  )}
                  {(r.status === 'NOT OK' || r.actionPlan) && (
                    <div>
                      <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 3 }}>Action Plan</p>
                      <EditableCell
                        value={r.actionPlan}
                        canEdit={canEdit}
                        isSuperAdmin={isSuperAdmin}
                        onSave={(v) => save(r.itemId, 'actionPlan', v)}
                      />
                    </div>
                  )}
                  {r.evidenceImage && (
                    <div>
                      <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 3 }}>Evidence</p>
                      <EvidenceThumbnail image={r.evidenceImage} />
                    </div>
                  )}
                </div>
              </div>
            );
          });
        })()}
      </div>

      {/* ── Desktop table ── */}
      <div id="rec-detail-desktop" style={{ display: 'none', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto', minWidth: 680 }}>
          <thead>
            <tr style={{ background: '#F1EFE8', borderBottom: '0.5px solid rgba(0,0,0,0.15)' }}>
              {['Check', 'Status', 'Comment', 'Action Plan', 'Evidence'].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '10px 12px', textAlign: 'left', fontSize: 11,
                    fontWeight: 500, color: '#6B6963', textTransform: 'uppercase',
                    letterSpacing: '0.4px', whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(() => {
              let itemNum = 0;
              return responses.map((r) => {
                if (r.isSubheading) {
                  return (
                    <tr key={r.itemId}>
                      <td
                        colSpan={5}
                        style={{
                          padding: '8px 12px', background: '#DBEAFE', fontSize: 12,
                          fontWeight: 500, color: '#1E40AF', borderBottom: '0.5px solid #BFDBFE',
                        }}
                      >
                        {r.label}
                      </td>
                    </tr>
                  );
                }
                itemNum += 1;
                const num = itemNum;
                return (
                  <tr key={r.itemId} style={{ borderBottom: '0.5px solid rgba(0,0,0,0.08)' }}>
                    <td style={{ padding: '10px 12px', fontSize: 13 }}>
                      <span style={{ color: '#9C9A92', fontSize: 11, marginRight: 6 }}>{num}.</span>
                      {r.label}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <EditableCell
                        value={r.status}
                        canEdit={canEdit}
                        isStatus
                        isSuperAdmin={isSuperAdmin}
                        onSave={(v) => save(r.itemId, 'status', v)}
                      />
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <EditableCell
                        value={r.comment}
                        canEdit={canEdit}
                        isSuperAdmin={isSuperAdmin}
                        onSave={(v) => save(r.itemId, 'comment', v)}
                      />
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <EditableCell
                        value={r.actionPlan}
                        canEdit={canEdit}
                        isSuperAdmin={isSuperAdmin}
                        onSave={(v) => save(r.itemId, 'actionPlan', v)}
                      />
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <EvidenceThumbnail image={r.evidenceImage} />
                    </td>
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
      </div>

      <style>{`
        @media(min-width: 560px) {
          #rec-detail-mobile { display: none !important; }
          #rec-detail-desktop { display: block !important; }
        }
      `}</style>
    </>
  );
}

// ──────────────────────────────────────────────────
// Main RecordsPage
// ──────────────────────────────────────────────────
export default function RecordsPage({
  initialRefFilter,
  onRefFilterConsumed,
  analyticsContext,
  onBackToFaultAnalysis,
}: {
  initialRefFilter?:    string;
  onRefFilterConsumed?: () => void;
  /** Present when this page was reached via a Fault Analysis "View Checklist"
   *  click — used only to decide whether to show the dedicated Back to Fault
   *  Analysis button below; the actual context payload is opaque here and
   *  round-tripped by App.tsx. */
  analyticsContext?:      unknown;
  onBackToFaultAnalysis?: () => void;
}) {
  const records        = useStore((s) => s.records);
  const upsertRecords  = useStore((s) => s.upsertRecords);
  const setRecordsTotalCount = useStore((s) => s.setRecordsTotalCount);
  const setRecordChecklist   = useStore((s) => s.setRecordChecklist);
  const departments    = useStore((s) => s.departments);
  const sections       = useStore((s) => s.sections);
  const equipmentTypes = useStore((s) => s.equipmentTypes);
  const settings       = useStore((s) => s.settings);
  const currentAdmin   = useStore((s) => s.currentAdmin);
  const deleteRecord   = useStore((s) => s.deleteRecord);
  const updateRecordField = useStore((s) => s.updateRecordField);

  const adminIsSuper = currentAdmin?.isSuperAdmin === true;
  const adminCanEdit = isAdmin(currentAdmin);
  // Only super admin can delete
  const canDelete = adminIsSuper;

  const [filterDept,    setFilterDept]    = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [filterEquip,   setFilterEquip]   = useState('');
  const [filterTech,    setFilterTech]    = useState('');
  const [filterTechDrop, setFilterTechDrop] = useState('');
  const [filterDate,    setFilterDate]    = useState('');
  const [filterRef,     setFilterRef]     = useState(initialRefFilter ?? '');

  useEffect(() => {
    if (initialRefFilter) {
      setFilterRef(initialRefFilter);
      if (onRefFilterConsumed) onRefFilterConsumed();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [page, setPage] = useState(1);
  const [pageRecords, setPageRecords] = useState<Record[]>([]);
  const [pageLoading, setPageLoading] = useState(false);
  const [filteredTotal, setFilteredTotal] = useState<number>(0);

  const idMaps = useIdMaps();
  const resolvedDeptName  = filterDept    ? idMaps.deptName(filterDept)       : '';
  const resolvedSecName   = filterSection ? idMaps.sectionName(filterSection) : '';
  const resolvedEquipCode = filterEquip   ? idMaps.equipCode(filterEquip)     : '';

  useEffect(() => {
    let alive = true;
    setPageLoading(true);

    const serverFilters: RecordsFilter = {};
    if (resolvedDeptName)  serverFilters.department    = resolvedDeptName;
    if (resolvedSecName)   serverFilters.section       = resolvedSecName;
    if (resolvedEquipCode) serverFilters.equipmentCode = resolvedEquipCode;
    const tech = filterTechDrop || filterTech;
    if (tech)              serverFilters.technician    = tech;
    if (filterDate)        serverFilters.date          = filterDate;
    if (filterRef)         serverFilters.refId         = filterRef;

    fetchRecordsPage(page, ITEMS_PER_PAGE, serverFilters)
      .then((res) => {
        if (!alive) return;
        if (res) {
          setPageRecords(res.records);
          upsertRecords(res.records);
          setRecordsTotalCount(res.total);
          setFilteredTotal(res.total);
        }
      })
      .finally(() => { if (alive) setPageLoading(false); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, resolvedDeptName, resolvedSecName, resolvedEquipCode, filterTechDrop, filterTech, filterDate, filterRef]);

  // ── Keep pageRecords in sync with live Zustand store edits ───────────────
  // When an admin edits a record (field or checklist), the Zustand `records`
  // store is updated immediately, but `pageRecords` is a static Supabase
  // snapshot. This effect merges any store-side changes (editedBy, editedAt,
  // checklist edits, field edits) back into the list view so the "Edited by"
  // badge appears without requiring a full page reload.
  useEffect(() => {
    setPageRecords((prev) =>
      prev.map((r) => {
        const live = records.find((x) => x.id === r.id);
        if (!live) return r;
        // Only replace if something meaningful changed to avoid infinite loops
        if (live.editedBy !== r.editedBy || live.editedAt !== r.editedAt) {
          return { ...r, editedBy: live.editedBy, editedAt: live.editedAt };
        }
        return r;
      })
    );
  // records is the Zustand selector — runs whenever any record in the store changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records]);

  const technicianOptions = useMemo(() => {
    const names = new Set(pageRecords.map((r) => r.technicianName).filter(Boolean));
    return Array.from(names).sort();
  }, [pageRecords]);
  const [detailRecord, setDetailRecord] = useState<Record | null>(null);

  // Arriving here from Fault Analysis' "View Checklist" always targets one
  // specific record (by refId) — open its detail view directly instead of
  // making the user pick it out of the filtered list themselves.
  const autoOpenedFromAnalytics = useRef(false);
  useEffect(() => {
    if (!autoOpenedFromAnalytics.current && analyticsContext && initialRefFilter) {
      const match = pageRecords.find((r) => r.refId === initialRefFilter) ?? records.find((r) => r.refId === initialRefFilter);
      if (match) {
        setDetailRecord(match);
        autoOpenedFromAnalytics.current = true;
      }
    }
  }, [pageRecords, records, analyticsContext, initialRefFilter]);

  const liveDetailRecord = detailRecord
    ? records.find((r) => r.id === detailRecord.id) ?? detailRecord
    : null;

  const filtered = pageRecords;
  const totalPages = Math.max(1, Math.ceil(filteredTotal / ITEMS_PER_PAGE) || 1);
  const paginated = filtered;

  function clearFilters() {
    setFilterDept('');
    setFilterSection('');
    setFilterEquip('');
    setFilterTech('');
    setFilterTechDrop('');
    setFilterDate('');
    setFilterRef('');
    setPage(1);
  }

  const filteredSectionOptions = filterDept
    ? sections.filter((s) => s.departmentId === filterDept)
    : sections;

  // ── Detail view ──
  if (liveDetailRecord) {
    return (
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '20px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
          <button className="back-btn" onClick={() => setDetailRecord(null)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back to Records
          </button>
          {/* Dedicated, context-preserving return path — only shown when this
              record was opened from Fault Analysis. Deliberately distinct
              from the generic "Back to Records" above: this one returns the
              user to the exact Analytics/Fault Analysis state (filters, tab,
              selected date/equipment/checklist item) they came from, rather
              than the plain records list. */}
          {!!analyticsContext && onBackToFaultAnalysis && (
            <button className="back-btn" onClick={onBackToFaultAnalysis}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m15 18-6-6 6-6" />
              </svg>
              Back to Fault Analysis
            </button>
          )}
        </div>

        <div className="card">
          {/* ── Branded checklist logo banner ── */}
          {settings.checklistLogoUrl && (
            <div className="checklist-logo-banner">
              <img
                src={settings.checklistLogoUrl}
                alt="Company logo"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="checklist-logo-banner-divider">
                <p className="checklist-logo-banner-title">DAILY CHECKING REPORT</p>
                <p className="checklist-logo-banner-ref">Ref: {liveDetailRecord.refId}</p>
              </div>
            </div>
          )}

          {/* Header row */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: 16,
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 500 }}>Record Detail</h2>
              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 12,
                    background: '#EFF6FF',
                    color: '#1D4ED8',
                    padding: '4px 12px',
                    borderRadius: 20,
                    fontWeight: 500,
                    fontFamily: 'monospace',
                  }}
                >
                  {liveDetailRecord.refId}
                </span>
                {/* Edit attribution badge — shown only when edited by non-super-admin */}
                {liveDetailRecord.editedBy && (
                  <span
                    style={{
                      fontSize: 11,
                      background: '#FEF9C3',
                      color: '#854D0E',
                      padding: '3px 10px',
                      borderRadius: 20,
                      border: '0.5px solid #FDE68A',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    Edited by {liveDetailRecord.editedBy}
                    {liveDetailRecord.editedAt && (
                      <span style={{ opacity: 0.7 }}>
                        · {formatDateTime(liveDetailRecord.editedAt)}
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn-secondary"
                onClick={() => { void generatePDF(liveDetailRecord, settings.checklistLogoUrl); }}
              >
                Download PDF
              </button>
              {/* Delete — Super Admin only */}
              {canDelete && (
                <button
                  className="btn-danger"
                  onClick={() => {
                    if (confirm('Delete this record? This cannot be undone. Only Super Admins can perform this action.')) {
                      deleteRecord(liveDetailRecord.id, currentAdmin!.email);
                      setDetailRecord(null);
                    }
                  }}
                >
                  Delete Record
                </button>
              )}
            </div>
          </div>


          {/* Basic Information */}
          <div style={{ marginBottom: 20 }}>
            <h3
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: '#6B6963',
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
              }}
            >
              Basic Information
            </h3>

            {/* Department — read-only for all */}
            <div className="review-row">
              <span style={{ fontSize: 13, color: '#6B6963', flexShrink: 0 }}>Department</span>
              <span style={{ fontSize: 13, fontWeight: 500, textAlign: 'right' }}>
                {liveDetailRecord.departmentName}
              </span>
            </div>

            {/* Section — read-only for all */}
            <div className="review-row">
              <span style={{ fontSize: 13, color: '#6B6963', flexShrink: 0 }}>Section</span>
              <span style={{ fontSize: 13, fontWeight: 500, textAlign: 'right' }}>
                {liveDetailRecord.sectionName}
              </span>
            </div>

            <BasicInfoRow
              label="Equipment Type"
              value={`${liveDetailRecord.equipmentTypeName} (${liveDetailRecord.equipmentTypeCode})`}
              canEdit={adminIsSuper} // only super admin can edit equipment type display
              onSave={(v) => {
                // parse "Name (Code)" format
                const match = v.match(/^(.*)\(([^)]+)\)$/);
                if (match) {
                  updateRecordField(liveDetailRecord.id, 'equipmentTypeName', match[1].trim(), currentAdmin?.email, adminIsSuper);
                  updateRecordField(liveDetailRecord.id, 'equipmentTypeCode', match[2].trim(), currentAdmin?.email, adminIsSuper);
                }
              }}
            />

            <BasicInfoRow
              label="Equipment No."
              value={liveDetailRecord.equipmentNumber || ''}
              canEdit={adminCanEdit}
              onSave={(v) => updateRecordField(liveDetailRecord.id, 'equipmentNumber', v, currentAdmin?.email, adminIsSuper)}
            />

            <BasicInfoRow
              label="Date"
              value={liveDetailRecord.date}
              canEdit={adminCanEdit}
              inputType="date"
              onSave={(v) => updateRecordField(liveDetailRecord.id, 'date', v, currentAdmin?.email, adminIsSuper)}
            />

            <BasicInfoRow
              label="Start Time"
              value={liveDetailRecord.startTime}
              canEdit={adminCanEdit}
              inputType="time"
              onSave={(v) => updateRecordField(liveDetailRecord.id, 'startTime', v, currentAdmin?.email, adminIsSuper)}
            />

            <BasicInfoRow
              label="Completion Time"
              value={liveDetailRecord.completionTime}
              canEdit={adminCanEdit}
              inputType="time"
              onSave={(v) => updateRecordField(liveDetailRecord.id, 'completionTime', v, currentAdmin?.email, adminIsSuper)}
            />

            <BasicInfoRow
              label="Hour Meter Reading"
              value={liveDetailRecord.hourMeterReading}
              canEdit={adminCanEdit}
              onSave={(v) => updateRecordField(liveDetailRecord.id, 'hourMeterReading', v, currentAdmin?.email, adminIsSuper)}
            />

            {liveDetailRecord.fuelCanDetermine === 'yes' && liveDetailRecord.fuelLevel !== '' && (
              <BasicInfoRow
                label="Fuel Level"
                value={`${liveDetailRecord.fuelLevel}%`}
                canEdit={false}
              />
            )}
            {liveDetailRecord.fuelCanDetermine === 'no' && (
              <BasicInfoRow
                label="Fuel Level"
                value={`Cannot determine - ${fuelReasonLabel(liveDetailRecord.fuelUndeterminedReason)}`}
                canEdit={false}
              />
            )}

            <BasicInfoRow
              label="Technician Name"
              value={liveDetailRecord.technicianName}
              canEdit={adminCanEdit}
              onSave={(v) => updateRecordField(liveDetailRecord.id, 'technicianName', v, currentAdmin?.email, adminIsSuper)}
            />

            <BasicInfoRow
              label="Supervisor Name"
              value={liveDetailRecord.supervisorName}
              canEdit={adminCanEdit}
              onSave={(v) => updateRecordField(liveDetailRecord.id, 'supervisorName', v, currentAdmin?.email, adminIsSuper)}
            />

            <BasicInfoRow
              label="QC Verifier"
              value={liveDetailRecord.qcVerifierName || ''}
              canEdit={adminCanEdit}
              onSave={(v) => updateRecordField(liveDetailRecord.id, 'qcVerifierName', v, currentAdmin?.email, adminIsSuper)}
            />

            <div className="review-row">
              <span style={{ fontSize: 13, color: '#6B6963', flexShrink: 0 }}>Submitted At</span>
              <span style={{ fontSize: 13, fontWeight: 500, textAlign: 'right' }}>
                {formatDateTime(liveDetailRecord.submittedAt)}
              </span>
            </div>
          </div>

          {/* Checklist */}
          <div>
            <h3
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: '#6B6963',
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
              }}
            >
              Checklist Results
            </h3>
            <ChecklistTable
              record={liveDetailRecord}
              canEdit={adminCanEdit}
              isSuperAdmin={adminIsSuper}
              editorEmail={currentAdmin?.email}
            />
          </div>

          {/* Urgent Attention Assessment */}
          <div style={{ marginTop: 16 }}>
            <h3
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: '#6B6963',
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
              }}
            >
              Urgent Attention
            </h3>
            <div
              style={{
                background: liveDetailRecord.requiresUrgentAttention ? '#FFF1F1' : '#F1EFE8',
                border: `0.5px solid ${liveDetailRecord.requiresUrgentAttention ? '#FCA5A5' : 'rgba(0,0,0,0.10)'}`,
                borderRadius: 10,
                padding: '12px 14px',
              }}
            >
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: liveDetailRecord.requiresUrgentAttention ? '#B91C1C' : '#166534',
                  margin: 0,
                }}
              >
                {liveDetailRecord.requiresUrgentAttention
                  ? 'YES — Urgent Attention Required'
                  : 'NO — No Urgent Attention Required'}
              </p>
              {liveDetailRecord.requiresUrgentAttention && liveDetailRecord.urgentAttentionReason && (
                <>
                  <p style={{ fontSize: 12, fontWeight: 500, color: '#6B6963', marginTop: 8, marginBottom: 2 }}>
                    Reason for Urgent Attention
                  </p>
                  <p style={{ fontSize: 13, color: '#3A3935', lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 }}>
                    {liveDetailRecord.urgentAttentionReason}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Additional Comment */}
          <div style={{ marginTop: 16 }}>
            <h3
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: '#6B6963',
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
              }}
            >
              Additional Comments
            </h3>
            {adminCanEdit ? (
              <AdditionalCommentEditor
                value={liveDetailRecord.additionalComment ?? ''}
                canEdit={adminCanEdit}
                onSave={(v) => updateRecordField(liveDetailRecord.id, 'additionalComment', v, currentAdmin?.email, adminIsSuper)}
              />
            ) : liveDetailRecord.additionalComment ? (
              <div
                style={{
                  background: '#F1EFE8',
                  borderRadius: 10,
                  padding: '12px 14px',
                  border: '0.5px solid rgba(0,0,0,0.10)',
                  fontSize: 13,
                  color: '#3A3935',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {liveDetailRecord.additionalComment}
              </div>
            ) : (
              <span style={{ fontSize: 13, color: '#9C9A92' }}>—</span>
            )}
            {liveDetailRecord.additionalEvidenceImage && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 4 }}>Evidence Image</p>
                <EvidenceThumbnail image={liveDetailRecord.additionalEvidenceImage} />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── List view ──
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 16px' }}>
      <div className="page-header">
        <h2 style={{ fontSize: 20, fontWeight: 500 }}>Records</h2>
        <span style={{ fontSize: 13, color: '#6B6963' }}>
          {filteredTotal} record{filteredTotal !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#6B6963' }}>Filters</span>
        </div>
        <div className="filter-grid" id="records-filter-grid">
          <div>
            <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 4 }}>Department</p>
            <select
              className="form-input"
              style={{ fontSize: 12 }}
              value={filterDept}
              onChange={(e) => { setFilterDept(e.target.value); setFilterSection(''); setPage(1); }}
            >
              <option value="">All</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 4 }}>Section</p>
            <select
              className="form-input"
              style={{ fontSize: 12 }}
              value={filterSection}
              onChange={(e) => { setFilterSection(e.target.value); setPage(1); }}
            >
              <option value="">All</option>
              {filteredSectionOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 4 }}>Equipment Type</p>
            <select
              className="form-input"
              style={{ fontSize: 12 }}
              value={filterEquip}
              onChange={(e) => { setFilterEquip(e.target.value); setPage(1); }}
            >
              <option value="">All</option>
              {equipmentTypes.map((eq) => (
                <option key={eq.id} value={eq.id}>{eq.name} ({eq.code})</option>
              ))}
            </select>
          </div>
          <div>
            <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 4 }}>Technician</p>
            <select
              className="form-input"
              style={{ fontSize: 12 }}
              value={filterTechDrop}
              onChange={(e) => { setFilterTechDrop(e.target.value); setFilterTech(''); setPage(1); }}
            >
              <option value="">All</option>
              {technicianOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div>
            <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 4 }}>Date</p>
            <input
              type="date"
              className="form-input"
              style={{ fontSize: 12 }}
              value={filterDate}
              onChange={(e) => { setFilterDate(e.target.value); setPage(1); }}
            />
          </div>
          <div>
            <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 4 }}>Reference ID</p>
            <input
              type="text"
              className="form-input"
              style={{ fontSize: 12 }}
              placeholder="Search ref..."
              value={filterRef}
              onChange={(e) => { setFilterRef(e.target.value); setPage(1); }}
            />
          </div>
        </div>
        <button className="btn-link-blue" style={{ marginTop: 10 }} onClick={clearFilters}>
          Clear all filters
        </button>
      </div>

      {paginated.length === 0 ? (
        <div className="empty-state">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#9C9A92"
            strokeWidth="1.5"
            style={{ margin: '0 auto 12px', display: 'block' }}
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <p style={{ color: '#6B6963', fontSize: 14, marginBottom: 12 }}>No records found</p>
          <p style={{ fontSize: 13, color: '#9C9A92' }}>
            {pageRecords.length === 0 && !pageLoading
              ? 'Submit your first daily check to see records here.'
              : 'Try adjusting your filters.'}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="table-wrapper" id="records-desktop-table" style={{ display: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>Ref ID</th>
                  <th>Date</th>
                  <th>Equipment</th>
                  <th>Eq. No.</th>
                  <th>Section</th>
                  <th>Technician</th>
                  <th>Supervisor</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((r) => (
                  <tr key={r.id}>
                    <td className="ref-id">
                      {r.refId}
                      {/* Edited indicator in list */}
                      {r.editedBy && (
                        <span
                          title={`Edited by ${r.editedBy}`}
                          style={{
                            display: 'inline-block',
                            marginLeft: 4,
                            fontSize: 10,
                            background: '#FEF9C3',
                            color: '#854D0E',
                            padding: '1px 5px',
                            borderRadius: 8,
                            border: '0.5px solid #FDE68A',
                          }}
                        >
                          edited
                        </span>
                      )}
                    </td>
                    <td style={{ color: '#6B6963' }}>{r.date}</td>
                    <td>
                      <span className="pill pill-blue">{r.equipmentTypeCode}</span>{' '}
                      <span style={{ fontSize: 12, color: '#6B6963' }}>{r.equipmentTypeName}</span>
                    </td>
                    <td style={{ fontSize: 12, color: '#6B6963', fontFamily: 'monospace' }}>
                      {r.equipmentNumber || '—'}
                    </td>
                    <td>{r.sectionName}</td>
                    <td>{r.technicianName}</td>
                    <td style={{ color: '#6B6963' }}>{r.supervisorName}</td>
                    <td>
                      <button
                        className="btn-link-blue"
                        onClick={async () => {
                          setDetailRecord(r);
                          const fromStore = useStore.getState().records.find((x) => x.id === r.id);
                          const hasChecklist = !!fromStore && Array.isArray(fromStore.checklistResponses) && fromStore.checklistResponses.length > 0;
                          const hasComment = fromStore?.additionalComment !== undefined;
                          if (!hasChecklist || !hasComment) {
                            const result = await fetchRecordChecklist(r.id);
                            if (result) setRecordChecklist(r.id, result.checklist, result.additionalComment, result.additionalEvidenceImage);
                          }
                        }}
                      >
                        View
                      </button>
                      <button
                        className="btn-link-blue"
                        onClick={async () => {
                          const fromStore2 = useStore.getState().records.find((x) => x.id === r.id);
                          const hasChecklist2 = !!fromStore2 && Array.isArray(fromStore2.checklistResponses) && fromStore2.checklistResponses.length > 0;
                          if (!hasChecklist2) {
                            const result = await fetchRecordChecklist(r.id);
                            if (result) {
                              setRecordChecklist(r.id, result.checklist, result.additionalComment, result.additionalEvidenceImage);
                              const updated = useStore.getState().records.find((x) => x.id === r.id);
                              void generatePDF(updated ?? r, settings.checklistLogoUrl);
                              return;
                            }
                          }
                          void generatePDF(fromStore2 ?? r, settings.checklistLogoUrl);
                        }}
                      >
                        PDF
                      </button>
                      {/* Delete — Super Admin only */}
                      {canDelete && (
                        <button
                          className="btn-link-red"
                          onClick={() => {
                            if (confirm('Delete this record? Only Super Admins can delete records.')) {
                              deleteRecord(r.id, currentAdmin!.email);
                            }
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div id="records-mobile-cards">
            {paginated.map((r) => (
              <div key={r.id} className="card-sm">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: 11, color: '#9C9A92' }}>
                    {r.date} · {formatDateTime(r.submittedAt)}
                  </span>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {r.editedBy && (
                      <span
                        title={`Edited by ${r.editedBy}`}
                        style={{
                          fontSize: 10,
                          background: '#FEF9C3',
                          color: '#854D0E',
                          padding: '1px 5px',
                          borderRadius: 8,
                          border: '0.5px solid #FDE68A',
                        }}
                      >
                        edited
                      </span>
                    )}
                    <span className="pill pill-blue">{r.equipmentTypeCode}</span>
                  </div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>
                  {r.equipmentTypeName}
                  {r.equipmentNumber && (
                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: 'monospace',
                        color: '#3B82F6',
                        marginLeft: 6,
                      }}
                    >
                      #{r.equipmentNumber}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#6B6963', marginBottom: 2 }}>
                  {r.technicianName} — {r.sectionName}
                </div>
                <div style={{ fontSize: 11, color: '#9C9A92', marginBottom: 4 }}>
                  {r.departmentName}
                </div>
                <div style={{ fontSize: 11, color: '#3B82F6', fontFamily: 'monospace', marginBottom: 4 }}>
                  {r.refId}
                </div>
                <div
                  style={{
                    borderTop: '0.5px solid rgba(0,0,0,0.10)',
                    marginTop: 10,
                    paddingTop: 10,
                    display: 'flex',
                    gap: 6,
                    flexWrap: 'wrap',
                  }}
                >
                  <button
                    style={{
                      flex: 1,
                      minWidth: 60,
                      padding: 7,
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: 'pointer',
                      background: '#EFF6FF',
                      color: '#1D4ED8',
                      transition: 'background 0.15s',
                      fontFamily: 'inherit',
                    }}
                    onClick={async () => {
                      setDetailRecord(r);
                      const fromStore = useStore.getState().records.find((x) => x.id === r.id);
                      const hasChecklist = !!fromStore && Array.isArray(fromStore.checklistResponses) && fromStore.checklistResponses.length > 0;
                      const hasComment = fromStore?.additionalComment !== undefined;
                      if (!hasChecklist || !hasComment) {
                        const result = await fetchRecordChecklist(r.id);
                        if (result) setRecordChecklist(r.id, result.checklist, result.additionalComment, result.additionalEvidenceImage);
                      }
                    }}
                  >
                    View
                  </button>
                  <button
                    style={{
                      flex: 1,
                      minWidth: 60,
                      padding: 7,
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: 'pointer',
                      background: '#F1EFE8',
                      color: '#1A1A18',
                      transition: 'background 0.15s',
                      fontFamily: 'inherit',
                    }}
                    onClick={async () => {
                      const fromStore2 = useStore.getState().records.find((x) => x.id === r.id);
                      const hasChecklist2 = !!fromStore2 && Array.isArray(fromStore2.checklistResponses) && fromStore2.checklistResponses.length > 0;
                      if (!hasChecklist2) {
                        const result = await fetchRecordChecklist(r.id);
                        if (result) {
                          setRecordChecklist(r.id, result.checklist, result.additionalComment, result.additionalEvidenceImage);
                          const updated = useStore.getState().records.find((x) => x.id === r.id);
                          void generatePDF(updated ?? r, settings.checklistLogoUrl);
                          return;
                        }
                      }
                      void generatePDF(fromStore2 ?? r, settings.checklistLogoUrl);
                    }}
                  >
                    PDF
                  </button>
                  {/* Delete — Super Admin only */}
                  {canDelete && (
                    <button
                      style={{
                        flex: 1,
                        minWidth: 60,
                        padding: 7,
                        border: 'none',
                        borderRadius: 8,
                        fontSize: 11,
                        fontWeight: 500,
                        cursor: 'pointer',
                        background: '#FEF2F2',
                        color: '#DC2626',
                        transition: 'background 0.15s',
                        fontFamily: 'inherit',
                      }}
                      onClick={() => {
                        if (confirm('Delete this record? Only Super Admins can delete records.')) {
                          deleteRecord(r.id, currentAdmin!.email);
                        }
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 8,
                marginTop: 16,
                flexWrap: 'wrap',
              }}
            >
              <button
                className="btn-secondary"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                style={{ padding: '8px 16px', opacity: page === 1 ? 0.4 : 1 }}
              >
                ← Prev
              </button>
              <span style={{ fontSize: 13, color: '#6B6963', padding: '0 8px' }}>
                Page {page} of {totalPages}
              </span>
              <button
                className="btn-secondary"
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
                style={{ padding: '8px 16px', opacity: page === totalPages ? 0.4 : 1 }}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      <style>{`
        .filter-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }
        @media(min-width: 640px) {
          #records-desktop-table { display: block !important; }
          #records-mobile-cards { display: none; }
          .filter-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
        @media(min-width: 960px) {
          .filter-grid { grid-template-columns: repeat(6, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}

// ──────────────────────────────────────────────────
// Additional comment editor with textarea
// ──────────────────────────────────────────────────
function AdditionalCommentEditor({
  value,
  canEdit,
  onSave,
}: {
  value: string;
  canEdit: boolean;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!canEdit) {
    return value ? (
      <div
        style={{
          background: '#F1EFE8',
          borderRadius: 10,
          padding: '12px 14px',
          border: '0.5px solid rgba(0,0,0,0.10)',
          fontSize: 13,
          color: '#3A3935',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
        }}
      >
        {value}
      </div>
    ) : <span style={{ fontSize: 13, color: '#9C9A92' }}>—</span>;
  }

  if (editing) {
    return (
      <div>
        <textarea
          autoFocus
          className="form-input"
          style={{ width: '100%', minHeight: 80, fontSize: 13, resize: 'vertical' }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button
            onClick={() => { onSave(draft); setEditing(false); }}
            style={{
              padding: '6px 14px', fontSize: 12, background: '#2563EB', color: '#fff',
              border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >Save</button>
          <button
            onClick={() => { setDraft(value); setEditing(false); }}
            style={{
              padding: '6px 14px', fontSize: 12, background: '#F1EFE8', color: '#1A1A18',
              border: '0.5px solid rgba(0,0,0,0.15)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => { setDraft(value); setEditing(true); }}
      style={{
        background: '#F1EFE8',
        borderRadius: 10,
        padding: '12px 14px',
        border: '0.5px dashed rgba(16,185,129,0.5)',
        fontSize: 13,
        color: value ? '#3A3935' : '#9C9A92',
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        cursor: 'pointer',
        minHeight: 40,
      }}
      title="Click to edit"
    >
      {value || 'Click to add a comment…'}
    </div>
  );
}
