/**
 * metrics.ts — Lightweight in-memory performance metrics for this app.
 *
 * Tracks:
 *   - Realtime events received per table
 *   - API (HTTP) calls fired (polls, targeted refreshes)
 *   - Safety-net polls fired
 *   - Session start time
 *
 * Access via window.__appMetrics in the browser console, or call
 * getMetricsSummary() to get a formatted snapshot.
 *
 * Zero dependencies. Zero overhead when not inspected.
 * Tree-shaken out of production bundles if metrics calls are removed.
 */

export interface MetricsSnapshot {
  sessionDurationSec: number;
  realtimeEvents:     Record<string, number>; // table → count
  apiCalls:           number;                 // total HTTP fetches to Supabase
  safetyNetPolls:     number;                 // 30s interval fires
  broadcastReceived:  number;                 // broadcast signals received
  broadcastSent:      number;                 // broadcast signals sent
  targetedRefreshes:  number;                 // admin-panel targeted fetches
  payloadKbByRequest: Record<string, number>; // label -> total KB
  payloadKbTotal:     number;                 // derived total KB across requests
  apiCallsPerMin:     number;                 // derived
  realtimePerMin:     number;                 // derived
}

const _start = Date.now();

const _state = {
  realtimeEvents:    {} as Record<string, number>,
  apiCalls:          0,
  safetyNetPolls:    0,
  broadcastReceived: 0,
  broadcastSent:     0,
  targetedRefreshes: 0,
  payloadBytesByRequest: {} as Record<string, number>,
};

export const metrics = {
  /** Call when any postgres_changes event is received */
  realtimeEvent(table: string): void {
    _state.realtimeEvents[table] = (_state.realtimeEvents[table] ?? 0) + 1;
  },

  /** Call for every HTTP fetch to Supabase (poll, targeted refresh, etc.) */
  apiCall(): void {
    _state.apiCalls += 1;
  },

  /** Call when the 30-second safety-net interval fires */
  safetyNetPoll(): void {
    _state.safetyNetPolls += 1;
    _state.apiCalls += 1;
  },

  /** Call when a broadcast 'refresh' signal is received */
  broadcastReceived(): void {
    _state.broadcastReceived += 1;
  },

  /** Call when a broadcast 'refresh' signal is sent */
  broadcastSent(): void {
    _state.broadcastSent += 1;
  },

  /** Call when an admin-panel targeted refresh fires */
  targetedRefresh(): void {
    _state.targetedRefreshes += 1;
    _state.apiCalls += 1;
  },

  /** Return a full snapshot with derived rates */
  getSnapshot(): MetricsSnapshot {
    const sessionSec = (Date.now() - _start) / 1000;
    const sessionMin = Math.max(sessionSec / 60, 0.01);
    const payloadKbByRequest: Record<string, number> = {};
    let payloadBytesTotal = 0;
    for (const [k, bytes] of Object.entries(_state.payloadBytesByRequest)) {
      payloadKbByRequest[k] = parseFloat((bytes / 1024).toFixed(2));
      payloadBytesTotal += bytes;
    }
    return {
      sessionDurationSec: Math.round(sessionSec),
      realtimeEvents:     { ..._state.realtimeEvents },
      apiCalls:           _state.apiCalls,
      safetyNetPolls:     _state.safetyNetPolls,
      broadcastReceived:  _state.broadcastReceived,
      broadcastSent:      _state.broadcastSent,
      targetedRefreshes:  _state.targetedRefreshes,
      payloadKbByRequest,
      payloadKbTotal:     parseFloat((payloadBytesTotal / 1024).toFixed(2)),
      apiCallsPerMin:     parseFloat((_state.apiCalls / sessionMin).toFixed(2)),
      realtimePerMin:     parseFloat(
        (Object.values(_state.realtimeEvents).reduce((a, b) => a + b, 0) / sessionMin).toFixed(2)
      ),
    };
  },

  /**
   * Record an estimated payload size for an HTTP request.
   * Note: Supabase JS doesn't expose transfer-size, so we estimate bytes as
   * UTF-8 JSON string length of the response `data` (plus a tiny constant).
   */
  payload(label: string, bytes: number): void {
    if (!label) return;
    const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    _state.payloadBytesByRequest[label] = (_state.payloadBytesByRequest[label] ?? 0) + safeBytes;
    const kb = safeBytes / 1024;
    // Keep logs compact but always present for monitoring.
    console.debug(`[payload] ${label}: ${kb.toFixed(2)} KB`);
  },

  /** Log a human-readable summary to the console */
  logSummary(): void {
    const s = metrics.getSnapshot();
    console.group('[metrics] 📊 Performance Summary');
    console.log(`Session: ${s.sessionDurationSec}s`);
    console.log(`API calls: ${s.apiCalls} total (${s.apiCallsPerMin}/min)`);
    console.log(`Payload: ${s.payloadKbTotal} KB total`, s.payloadKbByRequest);
    console.log(`Safety-net polls: ${s.safetyNetPolls}`);
    console.log(`Targeted refreshes: ${s.targetedRefreshes}`);
    console.log(`Broadcast sent: ${s.broadcastSent} | received: ${s.broadcastReceived}`);
    console.log(`Realtime events: ${s.realtimePerMin}/min`, s.realtimeEvents);

    // ── Monthly Free Tier projection ─────────────────────────────────────
    // Extrapolate current session rate to 50 users × 8h/day × 22 workdays.
    const USERS = 50;
    const HOURS_PER_DAY = 8;
    const WORK_DAYS = 22;
    const sessionHours = s.sessionDurationSec / 3600;
    if (sessionHours > 0.01) { // only project after >36 seconds of data
      const callsPerHour = s.apiCalls / sessionHours;
      const projectedMonthly = Math.round(callsPerHour * HOURS_PER_DAY * WORK_DAYS * USERS);
      const projectedEgressMb = parseFloat(((s.payloadKbTotal / 1024) / sessionHours * HOURS_PER_DAY * WORK_DAYS * USERS).toFixed(1));
      const reqPct = ((projectedMonthly / 50_000) * 100).toFixed(1);
      const egressPct = ((projectedEgressMb / 500) * 100).toFixed(1);
      console.group('[metrics] 📈 Free Tier Projection (50 users × 8h × 22 days)');
      console.log(`REST requests: ~${projectedMonthly.toLocaleString()} / 50,000 (${reqPct}%)`);
      console.log(`Egress:        ~${projectedEgressMb} MB / 500 MB (${egressPct}%)`);
      if (projectedMonthly > 45_000) console.warn('[metrics] ⚠️  Approaching REST request limit!');
      if (projectedEgressMb > 450)   console.warn('[metrics] ⚠️  Approaching egress limit!');
      console.groupEnd();
    }
    console.groupEnd();

    // ── Threshold warnings ────────────────────────────────────────────────
    if (s.apiCallsPerMin > 10) {
      console.warn('[metrics] ⚠️  API calls > 10/min — check for polling loops or missing realtime');
    }
    if (s.realtimePerMin > 60) {
      console.warn('[metrics] ⚠️  Realtime events > 60/min — consider table-level filters');
    }
    if (s.safetyNetPolls > 5 && s.sessionDurationSec < 300) {
      console.warn('[metrics] ⚠️  Safety-net fired >5x in <5 min — realtime may not be working');
    }
  },
};

/**
 * Expose on window for browser console inspection.
 *
 * Usage in Chrome DevTools:
 *   window.__appMetrics.getSnapshot()   // structured data
 *   window.__appMetrics.logSummary()    // formatted log with Free Tier projection
 *
 * Example output:
 *   Session: 142s
 *   API calls: 7 total (2.95/min)
 *   Payload: 18.4 KB total
 *   📈 Free Tier Projection: ~9,840 requests / 50,000 (19.7%)
 */
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__appMetrics = metrics;
}