/**
 * StorageWarningBanner.tsx — Persistent, visible storage warning system.
 *
 * VISIBILITY RULES:
 *   'warning'  → Yellow banner, dismissible. Shown once per session until dismissed
 *                or usage drops back below WARN_THRESHOLD_MB.
 *   'critical' → Red banner, NON-dismissible. Shown permanently until data is cleared.
 *   'exceeded' → Red banner (darker), NON-dismissible. Shown when an actual
 *                QuotaExceededError was caught. Submission is permanently blocked.
 *   'none'     → Nothing rendered (null).
 *
 * PLACEMENT:
 *   Rendered between <LastUpdatedBar> and <main> in App.tsx.
 *   Position: sticky, below the header, high z-index.
 *
 * WHY NON-DISMISSIBLE FOR CRITICAL/EXCEEDED:
 *   A user who dismisses a "storage full" warning may believe the problem is
 *   resolved. Forcing them to see the banner ensures they understand new
 *   submissions are not being persisted.
 */

import { useStorageMonitor } from '../lib/storageMonitor';
import { WARN_THRESHOLD_MB, BLOCK_THRESHOLD_MB } from '../lib/safeStorage';

export default function StorageWarningBanner() {
  const { warningLevel, displayMessage, usageMB, isDismissed, dismissWarning } =
    useStorageMonitor();

  // Nothing to show
  if (warningLevel === 'none') return null;
  // User dismissed the non-critical warning this session
  if (warningLevel === 'warning' && isDismissed) return null;

  const isBlocking = warningLevel === 'critical' || warningLevel === 'exceeded';
  const isDismissible = warningLevel === 'warning';

  // ── Colour palette ──
  const palette = {
    warning: {
      bg: '#FFFBEB',
      border: '#FCD34D',
      icon: '⚠️',
      iconBg: '#FEF3C7',
      titleColor: '#92400E',
      textColor: '#78350F',
      barColor: '#FBBF24',
      label: 'Storage Warning',
    },
    critical: {
      bg: '#FFF1F1',
      border: '#FCA5A5',
      icon: '🔴',
      iconBg: '#FEE2E2',
      titleColor: '#991B1B',
      textColor: '#7F1D1D',
      barColor: '#EF4444',
      label: 'Storage Critical',
    },
    exceeded: {
      bg: '#FFF1F1',
      border: '#F87171',
      icon: '🚨',
      iconBg: '#FEE2E2',
      titleColor: '#7F1D1D',
      textColor: '#7F1D1D',
      barColor: '#DC2626',
      label: 'Storage Full',
    },
  }[warningLevel];

  // Calculate the progress bar fill %
  const progressPct = Math.min((usageMB / 5) * 100, 100);

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 49, // below header (50) but above content
        background: palette.bg,
        borderBottom: `2px solid ${palette.border}`,
        padding: '10px 16px',
      }}
    >
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'flex-start', gap: 12 }}>

        {/* Icon */}
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            background: palette.iconBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontSize: 16,
          }}
        >
          {palette.icon}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: palette.titleColor }}>
              {palette.label}
            </span>
            {/* Dismiss button — only for warning level */}
            {isDismissible && (
              <button
                onClick={dismissWarning}
                aria-label="Dismiss storage warning"
                style={{
                  background: 'none',
                  border: '1px solid rgba(0,0,0,0.15)',
                  borderRadius: 6,
                  padding: '2px 10px',
                  fontSize: 11,
                  color: palette.textColor,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  flexShrink: 0,
                }}
              >
                Dismiss
              </button>
            )}
          </div>

          {/* Message */}
          <p style={{ fontSize: 13, color: palette.textColor, margin: '3px 0 6px', lineHeight: 1.5 }}>
            {displayMessage}
          </p>

          {/* Progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                flex: 1,
                height: 4,
                background: 'rgba(0,0,0,0.08)',
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progressPct}%`,
                  height: '100%',
                  background: palette.barColor,
                  borderRadius: 4,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
            <span style={{ fontSize: 11, color: palette.textColor, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {usageMB.toFixed(2)} / ~5.0 MB
            </span>
          </div>

          {/* Action hints */}
          {isBlocking && (
            <div style={{ marginTop: 8, fontSize: 12, color: palette.textColor }}>
              <strong>What to do:</strong>
              {' '}Open <strong>Admin Panel → Settings</strong> and check for any large data.
              Note: inspection records are no longer stored in this device&rsquo;s browser storage
              — they are saved directly to the server. If this warning appears, it may be caused
              by an unusually large app configuration. Contact your system administrator.
              {warningLevel === 'exceeded' && (
                <span> After clearing, <strong>reload this page</strong> to resume normal operation.</span>
              )}
            </div>
          )}

          {/* Threshold markers (visible at warning level only) */}
          {warningLevel === 'warning' && (
            <div style={{ marginTop: 4, fontSize: 11, color: palette.textColor, opacity: 0.75 }}>
              Submissions blocked at {BLOCK_THRESHOLD_MB.toFixed(0)} MB.
              Current usage: {usageMB.toFixed(2)} MB (warning threshold: {WARN_THRESHOLD_MB.toFixed(0)} MB).
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
