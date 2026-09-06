/**
 * Toast.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTE: The global toast system has moved to src/lib/toastContext.tsx.
 *
 * The global system (ToastProvider + GlobalToastRenderer + useGlobalToast)
 * is mounted in main.tsx as a sibling of <App>, which means it is NEVER
 * unmounted by any page or step transition. This file is kept as a re-export
 * shim so any hypothetical future local usage still compiles cleanly.
 *
 * For all submission feedback, use:
 *   import { useGlobalToast } from '../lib/toastContext';
 *   const { showToast } = useGlobalToast();
 *   showToast('success' | 'queued' | 'failed' | 'error' | 'duplicate', message);
 */

export { useGlobalToast as useToast, GlobalToastRenderer as default } from '../lib/toastContext';
export type { ToastStatus } from '../lib/toastContext';
