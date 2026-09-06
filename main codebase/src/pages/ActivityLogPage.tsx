import { useState, useMemo } from 'react';
import { useStore, ActivityLog, isSuperAdmin } from '../store';
import { formatDateTime } from '../pdfUtils';

type TimeFilter = 'all' | 'day' | 'week' | 'month';

function getPillStyle(type: ActivityLog['type']): { background: string; color: string } {
  switch (type) {
    case 'admin_login':
    case 'admin_created':
    case 'admin_permissions_updated':
      return { background: '#DBEAFE', color: '#1E40AF' };
    case 'record_deleted':
      return { background: '#FEE2E2', color: '#991B1B' };
    case 'record_edited':
      return { background: '#FEF9C3', color: '#854D0E' };
    case 'record_submitted':
      return { background: '#DCFCE7', color: '#166534' };
    case 'department_added':
    case 'department_removed':
    case 'section_added':
    case 'section_removed':
    case 'equipment_added':
    case 'equipment_removed':
      return { background: '#EDE9FE', color: '#5B21B6' };
    default:
      return { background: '#F1EFE8', color: '#6B6963' };
  }
}

function getPillLabel(type: ActivityLog['type']): string {
  switch (type) {
    case 'admin_login': return 'Admin Login';
    case 'admin_created': return 'Admin Created';
    case 'admin_permissions_updated': return 'Permissions Updated';
    case 'record_deleted': return 'Record Deleted';
    case 'record_edited': return 'Record Edited';
    case 'record_submitted': return 'Submitted';
    case 'department_added': return 'Dept Added';
    case 'department_removed': return 'Dept Removed';
    case 'section_added': return 'Section Added';
    case 'section_removed': return 'Section Removed';
    case 'equipment_added': return 'Equip Added';
    case 'equipment_removed': return 'Equip Removed';
    default: return type;
  }
}

function getFilterLabel(f: TimeFilter): string {
  switch (f) {
    case 'day': return 'Today';
    case 'week': return 'This Week';
    case 'month': return 'This Month';
    default: return 'All Time';
  }
}

export default function ActivityLogPage() {
  
  const activityLogs = useStore((s) => s.activityLogs);
  const currentAdmin = useStore((s) => s.currentAdmin);
  const deleteLog = useStore((s) => s.deleteLog);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');

  
  
  const publicLogs = useMemo(
    () => activityLogs.filter((l) => l.type !== 'admin_login'),
    [activityLogs]
  );

  const filtered = useMemo(() => {
    if (timeFilter === 'all') return publicLogs;

    const now = new Date();

    if (timeFilter === 'day') {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return publicLogs.filter((l) => new Date(l.timestamp) >= startOfDay);
    }

    if (timeFilter === 'week') {
      const day = now.getDay(); 
      const diff = now.getDate() - day + (day === 0 ? -6 : 1); 
      const startOfWeek = new Date(now.getFullYear(), now.getMonth(), diff);
      startOfWeek.setHours(0, 0, 0, 0);
      return publicLogs.filter((l) => new Date(l.timestamp) >= startOfWeek);
    }

    if (timeFilter === 'month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return publicLogs.filter((l) => new Date(l.timestamp) >= startOfMonth);
    }

    return publicLogs;
  }, [publicLogs, timeFilter]);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 16px' }}>
      {}
      <div className="page-header">
        <h2 style={{ fontSize: 20, fontWeight: 500 }}>Activity Log</h2>
        <span style={{ fontSize: 13, color: '#6B6963' }}>
          {filtered.length} of {publicLogs.length} event{publicLogs.length !== 1 ? 's' : ''}
        </span>
      </div>

      {}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: 16,
          border: '0.5px solid rgba(0,0,0,0.12)',
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#6B6963' }}>Filter by Period</span>
        </div>

        {}
        <div className="tab-bar" style={{ marginBottom: 0 }}>
          {(['all', 'day', 'week', 'month'] as TimeFilter[]).map((f) => (
            <button
              key={f}
              className={`tab-btn ${timeFilter === f ? 'active' : ''}`}
              onClick={() => setTimeFilter(f)}
            >
              {getFilterLabel(f)}
            </button>
          ))}
        </div>

        {timeFilter !== 'all' && (
          <div style={{ marginTop: 10 }}>
            <button
              className="btn-link-blue"
              style={{ fontSize: 12 }}
              onClick={() => setTimeFilter('all')}
            >
              Clear filter — show all
            </button>
          </div>
        )}
      </div>

      {}
      {filtered.length === 0 ? (
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
          </svg>
          <p style={{ color: '#6B6963', fontSize: 14 }}>
            {publicLogs.length === 0
              ? 'No activity logged yet.'
              : `No events found for "${getFilterLabel(timeFilter)}".`}
          </p>
          {publicLogs.length > 0 && timeFilter !== 'all' && (
            <button
              className="btn-link-blue"
              style={{ marginTop: 8, fontSize: 13 }}
              onClick={() => setTimeFilter('all')}
            >
              Show all events
            </button>
          )}
        </div>
      ) : (
        <div>
          {filtered.map((log) => {
            const pillStyle = getPillStyle(log.type);
            const canDelete = isSuperAdmin(currentAdmin);
            return (
              <div
                key={log.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  background: '#F1EFE8',
                  borderRadius: 12,
                  padding: '10px 14px',
                  marginBottom: 6,
                }}
              >
                <span
                  className="log-pill"
                  style={{ background: pillStyle.background, color: pillStyle.color }}
                >
                  {getPillLabel(log.type)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontSize: 13,
                      color: '#1A1A18',
                      wordBreak: 'break-word',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {log.description}
                  </p>
                  <p style={{ fontSize: 11, color: '#9C9A92', marginTop: 2 }}>
                    {formatDateTime(log.timestamp)}
                    {log.actor && ` · by ${log.actor}`}
                  </p>
                </div>
                {canDelete && (
                  <button
                    onClick={() => {
                      
                      
                      
                      
                      if (!isSuperAdmin(currentAdmin)) return;
                      deleteLog(log.id);
                    }}
                    title="Delete this log entry — Super Admin only"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#F87171',
                      fontSize: 11,
                      fontWeight: 500,
                      fontFamily: 'inherit',
                      padding: '2px 0',
                      flexShrink: 0,
                      alignSelf: 'flex-start',
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#DC2626'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#F87171'; }}
                  >
                    Delete
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
