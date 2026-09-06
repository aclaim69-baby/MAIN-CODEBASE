import { useCallback, useEffect, useState } from 'react';
import {
  daysAgoString,
  formatTimeFrameLabel,
  todayString,
} from '../lib/faultAnalysis';
import {
  fetchFuelMonitoringData,
  fuelReasonLabel,
  invalidateFuelCache,
  type DateRange,
  type FuelEquipmentNumberGroup,
  type FuelGroupResult,
  type FuelMonitoringResult,
  type FuelRecord,
  type TimeFrame,
} from '../lib/fuelAnalysis';

type FuelTab = 'lowFuel' | 'undetermined';

function FuelLevelBadge({ level }: { level: number }) {
  const isCritical = level < 10;
  const bg = isCritical ? '#FEE2E2' : '#FEF3C7';
  const color = isCritical ? '#B91C1C' : '#92400E';
  const border = isCritical ? '#FCA5A5' : '#FCD34D';
  return (
    <span style={{
      background: bg,
      color,
      fontWeight: 700,
      fontSize: 12,
      padding: '2px 9px',
      borderRadius: 20,
      border: `1px solid ${border}`,
      whiteSpace: 'nowrap',
    }}>
      {Math.round(level)}%
    </span>
  );
}

function ReasonBadge({ value }: { value: string }) {
  return (
    <span style={{
      background: '#F3F2EC',
      color: '#6B6963',
      fontWeight: 600,
      fontSize: 12,
      padding: '2px 9px',
      borderRadius: 20,
      border: '1px solid rgba(0,0,0,0.12)',
      whiteSpace: 'nowrap',
    }}>
      {fuelReasonLabel(value)}
    </span>
  );
}

function FuelRecordRow({ rec, type }: { rec: FuelRecord; type: FuelTab }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 10,
      padding: '8px 14px',
      borderBottom: '0.5px solid rgba(0,0,0,0.06)',
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500 }}>
          {rec.date}
          <span style={{ color: '#9C9A92', fontWeight: 400 }}> · {rec.technician}</span>
        </div>
        <div style={{ fontSize: 11, color: '#9C9A92', marginTop: 2 }}>Ref: {rec.refId}</div>
      </div>
      {type === 'lowFuel' && rec.fuelLevel !== undefined
        ? <FuelLevelBadge level={rec.fuelLevel} />
        : <ReasonBadge value={rec.reason ?? ''} />
      }
    </div>
  );
}

function FuelEquipNumberCard({ group, type }: { group: FuelEquipmentNumberGroup; type: FuelTab }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ border: '0.5px solid rgba(0,0,0,0.09)', borderRadius: 8, overflow: 'hidden', marginBottom: 6 }}>
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          background: expanded ? '#F9F7F2' : '#FAFAF8',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="#9C9A92" strokeWidth="2"
            style={{ flexShrink: 0, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.18s' }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            #{group.equipmentNumber}
          </span>
          <span style={{ fontSize: 12, color: '#6B6963', whiteSpace: 'nowrap' }}>
            {group.records.length} {group.records.length === 1 ? 'record' : 'records'}
          </span>
        </div>
        {type === 'lowFuel' && group.lowestFuel !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: '#9C9A92' }}>Lowest:</span>
            <FuelLevelBadge level={group.lowestFuel} />
          </div>
        )}
      </button>
      {expanded && group.records.map((rec) => (
        <FuelRecordRow key={rec.recordId} rec={rec} type={type} />
      ))}
    </div>
  );
}

function FuelGroupView({ result, type, loading }: {
  result: FuelGroupResult | null;
  type: FuelTab;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div style={{ background: '#FFFFFF', borderRadius: 8, border: '0.5px solid rgba(0,0,0,0.10)', overflow: 'hidden' }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: 'flex', gap: 10, padding: 14, borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
            <div style={{ width: 18, height: 18, borderRadius: 6, background: '#E5E3DC' }} />
            <div style={{ flex: 1, height: 14, borderRadius: 7, background: '#E5E3DC' }} />
            <div style={{ width: 70, height: 20, borderRadius: 10, background: '#E5E3DC' }} />
          </div>
        ))}
      </div>
    );
  }

  if (!result || result.totalCount === 0) {
    const msg = type === 'lowFuel'
      ? { title: 'No Low Fuel Alerts', sub: 'No equipment reported below 20% fuel for the selected period.' }
      : { title: 'No Undetermined Fuel Records', sub: 'No equipment reported fuel level as undetermined for the selected period.' };
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', background: '#FFFFFF', borderRadius: 8, border: '0.5px solid rgba(0,0,0,0.10)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1A18' }}>{msg.title}</div>
        <div style={{ fontSize: 12, color: '#9C9A92', marginTop: 4 }}>{msg.sub}</div>
      </div>
    );
  }

  return (
    <div>
      {result.sections.map((section) => (
        <div key={section.sectionName} style={{ background: '#FFF', borderRadius: 8, border: '0.5px solid rgba(0,0,0,0.10)', marginBottom: 10, overflow: 'hidden' }}>
          <div style={{ background: '#F9F7F2', padding: '10px 16px', borderBottom: '0.5px solid rgba(0,0,0,0.08)', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{section.sectionName}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6B6963', whiteSpace: 'nowrap' }}>
              {section.totalCount} {section.totalCount === 1 ? 'record' : 'records'}
            </span>
          </div>
          <div style={{ padding: '10px 12px' }}>
            {section.equipmentTypes.map((typeGroup) => (
              <div key={typeGroup.equipmentType} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6B6963', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '4px 0', borderBottom: '0.5px solid rgba(0,0,0,0.07)', marginBottom: 6 }}>
                  {typeGroup.equipmentType}
                  <span style={{ fontWeight: 400, marginLeft: 6 }}>({typeGroup.totalCount})</span>
                </div>
                {typeGroup.equipmentNumbers.map((numGroup) => (
                  <FuelEquipNumberCard key={numGroup.equipmentNumber} group={numGroup} type={type} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FuelMonitoringPage() {
  const [activeTab, setActiveTab] = useState<FuelTab>('lowFuel');
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('today');
  const [customStart, setCustomStart] = useState<string>(daysAgoString(7));
  const [customEnd, setCustomEnd] = useState<string>(todayString());
  const [result, setResult] = useState<FuelMonitoringResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const customRange: DateRange = { start: customStart, end: customEnd };

  const loadData = useCallback(async (isRefresh = false) => {
    if (customStart > customEnd) {
      setError('Start date must be on or before the end date.');
      setLoading(false);
      return;
    }

    if (isRefresh) {
      setRefreshing(true);
      invalidateFuelCache();
    } else {
      setLoading(true);
    }
    setError(null);

    const range = timeFrame === 'custom' ? customRange : undefined;
    const res = await fetchFuelMonitoringData(timeFrame, range);

    if (!res) {
      setError('Could not load fuel data. Check your connection and try again.');
      setResult(null);
    } else {
      setResult(res);
      setFetchedAt(new Date().toISOString());
    }

    setLoading(false);
    setRefreshing(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeFrame, customStart, customEnd]);

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  const shownResult = activeTab === 'lowFuel' ? result?.lowFuelAlerts ?? null : result?.undetermined ?? null;
  const summaryCount = shownResult?.totalCount ?? 0;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: '#1A1A18' }}>Fuel Monitoring</h1>
          <p style={{ fontSize: 13, color: '#6B6963', marginTop: 4 }}>
            {summaryCount} {summaryCount === 1 ? 'record' : 'records'} · {formatTimeFrameLabel(timeFrame, customRange)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="form-input"
            value={timeFrame}
            onChange={(e) => setTimeFrame(e.target.value as TimeFrame)}
            style={{ width: 150 }}
          >
            <option value="today">Today</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
            <option value="custom">Custom Range</option>
          </select>
          <button className="btn-secondary" onClick={() => void loadData(true)} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {timeFrame === 'custom' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input className="form-input" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ maxWidth: 180 }} />
          <input className="form-input" type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ maxWidth: 180 }} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, background: '#EDEBE3', padding: 4, borderRadius: 8, width: 'fit-content' }}>
        {([
          ['lowFuel', 'Low Fuel Alerts'],
          ['undetermined', 'Fuel Level Undetermined'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              border: 'none',
              borderRadius: 6,
              padding: '8px 12px',
              background: activeTab === key ? '#FFFFFF' : 'transparent',
              color: activeTab === key ? '#1A1A18' : '#6B6963',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: activeTab === key ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="banner-error" style={{ marginBottom: 12 }}>{error}</div>}

      <FuelGroupView result={shownResult} type={activeTab} loading={loading} />

      {fetchedAt && !loading && (
        <div style={{ textAlign: 'right', fontSize: 11, color: '#9C9A92', marginTop: 12 }}>
          Last updated {new Date(fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  );
}
