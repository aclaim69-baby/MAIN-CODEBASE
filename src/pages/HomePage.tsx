import { useState, useEffect } from 'react';
import { useStore, canViewRecords } from '../store';
import { fetchTodayCount, fetchRecordsPage } from '../lib/sync';

// ─── Stat display helpers ─────────────────────────────────────────────────────

/**
 * Format total records as a "nearest floor" display value.
 * Rules:
 *   < 50         → show exact number
 *   50–999       → round down to nearest 50, append "+"  (269 → "250+")
 *   1000–9999    → round down to nearest 100, append "+" (1109 → "1100+")
 *   10000+       → round down to nearest 1000, append "+"
 */
function formatTotalRecords(n: number): string {
  if (n < 50)     return String(n);
  if (n < 1000)   return `${Math.floor(n / 50)  * 50}+`;
  if (n < 10000)  return `${Math.floor(n / 100) * 100}+`;
  return `${Math.floor(n / 1000) * 1000}+`;
}

/** How stale can cached values be before we re-fetch? (15 min) */
const STALE_MS = 15 * 60 * 1000;

type Page = 'home' | 'records' | 'log' | 'admin' | 'new-check' | 'analysis';

interface Props {
  onNavigate: (page: Page) => void;
}

export default function HomePage({ onNavigate }: Props) {
  const records            = useStore((s) => s.records);
  const activityLogs       = useStore((s) => s.activityLogs);
  const departments        = useStore((s) => s.departments);
  const equipmentTypes     = useStore((s) => s.equipmentTypes);
  const settings           = useStore((s) => s.settings);
  const currentAdmin       = useStore((s) => s.currentAdmin);
  const setHomeTitle        = useStore((s) => s.setHomeTitle);
  const lastSyncedAt       = useStore((s) => s.lastSyncedAt);

  // ── Cached stat values (persisted in store, survive page navigation) ──────
  const todayCountCached   = useStore((s) => s.todayCountCached);
  const todayCountDate     = useStore((s) => s.todayCountDate);
  const recordsTotalCount  = useStore((s) => s.recordsTotalCount);
  const lastSubmittedAt    = useStore((s) => s.lastSubmittedAt);
  const setTodayCountCached = useStore((s) => s.setTodayCountCached);
  const setRecordsTotalCount = useStore((s) => s.setRecordsTotalCount);

  const isSuperAdmin  = currentAdmin?.isSuperAdmin === true;
  const canSeeRecords = canViewRecords(currentAdmin, settings.recordsVisibility ?? 'general');

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft,   setTitleDraft]   = useState('');
  const [titleSaved,   setTitleSaved]   = useState(false);

  const displayTitle = settings.homeTitle?.trim() || 'Technical Department Inspection System';

  // ── Smart stat fetching ───────────────────────────────────────────────────
  // Rules:
  //   • Today's count: only fetch if cache is for a different day OR if the
  //     last sync happened more than STALE_MS ago AND no cached value exists.
  //   • Total records: only fetch if no cached value, OR last sync > STALE_MS.
  //   • Never fetch if a realtime submission has already kept the value fresh
  //     (the store's incrementTodayCount / _realtimeInsertRecord handles that).

  useEffect(() => {
    const todayStr  = new Date().toISOString().split('T')[0];
    const lastMs    = lastSyncedAt ? new Date(lastSyncedAt).getTime() : 0;
    const isStale   = (Date.now() - lastMs) > STALE_MS;
    const wrongDay  = todayCountDate !== todayStr;

    // Today count: re-fetch only if cache is for the wrong day
    if (wrongDay || todayCountCached === null) {
      fetchTodayCount().then((count) => {
        setTodayCountCached(count, todayStr);
      });
    }

    // Total records: re-fetch only if stale or never fetched
    if (recordsTotalCount === null || isStale) {
      fetchRecordsPage(1, 1).then((res) => {
        if (res) setRecordsTotalCount(res.total);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When a new submission happens (lastSubmittedAt changes), refresh the total records count
  useEffect(() => {
    if (!lastSubmittedAt) return;
    fetchRecordsPage(1, 1).then((res) => {
      if (res) setRecordsTotalCount(res.total);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSubmittedAt]);

  // ── Title editing ─────────────────────────────────────────────────────────

  function startEditTitle() {
    setTitleDraft(displayTitle);
    setEditingTitle(true);
    setTitleSaved(false);
  }

  function saveTitle() {
    const val = titleDraft.trim() || 'Technical Department Inspection System';
    setHomeTitle(val);
    setEditingTitle(false);
    setTitleSaved(true);
    setTimeout(() => setTitleSaved(false), 2500);
  }

  function cancelTitle() {
    setEditingTitle(false);
    setTitleDraft('');
  }

  // ── Derived display values ────────────────────────────────────────────────
  const todayDisplay   = todayCountCached === null ? '…' : String(todayCountCached);
  const totalDisplay   = recordsTotalCount === null ? '…' : formatTotalRecords(recordsTotalCount);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 16px' }}>

      {/* ── Title ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
          {settings.homeLogoUrl ? (
            <img src={settings.homeLogoUrl} alt="Logo" style={{ height: 40, objectFit: 'contain' }} />
          ) : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 28, fontWeight: 500, color: '#1A1A18' }}>Daily Checking</h1>

            {editingTitle ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <input
                  autoFocus
                  type="text"
                  className="form-input"
                  style={{ fontSize: 13, padding: '4px 10px', flex: 1, minWidth: 0 }}
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')  saveTitle();
                    if (e.key === 'Escape') cancelTitle();
                  }}
                  placeholder="Technical Department Inspection System"
                />
                <button onClick={saveTitle}   style={{ padding: '4px 10px', fontSize: 12, background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>Save</button>
                <button onClick={cancelTitle} style={{ padding: '4px 10px', fontSize: 12, background: '#F1EFE8', color: '#1A1A18', border: '0.5px solid rgba(0,0,0,0.15)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <p style={{ fontSize: 13, color: '#6B6963' }}>{displayTitle}</p>
                {isSuperAdmin && (
                  <button
                    onClick={startEditTitle}
                    title="Edit homepage title (Super Admin)"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: '#9C9A92', fontSize: 11, lineHeight: 1, borderRadius: 4, transition: 'color 0.15s' }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#2563EB')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#9C9A92')}
                  >✏️</button>
                )}
              </div>
            )}

            {titleSaved && <p style={{ fontSize: 11, color: '#166534', marginTop: 2 }}>✅ Title updated on all devices</p>}
          </div>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div id="stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 24 }}>

        <div className="card" style={{ padding: 16, marginBottom: 0 }}>
          <p style={{ fontSize: 13, color: '#6B6963', marginBottom: 4 }}>Today's Checks</p>
          <p style={{ fontSize: 28, fontWeight: 500, color: '#1D4ED8' }}>{todayDisplay}</p>
        </div>

        <div className="card" style={{ padding: 16, marginBottom: 0 }}>
          <p style={{ fontSize: 13, color: '#6B6963', marginBottom: 4 }}>Total Records</p>
          <p style={{ fontSize: 28, fontWeight: 500, color: '#166534' }}>{totalDisplay}</p>
        </div>

        <div className="card" style={{ padding: 16, marginBottom: 0 }}>
          <p style={{ fontSize: 13, color: '#6B6963', marginBottom: 4 }}>Departments</p>
          <p style={{ fontSize: 28, fontWeight: 500, color: '#6D28D9' }}>{departments.length}</p>
        </div>

        <div className="card" style={{ padding: 16, marginBottom: 0 }}>
          <p style={{ fontSize: 13, color: '#6B6963', marginBottom: 4 }}>Equipment Types</p>
          <p style={{ fontSize: 28, fontWeight: 500, color: '#C2410C' }}>{equipmentTypes.length}</p>
        </div>
      </div>

      {/* ── Action Cards ── */}
      <div id="action-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 24 }}>
        <button className="action-card" onClick={() => onNavigate('new-check')}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: '#DBEAFE', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 12 2 2 4-4"/></svg>
          </div>
          <p style={{ fontSize: 16, fontWeight: 500 }}>Start New Check</p>
        </button>

        {canSeeRecords && (
          <button className="action-card" onClick={() => onNavigate('records')}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </div>
            <p style={{ fontSize: 16, fontWeight: 500 }}>View Records</p>
          </button>
        )}

        <button className="action-card" onClick={() => onNavigate('analysis')}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <p style={{ fontSize: 16, fontWeight: 500 }}>Fault Analysis</p>
        </button>

        <button className="action-card" onClick={() => onNavigate('log')}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: '#EDE9FE', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5B21B6" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <p style={{ fontSize: 16, fontWeight: 500 }}>Activity Log</p>
        </button>

        <button className="action-card" onClick={() => onNavigate('admin')}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: '#F1EFE8', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6B6963" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
          </div>
          <p style={{ fontSize: 16, fontWeight: 500 }}>Admin Panel</p>
        </button>
      </div>

      {/* ── Recent Submissions ── */}
      {canSeeRecords && records.length > 0 && (
        <div className="card">
          <div className="page-header" style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 16, fontWeight: 500 }}>Recent Submissions</h3>
            <button className="btn-link-blue" onClick={() => onNavigate('records')}>View all →</button>
          </div>
          {records.slice(0, 5).map((r) => (
            <div key={r.id} className="review-row">
              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{r.technicianName}</span>
                <span style={{ fontSize: 12, color: '#9C9A92', marginLeft: 8 }}>
                  {r.equipmentTypeCode}{r.equipmentNumber ? `#${r.equipmentNumber}` : ''} · {r.sectionName}
                </span>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ fontSize: 11, color: '#9C9A92' }}>{r.date}</p>
                <p className="ref-id" style={{ fontSize: 11 }}>{r.refId}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Recent Activity ── */}
      {activityLogs.filter((l) => l.type !== 'admin_login').length > 0 && (
        <div className="card">
          <div className="page-header" style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 16, fontWeight: 500 }}>Recent Activity</h3>
            <button className="btn-link-blue" onClick={() => onNavigate('log')}>View all →</button>
          </div>
          {activityLogs.filter((l) => l.type !== 'admin_login').slice(0, 3).map((log) => (
            <div key={log.id} style={{ fontSize: 13, color: '#6B6963', padding: '5px 0', borderBottom: '0.5px solid rgba(0,0,0,0.08)', wordBreak: 'break-word' }}>
              <span style={{ color: '#1A1A18' }}>{log.description}</span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @media(min-width: 480px) {
          #stat-grid   { grid-template-columns: repeat(4, 1fr) !important; }
          #action-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
