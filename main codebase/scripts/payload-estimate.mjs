import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://osfmblhsjzqnwagbwctz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_MFIMSQtrqoCVaoC07gM3zA_SAMEXQqD';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
});

function kb(value) {
  const bytes = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  return { bytes, kb: bytes / 1024 };
}

async function main() {
  const out = [];

  // Records: server-side pagination, explicit columns, exclude checklist
  const recordsSel =
    'id, ref_id, department, section, equipment_type, equipment_code, equipment_number, date, start_time, completion_time, hour_meter, technician, supervisor, qc_verifier, submitted_at, created_at';
  const rec = await supabase
    .from('records')
    .select(recordsSel, { count: 'exact' })
    .order('submitted_at', { ascending: false })
    .range(0, 14);
  out.push({ name: 'records_page_1', ...kb(rec.data), rows: rec.data?.length ?? 0, count: rec.count ?? null, error: rec.error?.message ?? null });

  // Logs: capped history
  const logs = await supabase
    .from('activity_logs')
    .select('id, type, description, actor, section, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  out.push({ name: 'logs_latest_100', ...kb(logs.data), rows: logs.data?.length ?? 0, error: logs.error?.message ?? null });

  // Settings
  const settings = await supabase
    .from('settings')
    .select('nav_logo, home_logo, qc_required, footer_text')
    .eq('id', 1)
    .single();
  out.push({ name: 'settings', ...kb(settings.data), error: settings.error?.message ?? null });

  // Admins (targeted refresh)
  const admins = await supabase
    .from('admins')
    .select('id, email, password, password_set, is_super_admin, role, can_delete_records, can_add_admins, created_at')
    .order('created_at', { ascending: true });
  out.push({ name: 'admins', ...kb(admins.data), rows: admins.data?.length ?? 0, error: admins.error?.message ?? null });

  // Structure
  const depts = await supabase.from('departments').select('id, name, created_at').order('created_at', { ascending: true });
  out.push({ name: 'departments', ...kb(depts.data), rows: depts.data?.length ?? 0, error: depts.error?.message ?? null });

  const secs = await supabase.from('sections').select('id, name, department_id, created_at').order('created_at', { ascending: true });
  out.push({ name: 'sections', ...kb(secs.data), rows: secs.data?.length ?? 0, error: secs.error?.message ?? null });

  const eq = await supabase.from('equipment_types').select('id, name, code, created_at').order('created_at', { ascending: true });
  out.push({ name: 'equipment_types', ...kb(eq.data), rows: eq.data?.length ?? 0, error: eq.error?.message ?? null });

  const templates = await supabase
    .from('checklist_templates')
    .select('id, equipment_type_id, section_id, items, updated_at');
  out.push({ name: 'checklist_templates', ...kb(templates.data), rows: templates.data?.length ?? 0, error: templates.error?.message ?? null });

  const fieldConfigs = await supabase
    .from('field_configs')
    .select('id, key, label, field_type, required, options, sort_order, is_built_in, is_active, updated_at, equipment_type_id')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  out.push({ name: 'field_configs', ...kb(fieldConfigs.data), rows: fieldConfigs.data?.length ?? 0, error: fieldConfigs.error?.message ?? null });

  const totalBytes = out.reduce((a, x) => a + (x.bytes ?? 0), 0);

  console.log(JSON.stringify({ requests: out, totalBytes, totalKb: totalBytes / 1024 }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

