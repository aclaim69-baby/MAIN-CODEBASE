/**
 * FaultAnalysisPanel.tsx
 *
 * Fault Trend Analysis — hierarchical Section → Equipment Type → Equipment Number view.
 *
 * Extracted unchanged from the original standalone AnalysisPage so this
 * component (design tokens, evidence thumbnails, section/type drill-down,
 * detail drawer, its own View By / Time Frame / Refresh controls) can be
 * embedded as the "Detailed Fault Analysis" block at the bottom of the new
 * Analytics Overview (see AnalysisPage.tsx) without reinventing it. It also
 * still works as-is if rendered on its own.
 *
 * The only additions vs. the original are the optional equipmentTypeFilter /
 * equipmentFilter props below, which prune the already-fetched section/type
 * trees client-side via filterSections/filterTrends (lib/faultAnalysis.ts) so
 * this panel stays in sync with Analytics' global Equipment Type / Equipment
 * filters without a second network request or a second query implementation.
 *
 * Navigation tree (Section view)
 * ────────────────────────────────────────────────────────────────
 *  Section accordion   (click to expand)
 *  └─ Equipment Type row  (fault count badge + "view" button)
 *     └─ Detail panel (slide-in drawer / bottom-sheet on mobile)
 *        └─ Equipment Number card  (one card per physical unit)
 *           └─ Checklist Submission card  (one per record/refId)
 *              ├─ Fault items listed   (label · comment · action plan)
 *              └─ "View Checklist →" button  (deep-links to Records page)
 *
 * Time frames: Today | Last 7 Days | Last 30 Days | Custom Date Range
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useStore } from '../store';
import {
  fetchFaultsBySection,
  fetchFaultsByType,
  invalidateFaultCache,
  formatTimeFrameLabel,
  formatRelativeTime,
  formatDateTime,
  todayString,
  daysAgoString,
  filterSections,
  filterTrends,
  type TimeFrame,
  type DateRange,
  type SectionFaultResult,
  type SectionGroup,
  type EquipmentTypeGroup,
  type EquipmentNumberGroup,
  type RecordGroup,
  type FaultTrendResult,
  type TrendItem,
  type FaultOccurrence,
} from '../lib/faultAnalysis';
import { createEvidenceSignedUrl } from '../lib/evidence';

type ViewMode = 'section' | 'faultType';

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg:          '#F3F2EC',
  card:        '#FFFFFF',
  border:      'rgba(0,0,0,0.10)',
  borderLight: 'rgba(0,0,0,0.06)',
  text:        '#1A1A18',
  muted:       '#6B6963',
  subtle:      '#9C9A92',
  hover:       '#FAFAF8',
  chipBg:      '#F1EFE8',
  blue:        '#2563EB',
  blueLight:   '#EFF6FF',
  sectionBg:   '#F8F7F3',
  unitBg:      '#F5F4EF',
  faultRed:    '#FEF2F2',
  faultRedBorder: 'rgba(239,68,68,0.15)',
};

// ─── Severity badge ───────────────────────────────────────────────────────────

function CountBadge({ count, small }: { count: number; small?: boolean }) {
  let bg = C.chipBg, color = C.muted;
  if (count >= 10) { bg = '#FEE2E2'; color = '#991B1B'; }
  else if (count >= 5)  { bg = '#FEF3C7'; color = '#92400E'; }
  else if (count >= 2)  { bg = '#FFF7ED'; color = '#B45309'; }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: small ? '2px 8px' : '3px 10px',
      borderRadius: 20, fontSize: small ? 11 : 12, fontWeight: 600,
      background: bg, color, whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {count} {count === 1 ? 'fault' : 'faults'}
    </span>
  );
}

// ─── Evidence thumbnail (signed URL resolved lazily) ──────────────────────────

function EvidenceThumb({ image }: { image?: FaultOccurrence['evidenceImage'] }) {
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

  if (!image || !src) return null;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); window.open(src, '_blank', 'noopener,noreferrer'); }}
      style={{ marginLeft: 13, marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 7, border: `1px solid ${C.border}`, background: '#fff', borderRadius: 8, padding: 4, cursor: 'pointer' }}
      title="View evidence image"
    >
      <img src={src} alt="Evidence" style={{ width: 38, height: 38, objectFit: 'cover', borderRadius: 6 }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: C.blue }}>Evidence Available</span>
    </button>
  );
}

// ─── Individual fault item inside a submission card ───────────────────────────

function FaultItem({ occ }: { occ: FaultOccurrence }) {
  return (
    <div style={{
      padding: '10px 0',
      borderBottom: `0.5px solid ${C.borderLight}`,
    }}>
      {/* Fault label */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 7, marginBottom: 6,
      }}>
        <span style={{
          marginTop: 2, flexShrink: 0,
          width: 6, height: 6, borderRadius: '50%',
          background: '#EF4444', display: 'inline-block',
        }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.35 }}>
          {occ.faultType}
        </span>
      </div>

      {/* Comment */}
      {occ.comment && (
        <div style={{ display: 'flex', gap: 7, marginBottom: 4, paddingLeft: 13 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.subtle}
            strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <div style={{ minWidth: 0 }}>
            <span style={{ fontSize: 11, color: C.subtle, fontWeight: 500 }}>Comment: </span>
            <span style={{ fontSize: 12, color: C.text, lineHeight: 1.4 }}>{occ.comment}</span>
          </div>
        </div>
      )}

      {/* Action plan */}
      {occ.actionPlan && (
        <div style={{ display: 'flex', gap: 7, paddingLeft: 13 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.subtle}
            strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          <div style={{ minWidth: 0 }}>
            <span style={{ fontSize: 11, color: C.subtle, fontWeight: 500 }}>Action Plan: </span>
            <span style={{ fontSize: 12, color: C.text, lineHeight: 1.4 }}>{occ.actionPlan}</span>
          </div>
        </div>
      )}

      {!occ.comment && !occ.actionPlan && (
        <div style={{ paddingLeft: 13 }}>
          <span style={{ fontSize: 11, color: C.subtle, fontStyle: 'italic' }}>
            No comment or action plan recorded
          </span>
        </div>
      )}
      <EvidenceThumb image={occ.evidenceImage} />
    </div>
  );
}

// ─── Checklist submission card ────────────────────────────────────────────────

function SubmissionCard({
  rec,
  onViewChecklist,
}: {
  rec:             RecordGroup;
  onViewChecklist: (refId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{
      background: C.card,
      borderRadius: 10,
      border: `0.5px solid ${C.border}`,
      marginBottom: 8,
      overflow: 'hidden',
    }}>
      {/* Submission header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        background: expanded ? '#FAFAF8' : C.card,
        borderBottom: expanded ? `0.5px solid ${C.borderLight}` : 'none',
        cursor: 'pointer',
        userSelect: 'none',
      }}
        onClick={() => setExpanded((p) => !p)}
      >
        {/* Clipboard icon */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke={C.muted} strokeWidth="2" style={{ flexShrink: 0 }}>
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
        </svg>

        {/* Ref + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
            {rec.refId || `Record ${rec.recordId.slice(0, 6)}`}
          </div>
          <div style={{
            fontSize: 11, color: C.subtle, marginTop: 1,
            display: 'flex', flexWrap: 'wrap', gap: '2px 10px',
          }}>
            <span><b style={{ fontWeight: 500 }}>Date:</b> {rec.date || formatDateTime(rec.submittedAt)}</span>
            <span><b style={{ fontWeight: 500 }}>By:</b> {rec.technician || '—'}</span>
            {rec.completionTime && (
              <span><b style={{ fontWeight: 500 }}>Completed:</b> {rec.completionTime}</span>
            )}
          </div>
        </div>

        {/* Fault count badge */}
        <CountBadge count={rec.faults.length} small />

        {/* View Checklist button */}
        <button
          onClick={(e) => { e.stopPropagation(); onViewChecklist(rec.refId); }}
          title={`Open checklist ${rec.refId} in Records`}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 10px', flexShrink: 0,
            background: C.blueLight,
            border: `0.5px solid rgba(37,99,235,0.25)`,
            borderRadius: 8, fontSize: 11, fontWeight: 600,
            color: C.blue, cursor: 'pointer',
            fontFamily: 'inherit', touchAction: 'manipulation',
            transition: 'background 0.1s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#DBEAFE'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = C.blueLight; }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          View Checklist
        </button>

        {/* Expand chevron */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke={C.subtle} strokeWidth="2" style={{
            flexShrink: 0,
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.18s',
          }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Fault items */}
      {expanded && (
        <div style={{ padding: '4px 14px 4px 14px' }}>
          {rec.faults.map((occ, i) => (
            <FaultItem key={`${occ.recordId}-${i}`} occ={occ} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Equipment Number card ────────────────────────────────────────────────────

function EquipmentNumberCard({
  unit,
  onViewChecklist,
}: {
  unit:            EquipmentNumberGroup;
  onViewChecklist: (refId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{
      marginBottom: 14,
      borderRadius: 12,
      border: `0.5px solid ${C.border}`,
      overflow: 'hidden',
      background: C.unitBg,
    }}>
      {/* Unit header */}
      <div
        onClick={() => setCollapsed((p) => !p)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 14px',
          cursor: 'pointer', userSelect: 'none',
          borderBottom: collapsed ? 'none' : `0.5px solid ${C.border}`,
          background: C.unitBg,
        }}
      >
        {/* Wrench/unit icon */}
        <div style={{
          width: 28, height: 28, borderRadius: 7,
          background: '#E8E6DF',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke={C.muted} strokeWidth="2">
            <rect x="2" y="7" width="20" height="14" rx="2" />
            <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
          </svg>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
            {unit.equipmentLabel}
          </div>
          <div style={{ fontSize: 11, color: C.subtle, marginTop: 1 }}>
            {unit.records.length} {unit.records.length === 1 ? 'submission' : 'submissions'}
          </div>
        </div>

        <CountBadge count={unit.totalFaults} />

        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke={C.subtle} strokeWidth="2" style={{
            flexShrink: 0,
            transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
            transition: 'transform 0.18s',
          }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Submissions */}
      {!collapsed && (
        <div style={{ padding: '10px 12px' }}>
          {unit.records.map((rec) => (
            <SubmissionCard
              key={rec.recordId}
              rec={rec}
              onViewChecklist={onViewChecklist}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

interface PanelData {
  title:            string;
  subtitle:         string;
  totalFaults:      number;
  equipmentNumbers: EquipmentNumberGroup[];
  // For "By Fault Type" panel which keeps the old flat layout
  flatOccurrences?: FaultOccurrence[];
}

function DetailPanel({
  data,
  onClose,
  onViewChecklist,
}: {
  data:            PanelData;
  onClose:         () => void;
  onViewChecklist: (refId: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const isFlat   = !!data.flatOccurrences;

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Unique equipment units (for summary line)
  const unitCount = data.equipmentNumbers.length;

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.38)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        zIndex: 100,
      }} />

      <div ref={panelRef} className="analysis-detail-panel" style={{
        position: 'fixed', zIndex: 101,
        background: C.bg,
        boxShadow: '-4px 0 32px rgba(0,0,0,0.14)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
        top: 0, right: 0, bottom: 0,
        width: 'min(480px, 100vw)',
        borderRadius: '16px 0 0 16px',
      }}>
        {/* ── Sticky header ── */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 1,
          background: C.card,
          borderBottom: `0.5px solid ${C.border}`,
          padding: '16px 16px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 17, fontWeight: 700, color: C.text,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }} title={data.title}>
                {data.title}
              </div>
              <div style={{ fontSize: 12, color: C.subtle, marginTop: 2 }}>{data.subtitle}</div>
            </div>
            <button onClick={onClose} style={{
              background: C.chipBg, border: 'none', borderRadius: 8,
              width: 32, height: 32, display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
              color: C.muted, touchAction: 'manipulation',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Summary strip */}
          <div style={{
            marginTop: 10, display: 'flex', alignItems: 'center',
            flexWrap: 'wrap', gap: '6px 12px',
          }}>
            <CountBadge count={data.totalFaults} />
            {!isFlat && (
              <span style={{ fontSize: 12, color: C.subtle }}>
                across <b style={{ color: C.muted }}>{unitCount}</b>{' '}
                {unitCount === 1 ? 'unit' : 'units'}
              </span>
            )}
            {isFlat && (
              <span style={{ fontSize: 12, color: C.subtle }}>
                {data.flatOccurrences!.length}{' '}
                {data.flatOccurrences!.length === 1 ? 'record' : 'records'}
              </span>
            )}
          </div>

          {/* Legend (section view only) */}
          {!isFlat && (
            <div style={{
              marginTop: 10, padding: '8px 10px',
              background: C.blueLight, borderRadius: 8,
              fontSize: 11, color: '#1D4ED8',
              border: `0.5px solid rgba(37,99,235,0.18)`,
              display: 'flex', alignItems: 'flex-start', gap: 6,
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              Faults are grouped by equipment unit and checklist submission.
              Click <b>"View Checklist"</b> to open the original record.
            </div>
          )}
        </div>

        {/* ── Body ── */}
        <div style={{ padding: '14px 14px 24px', flex: 1 }}>
          {data.totalFaults === 0 && (
            <div style={{ textAlign: 'center', color: C.subtle, padding: '32px 0', fontSize: 13 }}>
              No fault records found.
            </div>
          )}

          {/* Equipment Number cards (Section view) */}
          {!isFlat && data.equipmentNumbers.map((unit) => (
            <EquipmentNumberCard
              key={unit.equipmentLabel}
              unit={unit}
              onViewChecklist={onViewChecklist}
            />
          ))}

          {/* Flat occurrence list (By Fault Type view) */}
          {isFlat && data.flatOccurrences!.map((occ, i) => (
            <div key={`${occ.recordId}-${i}`} style={{
              background: C.card, borderRadius: 12,
              border: `0.5px solid ${C.border}`,
              padding: '14px 16px', marginBottom: 10,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>
                {occ.equipmentLabel}
              </div>
              <FaultItem occ={occ} />
              <div style={{
                marginTop: 8, display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', flexWrap: 'wrap', gap: 6,
              }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 12px' }}>
                  <span style={{ fontSize: 11, color: C.muted }}><b>By:</b> {occ.technician || '—'}</span>
                  <span style={{ fontSize: 11, color: C.muted }}><b>Date:</b> {formatDateTime(occ.submittedAt)}</span>
                  {occ.refId && <span style={{ fontSize: 11, color: C.muted }}><b>Ref:</b> {occ.refId}</span>}
                </div>
                {occ.refId && (
                  <button
                    onClick={() => onViewChecklist(occ.refId)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '4px 10px',
                      background: C.blueLight,
                      border: `0.5px solid rgba(37,99,235,0.25)`,
                      borderRadius: 7, fontSize: 11, fontWeight: 600,
                      color: C.blue, cursor: 'pointer',
                      fontFamily: 'inherit', touchAction: 'manipulation',
                      whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#DBEAFE'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = C.blueLight; }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.5">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    View Checklist
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 599px) {
          .analysis-detail-panel {
            top: auto !important;
            left: 0 !important; right: 0 !important; bottom: 0 !important;
            width: 100vw !important;
            max-height: 88vh !important;
            border-radius: 16px 16px 0 0 !important;
          }
        }
      `}</style>
    </>
  );
}

// ─── Equipment type row (child of a section) ──────────────────────────────────

function EquipmentTypeRow({
  group,
  onView,
}: {
  group:  EquipmentTypeGroup;
  onView: (g: EquipmentTypeGroup) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const unitCount = group.equipmentNumbers.length;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '11px 16px 11px 36px',
        borderBottom: `0.5px solid ${C.borderLight}`,
        background: hovered ? '#F5F4EF' : C.card,
        transition: 'background 0.1s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
        stroke={C.subtle} strokeWidth="1.8" style={{ flexShrink: 0 }}>
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      </svg>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: C.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {group.equipmentType}
        </div>
        <div style={{ fontSize: 11, color: C.subtle, marginTop: 1 }}>
          {unitCount} {unitCount === 1 ? 'unit' : 'units'}
        </div>
      </div>

      <CountBadge count={group.totalFaults} small />

      <button
        onClick={() => onView(group)}
        style={{
          background: 'none', border: 'none',
          padding: '4px 10px', fontSize: 12, fontWeight: 500,
          color: C.blue, cursor: 'pointer',
          borderRadius: 6, flexShrink: 0,
          fontFamily: 'inherit', touchAction: 'manipulation',
          transition: 'background 0.1s',
          display: 'flex', alignItems: 'center', gap: 4,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = C.blueLight; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
      >
        View
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}

// ─── Section accordion row ────────────────────────────────────────────────────

function SectionRow({
  section,
  isExpanded,
  onToggle,
  onViewEquipment,
}: {
  section:         SectionGroup;
  isExpanded:      boolean;
  onToggle:        () => void;
  onViewEquipment: (g: EquipmentTypeGroup, s: SectionGroup) => void;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '13px 16px',
          background: isExpanded ? '#EDF2FF' : C.sectionBg,
          border: `0.5px solid ${isExpanded ? 'rgba(37,99,235,0.20)' : C.border}`,
          borderRadius: isExpanded ? '12px 12px 0 0' : 12,
          cursor: 'pointer', textAlign: 'left',
          transition: 'background 0.15s, border-color 0.15s',
          fontFamily: 'inherit', touchAction: 'manipulation',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke={isExpanded ? C.blue : C.muted} strokeWidth="2" style={{ flexShrink: 0 }}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>

        <span style={{
          flex: 1, fontSize: 14, fontWeight: 600,
          color: isExpanded ? C.blue : C.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
        }}>
          {section.sectionName}
        </span>

        <span style={{ fontSize: 11, color: C.subtle, whiteSpace: 'nowrap', marginRight: 4 }}>
          {section.equipmentTypes.length} {section.equipmentTypes.length === 1 ? 'type' : 'types'}
        </span>

        <CountBadge count={section.totalFaults} />

        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke={isExpanded ? C.blue : C.subtle} strokeWidth="2"
          style={{
            flexShrink: 0, marginLeft: 2,
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isExpanded && (
        <div style={{
          border: `0.5px solid rgba(37,99,235,0.15)`,
          borderTop: 'none', borderRadius: '0 0 12px 12px',
          overflow: 'hidden', background: C.card,
        }}>
          {section.equipmentTypes.length === 0 ? (
            <div style={{ padding: 16, fontSize: 13, color: C.subtle, textAlign: 'center' }}>
              No equipment data available.
            </div>
          ) : (
            section.equipmentTypes.map((etGroup) => (
              <EquipmentTypeRow
                key={etGroup.equipmentType}
                group={etGroup}
                onView={(g) => onViewEquipment(g, section)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Flat fault-type row (By Fault Type view) ─────────────────────────────────

function TrendRow({ item, onView }: { item: TrendItem; onView: (i: TrendItem) => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '13px 16px',
        borderBottom: `0.5px solid ${C.borderLight}`,
        background: hovered ? C.hover : C.card,
        transition: 'background 0.1s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke={C.subtle} strokeWidth="2" style={{ flexShrink: 0 }}>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span style={{
        flex: 1, fontSize: 14, fontWeight: 500, color: C.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
      }} title={item.key}>
        {item.key}
      </span>
      <CountBadge count={item.count} />
      <button
        onClick={() => onView(item)}
        style={{
          background: 'none', border: 'none', padding: '4px 8px',
          fontSize: 12, fontWeight: 500, color: C.blue, cursor: 'pointer',
          borderRadius: 6, flexShrink: 0, fontFamily: 'inherit', touchAction: 'manipulation',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = C.blueLight; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
      >
        view
      </button>
    </div>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function SkeletonRow({ indent = false }: { indent?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: `12px 16px 12px ${indent ? 36 : 16}px`,
      borderBottom: `0.5px solid ${C.borderLight}`,
      background: C.card,
    }}>
      <div style={{ width: 14, height: 14, borderRadius: 4, background: '#E5E3DC', flexShrink: 0 }} />
      <div style={{ flex: 1, height: 13, borderRadius: 6, background: '#E5E3DC' }} />
      <div style={{ width: 70, height: 22, borderRadius: 20, background: '#F5E9D0', flexShrink: 0 }} />
      <div style={{ width: 30, height: 18, borderRadius: 6, background: '#DBEAFE', flexShrink: 0 }} />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────


interface FaultAnalysisPanelProps {
  /** Called when user clicks "View Checklist" — navigates to Records with that ref pre-filtered */
  onNavigateToRecord?: (refId: string) => void;
  /**
   * Optional deep-link date (YYYY-MM-DD), e.g. from a WhatsApp/email report link
   * like `?page=analysis&date=2026-07-29`. When provided, the page opens directly
   * on that single day via the Custom Range timeframe instead of "Today".
   */
  initialDate?: string;
  /**
   * Analytics' global Equipment Type / Equipment filters, when this panel is
   * embedded inside the Analytics Overview. Defaults to 'all' so the panel
   * behaves exactly as it always has when used standalone. Pruning happens
   * client-side (see filterSections/filterTrends) — no extra network request.
   */
  equipmentTypeFilter?: string;
  equipmentFilter?: string;
  /**
   * Optional checklist-item ("fault type") scope, set when this panel is
   * opened via the Overview's "Faults by Checklist Item" drill-down. When
   * present, the panel is pinned to the "By Fault Type" view and pruned to
   * just that item — same client-side-prune approach as equipmentFilter,
   * no extra network request.
   */
  checklistItemFilter?: string;
  /**
   * The date range that should govern this panel while it's embedded in
   * Analytics — either a specific clicked point (Equipment With Faults /
   * Fault Trend date click, {start,end} both that day) or, for an equipment
   * or checklist-item drill-down with no date click, the Analytics global
   * Date Range filter's resolved bounds. Either way, "click a chart → land
   * in Fault Analysis" must never silently fall back to whatever the
   * panel's own Time Frame happened to be — it must carry the Analytics
   * time period through. Reactive: changes are picked up on every render
   * without remounting the panel or losing its own View By selection.
   */
  dateRange?: { start: string; end: string } | null;
}

export default function FaultAnalysisPanel({ onNavigateToRecord, initialDate, equipmentTypeFilter = 'all', equipmentFilter = 'all', checklistItemFilter = '', dateRange = null }: FaultAnalysisPanelProps) {
  const [viewMode,    setViewMode]    = useState<ViewMode>('section');
  const [timeFrame,   setTimeFrame]   = useState<TimeFrame>(initialDate ? 'custom' : 'today');
  const [customStart, setCustomStart] = useState<string>(initialDate || daysAgoString(7));
  const [customEnd,   setCustomEnd]   = useState<string>(initialDate || todayString());

  // Track store record count to detect new submissions and auto-refresh "Today"
  const recordCount = useStore((s) => s.records.length);
  const prevRecordCountRef = useRef<number>(recordCount);

  const [sectionResult, setSectionResult] = useState<SectionFaultResult | null>(null);
  const [trendResult,   setTrendResult]   = useState<FaultTrendResult   | null>(null);

  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [panelData,  setPanelData]  = useState<PanelData | null>(null);
  const [panelOpen,  setPanelOpen]  = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [fetchedAt,  setFetchedAt]  = useState<string | null>(null);

  const customRange: DateRange = { start: customStart, end: customEnd };

  // Client-side prune to Analytics' global Equipment Type / Equipment filters
  // (no-ops and returns the original arrays when both are 'all').
  const filteredSections = useMemo(
    () => sectionResult ? filterSections(sectionResult.sections, equipmentTypeFilter, equipmentFilter) : [],
    [sectionResult, equipmentTypeFilter, equipmentFilter],
  );
  const filteredTrends = useMemo(() => {
    const base = trendResult ? filterTrends(trendResult.trends, equipmentTypeFilter, equipmentFilter) : [];
    return checklistItemFilter ? base.filter((t) => t.key === checklistItemFilter) : base;
  }, [trendResult, equipmentTypeFilter, equipmentFilter, checklistItemFilter]);
  const isFiltered = equipmentTypeFilter !== 'all' || equipmentFilter !== 'all' || !!checklistItemFilter;
  const filterLabel = [equipmentTypeFilter !== 'all' ? equipmentTypeFilter : null, equipmentFilter !== 'all' ? equipmentFilter : null, checklistItemFilter || null]
    .filter(Boolean).join(' · ');

  // A checklist-item drill-down only makes sense in the flat "By Fault Type"
  // view, so it pins the mode rather than leaving the section tree showing
  // unrelated equipment while the item filter silently does nothing.
  const effectiveViewMode: ViewMode = checklistItemFilter ? 'faultType' : viewMode;
  const totalFaults = effectiveViewMode === 'section'
    ? filteredSections.reduce((s, x) => s + x.totalFaults, 0)
    : filteredTrends.reduce((s, x) => s + x.count, 0);
  const sectionCount = filteredSections.length;

  // Checklist-item drill-down from Analytics: land the user straight on the
  // affected-equipment breakdown for that one item, instead of making them
  // click "view" on the only row in an otherwise single-row list — a total
  // count alone doesn't answer "which equipment had this fault?".
  const autoOpenedChecklistItem = useRef<string | null>(null);
  useEffect(() => {
    if (checklistItemFilter && filteredTrends.length === 1 && autoOpenedChecklistItem.current !== checklistItemFilter) {
      handleViewFaultType(filteredTrends[0]);
      autoOpenedChecklistItem.current = checklistItemFilter;
    }
    if (!checklistItemFilter) autoOpenedChecklistItem.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checklistItemFilter, filteredTrends]);

  // ── Load data ────────────────────────────────────────────────────────────

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
      invalidateFaultCache(); // force fresh DB fetch on manual refresh
    } else {
      setLoading(true);
    }
    setError(null);

    const range = timeFrame === 'custom' ? customRange : undefined;

    const [secRes, typeRes] = await Promise.all([
      fetchFaultsBySection(timeFrame, range),
      fetchFaultsByType(timeFrame, range),
    ]);

    if (secRes === null || typeRes === null) {
      setError('Could not load fault data. Check your connection and try again.');
      setSectionResult(null);
      setTrendResult(null);
    } else {
      setSectionResult(secRes);
      setTrendResult(typeRes);
      setFetchedAt(new Date().toISOString());
      if (secRes.sections.length === 1) {
        setExpandedSections(new Set([secRes.sections[0].sectionName]));
      }
    }

    setLoading(false);
    setRefreshing(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeFrame, customStart, customEnd]);

  useEffect(() => {
    setExpandedSections(new Set());
    setPanelOpen(false);
    setPanelData(null);
    loadData(false);
  }, [loadData]);

  // ── Live update: when a new record is submitted and we're viewing "Today",
  //    auto-refresh the analysis so faults appear immediately without a manual Refresh click.
  useEffect(() => {
    if (recordCount > prevRecordCountRef.current && timeFrame === 'today') {
      // Cache was already invalidated by store.addRecord — just reload
      loadData(false);
    }
    prevRecordCountRef.current = recordCount;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordCount]);

  // ── Analytics chart/filter drill-down: apply Analytics' time period (or a
  //    clicked point's single date, which narrows it further) reactively.
  //    Reuses the exact same Time Frame / customStart / customEnd state (and
  //    therefore the exact same loadData effect above) that the panel's own
  //    Time Frame dropdown drives — no second query path, no separate date
  //    handling to keep in sync. The panel's own Time Frame control remains
  //    usable afterwards for further ad-hoc refinement; it's only re-synced
  //    when Analytics' own selection actually changes.
  useEffect(() => {
    if (dateRange && (timeFrame !== 'custom' || customStart !== dateRange.start || customEnd !== dateRange.end)) {
      setTimeFrame('custom');
      setCustomStart(dateRange.start);
      setCustomEnd(dateRange.end);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange?.start, dateRange?.end]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  function toggleSection(name: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else                next.add(name);
      return next;
    });
  }

  function handleViewEquipmentType(group: EquipmentTypeGroup, section: SectionGroup) {
    setPanelData({
      title:            group.equipmentType,
      subtitle:         `Section: ${section.sectionName}`,
      totalFaults:      group.totalFaults,
      equipmentNumbers: group.equipmentNumbers,
    });
    setPanelOpen(true);
  }

  function handleViewFaultType(item: TrendItem) {
    setPanelData({
      title:            item.key,
      subtitle:         `Fault Type · ${item.count} ${item.count === 1 ? 'occurrence' : 'occurrences'}`,
      totalFaults:      item.count,
      equipmentNumbers: [],
      flatOccurrences:  item.occurrences,
    });
    setPanelOpen(true);
  }

  function handleClosePanel() {
    setPanelOpen(false);
    setTimeout(() => setPanelData(null), 260);
  }

  function handleViewChecklist(refId: string) {
    if (!refId) return;
    handleClosePanel();
    // Short delay so panel animation starts before navigation
    setTimeout(() => {
      if (onNavigateToRecord) {
        onNavigateToRecord(refId);
      }
    }, 80);
  }

  function handleApplyCustomRange() {
    if (!customStart || !customEnd) return;
    if (customStart > customEnd) {
      setError('Start date must be on or before the end date.');
      return;
    }
    loadData(false);
  }

  // ── Options ───────────────────────────────────────────────────────────────

  const viewOptions: { value: ViewMode; label: string }[] = [
    { value: 'section',    label: 'By Section' },
    { value: 'faultType',  label: 'By Fault Type' },
  ];

  const timeOptions: { value: TimeFrame; label: string }[] = [
    { value: 'today',  label: 'Today' },
    { value: 'week',   label: 'Last 7 Days' },
    { value: 'month',  label: 'Last 30 Days' },
    { value: 'custom', label: 'Custom Range' },
  ];

  const summaryText = (() => {
    const scope = isFiltered ? ` — ${filterLabel}` : '';
    if (totalFaults === 0)
      return `No faults recorded — ${formatTimeFrameLabel(timeFrame, customRange)}${scope}`;
    if (effectiveViewMode === 'section')
      return `${totalFaults} ${totalFaults === 1 ? 'fault' : 'faults'} across ${sectionCount} ${sectionCount === 1 ? 'section' : 'sections'} — ${formatTimeFrameLabel(timeFrame, customRange)}${scope}`;
    const groups = filteredTrends.length;
    return `${totalFaults} ${totalFaults === 1 ? 'fault' : 'faults'} across ${groups} fault ${groups === 1 ? 'type' : 'types'} — ${formatTimeFrameLabel(timeFrame, customRange)}${scope}`;
  })();

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px 48px' }}>

      {/* ── Page header ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9, background: '#FEE2E2',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="#EF4444" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: C.text, margin: 0 }}>
            Fault Trend Analysis
          </h1>
        </div>
        <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
          Browse faults by section and equipment unit, or explore by fault category.
          Click <strong>View Checklist</strong> on any fault to open its source record.
        </p>
      </div>

      {/* ── Control bar ── */}
      <div style={{
        background: C.card, borderRadius: 14,
        border: `0.5px solid ${C.border}`,
        padding: '14px 16px', marginBottom: 12,
      }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {/* View mode */}
          <div style={{ flex: '1 1 140px', minWidth: 120 }}>
            <label style={{
              fontSize: 11, fontWeight: 500, color: C.subtle,
              display: 'block', marginBottom: 4,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>View By</label>
            <select
              className="form-input"
              value={effectiveViewMode}
              disabled={!!checklistItemFilter}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
              style={{ fontSize: 13, padding: '8px 32px 8px 12px', width: '100%', opacity: checklistItemFilter ? 0.6 : 1 }}
            >
              {viewOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Time frame */}
          <div style={{ flex: '1 1 140px', minWidth: 130 }}>
            <label style={{
              fontSize: 11, fontWeight: 500, color: C.subtle,
              display: 'block', marginBottom: 4,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>Time Frame</label>
            <select
              className="form-input"
              value={timeFrame}
              onChange={(e) => setTimeFrame(e.target.value as TimeFrame)}
              style={{ fontSize: 13, padding: '8px 32px 8px 12px', width: '100%' }}
            >
              {timeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Refresh */}
          <button
            onClick={() => loadData(true)}
            disabled={loading || refreshing}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', height: 38, alignSelf: 'flex-end',
              background: C.chipBg, border: `0.5px solid rgba(0,0,0,0.15)`,
              borderRadius: 10, fontSize: 13, fontWeight: 500, color: C.text,
              cursor: loading || refreshing ? 'not-allowed' : 'pointer',
              opacity: loading || refreshing ? 0.55 : 1,
              fontFamily: 'inherit', touchAction: 'manipulation',
              flexShrink: 0, whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => { if (!loading && !refreshing) (e.currentTarget as HTMLButtonElement).style.background = '#E5E3DC'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = C.chipBg; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"
              style={{ animation: refreshing ? 'fa-spin 0.8s linear infinite' : 'none' }}>
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Custom date range */}
        {timeFrame === 'custom' && (
          <div style={{
            marginTop: 12, paddingTop: 12,
            borderTop: `0.5px solid ${C.borderLight}`,
            display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap',
          }}>
            <div style={{ flex: '1 1 140px', minWidth: 130 }}>
              <label style={{
                fontSize: 11, fontWeight: 500, color: C.subtle,
                display: 'block', marginBottom: 4,
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>From</label>
              <input type="date" className="form-input" value={customStart}
                max={customEnd || todayString()}
                onChange={(e) => setCustomStart(e.target.value)}
                style={{ fontSize: 13, padding: '8px 12px', width: '100%' }} />
            </div>
            <div style={{ flex: '1 1 140px', minWidth: 130 }}>
              <label style={{
                fontSize: 11, fontWeight: 500, color: C.subtle,
                display: 'block', marginBottom: 4,
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>To</label>
              <input type="date" className="form-input" value={customEnd}
                min={customStart} max={todayString()}
                onChange={(e) => setCustomEnd(e.target.value)}
                style={{ fontSize: 13, padding: '8px 12px', width: '100%' }} />
            </div>
            <button
              onClick={handleApplyCustomRange}
              disabled={!customStart || !customEnd || loading}
              style={{
                height: 38, alignSelf: 'flex-end', padding: '8px 16px', flexShrink: 0,
                background: C.blue, color: '#FFFFFF', border: 'none', borderRadius: 10,
                fontSize: 13, fontWeight: 500,
                cursor: !customStart || !customEnd || loading ? 'not-allowed' : 'pointer',
                opacity: !customStart || !customEnd || loading ? 0.55 : 1,
                fontFamily: 'inherit', touchAction: 'manipulation', whiteSpace: 'nowrap',
              }}
            >
              Apply Range
            </button>
          </div>
        )}
      </div>

      {/* ── Summary strip ── */}
      {!loading && !error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px',
          background: totalFaults > 0 ? '#FEF9EE' : '#F0FDF4',
          borderRadius: 10, marginBottom: 14,
          border: `0.5px solid ${totalFaults > 0 ? 'rgba(245,158,11,0.22)' : 'rgba(34,197,94,0.18)'}`,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke={totalFaults > 0 ? '#92400E' : '#166534'} strokeWidth="2">
            {totalFaults > 0
              ? <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>
              : <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>
            }
          </svg>
          <span style={{ fontSize: 13, fontWeight: 500, color: totalFaults > 0 ? '#92400E' : '#166534' }}>
            {summaryText}
          </span>
        </div>
      )}

      {/* ── Error banner ── */}
      {error && (
        <div style={{
          background: '#FEF2F2', border: `0.5px solid rgba(239,68,68,0.28)`,
          borderRadius: 12, padding: '12px 16px', marginBottom: 14,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="#EF4444" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#991B1B' }}>Failed to load data</div>
            <div style={{ fontSize: 12, color: '#EF4444', marginTop: 2 }}>{error}</div>
          </div>
        </div>
      )}

      {/* ── BY SECTION VIEW ── */}
      {effectiveViewMode === 'section' && (
        <div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0 16px', marginBottom: 8,
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.subtle, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Section / Equipment
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.subtle, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Faults
            </span>
          </div>

          {loading && (
            <div style={{ background: C.card, borderRadius: 12, border: `0.5px solid ${C.border}`, overflow: 'hidden', marginBottom: 8 }}>
              {[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          )}

          {!loading && !error && filteredSections.length === 0 && (
            <div style={{
              background: C.card, borderRadius: 12, border: `0.5px solid ${C.border}`,
              padding: '40px 20px', textAlign: 'center',
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                stroke="#D1CFC8" strokeWidth="1.5" style={{ margin: '0 auto 10px', display: 'block' }}>
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <div style={{ fontSize: 14, fontWeight: 500, color: C.muted }}>No faults found</div>
              <div style={{ fontSize: 12, color: C.subtle, marginTop: 4 }}>
                {isFiltered
                  ? `No "NOT OK" items for ${filterLabel} in the selected time range.`
                  : 'No "NOT OK" items submitted for the selected time range.'}
              </div>
            </div>
          )}

          {!loading && !error && filteredSections.map((section) => (
            <SectionRow
              key={section.sectionName}
              section={section}
              isExpanded={expandedSections.has(section.sectionName)}
              onToggle={() => toggleSection(section.sectionName)}
              onViewEquipment={handleViewEquipmentType}
            />
          ))}
        </div>
      )}

      {/* ── BY FAULT TYPE VIEW ── */}
      {effectiveViewMode === 'faultType' && (
        <div style={{
          background: C.card, borderRadius: 14,
          border: `0.5px solid ${C.border}`, overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 16px',
            borderBottom: `0.5px solid ${C.borderLight}`,
            background: C.sectionBg,
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.subtle, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Fault Type
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.subtle, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Count
            </span>
          </div>

          {loading && [...Array(5)].map((_, i) => <SkeletonRow key={i} />)}

          {!loading && !error && filteredTrends.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: C.subtle }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>No faults found</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                {isFiltered ? `No "NOT OK" items for ${filterLabel} in the selected period.` : 'No "NOT OK" items for the selected period.'}
              </div>
            </div>
          )}

          {!loading && !error && filteredTrends.map((item) => (
            <TrendRow key={item.key} item={item} onView={handleViewFaultType} />
          ))}
        </div>
      )}

      {/* ── Last updated ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        gap: 5, marginTop: 14, padding: '0 2px',
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.subtle} strokeWidth="2">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
        <span style={{ fontSize: 11, color: C.subtle }}>
          {fetchedAt
            ? `Last updated ${formatRelativeTime(fetchedAt)}`
            : loading ? 'Loading…' : 'Not yet loaded'
          }
        </span>
      </div>

      {/* ── Detail panel ── */}
      {panelOpen && panelData && (
        <DetailPanel
          data={panelData}
          onClose={handleClosePanel}
          onViewChecklist={handleViewChecklist}
        />
      )}

      <style>{`
        @keyframes fa-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
