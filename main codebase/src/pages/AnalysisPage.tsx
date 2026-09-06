/**
 * AnalysisPage.tsx
 *
 * Analytics — unified inspection + fault analytics.
 *
 * Overview tab (see section 49 of the spec this was built against):
 *   KPI summary
 *     → Inspection Volume & Equipment With Faults (line chart) + Inspection Result (donut)
 *     → Faults by Equipment + Faults by Checklist Item
 *     → Detailed Fault Analysis (the real, unmodified Fault Trend Analysis
 *       experience — see FaultAnalysisPanel.tsx — embedded here rather than
 *       reimplemented, and pruned to the active Equipment Type / Equipment
 *       filter client-side, no extra network request)
 *
 * Inspections / Faults tabs are the pre-existing deeper breakdown views kept
 * alongside the new Overview.
 *
 * No fuel, telemetry, or maintenance data anywhere on this page — Analytics
 * is inspection + fault analytics only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  averageInspectionsPerDay, bounds, equipmentFaultMetrics, fetchAnalytics, faults, formatAveragePerDay,
  group, inspectionStatus, type AnalyticsData, type AnalyticsFilters, type AnalyticsPeriod, type AnalyticsRecord,
} from '../lib/analytics';
import FaultAnalysisPanel from './FaultAnalysisPanel';

const initialFilters: AnalyticsFilters = { period: 'thisMonth', equipmentType: 'all', equipment: 'all', result: 'all' };
const periodLabels: Record<AnalyticsPeriod, string> = {
  today: 'Today', yesterday: 'Yesterday', '7d': 'Last 7 Days', '30d': 'Last 30 Days', '90d': 'Last 90 Days',
  thisMonth: 'This Month', lastMonth: 'Last Month', custom: 'Custom Range',
};

// ─── Small shared building blocks ──────────────────────────────────────────

const cardStyle: React.CSSProperties = { background: '#fff', border: '1px solid rgba(0,0,0,.1)', borderRadius: 14, padding: 16 };
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={cardStyle}><h3 style={{ fontSize: 14, margin: '0 0 14px' }}>{title}</h3>{children}</section>;
}
function Empty({ text }: { text: string }) {
  return <div style={{ height: 150, display: 'grid', placeItems: 'center', color: '#9C9A92', fontSize: 13, textAlign: 'center', padding: '0 12px' }}>{text}</div>;
}
const tooltipStyle: React.CSSProperties = { background: '#fff', border: '1px solid rgba(0,0,0,.12)', borderRadius: 10, boxShadow: '0 8px 20px rgba(0,0,0,.12)', padding: '10px 12px', fontSize: 12 };
const shortLabel = (v: string) => (v.length > 24 ? v.slice(0, 23) + '…' : v);

function ChartTooltip({ active, payload, label, percent }: { active?: boolean; payload?: any[]; label?: string; percent?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={tooltipStyle}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 18, color: '#4B4A45' }}>
          <span><span style={{ color: p.color }}>●</span> {p.name}</span>
          <b>{percent ? `${Number(p.value).toFixed(1)}%` : Number(p.value).toLocaleString()}</b>
        </div>
      ))}
    </div>
  );
}

/** Horizontal bar chart — used for "Faults by X" and equipment-ranking views. */
function Bars({ data, onClick, percent, metricName }: { data: { label: string; value: number }[]; onClick?: (x: string) => void; percent?: boolean; metricName?: string }) {
  if (!data.length) return <Empty text="No data available for the selected filters." />;
  const rows = data.slice(0, 8);
  const h = Math.max(220, rows.length * 42);
  return (
    <div style={{ height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 28, left: 12, bottom: 4 }}
          onClick={(s: any) => { const row = s?.activePayload?.[0]?.payload; if (row && onClick) onClick(row.label); }}>
          <CartesianGrid horizontal={false} stroke="#ECEAE4" />
          <XAxis type="number" tick={{ fontSize: 11, fill: '#85827A' }} tickLine={false} axisLine={false}
            tickFormatter={(v) => (percent ? `${v}%` : Number(v).toLocaleString())} />
          <YAxis type="category" dataKey="label" width={112} tick={{ fontSize: 11, fill: '#55534D' }} tickLine={false} axisLine={false} tickFormatter={shortLabel} />
          <Tooltip content={<ChartTooltip percent={percent} />} cursor={{ fill: 'rgba(37,99,235,.07)' }} />
          <Bar dataKey="value" name={metricName || (percent ? 'Fault Rate' : 'Count')} fill="#2563EB" radius={[0, 4, 4, 0]} barSize={22}
            label={{ position: 'right', fontSize: 11, fill: '#4B4A45', formatter: (v: any) => (percent ? `${v}%` : String(v)) }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Custom clickable dot for Trend lines. Recharts' `dot` render-prop receives
 *  the full per-point props (including `payload`, the original data row) —
 *  unlike `activeDot`'s onClick, which only ever hands back the activeDot
 *  config object, not the data. Using this is what lets a click resolve to
 *  the exact date/value of the point clicked, never "today" or a guess. */
function ClickableDot(props: any) {
  const { cx, cy, payload, onPointClick, stroke } = props;
  if (cx == null || cy == null) return null;
  return (
    <g style={{ cursor: onPointClick ? 'pointer' : 'default' }} onClick={() => onPointClick?.(payload)}>
      {/* Larger transparent hit target — the visible dot alone is too small to tap reliably. */}
      <circle cx={cx} cy={cy} r={11} fill="transparent" />
      <circle cx={cx} cy={cy} r={3} fill={stroke} stroke="#fff" strokeWidth={1.5} />
    </g>
  );
}

/** Multi-series line chart. Every series shares the same X-axis labels (the
 *  data array's `label` field). Used for both single-series trends
 *  (Inspection Volume, Fault Trend) and the two-series Overview chart.
 *  A series with `onPointClick` becomes a navigation control, not just a
 *  visualization — clicking a point passes that point's own data row (so
 *  the caller reads the real date off it, never assuming "today"). Series
 *  without `onPointClick` (e.g. Inspection Volume) stay plain and inert —
 *  clicking one line was never meant to trigger the other's action. */
function Trend({ data, series }: { data: any[]; series: { key: string; name: string; color: string; onPointClick?: (point: any) => void }[] }) {
  if (!data.length) return <Empty text="No inspection data available for the selected period." />;
  return (
    <div style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 16, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="#ECEAE4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#85827A' }} tickLine={false} axisLine={false} minTickGap={28} />
          <YAxis tick={{ fontSize: 10, fill: '#85827A' }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#9CA3AF', strokeWidth: 1, strokeDasharray: '3 3' }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 5 }} />
          {series.map((l) => (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2.25}
              dot={l.onPointClick
                ? (dotProps: any) => <ClickableDot key={`dot-${l.key}-${dotProps.index}`} {...dotProps} onPointClick={l.onPointClick} />
                : { r: 2, strokeWidth: 1, fill: '#fff' }}
              activeDot={{ r: 4, strokeWidth: 2 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Inspection Result donut — percentages are always visible in the legend
 *  below the chart, not just on hover (spec section 20). */
function Donut({ ok, bad }: { ok: number; bad: number }) {
  const total = ok + bad;
  if (!total) return <Empty text="No inspection data available for the selected period." />;
  // Full-precision percentages first; NOT OK is derived as the remainder so
  // the two always sum to exactly 100% (avoids 99%+2%=101% rounding drift).
  const okPct = (ok / total) * 100, badPct = 100 - okPct;
  const data = [
    { name: 'OK', value: ok, pct: okPct, color: '#22C55E' },
    { name: 'NOT OK', value: bad, pct: badPct, color: '#EF4444' },
  ];
  const pctLabel = (p: number) => `${Number.isInteger(Math.round(p * 10) / 10) ? Math.round(p) : p.toFixed(1)}%`;
  return (
    <div>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="78%" paddingAngle={3} stroke="none"
              label={({ value, pct }: any) => (value > 0 ? pctLabel(pct) : '')} labelLine={false}>
              {data.map((x) => <Cell key={x.name} fill={x.color} />)}
            </Pie>
            <Tooltip content={({ active, payload }: any) => {
              const x = payload?.[0]?.payload;
              if (!active || !x) return null;
              return <div style={tooltipStyle}><b>{x.name}</b><div style={{ marginTop: 5 }}>{Number(x.value).toLocaleString()} · {pctLabel(x.pct)}</div></div>;
            }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {/* Always-visible percentage readout — no hover required, and this is
          what communicates the category+percentage pairing accessibly (not
          color alone). */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 22, marginTop: 2, fontSize: 13 }} role="list" aria-label="Inspection result breakdown">
        {data.map((x) => (
          <div key={x.name} role="listitem" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: x.color, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ color: '#4B4A45' }}>{x.name} <b>{pctLabel(x.pct)}</b></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ fontSize: 11, color: '#6B6963' }}>{label}<div style={{ marginTop: 4 }}>{children}</div></label>;
}

// ─── Metrics derivation ─────────────────────────────────────────────────────

/** Everything the Overview/Inspections/Faults tabs read, derived once from
 *  the already-globally-filtered record set `records` (date range, equipment
 *  type, equipment, and checklist result all already applied — see
 *  fetchAnalytics in lib/analytics.ts, the single authoritative filter). */
function useMetrics(records: AnalyticsRecord[]) {
  return useMemo(() => {
    const bad = records.filter((x) => inspectionStatus(x) === 'NOT OK');
    const occ = records.flatMap(faults);
    const by = (a: { key: string }[]) => group(a);
    return {
      r: records,
      bad,
      occ,
      ok: records.length - bad.length,
      // Inspection Volume — one time bucket per calendar date, ascending.
      date: by(records.map((x) => ({ key: x.date }))).sort((a, b) => a.label.localeCompare(b.label)),
      eq: by(records.map((x) => ({ key: x.equipment }))),
      type: by(records.map((x) => ({ key: x.equipmentType }))),
      // "Faults by Equipment" — fault OCCURRENCE volume per equipment (distinct concept from Equipment With Faults; spec section 23).
      feq: by(records.flatMap((x) => faults(x).map(() => ({ key: x.equipment })))),
      ftype: by(records.flatMap((x) => faults(x).map(() => ({ key: x.equipmentType })))),
      items: by(occ.map((x) => ({ key: x.label || 'Unknown' }))),
      days: by(records.map((x) => ({ key: new Date(x.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' }) }))),
      fdate: by(records.flatMap((x) => faults(x).map(() => ({ key: x.date })))).sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [records]);
}
type Metrics = ReturnType<typeof useMetrics>;

/**
 * Inspection Volume & Equipment With Faults — the Overview's primary line
 * chart data. Both series use the identical per-date buckets (m.date's
 * labels, spec section 11). "Equipment With Faults" for a bucket is the
 * COUNT OF DISTINCT EQUIPMENT that had at least one NOT OK checklist item
 * that date — never the raw count of fault occurrences, and never a
 * per-equipment ranking (spec sections 8–10, 42–43). At the single-equipment
 * filter level this collapses to 0 or 1 per bucket, which falls out of the
 * same distinct-count logic automatically (spec section 14/43).
 */
function useVolumeAndFaultsTrend(m: Metrics) {
  return useMemo(() => {
    const equipmentByDate = new Map<string, Set<string>>();
    for (const rec of m.r) {
      if (faults(rec).length > 0) {
        if (!equipmentByDate.has(rec.date)) equipmentByDate.set(rec.date, new Set());
        equipmentByDate.get(rec.date)!.add(rec.equipment);
      }
    }
    return m.date.map((d) => ({
      label: d.label,
      inspections: d.value,
      equipmentWithFaults: equipmentByDate.get(d.label)?.size ?? 0,
    }));
  }, [m]);
}

// ─── Page ───────────────────────────────────────────────────────────────────

/** Everything needed to put Analytics back exactly where the user left it —
 *  captured at the moment of a "View Checklist" navigation to Records, and
 *  handed back via restoreContext when they click "Back to Fault Analysis"
 *  on the source record (see App.tsx). Deliberately plain/serializable data,
 *  not React state, so it survives this page unmounting while on Records. */
export interface AnalyticsRestoreContext {
  filters: AnalyticsFilters;
  tab: 'overview' | 'inspections' | 'faults';
  drillEquipment: string | null;
  drillItem: string | null;
  drillDate: string | null;
}

export default function AnalysisPage({ initialDate, onNavigateToRecord, restoreContext, onRestoreContextConsumed }: {
  initialDate?: string;
  onNavigateToRecord?: (id: string, context: AnalyticsRestoreContext) => void;
  restoreContext?: AnalyticsRestoreContext | null;
  onRestoreContextConsumed?: () => void;
}) {
  const [filters, setFilters] = useState<AnalyticsFilters>(() =>
    restoreContext?.filters ?? (initialDate ? { ...initialFilters, period: 'custom', start: initialDate, end: initialDate } : initialFilters),
  );
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'overview' | 'inspections' | 'faults'>(() => restoreContext?.tab ?? 'overview');
  const [equipment, setEquipment] = useState<string | null>(null);

  // Equipment / checklist-item / date drill-down into the embedded Detailed
  // Fault Analysis panel. This is deliberately local component state rather
  // than a route change — the panel is embedded on this same page, so there
  // is no navigation to lose: clearing the drill is the "back" action, and
  // every other filter, tab, and scroll position is simply still there. It's
  // restored wholesale from restoreContext when returning from a source
  // record (see the effect below).
  const [drillEquipment, setDrillEquipment] = useState<string | null>(() => restoreContext?.drillEquipment ?? null);
  const [drillItem, setDrillItem] = useState<string | null>(() => restoreContext?.drillItem ?? null);
  // The date behind a clicked "Equipment With Faults" or "Fault Trend" point
  // — combines with drillEquipment/drillItem rather than replacing them
  // (clicking a date, then an equipment bar, narrows to both together).
  const [drillDate, setDrillDate] = useState<string | null>(() => restoreContext?.drillDate ?? null);
  const faultAnalysisRef = useRef<HTMLDivElement>(null);
  const scrollToFaultAnalysis = () => requestAnimationFrame(() =>
    faultAnalysisRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  const drillToEquipment = (name: string) => { setTab('overview'); setDrillEquipment(name); setDrillItem(null); scrollToFaultAnalysis(); };
  const drillToItem = (name: string) => { setTab('overview'); setDrillItem(name); setDrillEquipment(null); scrollToFaultAnalysis(); };
  // Shared by both clickable line charts (Overview's Equipment With Faults
  // series and the Faults tab's Fault Trend). Always jumps to the Overview
  // tab first since that's where the embedded Fault Analysis panel lives.
  const drillToDate = (dateLabel: string) => { setTab('overview'); setDrillDate(dateLabel); scrollToFaultAnalysis(); };
  const clearDrill = () => { setDrillEquipment(null); setDrillItem(null); setDrillDate(null); };

  // One-time restore: if we arrived here via "Back to Fault Analysis", the
  // states above already picked up restoreContext at mount (lazy initializers
  // above) — this just tells App.tsx the context has been applied so it
  // doesn't get reapplied on some later, unrelated mount of this page, and
  // scrolls straight to the panel so the return feels immediate.
  useEffect(() => {
    if (restoreContext) {
      onRestoreContextConsumed?.();
      if (restoreContext.tab === 'overview' && (restoreContext.drillEquipment || restoreContext.drillItem || restoreContext.drillDate)) {
        scrollToFaultAnalysis();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guards against a slower, now-stale request overwriting a newer one when
  // filters change quickly (spec section 30).
  const requestRef = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestRef.current;
    setFetching(true);
    setError('');
    try {
      const result = await fetchAnalytics(filters);
      if (id === requestRef.current) { setData(result); setError(''); }
    } catch {
      if (id === requestRef.current) setError('Unable to load analytics data.');
    } finally {
      if (id === requestRef.current) setFetching(false);
    }
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  const m = useMetrics(data?.records || []);
  const rate = m.r.length ? (m.bad.length / m.r.length) * 100 : 0;
  const per = equipmentFaultMetrics(m.r).map((x) => ({
    label: x.equipment, value: x.inspections, faultyInspections: x.faultyInspections, faultOccurrences: x.faultOccurrences, faultRate: x.faultRate,
  }));
  // Centralized Average Inspections — same calculation feeds the KPI and both
  // exports; operates on m.r, which already reflects every active global
  // filter (date range, equipment type, equipment, checklist result).
  const avgPerDay = averageInspectionsPerDay(m.r.length, filters);
  const avgLabel = `${formatAveragePerDay(avgPerDay)} / day`;
  const volumeAndFaultsTrend = useVolumeAndFaultsTrend(m);

  const updateFilter = (k: keyof AnalyticsFilters, v: string) =>
    setFilters((f) => ({ ...f, [k]: v, equipment: k === 'equipmentType' ? 'all' : f.equipment }));

  const exportPdf = () => {
    const d = new jsPDF();
    d.setFontSize(18); d.text('DAILY CHECKING — ANALYTICS REPORT', 14, 18);
    d.setFontSize(10);
    const b = bounds(filters);
    d.text(`Reporting period: ${b.start} to ${b.end}`, 14, 26);
    autoTable(d, {
      startY: 34, head: [['Metric', 'Value']],
      body: [
        ['Total Inspections', m.r.length], ['Average Inspections', avgLabel], ['OK Inspections', m.ok],
        ['NOT OK Inspections', m.bad.length], ['Fault Occurrences', m.occ.length], ['Fault Rate', rate.toFixed(1) + '%'],
        ['Equipment Inspected', m.eq.length], ['Equipment With Faults', m.feq.length],
      ],
    });
    autoTable(d, {
      startY: (d as any).lastAutoTable.finalY + 8, head: [['Equipment', 'Inspections', 'Faulty Inspections', 'Fault Rate']],
      body: per.map((x) => [x.label, x.value, x.faultyInspections, x.faultRate.toFixed(1) + '%']),
    });
    d.save('Daily_Checking_Analytics.pdf');
  };

  const exportExcel = () => {
    const book = XLSX.utils.book_new();
    const summary = [
      ['Metric', 'Value'], ['Total Inspections', m.r.length], ['Average Inspections', avgLabel], ['OK Inspections', m.ok],
      ['NOT OK Inspections', m.bad.length], ['Fault occurrences', m.occ.length], ['Fault Rate', rate / 100],
      ['Equipment Inspected', m.eq.length], ['Equipment With Faults', m.feq.length],
    ];
    const equipmentRows = [
      ['Equipment', 'Equipment Type', 'Total Inspections', 'OK Inspections', 'Faulty Inspections', 'Fault Occurrences', 'Fault Rate'],
      ...per.map((x) => [x.label, m.r.find((r) => r.equipment === x.label)?.equipmentType || '', x.value, x.value - x.faultyInspections, x.faultyInspections, x.faultOccurrences, x.faultRate / 100]),
    ];
    const inspectionRows = [
      ['Date', 'Equipment Type', 'Equipment', 'Inspection Count', 'OK Count', 'NOT OK Count'],
      ...m.r.map((r) => [r.date, r.equipmentType, r.equipment, 1, inspectionStatus(r) === 'OK' ? 1 : 0, inspectionStatus(r) === 'NOT OK' ? 1 : 0]),
    ];
    const faultRows = [
      ['Equipment Type', 'Equipment', 'Checklist Item', 'Fault Count'],
      ...m.occ.map((f) => { const r = m.r.find((x) => faults(x).includes(f)); return [r?.equipmentType || '', r?.equipment || '', f.label || 'Unknown', 1]; }),
    ];
    for (const [name, rows] of [['Executive Summary', summary], ['Inspection Analytics', inspectionRows], ['Fault Analytics', faultRows], ['Equipment Analytics', equipmentRows]] as [string, any[][]][]) {
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
    }
    XLSX.writeFile(book, 'Daily_Checking_Analytics.xlsx');
  };

  // Initial load only (no data yet): a full skeleton/loading state is fine.
  if (fetching && !data) return <div style={{ maxWidth: 1200, margin: 'auto', padding: 24, color: '#6B6963' }}>Loading analytics…</div>;
  // Initial load failed outright (nothing to show at all yet): full error state.
  if (error && !data) return <div style={{ maxWidth: 1200, margin: 'auto', padding: 24 }}><div style={{ ...cardStyle, color: '#B91C1C' }}>{error} <button className="btn-link-blue" onClick={load}>Retry</button></div></div>;

  return (
    <div style={{ maxWidth: 1200, margin: 'auto', padding: '24px 16px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            Analytics{fetching && <span style={{ fontSize: 12, fontWeight: 500, color: '#2563EB' }}>Updating…</span>}
          </h1>
          <p style={{ margin: '5px 0', color: '#6B6963' }}>Fleet inspection and fault performance</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={exportExcel}>Export Excel</button>
          <button className="btn-primary" onClick={exportPdf}>Export PDF</button>
        </div>
      </div>

      {/* ── Global filters — authoritative for KPIs, charts, and the embedded Fault Analysis panel below ── */}
      <div style={{ ...cardStyle, marginBottom: 18 }}>
        <div className="filter-grid">
          <Field label="Date Range">
            <select className="form-input" value={filters.period} onChange={(e) => updateFilter('period', e.target.value)}>
              {Object.entries(periodLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {filters.period === 'custom' && <>
            <Field label="Start"><input type="date" className="form-input" value={filters.start || ''} onChange={(e) => updateFilter('start', e.target.value)} /></Field>
            <Field label="End"><input type="date" className="form-input" value={filters.end || ''} onChange={(e) => updateFilter('end', e.target.value)} /></Field>
          </>}
          <Field label="Equipment Type">
            <select className="form-input" value={filters.equipmentType} onChange={(e) => updateFilter('equipmentType', e.target.value)}>
              <option value="all">All Equipment</option>
              {data?.equipmentTypes.map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="Equipment">
            <select className="form-input" value={filters.equipment} onChange={(e) => updateFilter('equipment', e.target.value)}>
              <option value="all">All Equipment</option>
              {data?.equipment.filter((x) => filters.equipmentType === 'all' || x.startsWith(filters.equipmentType)).map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="Checklist Result">
            <select className="form-input" value={filters.result} onChange={(e) => updateFilter('result', e.target.value)}>
              <option value="all">All</option><option>OK</option><option>NOT OK</option>
            </select>
          </Field>
          <button className="btn-secondary" style={{ alignSelf: 'end' }} onClick={() => setFilters(initialFilters)}>Reset Filters</button>
        </div>
      </div>

      {/* A failed refetch never wipes out the last good data — it shows as a
          dismissible-by-retry banner above the still-visible dashboard, so the
          user always knows whether they're looking at live or stale-on-error data. */}
      {error && <div style={{ ...cardStyle, color: '#B91C1C', marginBottom: 18 }}>{error} — showing the last successfully loaded data. <button className="btn-link-blue" onClick={load}>Retry</button></div>}

      <div style={{ opacity: fetching ? 0.6 : 1, transition: 'opacity 150ms' }}>
        {equipment
          ? <EquipmentDrilldown m={m} name={equipment} back={() => setEquipment(null)} />
          : <>
              <div style={{ display: 'flex', gap: 5, borderBottom: '1px solid #ddd', marginBottom: 18 }}>
                {(['overview', 'inspections', 'faults'] as const).map((x) => (
                  <button key={x} onClick={() => setTab(x)} style={{
                    padding: '10px 14px', textTransform: 'capitalize', background: 'none', border: 'none',
                    borderBottom: tab === x ? '2px solid #2563EB' : '2px solid transparent',
                    color: tab === x ? '#2563EB' : '#6B6963', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}>{x}</button>
                ))}
              </div>
              {tab === 'overview' && (
                <OverviewTab m={m} volumeAndFaultsTrend={volumeAndFaultsTrend} avgLabel={avgLabel}
                  onDrillEquipment={drillToEquipment} onDrillItem={drillToItem} onDrillDate={drillToDate}
                  drillEquipment={drillEquipment} drillItem={drillItem} drillDate={drillDate} onClearDrill={clearDrill}
                  faultAnalysisRef={faultAnalysisRef}
                  filters={filters}
                  onNavigateToRecord={onNavigateToRecord && ((refId: string) => onNavigateToRecord(refId, { filters, tab, drillEquipment, drillItem, drillDate }))}
                  initialDate={initialDate} />
              )}
              {tab === 'inspections' && <InspectionsTab m={m} avgLabel={avgLabel} select={setEquipment} />}
              {tab === 'faults' && <FaultsTab m={m} onDrillDate={drillToDate} onDrillEquipment={drillToEquipment} onDrillItem={drillToItem} />}
            </>}
      </div>
    </div>
  );
}

// ─── Overview tab ───────────────────────────────────────────────────────────

function OverviewTab({ m, volumeAndFaultsTrend, avgLabel, onDrillEquipment, onDrillItem, onDrillDate, drillEquipment, drillItem, drillDate, onClearDrill, faultAnalysisRef, filters, onNavigateToRecord, initialDate }: {
  m: Metrics; volumeAndFaultsTrend: { label: string; inspections: number; equipmentWithFaults: number }[];
  avgLabel: string;
  onDrillEquipment: (x: string) => void; onDrillItem: (x: string) => void; onDrillDate: (x: string) => void;
  drillEquipment: string | null; drillItem: string | null; drillDate: string | null; onClearDrill: () => void;
  faultAnalysisRef: React.RefObject<HTMLDivElement | null>;
  filters: AnalyticsFilters; onNavigateToRecord?: (id: string) => void; initialDate?: string;
}) {
  // Fault Rate and NOT OK Inspections are intentionally not surfaced here —
  // detailed fault-rate figures live in the Faults tab; the Overview stays
  // high-level (spec: remove Fault Rate / NOT OK Inspections KPIs).
  const kpis: [string, string | number][] = [
    ['Total Inspections', m.r.length], ['Average Inspections', avgLabel], ['OK Inspections', m.ok],
    ['Equipment Inspected', m.eq.length], ['Equipment With Faults', m.feq.length],
  ];
  const drillParts = [drillEquipment, drillItem, drillDate].filter(Boolean) as string[];
  // Whatever brought the user into this panel — an equipment bar, a
  // checklist-item bar, or nothing at all — Fault Analysis must reflect
  // Analytics' own selected period, not silently fall back to "Today". A
  // clicked date point narrows that down to just the one day; otherwise use
  // Analytics' full resolved range.
  const faultAnalysisDateRange = drillDate ? { start: drillDate, end: drillDate } : bounds(filters);
  return (
    <>
      <div className="analytics-kpis">
        {kpis.map((x) => (
          <div key={x[0]} style={cardStyle}>
            <div style={{ fontSize: 12, color: '#6B6963' }}>{x[0]}</div>
            <div style={{ fontSize: 27, fontWeight: 700, marginTop: 7 }}>{x[1]}</div>
          </div>
        ))}
      </div>

      <div className="analytics-charts cols-2">
        <Card title="Inspection Volume & Equipment With Faults">
          {/* Only the Equipment With Faults series is a navigation control —
              Inspection Volume stays a plain, inert line so the two clicks
              can never be confused with each other. A point with no faults
              (nothing to drill into) is a no-op rather than opening an
              always-empty Fault Analysis view. */}
          <Trend data={volumeAndFaultsTrend} series={[
            { key: 'inspections', name: 'Inspection Volume', color: '#2563EB' },
            {
              key: 'equipmentWithFaults', name: 'Equipment With Faults', color: '#DC2626',
              onPointClick: (point) => { if (point?.equipmentWithFaults > 0) onDrillDate(point.label); },
            },
          ]} />
        </Card>
        <Card title="Inspection Result"><Donut ok={m.ok} bad={m.bad.length} /></Card>
      </div>

      <div className="analytics-charts cols-2">
        {/* Clicking a bar drills into the Detailed Fault Analysis panel below,
            scoped to that equipment/checklist item — no page navigation, so
            every other Analytics filter, tab, and scroll position stays put. */}
        <Card title="Faults by Equipment"><Bars data={m.feq} onClick={onDrillEquipment} /></Card>
        <Card title="Faults by Checklist Item"><Bars data={m.items} onClick={onDrillItem} /></Card>
      </div>

      <section ref={faultAnalysisRef} style={{ marginTop: 4, scrollMarginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8, padding: '0 2px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#9C9A92', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Detailed Fault Analysis
          </div>
          {drillParts.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#2563EB', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 999, padding: '4px 10px' }}>
              Filtered to <b>{drillParts.join(' · ')}</b>
              <button className="btn-link-blue" style={{ fontSize: 12, padding: 0 }} onClick={onClearDrill}>Clear</button>
            </div>
          )}
        </div>
        <FaultAnalysisPanel
          initialDate={initialDate}
          dateRange={faultAnalysisDateRange}
          onNavigateToRecord={onNavigateToRecord}
          equipmentTypeFilter={filters.equipmentType}
          equipmentFilter={drillEquipment || filters.equipment}
          checklistItemFilter={drillItem || ''}
        />
      </section>
    </>
  );
}

// ─── Inspections tab ────────────────────────────────────────────────────────

function InspectionsTab({ m, avgLabel, select }: { m: Metrics; avgLabel: string; select: (x: string) => void }) {
  const kpis: [string, string | number][] = [
    ['Total Inspections', m.r.length], ['Average Inspections', avgLabel], ['OK Inspections', m.ok], ['NOT OK Inspections', m.bad.length],
  ];
  const week = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((label) => ({
    label, value: m.days.find((x) => x.label === label)?.value || 0,
  }));
  return (
    <>
      <div className="analytics-kpis">
        {kpis.map((x) => (
          <div key={x[0]} style={cardStyle}>
            <div style={{ fontSize: 12, color: '#6B6963' }}>{x[0]}</div>
            <div style={{ fontSize: 27, fontWeight: 700, marginTop: 7 }}>{x[1]}</div>
          </div>
        ))}
      </div>
      {/* Inspection Result Distribution removed here — it's still shown once,
          on the Overview, beside the primary line chart (spec: don't remove
          Inspection Result from the app, just this duplicate). */}
      <div className="analytics-charts cols-2">
        <Card title="Inspection Volume"><Trend data={m.date} series={[{ key: 'value', name: 'Inspections', color: '#2563EB' }]} /></Card>
        <Card title="Inspections by Equipment Type"><Bars data={m.type} /></Card>
        <Card title="Inspections by Equipment"><Bars data={m.eq} onClick={select} /></Card>
        <Card title="Inspection Activity by Day"><Bars data={week} /></Card>
      </div>
    </>
  );
}

// ─── Faults tab ─────────────────────────────────────────────────────────────

function FaultsTab({ m, onDrillDate, onDrillEquipment, onDrillItem }: {
  m: Metrics;
  onDrillDate: (x: string) => void; onDrillEquipment: (x: string) => void; onDrillItem: (x: string) => void;
}) {
  return (
    <div className="analytics-charts cols-2">
      {/* Fault Trend doubles as a date-based navigation control into the
          Overview's embedded Fault Analysis — same click → date → Fault
          Analysis workflow as the Overview's Equipment With Faults series,
          just reached from this chart instead. A day with zero faults isn't
          made clickable (nothing to drill into). */}
      <Card title="Fault Trend">
        <Trend data={m.fdate} series={[{
          key: 'value', name: 'Faults', color: '#DC2626',
          onPointClick: (point) => { if (point?.value > 0) onDrillDate(point.label); },
        }]} />
      </Card>
      <Card title="Faults by Equipment Type"><Bars data={m.ftype} /></Card>
      <Card title="Faults by Equipment"><Bars data={m.feq} onClick={onDrillEquipment} /></Card>
      <Card title="Faults by Checklist Item"><Bars data={m.items} onClick={onDrillItem} /></Card>
      <section style={cardStyle}>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Repeat Fault Analysis</h3>
        {m.items.length
          ? <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr><th align="left">Checklist Item</th><th align="right">Occurrences</th></tr></thead>
              <tbody>{m.items.slice(0, 10).map((x) => (
                <tr key={x.label}><td style={{ padding: '9px 0', borderTop: '1px solid #eee' }}>{x.label}</td><td style={{ borderTop: '1px solid #eee' }} align="right">{x.value}</td></tr>
              ))}</tbody>
            </table>
          : <Empty text="No failed checklist items found." />}
      </section>
    </div>
  );
}

// ─── Single-equipment drill-down (from a bar chart click) ─────────────────

function EquipmentDrilldown({ m, name, back }: { m: Metrics; name: string; back: () => void }) {
  const r = m.r.filter((x) => x.equipment === name);
  const bad = r.filter((x) => inspectionStatus(x) === 'NOT OK');
  const date = group(r.map((x) => ({ key: x.date }))).sort((a, b) => a.label.localeCompare(b.label));
  const fd = group(r.flatMap((x) => faults(x).map(() => ({ key: x.date })))).sort((a, b) => a.label.localeCompare(b.label));
  const items = group(r.flatMap((x) => faults(x).map((f) => ({ key: f.label || 'Unknown' }))));
  return (
    <>
      <button className="btn-link-blue" onClick={back}>← Back to Analytics</button>
      <h2 style={{ marginBottom: 2 }}>{name}</h2>
      <p style={{ color: '#6B6963', marginTop: 0 }}>Equipment Type: {r[0]?.equipmentType || '—'}</p>
      <div className="analytics-kpis">
        {([['Total Inspections', r.length], ['OK Inspections', r.length - bad.length], ['Faults', bad.length], ['Fault Rate', (r.length ? (bad.length / r.length) * 100 : 0).toFixed(1) + '%']] as [string, string | number][]).map((x) => (
          <div style={cardStyle} key={x[0]}>
            <div style={{ fontSize: 12, color: '#6B6963' }}>{x[0]}</div>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 7 }}>{x[1]}</div>
          </div>
        ))}
      </div>
      <div className="analytics-charts">
        <Card title="Inspection Trend"><Trend data={date} series={[{ key: 'value', name: 'Inspections', color: '#2563EB' }]} /></Card>
        <Card title="Fault Trend"><Trend data={fd} series={[{ key: 'value', name: 'Faults', color: '#DC2626' }]} /></Card>
        <Card title="Inspection Result"><Donut ok={r.length - bad.length} bad={bad.length} /></Card>
        <Card title="Faults by Checklist Item"><Bars data={items} /></Card>
      </div>
    </>
  );
}
