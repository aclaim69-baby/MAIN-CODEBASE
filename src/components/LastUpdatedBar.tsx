/**
 * LastUpdatedBar.tsx
 *
 * A slim bar shown below the header on every page.
 *
 * ALL USERS see:
 *   ● Live | Data synced across all devices
 *
 * ADMIN USERS ONLY also see (right side):
 *   🕐 Last updated: 32s ago (14:32:07)
 *
 * The "Last updated" timestamp is admin-only because technicians
 * don't need to know sync timing — they just need to know data is live.
 * Admins monitoring the system benefit from seeing exactly when data
 * last refreshed.
 */

import { useState, useEffect } from 'react';
import { useStore } from '../store';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diffMs  = Date.now() - new Date(iso).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5)  return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr  < 24) return `${diffHr}h ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatAbsolute(iso: string | null): string {
  if (!iso) return '';
  const d   = new Date(iso);
  const now = new Date();
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth()    === now.getMonth()    &&
    d.getDate()     === now.getDate()
  ) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LastUpdatedBar() {
  const lastSyncedAt        = useStore((s) => s.lastSyncedAt);
  const isRealtimeConnected = useStore((s) => s.isRealtimeConnected);
  // currentAdmin is null for technicians, set for any logged-in admin
  const currentAdmin        = useStore((s) => s.currentAdmin);
  const isAdmin             = currentAdmin !== null;

  // Tick every second so the "X ago" label updates live (admin only)
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isAdmin) return; // no need to tick if we're not showing the timestamp
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isAdmin]);

  const relativeLabel = formatAgo(lastSyncedAt);
  const absoluteLabel = formatAbsolute(lastSyncedAt);
  const connected     = isRealtimeConnected;

  const dotColor  = connected ? '#22C55E' : '#F59E0B';
  const dotShadow = connected
    ? '0 0 0 2px rgba(34,197,94,0.25)'
    : '0 0 0 2px rgba(245,158,11,0.20)';
  const statusLabel = connected ? 'Live' : 'Syncing…';
  const statusColor = connected ? '#166534' : '#92400E';

  return (
    <div
      style={{
        width: '100%',
        background: '#FFFFFF',
        borderBottom: '0.5px solid rgba(0,0,0,0.08)',
        padding: '5px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 30,
      }}
    >
      <div
        style={{
          maxWidth: 960,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        {/* LEFT — Connection status dot + label (visible to ALL users) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: dotColor,
              boxShadow: dotShadow,
              flexShrink: 0,
              transition: 'background 0.4s, box-shadow 0.4s',
            }}
          />
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: statusColor,
              transition: 'color 0.4s',
            }}
          >
            {statusLabel}
          </span>
          <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.15)', margin: '0 2px' }}>|</span>
          <span style={{ fontSize: 11, color: '#9C9A92', fontWeight: 400 }}>
            Data synced across all devices
          </span>
        </div>

        {/* RIGHT — Last updated timestamp (ADMIN ONLY) */}
        {isAdmin && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9C9A92"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span style={{ fontSize: 11, color: '#6B6963', fontWeight: 500 }}>
              Last updated:
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: lastSyncedAt ? '#2563EB' : '#9C9A92',
                minWidth: 54,
              }}
            >
              {relativeLabel}
            </span>
            {absoluteLabel && (
              <span
                style={{
                  fontSize: 10,
                  color: '#9C9A92',
                  fontWeight: 400,
                  fontFamily: 'monospace',
                }}
              >
                ({absoluteLabel})
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}