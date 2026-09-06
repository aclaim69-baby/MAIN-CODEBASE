/**
 * toastContext.tsx
 * ═══════════════════════════════════════════════════════════════════
 * Global toast notification system.
 *
 * WHY GLOBAL?
 * -----------
 * When Toast was rendered inside TechnicianFlow, calling setStep('done')
 * caused the entire TechnicianFlow tree (including the toast) to re-render
 * or unmount before the user could see the notification.
 *
 * Moving the toast to a React Context that lives above App solves this:
 * the toast DOM node is never unmounted by step/page transitions.
 *
 * PUBLIC API
 * ----------
 *   // In any component:
 *   const { showToast } = useGlobalToast();
 *   showToast('success', 'Record saved successfully');
 *   // status: 'success' | 'queued' | 'failed' | 'error' | 'duplicate'
 *   //   'duplicate' = informational (blue), NOT an error — used when a
 *   //   checklist for this equipment/date already exists server-side.
 *
 *   // In main.tsx / App root:
 *   <ToastProvider>
 *     <App />
 *     <GlobalToastRenderer />
 *   </ToastProvider>
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export type ToastStatus = 'success' | 'queued' | 'failed' | 'error' | 'duplicate';

interface ToastState {
  status: ToastStatus | null;
  message: string;
  visible: boolean;
  /** Increments each time showToast fires — forces re-render even for same message */
  key: number;
}

interface ToastContextValue {
  toast: ToastState;
  showToast: (status: ToastStatus, message: string) => void;
  dismissToast: () => void;
}

// ── Duration each toast stays visible (ms) ───────────────────────────────────

const DURATION: Record<ToastStatus, number> = {
  success:   4000,
  queued:    6000,
  failed:    7000,
  error:     7000,
  duplicate: 6500,
};

// ── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>({
    status: null,
    message: '',
    visible: false,
    key: 0,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((status: ToastStatus, message: string) => {
    console.log('[Toast] triggered:', status, message);

    // Clear any pending auto-dismiss from a previous toast
    if (timerRef.current) clearTimeout(timerRef.current);

    setToast((prev) => ({ status, message, visible: true, key: prev.key + 1 }));

    timerRef.current = setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, DURATION[status]);
  }, []);

  const dismissToast = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  // Cleanup timer on unmount (provider lives for app lifetime, but be correct)
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <ToastContext.Provider value={{ toast, showToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useGlobalToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useGlobalToast must be used inside <ToastProvider>');
  }
  return ctx;
}

// ── Visual config per status ─────────────────────────────────────────────────

const CONFIG: Record<ToastStatus, { bg: string; border: string; textColor: string; icon: React.ReactNode }> = {
  success: {
    bg: '#F0FDF4',
    border: '#86EFAC',
    textColor: '#14532D',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
  },
  queued: {
    bg: '#FFFBEB',
    border: '#FCD34D',
    textColor: '#78350F',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="#D97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  failed: {
    bg: '#FEF2F2',
    border: '#FCA5A5',
    textColor: '#7F1D1D',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
  error: {
    bg: '#FEF2F2',
    border: '#FCA5A5',
    textColor: '#7F1D1D',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
  },
  // "duplicate": informational, NOT an error — this fires when a checklist for
  // the equipment/date already exists (one-per-day is intentional). Styled in
  // blue rather than red so it reads as a status notice, not a failure.
  duplicate: {
    bg: '#EFF6FF',
    border: '#93C5FD',
    textColor: '#1E3A8A',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="11" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  },
};

// ── Global renderer — place this once, at the very top of App (or in main.tsx) ──

export function GlobalToastRenderer() {
  const { toast, dismissToast } = useGlobalToast();

  if (!toast.status || !toast.visible) return null;

  const cfg = CONFIG[toast.status];

  return (
    <div
      key={toast.key}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        // ── Positioning: fixed, above everything, centred horizontally ──
        position: 'fixed',
        bottom: 28,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 99999,          // above modals, overlays, header

        // ── Layout ──
        display: 'flex',
        alignItems: 'center',
        gap: 10,

        // ── Sizing ──
        padding: '13px 16px',
        borderRadius: 12,
        maxWidth: 'min(440px, calc(100vw - 32px))',
        minWidth: 260,
        width: 'max-content',

        // ── Appearance ──
        background: cfg.bg,
        border: `1.5px solid ${cfg.border}`,
        boxShadow: '0 6px 24px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.08)',

        // ── Animation ──
        animation: 'dc-toast-in 0.25s cubic-bezier(0.21, 1.02, 0.73, 1) both',
      }}
    >
      {/* Icon */}
      <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        {cfg.icon}
      </span>

      {/* Message */}
      <span style={{
        flex: 1,
        fontSize: 14,
        fontWeight: 500,
        color: cfg.textColor,
        lineHeight: 1.45,
        userSelect: 'none',
      }}>
        {toast.message}
      </span>

      {/* Dismiss button */}
      <button
        onClick={dismissToast}
        aria-label="Dismiss"
        style={{
          flexShrink: 0,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '2px 2px 2px 6px',
          lineHeight: 0,
          color: cfg.textColor,
          opacity: 0.5,
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.5')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <style>{`
        @keyframes dc-toast-in {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(14px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
