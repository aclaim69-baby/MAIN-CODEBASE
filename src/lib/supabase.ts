import { createClient } from '@supabase/supabase-js';

const envSupabaseUrl = import.meta.env.VITE_SUPABASE_URL?.toString().trim();
const envSupabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.toString().trim();

if (!envSupabaseUrl || !envSupabaseKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Configure Supabase explicitly.');
}
const SUPABASE_URL = envSupabaseUrl;
const SUPABASE_ANON_KEY = envSupabaseKey;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: {
      apikey:          SUPABASE_ANON_KEY,
      // Reduce events/sec from 10 → 5. At 50 users × 5 checklists/day the
      // burst rate is low; 5/s is more than enough and cuts WS message overhead.
      eventsPerSecond: 5,
    },
    // 30s heartbeat (was 15s). Supabase keeps WS alive; 30s halves heartbeat
    // traffic with no practical impact on connection reliability.
    heartbeatIntervalMs: 30_000,
    reconnectAfterMs: (tries: number) => Math.min(tries * 1_000, 10_000),
  },
  global: {
    headers: {
      'x-app-name':    'daily-checking',
      'apikey':        SUPABASE_ANON_KEY,
    },
  },
  db: { schema: 'public' },
});

// ─── Connection health check ──────────────────────────────────────────────────

export async function checkSupabaseConnection(): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('records')
      .select('id', { head: true, count: 'exact' });

    if (error) {
      console.error('[supabase] ❌ Connection check failed:', error.message, '| code:', error.code);
      if (error.code === '42P01') {
        console.error('[supabase] Tables missing — run supabase/SETUP.sql then supabase/SECURITY_RLS_ENABLE.sql');
      } else if (error.code === 'PGRST301' || error.message?.includes('RLS') || error.message?.includes('row-level security')) {
        console.error('[supabase] RLS policy missing — run supabase/SECURITY_RLS_ENABLE.sql');
        console.error('  This script enables RLS with correct anon-role policies so the app works.');
      } else if (error.code === '42501' || error.message?.includes('permission denied')) {
        console.error('[supabase] Permission denied — re-run supabase/SECURITY_RLS_ENABLE.sql to restore grants');
      } else if (error.message?.includes('JWT') || error.message?.includes('token')) {
        console.error('[supabase] JWT invalid — check the anon key in supabase.ts');
      }
      return false;
    }

    console.debug('[supabase] ✅ Connection OK (RLS enabled with anon policies)');
    return true;
  } catch (err) {
    console.error('[supabase] ❌ Network exception:', err);
    return false;
  }
}
